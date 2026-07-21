# Muze

Muze is a bilingual Persian/English Telegram bot built with Node.js, Telegraf,
MongoDB, and an OpenAI-compatible AI endpoint.

The bot combines:

- public social profiles and private saved-profile bookmarks
- movie, music, and book lists, plus profile interests
- AI-powered suggestions
- shared-taste people discovery with private profile bookmarks
- live discussion rooms with taste-based join rules
- shareable discussion invites and last-10-message room context

## Requirements

- Node.js 20 or newer
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
MONGO_DB_NAME=bot

# Optional custom Bot API root. Leave empty for normal Telegram Bot API.
API_ROOT=

# Optional HTTP(S) proxy for Telegram Bot API calls.
# Useful when api.telegram.org is blocked unless routed through a local proxy.
TELEGRAM_PROXY_URL=

# OpenAI-compatible AI endpoint and credentials.
API_BASE_URL=
API_KEY=
MODEL_NAME=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
AI_SUGGESTION_PROVIDER=auto
AI_TIMEOUT_MS=8000

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

`API_ROOT` is only for the bot platform API root when a custom root is needed.
For normal Telegram deployment, leave it empty so Telegraf uses Telegram's
default API. `API_BASE_URL` belongs to the AI provider. They must never point
to the same endpoint.

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
npm.cmd run clear:user-data:dry
npm.cmd run clear:user-data
```

Use `clear:user-data:dry` before `clear:user-data` when preparing a clean test
run. It clears user/product state while preserving AI response caches and admin
settings.

Use `create:indexes` before starting a fresh deployment database or after
adding schema indexes. It calls MongoDB `createIndexes()` for the declared
Mongoose models, so it creates missing indexes without dropping existing ones.

## Architecture

The runtime starts in `src/index.js`. Text and callback dispatchers live in
`src/bot.js` and `src/callbacks.js`; feature behavior is split into focused
`src/flows` and `src/services` modules.

Read these before changing related behavior:

- [Agent map](docs/agent-map.md)
- [Architecture notes](docs/architecture.md)
- [Bot UX rules](docs/bot-ux.md)
- [AI lists and suggestions](docs/ai-lists-and-suggestions.md)
- [Discussions](docs/discussions.md)
- [Analytics dashboard](docs/analytics-dashboard.md)
- [Fresh server and fresh MongoDB deployment](docs/fresh-server-deployment.md)
- [Production smoke-test checklist](docs/production-smoke-test-checklist.md)
- [Product roadmap](docs/product-roadmap.md)

## Validation

`npm.cmd test` runs the fast unit suite. `npm.cmd run test:integration` uses
`MONGODB_TEST_URI` (default `mongodb://127.0.0.1:27017`) with a unique,
temporary database and exercises persisted discussion mutations. MongoDB must
be running locally; the temporary database is dropped after the suite.
`npm.cmd run check` runs linting, translation validation, and both test suites.
CI runs the same checks for pushes and pull requests.
