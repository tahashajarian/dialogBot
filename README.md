# Muze

## License

Muze is proprietary software. No permission is granted to use, copy, modify,
publish, distribute, host, or deploy this code without prior written permission.
See [LICENSE](LICENSE).

Muze is a bilingual Persian/English Telegram bot built with Node.js, Telegraf,
MongoDB, and an OpenAI-compatible AI endpoint.

## Repository scope

This repository is the Telegram bot only. Mobile development has moved to the
independent `Muze-App` repository (local path:
`C:\Users\shaja\Documents\Work\Muze-App`). The two products do not share
accounts, databases, discussions, messages, deployments, or runtime code.
Do not add the React Native app or mobile API back to this repository.

The bot combines:

- public social profiles and private saved-profile bookmarks
- movie, music, and book lists, plus profile interests
- AI-powered suggestions
- shared-taste people discovery with private profile bookmarks
- live discussion rooms with taste-based join rules
- shareable discussion invites and last-10-message room context

## Requirements

- Node.js 24 LTS or newer
- MongoDB
- a Telegram bot token from BotFather
- an OpenAI-compatible API key for AI features

## Setup

```powershell
npm ci
Copy-Item .env.example .env
npm.cmd run dev
```

Create `.env` with the variables below. Do not commit it.

```dotenv
BOT_TOKEN=
MONGO_URI=mongodb://127.0.0.1:27017
MONGO_DB_NAME=muze_telegram

# Optional custom Bot API root. Leave empty for normal Telegram Bot API.
API_ROOT=

# Optional HTTP(S) proxy for Telegram Bot API calls.
# Useful when api.telegram.org is blocked unless routed through a local proxy.
TELEGRAM_PROXY_URL=

# OpenAI-compatible AI endpoint and credentials.
API_BASE_URL=
API_KEY=
MODEL_NAME=gpt-4o-mini
FAST_MODEL_NAME=
EMBEDDING_MODEL=text-embedding-3-small
AI_SUGGESTION_PROVIDER=auto
AI_TIMEOUT_MS=8000
OPEN_LIBRARY_CONTACT_EMAIL=

# Private-beta usernames, comma-separated.
# Leave empty to allow all users.
ALLOWED_USERNAMES=

# Moderation: unique reports needed before an automatic ban.
REPORT_BAN_THRESHOLD=5

# Fail-safe rollout switch for private discussion-owner join cards.
DISCUSSION_OWNER_JOIN_NOTICES_ENABLED=false

# Stable secret for account-deletion/recreation anti-abuse identity checks.
ACCOUNT_DELETION_SECRET=

# Discussion invite link configuration.
BOT_DEEP_LINK_BASE_URL=
BOT_PUBLIC_URL=
BOT_USERNAME=

# Optional local analytics dashboard.
ADMIN_DASHBOARD_HOST=127.0.0.1
ADMIN_DASHBOARD_PORT=8787
ADMIN_DASHBOARD_TOKEN=
```

With a token configured, open the normal dashboard URL and sign in; do not put
the token in the URL. Keep remote access behind HTTPS or an SSH tunnel.

`API_ROOT` is only for the bot platform API root when a custom root is needed.
For normal Telegram deployment, leave it empty so Telegraf uses Telegram's
default API. `API_BASE_URL` belongs to the AI provider. They must never point
to the same endpoint.

With `NODE_ENV=production`, remote `API_ROOT` and `API_BASE_URL` values must use
HTTPS. `ACCOUNT_DELETION_SECRET` is required, must be at least 32 characters,
and must be independent from the bot token and AI API key. Startup errors name
the invalid setting without printing its value.


Book suggestions use one ranked AI candidate batch followed by bounded Open Library identity checks and a strict Wikidata fallback. Set `OPEN_LIBRARY_CONTACT_EMAIL` so Open Library can identify regular API traffic. Google Books is not used.
Saved-for-later items are exclusions only and never positive taste evidence.

`AI_SUGGESTION_PROVIDER` controls which OpenAI-compatible API is used for
one-item suggestions. Use `auto` to try chat completions and then responses,
`chat` for chat-completions-only providers, or `responses` for providers where
the Responses API is the working path.

If Telegram Bot API access is blocked on the host, set `TELEGRAM_PROXY_URL` to
a local HTTP(S) proxy such as `http://127.0.0.1:7890`. SOCKS proxy URLs and
generic proxy environment variables are not used by this setting.

