# Fresh Server And Fresh MongoDB Deployment

Use this checklist to deploy Muze on a new Linux server with a new, empty MongoDB database. It assumes Telegram polling mode and one running bot process. Adapt paths and service names to the host, but keep the order and safety checks.

## Important rules

- Use a dedicated production Telegram bot token and a dedicated production database.
- Never point tests, seed scripts, or user-data clearing scripts at the production database.
- Run only one polling instance for a bot token. Two instances can compete for Telegram updates.
- Do not copy `.env`, MongoDB data, logs, or secrets into Git.
- Keep `API_ROOT` empty for the normal Telegram Bot API. `API_BASE_URL` is only for the AI provider.
- Keep `ACCOUNT_DELETION_SECRET` stable for the lifetime of this deployment. Rotating it can break deletion/recreation anti-abuse continuity.
- A fresh MongoDB starts with no users, settings, ledger history, invitations, or user-created discussions. Muze starter rooms are created automatically after Telegram `getMe()` succeeds.

## 1. Prepare accounts and values before touching the server

☐ Create or select the production Telegram bot in BotFather.

☐ Record its token and username securely. Configure BotFather name, About, description, and commands to match `docs/product-roadmap.md`.

☐ Complete and publish `docs/privacy-policy.md`, add its public URL and the support contact to the bot's public launch information, and assign the owners/placeholders in `docs/moderation-runbook.md`.

☐ Create a fresh MongoDB database and a least-privilege application user that can read/write that database and create indexes.

☐ If using MongoDB Atlas, add only the new server's public outbound IP as a
`/32` entry in Atlas **Network Access**, remove `0.0.0.0/0` if present, and use
the TLS-enabled `mongodb+srv://` connection string. Prefer a replica set/Atlas
deployment for native transaction support; Muze has a recoverable fallback for
standalone MongoDB, but a replica set is the stronger production topology.

☐ If MongoDB runs on the same VPS, keep it local-only in
`/etc/mongod.conf`, then restart MongoDB:

```yaml
net:
  port: 27017
  bindIp: 127.0.0.1
```

```bash
sudo systemctl restart mongod
sudo ss -lntp | grep 27017
```

The listener must show `127.0.0.1:27017`, not `0.0.0.0:27017` or
`[::]:27017`. In this setup, use `MONGO_URI=mongodb://127.0.0.1:27017`.

☐ Choose a unique production database name, for example `muze_telegram_production`. Do not share a database with staging, tests, or an older non-Telegram deployment.

☐ Prepare:
- `BOT_TOKEN`;
- `MONGO_URI` and `MONGO_DB_NAME`;
- AI provider `API_BASE_URL`, `API_KEY`, `MODEL_NAME`, and embedding model;
- bot username/deep-link URL;
- a strong random `ACCOUNT_DELETION_SECRET` stored in the server secret manager or environment file;
- an optional strong `ADMIN_DASHBOARD_TOKEN`;
- optional `ALLOWED_USERNAMES` during private beta.

### Repository checks before production

These checks become active only after the reviewed commit containing
`.github/workflows/` and `.github/dependabot.yml` is pushed to the GitHub
repository. A successful local test run does not replace them.

☐ Push the exact release commit and confirm the normal **CI** workflow passes.
Do not deploy a commit with failing or cancelled checks.

☐ Run the **Secret scanning** workflow manually once and review the first
full-history Gitleaks result. The checkout used by this workflow includes the
complete Git history, so old removed secrets can still be detected.

☐ If Gitleaks reports a real credential, rotate or revoke it at its provider
before production. Removing it from the current file or marking the workflow
green does not make an exposed credential safe. Add a narrow reviewed
allowlist only for a confirmed false positive.

☐ Confirm the dependency graph, Dependabot alerts, malware alerts, security
updates, and grouped security updates remain enabled. Confirm Dependabot
recognizes both the `npm` and `github-actions` configurations. Review its pull
requests normally; never auto-deploy an unreviewed dependency or workflow
update.

☐ In the GitHub branch protection/ruleset for the production branch, require
the available CI and secret-scanning checks before merge. Record any check that
cannot be required under the repository's current GitHub plan and verify it
manually before each deployment.

GitHub CodeQL/code scanning is not available for this private repository under
its current GitHub plan. The unsupported workflow is intentionally omitted;
the normal CI workflow still runs ESLint and the full project validation.

## 2. Prepare the Linux host

☐ Update the operating system and install security updates.

☐ Install Git and Node.js 20 or newer. Confirm:

```bash
node --version
npm --version
git --version
```

☐ Create a dedicated non-root service account and application directory. Example names used below:

```text
service user: muze
application:  /opt/muze
environment:  /etc/muze/muze.env
```

