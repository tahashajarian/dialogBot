# Production Operations Status

This document records the current Muze production deployment and the remaining
operational work. It intentionally contains no host IP, tokens, passwords,
private keys, environment values, or dashboard credentials.

Last verified: 2026-07-26

## Current deployment

- Provider/region: ParsPack VPS, Sweden
- Operating system: Ubuntu 24.04 LTS, x86_64
- Runtime: Node.js 24 LTS
- Database: MongoDB Community 8.0, standalone and local to the VPS
- Production database: `muze_telegram_production`
- Application path: `/opt/muze/app`
- Environment file: `/etc/muze/muze.env`
- Deployed commit at the last audit:
  `1f4c4e3c0ff62d72aba577408edad0ed7152048c`
- Telegram mode: polling, exactly one bot process
- Telegram network path: direct; `API_ROOT` and `TELEGRAM_PROXY_URL` are empty

Always compare the deployed commit with `origin/main` and confirm CI plus Secret
Scanning are green for that exact commit before treating a later revision as
production-approved.

## Accounts and access

- `muzeadmin` is the SSH administrator and uses `sudo`.
- `muze` is the locked, non-login application service account.
- Root SSH login is disabled.
- SSH password and keyboard-interactive authentication are disabled.
- Public-key SSH authentication is enabled.
- UFW defaults to deny incoming traffic and exposes only OpenSSH.
- The GitHub repository is accessed with a read-only deploy key stored under
  `/opt/muze/.ssh/`; write access is not enabled.

Never copy the VPS SSH private key, GitHub deploy private key, age private
identity, bot token, AI key, MongoDB passwords, or environment file into Git.

## Services and private listeners

| Service | Unit | Listener | Expected state |
| --- | --- | --- | --- |
| Telegram bot | `muze-bot.service` | No inbound port | enabled, active |
| MongoDB | `mongod.service` | `127.0.0.1:27017` | enabled, active |
| Dashboard | `muze-dashboard.service` | `127.0.0.1:8787` | enabled, active |
| Backup timer | `muze-backup.timer` | None | enabled, active |

Dashboard access must use an SSH tunnel; port `8787` must not be opened in UFW
or the provider firewall:

```bash
ssh -i /path/to/vps-key \
  -L 8787:127.0.0.1:8787 \
  muzeadmin@SERVER_HOST
```

Then open `http://127.0.0.1:8787` locally and enter the dashboard token on its
sign-in page. Do not put the token in the URL.

## MongoDB security

- MongoDB is bound only to `127.0.0.1`.
- Authorization is enabled in `/etc/mongod.conf`.
- `muzeMongoAdmin` is the recovery administrator account in `admin`.
- `muzeApp` is scoped to the production application database.
- `/etc/muze/muze.env` is `600 root:root`.
- Unauthenticated `listCollections` access was verified to fail.
- The VPS must expose AVX. The provider changed the virtual CPU configuration
  after MongoDB initially exited with `signal=ILL`; both `avx` and `avx2` are
  now visible.

Verify the CPU flags after a host migration:

```bash
grep -m1 -oE '\b(avx|avx2)\b' /proc/cpuinfo | sort -u
```

Do not downgrade to an unsupported MongoDB release to work around missing CPU
features.

## Backups

Configured:

- MongoDB Database Tools are installed.
- `age` encrypts every archive before it is retained.
- Public recipient: `/etc/muze/backup-recipients.txt` (`644 root:root`).
- Backup configuration: `/etc/muze/backup.env` (`600 root:root`).
- Backup script: `/usr/local/sbin/muze-mongodb-backup` (`700 root:root`).
- Local encrypted archives: `/var/backups/muze` (`700 root:root`).
- Timer: daily around 03:20 UTC with up to 20 minutes randomized delay.
- VPS-local retention: 14 days.
- A manual backup completed successfully through both the script and systemd
  service.
- One encrypted archive was copied off the VPS and successfully passed an
  `age` decryption plus gzip-integrity test without writing plaintext.

The private age identity must remain off the VPS. Its current administrator
copy is kept outside the repository in:

```text
~/Documents/Work/sweeden-vps/backup-keys/muze-backup-identity.txt
```

Its Windows ACL is restricted to the owning Windows account. Store a second
protected recovery copy in a password manager or encrypted offline storage.

