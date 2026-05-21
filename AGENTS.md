# Repository Guidance

## Project Overview
- This repo contains a Bale bot (Telegraf-compatible API) built with Node.js and MongoDB.
- Main entry point: `src/index.js`.
- Bot routing lives in `src/bot.js` and `src/callbacks.js`.

## Working Rules
- Keep changes focused and minimal.
- Prefer fixing the root cause over adding temporary workarounds.
- Avoid unrelated refactors unless they are needed for the task.
- Preserve the existing style and naming unless a change is required.

## Bot Behavior Notes
- The bot uses stored user state in MongoDB for profile edits and AI section state.
- Profile fields currently include language, name, city, age, gender, pet, bio, location, and photo.
- Profile actions should always fail safely and fall back to text if photo rendering fails.
- When a user has no profile photo, show the local default avatar from `assets/default_profile.png`.
- Age selection should use a two-step flow: 10-year ranges first, then exact ages inside the chosen range.
- Text inputs should be length-limited and normalized before saving (name/city short, bio longer).
- Keep shared profile rendering/location helpers in `src/services/profile.js` and reuse them from `src/bot.js` and `src/callbacks.js`.
- AI assistant menu includes movies, music, books, and random sections.
- In AI sections, users stay in chat state until pressing the bottom text back button.
- Bottom AI-section back returns users to the AI assistant menu; the inline AI assistant back button returns to the main menu.
- Pin/unpin flows must use the active chat id and must not swallow API errors silently.
- Only persist a pinned message id after the pin request succeeds.
- If Bale pinning fails, log the chat id, message id, and error so the cause is visible.
- Prefer Bale/Telegraf docs for API-shape assumptions before changing helper signatures.

## Data Model Notes
- User schema lives in `src/models/user.js`.
- Update `src/services/users.js` when adding or changing user fields or state helpers.
- If a new profile field is added, update:
  - `src/models/user.js`
  - `src/messages.js`
  - `src/keyboards.js`
  - `src/services/profile.js`
  - `src/bot.js`
  - `src/callbacks.js`

## Validation
- Prefer a quick syntax or runtime check after edits when available.
- If `node` or `npm` is unavailable in the environment, mention that in the handoff.

## Safety
- Do not hardcode secrets.
- Keep environment-specific values in `.env`.
- Do not delete user data unless the task explicitly asks for it.

## Environment Contract
- This bot runs on Bale via Telegraf-compatible API.
- `API_ROOT` is reserved for Bale Bot API root (`Telegraf` `telegram.apiRoot`).
- `API_BASE_URL` is reserved for GapGPT/OpenAI-compatible endpoint base URL.
- `API_KEY` (or `OPENAI_API_KEY`) is used for GapGPT/OpenAI-compatible auth.
- `MODEL_NAME` (or `OPENAI_MODEL`) controls AI model selection.
- Never reuse or swap `API_ROOT` and `API_BASE_URL`.
- Keep Bale and AI endpoint configuration separate to avoid launch failures.
