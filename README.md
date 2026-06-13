# DialogBot

DialogBot is a bilingual Persian/English Bale bot built with Node.js, Telegraf's
compatible API surface, MongoDB, and an OpenAI-compatible AI endpoint.

The bot combines:

- public social profiles and private saved-profile bookmarks
- movie, music, book, and broad-interest lists
- AI taste feedback and suggestions
- live discussion rooms with taste-based join rules
- shareable discussion invites and last-10-message room context

## Requirements

- Node.js 20 or newer
- MongoDB
- a Bale bot token
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

# Bale Bot API root, when a custom root is required.
API_ROOT=

# OpenAI-compatible AI endpoint and credentials.
API_BASE_URL=
API_KEY=
MODEL_NAME=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
AI_TIMEOUT_MS=8000

# Private-beta usernames, comma-separated.
ALLOWED_USERNAMES=

# Discussion invite link configuration.
BOT_DEEP_LINK_BASE_URL=
BOT_PUBLIC_URL=
BOT_USERNAME=
```

`API_ROOT` belongs to Bale. `API_BASE_URL` belongs to the AI provider. They
must never point to the same endpoint.

## Commands

```powershell
npm.cmd start
npm.cmd run dev
npm.cmd run check
npm.cmd test
npm.cmd run test:integration
npm.cmd run lint
npm.cmd run validate:translations
```

Data cleanup and migrations have dry-run commands in `package.json`. Review
their output before using an applying command.

After deploying the supported partial public-code index definition, run:

```powershell
npm.cmd run migrate:public-code-indexes
```

This checks for duplicate non-empty codes before replacing the legacy sparse
indexes.

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

## Validation

`npm.cmd test` runs the fast unit suite. `npm.cmd run test:integration` uses
`MONGODB_TEST_URI` (default `mongodb://127.0.0.1:27017`) with a unique,
temporary database and exercises persisted discussion mutations. MongoDB must
be running locally; the temporary database is dropped after the suite.
`npm.cmd run check` runs linting, translation validation, and both test suites.
CI runs the same checks for pushes and pull requests.
