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
- Keep bot conversations low-noise: edit an existing bot message when navigating menus if possible, and delete stale inline picker messages after the user chooses an item.
- Do not delete user messages. Only delete bot messages that are temporary, stale, or invalid after the next action.
- If an inline message contains item indexes, remove or edit it after a mutating action so old buttons cannot act on shifted indexes.
- Keep general interaction guarding centralized. Fast repeated taps, repeated callbacks, and duplicated user actions should be filtered before reaching individual feature handlers when possible.

## Reusable Bot UX Rules
- Prefer one clear hub message per menu instead of sending repeated "back" or "returned" messages.
- Use callback notifications for lightweight context changes when the platform supports them, but do not rely on them as persistent pinned content.
- When collecting typed input, hide bottom keyboards and provide one inline cancel button.
- Cancel/back copy should match the action: "back" should not sound like an operation was canceled unless an input flow was actually canceled.
- Long-running AI actions should send one placeholder, update that same message through short natural waiting copy, then edit it into the final response when possible.
- Protect repeated fast taps centrally, not inside every handler.
- The general guard should be conservative: block obvious duplicate interactions for a short window, but do not block normal follow-up text, different buttons, or intentional repeated actions after the window expires.
- Keep user-facing AI responses short, warm, and action-oriented; avoid repeating the same progress/count text twice in one response.

## Reusable AI Cost Rules
- Normalize user text before AI/cache work: lowercase, trim, collapse spaces, remove filler phrases and unnecessary punctuation.
- Use cache lookup before response generation: exact normalized match, then conservative fuzzy match, then optional embedding/semantic match.
- Keep fuzzy/semantic thresholds configurable and bias toward avoiding false positives over saving one API call.
- Store reusable AI responses with original input, normalized input, category, response, embedding when enabled, hit count, and last-used time.
- Log cache match type (`exact`, `fuzzy`, `semantic`, `new_api_call`) so API reduction can be measured.
- For recommendation prompts, send only the context the model needs. Prefer full Top 10 plus a capped recent slice of larger lists, while doing duplicate checks locally against the full stored list.
- Add per-user/per-section rate limits for expensive AI flows.

## Bot Behavior Notes
- Bale docs reference: https://docs.bale.ai/
- The bot uses stored user state in MongoDB for profile edits and AI section state.
- Repeated identical user interactions are guarded in `src/services/interaction-guard.js` and applied from `src/index.js`; keep duplicate-tap protection centralized there.
- The interaction guard should fail open if it is unsure, so bot features keep working even if guard state is missing or malformed.
- Profile fields currently include language, name, city, age, gender, pet, bio, location, and photo.
- Profile actions should always fail safely and fall back to text if photo rendering fails.
- When a user has no profile photo, show the local default avatar from `assets/default_profile.png`.
- Age selection should use a two-step flow: 10-year ranges first, then exact ages inside the chosen range.
- Text inputs should be length-limited and normalized before saving (name/city short, bio longer).
- Keep shared profile rendering/location helpers in `src/services/profile.js` and reuse them from `src/bot.js` and `src/callbacks.js`.
- AI assistant menu includes movies, music, books, and random sections.
- AI section entry uses Bale callback notifications (`answerCallbackQuery`) as a temporary top notification with the section name; it is not persistent like a pin.
- AI lists are stored under `aiLists.{section}.{listType}` with item objects: `{ title, comment, watched }`.
- `watchlist` is capped at 100 items per section; `topTen` is capped at 10 items per section.
- Watchlist supports section-aware status wording (movies: watched, music: listened, books: read, random: done).
- Watchlist includes inline actions for status toggle, comment edit, and move-to-top-ten (if topTen has room).
- TopTen items also support comment edit.
- AI list duplicate detection should run across all sections and list types, not just music, and should return match data for better duplicate messages.
- Taste labels are stored in `aiTaste.{section}` with `labelKey`, `emoji`, confidence, sample count, and updated time; derive translated titles at render time.
- Taste labels are temporary after 3 TopTen items and stronger after 10; recalculate labels whenever TopTen changes.
- Profile should show existing section taste labels under a separate label heading, with spacing from the rest of the profile.
- Suggestions in AI sections return exactly one item plus a very short reason.
- Pressing the section suggestion button should first show a choice prompt: suggest from Top 10, or collect one short mood/genre note. Do not call AI until the user chooses.
- The mood/genre suggestion input state should hide the bottom keyboard and provide an inline cancel button; cancel returns to the same section entry message and keyboard.
- Suggestions should avoid duplicates from the user's topTen, watchlist, and `aiRecentSuggestions`; `aiRecentSuggestions.{section}` is capped at 20 stored titles.
- Suggestion prompts should send all Top 10 items but only a capped recent slice of watchlist titles (currently 30); local duplicate checks must still use the full watchlist.
- Suggestions are limited to 10 per hour per user per section via `aiSuggestionUsage`; failed/no-response suggestion calls should refund the quota slot.
- Suggestion cards include:
  - add to watchlist (confirms add, then shows inline buttons for going to the list or getting another suggestion)
  - add as done/watched/read/listened (confirms with section-aware wording, then shows an inline button for another suggestion)
- Suggestion reasons are saved as item comments when adding from suggestion buttons.
- Suggestions should not auto-send the next item after a status action; users should explicitly press the inline "another suggestion" button.
- AI calls should show a placeholder message, update it through staged "thinking" copy if delayed, then edit that same message into the final response when possible.
- If AI returns no usable response, show a clear retry/other-section fallback message.
- Users are not forced to complete topTen before receiving suggestions, but they must add at least three topTen items in that section before suggestions are allowed.
- AI section entry should be a guided hub message, not an open chat prompt: tell users their section taste is not known yet, encourage filling topTen, and direct them to bottom buttons.
- Free-form text in AI section chat state should not trigger AI suggestions; reply with guidance to use the bottom buttons.
- When a user enters topTen in any section, send the current topTen list as a separate message before the section/manage description and inline buttons.
- TopTen menus should still keep the "show all" action even though the list is also shown on entry.
- TopTen collector flow still supports `+`/`-` text actions when users choose to curate topTen directly.
- Use `scripts/migrate-ai-lists.js` to move legacy flat lists into `aiLists`, and `scripts/rollback-ai-lists.js` to restore legacy fields if needed.
- In AI sections, users stay in chat state until pressing the bottom text back button.
- Bottom AI-section back returns users to the AI assistant menu; the inline AI assistant back button returns to the main menu.
- Pin/unpin flows must use the active chat id and must not swallow API errors silently.
- Only persist a pinned message id after the pin request succeeds.
- If Bale pinning fails, log the chat id, message id, and error so the cause is visible.
- Prefer Bale/Telegraf docs for API-shape assumptions before changing helper signatures.

## Data Model Notes
- User schema lives in `src/models/user.js`.
- Update `src/services/users.js` when adding or changing user fields or state helpers.
- Keep AI list access centralized in `src/services/users.js` helpers (`getAiListItemsFromUser`, `addAiListItem`, `removeAiListItem`).
- If a new profile field is added, update:
  - `src/models/user.js`
  - `src/messages.js`
  - `src/keyboards.js`
  - `src/services/profile.js`
  - `src/bot.js`
  - `src/callbacks.js`

## Validation
- Prefer a quick syntax or runtime check after edits when available.
- Run `npm.cmd run validate:translations` on Windows after changing `src/messages.js`, translation keys, or direct `messages[lang].key` usage.
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