☐ Restrict SSH, enable the host firewall, and expose no inbound application
port for the polling bot. On an Ubuntu host using UFW, allow SSH before enabling
the firewall so the current connection is not locked out:

```bash
sudo ufw allow OpenSSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw deny 8787/tcp
sudo ufw deny 27017/tcp
sudo ufw enable
sudo ufw status
```

☐ In the VPS provider's firewall/security-group panel, allow the required SSH
port and add no inbound rule for dashboard port `8787` or MongoDB port `27017`.

☐ Confirm the server can reach:
- `api.telegram.org` directly over HTTPS. When direct access works, keep
  `TELEGRAM_PROXY_URL` empty so production Telegram traffic does not take the
  slower local-development proxy path;
- the MongoDB endpoint;
- the configured AI API endpoint.

## 3. Install the application

☐ Clone or copy the reviewed release into `/opt/muze`. Deploy a specific reviewed commit or tag, not an unreviewed moving branch.

☐ Give the service account ownership of the application directory, then install exact locked dependencies:

```bash
cd /opt/muze
npm ci --omit=dev
```

For pre-deployment validation, run the full checks in CI or in a separate build/test environment with development dependencies and a non-production test MongoDB. Do not run integration tests against production.

## 4. Create the production environment

☐ Create `/etc/muze/muze.env` with permissions readable only by the service account/root. Do not place shell `export` statements in a systemd `EnvironmentFile`.

If the two application secrets do not exist yet, generate them directly on
the VPS without displaying them or placing their values in shell history:

```bash
sudo sh -c '
set -eu
umask 077
ENV_FILE=/etc/muze/muze.env
test -f "$ENV_FILE"

grep -q "^ACCOUNT_DELETION_SECRET=.\+" "$ENV_FILE" ||
  printf "\nACCOUNT_DELETION_SECRET=%s\n" "$(openssl rand -hex 32)" >> "$ENV_FILE"

grep -q "^ADMIN_DASHBOARD_TOKEN=.\+" "$ENV_FILE" ||
  printf "ADMIN_DASHBOARD_TOKEN=%s\n" "$(openssl rand -hex 32)" >> "$ENV_FILE"

chmod 600 "$ENV_FILE"
'
```

This intentionally does not replace a non-empty existing value. Never rotate
`ACCOUNT_DELETION_SECRET` during an ordinary deployment: changing it breaks
account-deletion/recreation identity continuity.

```dotenv
NODE_ENV=production
BOT_TOKEN=replace_with_production_token
MONGO_URI=replace_with_production_mongo_uri
MONGO_DB_NAME=muze_telegram_production

# Normal Telegram Bot API with direct VPS access: leave both empty.
API_ROOT=
TELEGRAM_PROXY_URL=

API_BASE_URL=replace_with_ai_api_base
API_KEY=replace_with_ai_key
MODEL_NAME=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
AI_SUGGESTION_PROVIDER=auto
AI_TIMEOUT_MS=20000

CACHE_ENABLED=true
ENABLE_SEMANTIC_MATCHING=true

# Empty allows everyone. During private beta, use comma-separated usernames.
ALLOWED_USERNAMES=
REPORT_BAN_THRESHOLD=5

BOT_USERNAME=replace_without_at_sign
BOT_DEEP_LINK_BASE_URL=https://t.me/replace_with_bot_username
BOT_PUBLIC_URL=https://t.me/replace_with_bot_username

# Required in production: at least 32 characters and independent from every token.
ACCOUNT_DELETION_SECRET=replace_with_long_stable_random_secret

ADMIN_DASHBOARD_HOST=127.0.0.1
ADMIN_DASHBOARD_PORT=8787
ADMIN_DASHBOARD_TOKEN=replace_with_strong_random_token
```

☐ Compare against `.env.example` before every deployment so newly required variables are not missed.

☐ Verify `API_ROOT` and `API_BASE_URL` are not swapped and do not point to the same endpoint.

☐ Start once with the production environment and confirm configuration
validation succeeds. Remote `API_ROOT` and `API_BASE_URL` values must use
HTTPS; HTTP is accepted only for loopback services.

Validate the bot environment without starting it or printing secret values:

```bash
npm run validate:production-config
```

If the dashboard will run on this host, validate its token as well:

```bash
npm run validate:production-dashboard
```

## 5. Initialize the fresh MongoDB

☐ From the application directory, load the production environment into the deployment shell using the host's secure mechanism, then create declared indexes:

```bash
npm run create:indexes
```

☐ Confirm the command reports the intended production database name and creates indexes successfully.

☐ Confirm the output includes every current model, including `AccountDeletion`; whenever a new model is added, update `scripts/create-indexes.js` in the same change.