Still required:

- Automate upload of each encrypted `.age` archive to separately controlled
  off-server storage.
- Perform and record a full restore into a separate non-production MongoDB
  host/database. A decrypt/gzip check is useful but is not a complete restore
  test.
- Prefer a dedicated read-only MongoDB backup user instead of reusing the
  application database credential.

## Memory and host updates

- A `2G` swap file exists at `/swapfile`, is `600 root:root`, and is listed in
  `/etc/fstab`.
- `vm.swappiness=10` is persisted in
  `/etc/sysctl.d/99-muze-memory.conf`.
- `unattended-upgrades` is enabled and active.
- `apt-daily.timer` and `apt-daily-upgrade.timer` are enabled.

Swap is an emergency buffer, not additional application capacity. Investigate
sustained swap use or repeated service restarts.

## Routine health checks

```bash
sudo systemctl is-active muze-bot mongod muze-dashboard
sudo systemctl show muze-bot muze-dashboard -p NRestarts
sudo systemctl list-timers muze-backup.timer --no-pager
sudo ss -lntp | grep -E '(:22|:27017|:8787)'
sudo ufw status verbose
swapon --show
df -h /
```

Inspect warnings without exposing the environment:

```bash
sudo journalctl \
  -u muze-bot \
  -u muze-dashboard \
  -u mongod \
  -u muze-backup \
  --since "24 hours ago" \
  -p warning \
  --no-pager
```

Never print `/etc/muze/muze.env`, `/etc/muze/backup.env`, private keys, or
password-manager entries into tickets, chat, CI logs, or screenshots.

## Deployment/update procedure

Run tests, the production dependency audit, CI, and Secret Scanning before
updating the VPS. Deploy an exact reviewed commit rather than an unreviewed
moving branch.

```bash
sudo -u muze env \
  GIT_SSH_COMMAND='ssh -i /opt/muze/.ssh/github_deploy -o IdentitiesOnly=yes' \
  git -C /opt/muze/app fetch --prune origin

sudo -u muze git -C /opt/muze/app checkout --detach REVIEWED_FULL_COMMIT_SHA
sudo -u muze npm --prefix /opt/muze/app ci --omit=dev
sudo -u muze npm --prefix /opt/muze/app audit --omit=dev
```

Validate configuration and create/update indexes before restart:

```bash
sudo systemd-run \
  --wait --pipe --collect \
  --unit=muze-release-config-check \
  --property=User=muze \
  --property=WorkingDirectory=/opt/muze/app \
  --property=EnvironmentFile=/etc/muze/muze.env \
  /usr/bin/npm run validate:production-config

sudo systemd-run \
  --wait --pipe --collect \
  --unit=muze-release-index-setup \
  --property=User=muze \
  --property=WorkingDirectory=/opt/muze/app \
  --property=EnvironmentFile=/etc/muze/muze.env \
  /usr/bin/npm run create:indexes

sudo systemctl restart muze-bot
sudo systemctl status muze-bot --no-pager
sudo journalctl -u muze-bot -n 100 --no-pager -o cat
```

Use a new transient unit name if a previous unit with the same name has not
been collected. Do not run test integration, seed, load-test, or user-clearing
commands against production.

## Verified launch state

At the last audit:

- Bot, MongoDB, and dashboard were enabled and active.
- Bot and dashboard had zero restarts.
- One real `/start` onboarding test completed successfully and was fast.
- MongoDB connected to the intended production database.
- Telegram `getMe` succeeded.
- Eight starter discussions were ready.
- Polling started without warnings.
- Dashboard returned the expected unauthenticated login redirect.
- Production configuration and dashboard security validation succeeded.
- `npm audit --omit=dev` reported zero vulnerabilities.
- No pending Ubuntu package updates were reported.

## Remaining launch/operations work

- Complete `docs/production-smoke-test-checklist.md` in Persian and English
  with disposable test accounts.
- Confirm CI and Secret Scanning for every newly deployed commit.
- Automate off-server encrypted backup upload.
- Complete and record a full non-production restore test.
- Finish the production privacy-policy placeholders and publish the policy.
- Confirm moderator/support ownership and incident contacts.
- Periodically review logs, disk, swap, dependency alerts, dashboard health,
  Star reconciliation, and backup delivery.
