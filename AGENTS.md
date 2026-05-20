# Repository Guidance

## Project Overview
- This repo contains a Telegram bot built with Node.js, Telegraf, and MongoDB.
- Main entry point: `src/index.js`.
- Bot routing lives in `src/bot.js` and `src/callbacks.js`.

## Working Rules
- Keep changes focused and minimal.
- Prefer fixing the root cause over adding temporary workarounds.
- Avoid unrelated refactors unless they are needed for the task.
- Preserve the existing style and naming unless a change is required.

## Bot Behavior Notes
- The bot uses stored user state in MongoDB for profile edits.
- Profile fields currently include language, name, city, age, pet preference, and photo.
- Profile actions should always fail safely and fall back to text if photo rendering fails.
- When a user has no profile photo, show the local default avatar from `assets/default_profile.png`.
- Age selection should use a two-step flow: 10-year ranges first, then exact ages inside the chosen range.

## Data Model Notes
- User schema lives in `src/models/user.js`.
- Update `src/services/users.js` when adding or changing user fields or state helpers.
- If a new profile field is added, update:
  - `src/models/user.js`
  - `src/messages.js`
  - `src/keyboards.js`
  - `src/bot.js`
  - `src/callbacks.js`

## Validation
- Prefer a quick syntax or runtime check after edits when available.
- If `node` or `npm` is unavailable in the environment, mention that in the handoff.

## Safety
- Do not hardcode secrets.
- Keep environment-specific values in `.env`.
- Do not delete user data unless the task explicitly asks for it.