☐ Do not run any of these against production:
- `npm run clear:user-data`;
- `npm run seed:people`;
- `npm run seed:discussions`;
- `npm run test:integration` with the production URI;
- load tests with the production URI.

☐ Do not manually seed Muze starter discussions. Normal bot startup creates/updates the language-specific starter rooms idempotently using the real Telegram bot account ID.

## 6. Install the bot as a service

☐ Create `/etc/systemd/system/muze-bot.service`:

```ini
[Unit]
Description=Muze Telegram Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=muze
Group=muze
WorkingDirectory=/opt/muze
EnvironmentFile=/etc/muze/muze.env
ExecStartPre=/usr/bin/npm run validate:production-config
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

If `npm` is installed elsewhere, use the absolute path returned by `command -v npm`.

☐ Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now muze-bot
sudo systemctl status muze-bot
```

☐ Inspect startup logs without printing the environment file:

```bash
sudo journalctl -u muze-bot -n 200 --no-pager
```

Expected startup milestones include MongoDB connected, Telegram `getMe()` successful, starter discussions ready, webhook deletion attempted, and polling started. Treat repeated startup failures, authentication errors, or polling conflicts as blockers.

MongoDB selection is bounded to five seconds, pool queue waits to 2.5 seconds,
and sockets to 20 seconds. Temporary database loss marks the bot unready and
produces a throttled bilingual retry notice without replacing the user's
keyboard or changing their flow state. Telegram startup retries include jitter
so multiple instances do not retry in lockstep.

## 7. Optional dashboard service

☐ Keep the dashboard separate from the bot process. Create a second systemd service using the same working directory and environment, with:

```ini
ExecStartPre=/usr/bin/npm run validate:production-dashboard
ExecStart=/usr/bin/npm run dashboard
```

☐ Set a strong `ADMIN_DASHBOARD_TOKEN` and bind the dashboard to `127.0.0.1`.
After starting it, verify the listener:

```bash
sudo ss -lntp | grep 8787
```

It must show `127.0.0.1:8787`, not `0.0.0.0:8787` or `[::]:8787`.

☐ To access the dashboard privately, run this from the administrator's own
computer and keep the SSH session open:

```bash
ssh -L 8787:127.0.0.1:8787 your_user@your_server_ip
```

Then open `http://127.0.0.1:8787` locally. Do not put the dashboard token in
the URL; enter it on the dashboard sign-in page. A properly authenticated
HTTPS reverse proxy is an alternative for a later deployment, but port `8787`
must remain closed to public inbound traffic.

☐ Confirm the dashboard shows MongoDB connected, a fresh bot heartbeat, starter-room counts, and zero Star reconciliation mismatches.

## 8. First production verification

☐ Confirm exactly one bot polling service is active.

☐ Confirm the fresh database contains the expected model indexes and the Muze-created Persian/English starter rooms.

☐ Confirm each starter room has the expected configured capacity after the capacity change is implemented.

☐ Use dedicated test accounts—not the bot account—to follow `docs/production-smoke-test-checklist.md` in Persian and English.

☐ At minimum verify:
- direct `/start`, language selection, onboarding, and starter invitation;
- shared discussion deep-link onboarding;
- Favorites add/remove and one AI suggestion;
- own versus public profile privacy;
- People and private saved profiles;
- discussion preview, join condition, join, message, leave, and invitation;
- one-time Star rewards and no duplicate reward after repeated taps;
- account deletion/recreation behavior on a disposable test account;
- dashboard heartbeat, AI health, and Star reconciliation.

☐ If private beta is intended, verify an unlisted username is blocked and an allowed username can use the bot before inviting testers.

☐ Verify the published privacy/support contact works and the assigned moderator can follow the report, auto-ban, appeal, and incident procedures in `docs/moderation-runbook.md`.

## 9. Backups, monitoring, and updates

### Encrypted MongoDB backup setup

The following pattern uses MongoDB Database Tools archive/gzip output and
encrypts it immediately with an `age` public recipient. Keep the corresponding
private identity offline and outside the VPS. A backup stored only on the same
VPS is not sufficient; copy each encrypted result to separately controlled
off-host storage.

☐ Install compatible MongoDB Database Tools and `age`, then verify:

```bash
mongodump --version
mongorestore --version
age --version
```

☐ On a trusted administrator machine—not the VPS—create the encryption
identity, store it in the password manager/offline recovery location, and copy
only the public recipient line to the VPS:

```bash
age-keygen -o muze-backup-identity.txt
age-keygen -y muze-backup-identity.txt > muze-backup-recipients.txt
```

Install only `muze-backup-recipients.txt` at
`/etc/muze/backup-recipients.txt`. The `AGE-SECRET-KEY-...` identity must not
exist on the production VPS.

