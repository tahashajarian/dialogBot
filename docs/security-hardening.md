# Security Hardening Checklist

This is a practical backlog for improving Muze security over time. It is not a
launch blocker list unless an item is marked **Do now**.

## Do now: protect the analytics dashboard

- [ ] Generate a strong random dashboard token and store it only in the
  production `.env` or server secret manager:

  ```dotenv
  ADMIN_DASHBOARD_HOST=127.0.0.1
  ADMIN_DASHBOARD_TOKEN=replace_with_a_long_random_secret
  ```

- [ ] Keep the dashboard bound to `127.0.0.1`; do not expose port `8787` to the
  public internet.
- [ ] Access it through an SSH tunnel when working remotely.
- [ ] Never commit the real token, paste it into an issue, or put it in a URL.

One way to generate a token on the server is:

```bash
openssl rand -hex 32
```

After changing the environment, restart the dashboard service and open its
normal URL. Sign in through the dashboard login page. Query-string and
`X-Dashboard-Token` authentication are not accepted. Read-only snapshot scripts
may use `Authorization: Bearer <token>`.

## High priority: application protections

- [ ] Add explicit trusted-proxy configuration if the dashboard is ever bound
  directly to a non-loopback interface behind a reverse proxy.
- [ ] Require dashboard authentication even on localhost for settings-changing
  requests.
- [ ] Increase newly generated public profile codes from four characters to at
  least 10–12 cryptographically random characters. Continue accepting existing
  short codes for compatibility.
- [ ] If beta access restrictions are used, authorize immutable numeric
  Telegram user IDs rather than usernames, which can change ownership.

## High priority: production infrastructure

- [ ] Expose no inbound application port for the polling bot. Allow only the
  required SSH access through the host firewall.
- [ ] Never expose MongoDB publicly. Use a least-privilege database account,
  TLS, and server/IP restrictions.
- [ ] Run the bot and dashboard as a dedicated non-root service account.
- [ ] Add compatible systemd sandboxing such as `ProtectSystem=strict`,
  `ProtectHome=true`, `PrivateDevices=true`, and narrow writable paths.

## Maintenance and supply chain

- [ ] Run `npm audit` and the full test suite before production deployments.
- [ ] Review the first full-history Gitleaks result after pushing these workflows.
- GitHub CodeQL/code scanning is unavailable for this private repository under
  its current GitHub plan, so it is intentionally not a required check.
- [ ] Deploy reviewed commits/tags with `npm ci --omit=dev`.

## Recovery and operations

- [ ] Automate encrypted MongoDB backups.
- [ ] Test restoration into a separate non-production database.
- [ ] Restrict and periodically review access to production logs and backups.
- [ ] Fill the ownership, support, incident-response, appeal, and retention
  placeholders in `docs/moderation-runbook.md` and `docs/privacy-policy.md`.

## Current positive checks

- The bot uses polling, so it does not need a public webhook server.
- `.env` is ignored by Git.
- Star spending is ledger-backed and idempotent.
- Callback and navigation authorization have extensive automated coverage.
- User inputs have length and quality validation.
- Update-error logging avoids full message text and full callback payloads.
- False automatic bans can be reversed only through the authenticated,
  CSRF-protected dashboard flow and every attempted mutation has a durable audit record.
- Dashboard settings use signed sessions, CSRF validation, hardened response
  headers, and no query-string tokens.
- Production configuration enforces independent strong secrets and rejects
  remote plain-HTTP API endpoints.
- General updates and direct profile-code lookups are rate-limited.
- Dependabot, Gitleaks, pinned GitHub Actions, and ESLint CI are configured.
- `npm audit` reported zero known dependency vulnerabilities on 2026-07-23.
