# Repository Guidance

## Project Overview

- This repo contains a Bale bot using a Telegraf-compatible API, Node.js, and MongoDB.
- Main entry point: `src/index.js`.
- Bot routing lives mainly in `src/bot.js` and `src/callbacks.js`.
- Read focused docs before changing related behavior:
  - [Architecture notes](docs/architecture.md)
  - [Bot UX rules](docs/bot-ux.md)
  - [AI lists and suggestions](docs/ai-lists-and-suggestions.md)
  - [Discussions design](docs/discussions.md)

## Working Rules

- Keep changes focused and minimal.
- Prefer fixing the root cause over adding temporary workarounds.
- Avoid unrelated refactors unless they are needed for the task.
- Preserve the existing style and naming unless a change is required.
- Do not delete user data unless the task explicitly asks for it.
- Do not hardcode secrets; keep environment-specific values in `.env`.

## Current Phase

- Discussion feature work is currently in design mode.
- For discussion-phase changes, update docs only unless the user explicitly asks to implement/code it.
- `docs/discussions.md` is the source of truth for discussion behavior.

## Critical UX Rules

- Keep bot conversations low-noise.
- Edit existing bot messages when navigating menus if possible.
- Delete stale inline picker messages after the user chooses an item.
- Delete consumed inline cards before sending a fresh follow-up card/message; edit in place only when the flow is moving to another picker/state in the same card.
- Do not delete user messages.
- If an inline message contains item indexes, remove or edit it after mutating actions so old buttons cannot act on shifted indexes.
- Keep repeated-tap protection centralized in `src/services/interaction-guard.js`.

## Critical Product Rules

- Profile discoverability controls whether other users can view a profile; it should not be assumed to gate discussion participation unless `docs/discussions.md` changes.
- Profiles are private by default.
- `showActiveDiscussionOnProfile` is a separate opt-in profile setting, default false. Never expose a user's active discussion on their profile unless this is enabled.
- Discussions, when implemented, are live rooms with last-10-message context, one active room per user, taste-based join rules, and no seen/read count in MVP.
- The internal `random` AI section should be treated as user-facing `🧩 علاقه‌مندی‌ها` / `🧩 Interests`, a first-class broad interests section.
- AI suggestions should not trigger from free-form AI-section chat text; users should use the section buttons.
- TopTen/list behavior and AI suggestion rules are documented in `docs/ai-lists-and-suggestions.md`.
- Known Interests chips should use predefined feedback and the same visible placeholder/save flow as typed TopTen input.

## Data Model Reminders

- User schema lives in `src/models/user.js`.
- Update `src/services/users.js` when adding or changing user fields or state helpers.
- Keep AI list access centralized in `src/services/users.js`.
- If a new profile field is added, update:
  - `src/models/user.js`
  - `src/messages.js`
  - `src/keyboards.js`
  - `src/services/profile.js`
  - `src/bot.js`
  - `src/callbacks.js`

## Validation

- Prefer a quick syntax or runtime check after edits when available.
- Run `npm.cmd run validate:translations` after changing `src/messages.js`, translation keys, or direct `messages[lang].key` usage.
- Run `npm.cmd test` when behavior or shared services change.
- If `node` or `npm` is unavailable, mention that in the handoff.

## Environment Contract

- `API_ROOT` is for Bale Bot API root.
- `API_BASE_URL` is for the GapGPT/OpenAI-compatible endpoint base URL.
- `API_KEY` or `OPENAI_API_KEY` is for AI auth.
- `MODEL_NAME` or `OPENAI_MODEL` controls AI model selection.
- Never reuse or swap `API_ROOT` and `API_BASE_URL`.