☐ Create root-only `/etc/muze/backup.env`. Shell-quote values so special URI
characters remain literal:

```bash
MONGO_BACKUP_URI='mongodb://backup_user:replace_password@127.0.0.1:27017/?authSource=admin'
MONGO_BACKUP_DB='muze_telegram_production'
BACKUP_RETENTION_DAYS='14'
```

Use a dedicated least-privilege MongoDB backup user. Protect both backup files:

```bash
sudo chown root:root /etc/muze/backup.env /etc/muze/backup-recipients.txt
sudo chmod 600 /etc/muze/backup.env
sudo chmod 644 /etc/muze/backup-recipients.txt
sudo install -d -o root -g root -m 700 /var/backups/muze
```

☐ Create `/usr/local/sbin/muze-mongodb-backup`:

```bash
#!/usr/bin/env bash
set -euo pipefail

source /etc/muze/backup.env
BACKUP_DIR=/var/backups/muze
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL="$BACKUP_DIR/muze-$STAMP.archive.gz.age"
TEMP="$FINAL.tmp"

cleanup() { rm -f -- "$TEMP"; }
trap cleanup EXIT

mongodump \
  --uri="$MONGO_BACKUP_URI" \
  --db="$MONGO_BACKUP_DB" \
  --archive \
  --gzip |
  age -R /etc/muze/backup-recipients.txt -o "$TEMP"

test -s "$TEMP"
mv -- "$TEMP" "$FINAL"
chmod 600 "$FINAL"
find "$BACKUP_DIR" -type f -name 'muze-*.archive.gz.age' \
  -mtime "+$BACKUP_RETENTION_DAYS" -delete
```

```bash
sudo chown root:root /usr/local/sbin/muze-mongodb-backup
sudo chmod 700 /usr/local/sbin/muze-mongodb-backup
sudo /usr/local/sbin/muze-mongodb-backup
sudo find /var/backups/muze -maxdepth 1 -type f -name '*.age' -ls
```

The command must finish successfully and create one non-empty encrypted file.
Configure the chosen off-host storage client to upload only `*.age` files.
Verify the remote object exists before relying on retention cleanup.

☐ Schedule the backup with `/etc/systemd/system/muze-backup.service`:

```ini
[Unit]
Description=Encrypted Muze MongoDB backup
After=mongod.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/muze-mongodb-backup
User=root
```

Create `/etc/systemd/system/muze-backup.timer`:

```ini
[Unit]
Description=Daily encrypted Muze MongoDB backup

[Timer]
OnCalendar=*-*-* 03:20:00 UTC
Persistent=true
RandomizedDelaySec=20m

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now muze-backup.timer
sudo systemctl list-timers muze-backup.timer
```

### Mandatory restore test

☐ Copy one encrypted backup to a separate non-production restore host with the
offline `age` identity. Restore into a new database name, never production:

```bash
export RESTORE_URI='mongodb://restore_user:replace_password@127.0.0.1:27017/?authSource=admin'
export SOURCE_DB='muze_telegram_production'
export RESTORE_DB='muze_restore_test'

age --decrypt -i ./muze-backup-identity.txt ./muze-YYYYMMDDTHHMMSSZ.archive.gz.age |
  mongorestore \
    --uri="$RESTORE_URI" \
    --archive \
    --gzip \
    --drop \
    --nsFrom="${SOURCE_DB}.*" \
    --nsTo="${RESTORE_DB}.*"
```

Confirm expected collections and representative counts, then delete only the
separate restore-test database. Record the test date, backup filename,
operator, result, and tool versions without recording credentials.

☐ Monitor service restarts, disk space, MongoDB availability, Telegram/AI failures, slow updates, reports, and Star reconciliation.

☐ Follow `docs/stars-operations.md` while Stars are enabled.

☐ For each later release:
1. review and validate the exact commit;
2. push it and confirm required CI and Gitleaks checks pass;
3. review pending Dependabot security updates and resolve applicable alerts;
4. back up MongoDB;
5. install with `npm ci --omit=dev`;
6. run `npm run create:indexes` if schemas/indexes changed (safe to run on every deploy);
7. restart the bot service;
8. inspect logs and dashboard health;
9. run the risk-appropriate smoke-test sections;
10. keep the previous release available for application rollback.

Application rollback must never assume database changes can be destructively reversed. Review migrations and compatibility before changing versions.

## Deployment complete when

- One healthy polling process is running under a non-root service account.
- Secrets are outside Git with restricted permissions.
- The bot connects to the intended fresh production database and Telegram bot.
- Indexes and language-specific starter rooms exist.
- Persian and English smoke tests pass.
- GitHub CI and full-history Gitleaks checks have been reviewed.
- Dashboard/health and Star reconciliation are clean.
- Backups and monitoring are active.