## Commands

```powershell
npm.cmd start
npm.cmd run dev
npm.cmd run dashboard
npm.cmd run check
npm.cmd test
npm.cmd run test:integration
npm.cmd run create:indexes
npm.cmd run lint
npm.cmd run architecture
npm.cmd run validate:translations
npm.cmd run validate:production-config
npm.cmd run clear:user-data:dry
npm.cmd run clear:user-data
```

Use `clear:user-data:dry` before `clear:user-data` when preparing a clean test
run. It clears user/product state while preserving AI response caches and admin
settings.

Use `create:indexes` before starting a fresh deployment database or after
adding schema indexes. It calls MongoDB `createIndexes()` for the declared
Mongoose models, so it creates missing indexes without dropping existing ones.

## AI suggestion QA without changing favorites

Use the development-only QA runner to test reusable Persian and English taste
profiles without editing a real user's favorites or writing to MongoDB:

```powershell
npm.cmd run qa:suggestions -- list
npm.cmd run qa:suggestions -- run fa-iranian-music --count=10
npm.cmd run qa:suggestions -- run fa-iranian-movies --count=5 --mood="تلخ و اجتماعی"
```

It uses the real suggestion and catalogue services from `.env`, but it does not
start Telegram, consume quotas or Stars, or change stored user data. See
[AI suggestion QA runner](docs/ai-suggestion-qa.md) for presets, custom JSON
profiles, rejected-item tests, JSON output, and timing comparisons.

## Telegram inline capture

After deploying the inline-capture code, enable inline mode explicitly in
`@BotFather` with `/setinline`. A concise placeholder is:

```text
نام فیلم، آهنگ یا کتاب · Movie, song, or book
```

Also use `/setinlinefeedback` in `@BotFather` and select 100% so each chosen
result reaches Muze's save handler.

Users type an item such as `@MuzeBot Dune`, then select Watch Later, Listen
Later, or Read Later. Selection saves the item and posts a small confirmation
in that chat. Telegram supplies the bot attribution, and a compact localized
text link beneath the confirmation can open Muze's private chat.

People who have not started Muze may capture up to 10 items. These selections
expire after 30 days and are imported silently when onboarding finishes.

## Architecture

The runtime starts in `src/index.js`. Text and callback dispatchers live in
`src/bot.js` and `src/callbacks.js`; feature behavior is split into focused
`src/flows` and `src/services` modules.

Read these before changing related behavior:

- [Agent map](docs/agent-map.md)
- [Architecture notes](docs/architecture.md)
- [Bot UX rules](docs/bot-ux.md)
- [AI lists and suggestions](docs/ai-lists-and-suggestions.md)
- [AI suggestion QA runner](docs/ai-suggestion-qa.md)
- [Discussions](docs/discussions.md)
- [Analytics dashboard](docs/analytics-dashboard.md)
- [Fresh server and fresh MongoDB deployment](docs/fresh-server-deployment.md)
- [Production operations status](docs/production-operations-status.md)
- [Production smoke-test checklist](docs/production-smoke-test-checklist.md)
- [Privacy policy launch template](docs/privacy-policy.md)
- [Moderation and safety runbook](docs/moderation-runbook.md)
- [Product roadmap](docs/product-roadmap.md)

## Validation

`npm.cmd test` runs the fast unit suite. `npm.cmd run test:integration` uses
`MONGODB_TEST_URI` (default `mongodb://127.0.0.1:27017`) with a unique,
temporary database and exercises persisted discussion mutations. MongoDB must
be running locally; the temporary database is dropped after the suite.
`npm.cmd run check` runs linting, translation validation, and both test suites.
CI runs the same checks for pushes and pull requests.

### Trusted Home runtime context
Home supports the exact keys `status` and `diagnostics`, plus the Persian
`وضعیت` alias for `status`. They provide a verified personal summary and an
always-English sanitized support report containing the deployed version. The
routes are Home-only and cannot
intercept onboarding, profile/list input, other navigation modes, or live
discussion messages. Other Home text keeps the normal concise use-buttons
guidance.
## Suggestion QA dashboard

Before deployment, run the local editable QA dashboard without changing real user favorites:

```powershell
npm.cmd run qa:suggestions:web
```

On Windows, `start-suggestion-lab.cmd` launches the same dashboard by double-click.
See `docs/ai-suggestion-qa.md` for profiles, safety guarantees, and terminal usage.
