# Automated production deployment

Muze can deploy an exact tested `main` commit after CI succeeds. Automation is
disabled unless the repository variable `PRODUCTION_DEPLOY_ENABLED` is exactly
`true`, so the workflow can be merged before the VPS is prepared.

## Security model

- GitHub Actions gets a dedicated Ed25519 key, not a personal administrator
  key and not the read-only GitHub repository deploy key.
- The key cannot open a shell, forward ports, allocate a terminal, or choose a
  command. Its `authorized_keys` entry forces one root-owned deployment script.
- The workflow sends only the 40-character commit SHA on standard input.
- The server accepts only the current `origin/main`, only as a fast-forward,
  and only when the production worktree is clean.
- Production environment values remain in `/etc/muze/muze.env` and are never
  copied into GitHub.

## One-time setup

Keep `PRODUCTION_DEPLOY_ENABLED` unset until every step below succeeds.

### 1. Generate the dedicated key locally

From Git Bash in a private local directory:

```bash
ssh-keygen -t ed25519 -a 100 -f ./muze-github-actions-deploy -C "muze-github-actions-deploy"
```

Use an empty passphrase because GitHub Actions must use the key
non-interactively. Protect the private file locally and never commit either
generated file.

### 2. Install the deployment command on the VPS

Deploy the repository commit containing `ops/muze-deploy-from-github` manually
once. Then, from the VPS:

```bash
sudo install \
  -o root \
  -g root \
  -m 700 \
  /opt/muze/app/ops/muze-deploy-from-github \
  /usr/local/sbin/muze-deploy-from-github

sudo bash -n /usr/local/sbin/muze-deploy-from-github
sudo stat -c '%a %U:%G %n' /usr/local/sbin/muze-deploy-from-github
```

Expected ownership and mode:

```text
700 root:root /usr/local/sbin/muze-deploy-from-github
```

Create the narrow sudo rule:

```bash
printf '%s\n' \
  'muzeadmin ALL=(root) NOPASSWD: /usr/local/sbin/muze-deploy-from-github' |
sudo tee /etc/sudoers.d/muze-github-actions-deploy >/dev/null

sudo chmod 440 /etc/sudoers.d/muze-github-actions-deploy
sudo visudo -cf /etc/sudoers.d/muze-github-actions-deploy
```

### 3. Restrict the public key on the VPS

Copy `muze-github-actions-deploy.pub` to the VPS temporarily, verify the file,
and append it to `/home/muzeadmin/.ssh/authorized_keys` as one line prefixed
with:

```text
restrict,command="sudo /usr/local/sbin/muze-deploy-from-github"
```

The complete line must look like:

```text
restrict,command="sudo /usr/local/sbin/muze-deploy-from-github" ssh-ed25519 AAAA... muze-github-actions-deploy
```

Keep the existing personal login key line unchanged. Then verify:

```bash
sudo chown -R muzeadmin:muzeadmin /home/muzeadmin/.ssh
sudo chmod 700 /home/muzeadmin/.ssh
sudo chmod 600 /home/muzeadmin/.ssh/authorized_keys
```

Delete the temporary uploaded public-key file after the line is verified.

### 4. Prepare the trusted host-key value

While connected through the already trusted administrator session:

```bash
printf '%s ' '82.115.8.159'
sudo cat /etc/ssh/ssh_host_ed25519_key.pub
```

Save the resulting single line as `DEPLOY_SSH_KNOWN_HOSTS`. Verify its
fingerprint against the fingerprint previously accepted for this VPS before
adding it to GitHub.

### 5. Configure GitHub

Create a GitHub environment named `production`. Add these environment secrets:

- `DEPLOY_SSH_PRIVATE_KEY`: the complete private key file, including its BEGIN
  and END lines;
- `DEPLOY_SSH_KNOWN_HOSTS`: the trusted single host-key line from the VPS;
- `DEPLOY_SSH_HOST`: the VPS IP address;
- `DEPLOY_SSH_USER`: `muzeadmin`.

Do not place the bot token, MongoDB credentials, dashboard token, or production
environment file in GitHub.

### 6. Test the restricted key before enabling deployment

From the local directory containing the dedicated private key:

```bash
printf '%s\n' "$(git rev-parse HEAD)" |
ssh \
  -i ./muze-github-actions-deploy \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  muzeadmin@82.115.8.159
```

This runs the deployment command; it must not open an interactive shell. Use
only a commit already pushed to `origin/main`.

### 7. Enable automatic deployment

Create the repository Actions variable:

```text
PRODUCTION_DEPLOY_ENABLED=true
```

The next push to `main` will run validation, Gitleaks, and production
deployment in that order.

## Normal use

```bash
git push origin main
```

Confirm all three CI jobs are green:

- `validate`;
- `Scan Git history`;
- `Deploy production`.

If deployment fails, the existing bot process normally remains running unless
the failure happened during service restart. Read the failed job output, keep
`PRODUCTION_DEPLOY_ENABLED` set to `false` while repairing the setup, and use
the manual fallback in `docs/production-operations-status.md`.

## Updating the server-side deployment script

The installed `/usr/local/sbin/muze-deploy-from-github` copy is intentionally
root-owned and does not update itself automatically. After reviewing changes
to `ops/muze-deploy-from-github`, install the new version manually with the
same `sudo install` command and validate it with `sudo bash -n` before the next
automatic deployment.
