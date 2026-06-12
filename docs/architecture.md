# Architecture Notes

## Project Overview

- This repo contains a Bale bot using a Telegraf-compatible API.
- Runtime stack: Node.js and MongoDB.
- Main entry point: `src/index.js`.
- Runtime environment parsing and validation lives in `src/config.js`.
- Bot routing lives mainly in `src/bot.js` and `src/callbacks.js`.
- User schema lives in `src/models/user.js`.
- For a quick file-by-file orientation, read [Agent map](agent-map.md).

## Flow Boundaries

Keep the router files thin:

- `src/bot.js` dispatches text messages.
- `src/callbacks.js` dispatches callback queries.
- `src/flows/ai-text.js` owns AI text states for section chat, list management, comments, and suggestion-context prompts.
- `src/flows/ai-callbacks.js` owns AI callback routes and AI section/list callback actions.
- `src/flows/ai-cards.js` owns remembered AI list/section card IDs and stale AI card cleanup helpers.
- `src/flows/profile-edit.js` owns profile edit prompt tracking and stale prompt cleanup.
- `src/flows/profile-callbacks.js` owns profile edit/settings callback routing and own-profile callback rendering.
- `src/flows/saved-profiles.js` owns saved-profile commands/callback helpers, public-profile viewing by code, saved-list message tracking, and stale public-profile card cleanup.
- `src/flows/discussions-text.js` owns discussion text commands and bottom-keyboard controls.
- `src/flows/discussions-create-text.js` owns typed discussion-create wizard states.
- `src/flows/discussions-create-callbacks.js` owns inline discussion-create wizard callbacks.
- `src/flows/discussions-callbacks.js` owns discussion callback housekeeping, predicates, list/menu callbacks, and join-error acknowledgements.
- `src/services/discussion-actions.js` owns discussion side-effect orchestration such as notifications.
- `src/services/discussion-delivery-memory.js` owns runtime-only delivered-message id mapping for platform-native discussion replies. Reply metadata and delivered ids should not be persisted.
- Discussion invite behavior should keep the same split: command/deep-link handling in `src/flows/discussions-text.js`, invite preview/callback handling in `src/flows/discussions-callbacks.js`, data lookups in `src/services/discussions.js`, and invite copy/rendering in `src/services/discussion-ui.js`.

## Data Model Rules

- Update `src/services/users.js` when adding or changing user fields or state helpers.
- Keep AI list access centralized in `src/services/users.js` helpers:
  - `getAiListItemsFromUser`
  - `addAiListItem`
  - `removeAiListItem`
- If a new profile field is added, update:
  - `src/models/user.js`
  - `src/messages.js`
  - `src/keyboards.js`
  - `src/services/profile.js`
  - `src/bot.js`
  - `src/callbacks.js`

## UI Helper Services

To keep `src/callbacks.js` and `src/bot.js` focused on routing/orchestration, UI formatting helpers are split into service helpers:

- `src/services/discussion-ui.js` for discussion error/preview copy shaping.
- `src/services/discussion-room-ui.js` for room header/recent/member line rendering.
- `src/services/saved-profiles-ui.js` for saved-profile list item shaping and saved-code helpers.
- `src/services/ai-list-ui.js` for AI list/taste/suggestion text shaping.

When adding new discussion/profile UI flows, prefer extending these helpers or focused flow modules instead of growing inline formatting logic inside callbacks.

Viewed public-profile cards are transient. Store and clear their last bot message id through `src/flows/saved-profiles.js` instead of leaving profile cards behind in chat. Saved-profile list views may offer a back button to the saved list; profiles opened from discussion/member contexts should not add an acknowledgement inline button.

## Existing Profile Fields

- language
- name
- city
- age
- gender
- pet
- bio
- location
- photo
- active discussion profile visibility (`showActiveDiscussionOnProfile`)
- future saved profile references, capped at 50 per user
- transient public-profile card id (`publicProfileLastMessageId`)
- transient discussion member-list card id (`discussionLastMembersMessageId`)

Profiles are public inside bot social surfaces for now. Active-discussion visibility controls whether the user's current active discussion may be shown on that profile and should default to off unless explicitly enabled.

Saved profiles, when implemented, should be private one-way bookmarks. They should store references/public profile codes only, not duplicate private profile data.

## Validation

- Prefer a quick syntax or runtime check after edits when available.
- Run `npm.cmd run validate:translations` on Windows after changing:
  - `src/messages.js`
  - translation keys
  - direct `messages[lang].key` usage
- Run `npm.cmd test` when behavior or shared services change.
- If `node` or `npm` is unavailable in the environment, mention that in the handoff.

## Safety

- Do not hardcode secrets.
- Keep environment-specific values in `.env`.
- Do not delete user data unless the task explicitly asks for it.
- Prefer Bale/Telegraf docs for API-shape assumptions before changing helper signatures.

## Environment Contract

- This bot runs on Bale via Telegraf-compatible API.
- `API_ROOT` is reserved for Bale Bot API root (`Telegraf` `telegram.apiRoot`).
- `API_BASE_URL` is reserved for GapGPT/OpenAI-compatible endpoint base URL.
- `API_KEY` or `OPENAI_API_KEY` is used for GapGPT/OpenAI-compatible auth.
- `MODEL_NAME` or `OPENAI_MODEL` controls AI model selection.
- `BOT_DEEP_LINK_BASE_URL` is the platform-neutral public bot URL for invite deep links. For Bale use `https://ble.ir/@BotUsername`; for Telegram later use `https://t.me/BotUsername`. If it contains `{payload}`, the payload is substituted there; otherwise `?start=payload` is appended.
- `BOT_PUBLIC_URL` and `BOT_USERNAME` are still supported as fallback invite-link settings for Bale.
- Never reuse or swap `API_ROOT` and `API_BASE_URL`.
- Keep Bale and AI endpoint configuration separate to avoid launch failures.
- Startup validates required runtime variables and common `API_ROOT`/`API_BASE_URL` mix-ups through `src/config.js`.
