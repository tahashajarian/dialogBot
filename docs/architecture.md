# Architecture Notes

## Project Overview

- This repo contains a Telegram bot using Telegraf.
- Runtime stack: Node.js and MongoDB.
- Main entry point: `src/index.js`.
- Runtime environment parsing and validation lives in `src/config.js`.
- Bot routing lives mainly in `src/bot.js` and `src/callbacks.js`.
- User schema lives in `src/models/user.js`.
- For a quick file-by-file orientation, read [Agent map](agent-map.md).
- The Stars economy, including rewards, spending, referrals, boosts, the Advanced Search preview, privacy, administration, rollout, and deferred payment work, is specified in [Stars Economy](stars.md).
- Discussion language normalization and effective discovery preferences live in `src/services/discussion-language.js`; filtering is applied by `src/services/discussions.js` before limiting and ranking.

## Flow Boundaries

Keep the router files thin:

- `src/bot.js` dispatches text messages.
- `src/callbacks.js` dispatches callback queries.
- `src/flows/ai-text.js` owns AI text states for section chat, list management, comments, and suggestion-context prompts.
- `src/flows/ai-callbacks.js` owns AI callback routes and AI section/list callback actions.
- `src/flows/ai-cards.js` owns remembered AI list/section card IDs and stale AI card cleanup helpers.
- `src/flows/profile-edit.js` owns profile edit prompt tracking and stale prompt cleanup.
- `src/flows/profile-text.js` owns typed profile edit states, profile edit cancellation, and reset-photo text commands.
- `src/flows/profile-callbacks.js` owns profile edit/settings callback routing and own-profile callback rendering.
- `src/flows/saved-profiles.js` owns the people hub, people-discovery callbacks, saved-profile commands/callback helpers, public-profile viewing by code, list message tracking, and stale public-profile card cleanup.
- `src/flows/discussions-text.js` owns discussion text commands and bottom-keyboard controls.
- `src/flows/discussion-messages.js` owns active-room text/voice message validation, recent-message append orchestration, delivery, and runtime reply mapping.
- `src/flows/discussions-create-text.js` owns typed discussion-create wizard states.
- `src/flows/discussions-create-callbacks.js` owns inline discussion-create wizard callbacks.
- `src/flows/discussions-callbacks.js` owns discussion callback housekeeping, predicates, list/menu callbacks, and join-error acknowledgements.
- `src/flows/discussion-invitations.js` owns stored user-to-user discussion invitation commands/callbacks, inbox rendering flow, and invite source return handling.
- `src/services/discussion-actions.js` owns discussion side-effect orchestration such as notifications.
- `src/services/discussion-invitations.js` owns stored invitation creation, lookup, lifecycle, daily-limit checks, and received-invite listing.
- `src/services/discussion-invitation-mutes.js` owns invitation mute pairs and the cross-feature "muted user cannot join muter's created discussions" predicate.
- `src/services/discussion-join-rules.js` owns discussion join-rule payload validation and user eligibility checks.
- `src/services/discussion-notifications.js` owns low-level discussion notification payload normalization and best-effort member delivery helpers.
- `src/services/discussion-messages.js` owns discussion message quota checks and recent-message append rules.
- `src/services/discussion-starters.js` owns bot-created starter room seed definitions, startup seeding, and starter-room sort order.
- `src/services/discussion-text.js` owns shared discussion text normalization and link detection.
- `src/services/discussion-delivery-memory.js` owns runtime-only delivered-message id mapping for platform-native discussion replies. Reply metadata and delivered ids should not be persisted.
- `src/services/public-codes.js` owns public profile/discussion code normalization, generation, and lookup helpers.
- `src/services/people-discovery.js` owns shared-item filtering, ranking, and pagination for the free `👀 دیدن آدم‌ها` People entry.
- `src/services/people-taste-matches.js` contains legacy time-limited Stars entitlement helpers kept for old callback/data compatibility; current People discovery does not charge Stars.
- `src/services/people-discovery-ui.js` owns people-discovery list text and callback predicate helpers.
- `src/services/saved-profiles.js` owns saved-profile bookmark mutation rules and caps.
- Public share-link discussion invite behavior should keep the same split: command/deep-link handling in `src/flows/discussions-text.js`, invite preview/callback handling in `src/flows/discussions-callbacks.js`, data lookups in `src/services/discussions.js`, and invite copy/rendering in `src/services/discussion-ui.js`.
- Stored saved-profile invitations should use `src/flows/discussion-invitations.js`, `src/services/discussion-invitations.js`, `src/services/discussion-invitation-mutes.js`, and `src/services/discussion-invitations-ui.js`.

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

Stars must keep an immutable transaction ledger as the source of truth. A cached user balance is allowed only with atomic ledger/balance updates and reconciliation. Star economy settings should use the focused Mongo-backed settings service/AppSetting key instead of mixing financial settings into `operational-limits.js`. See [Stars Economy](stars.md) for the module boundaries.

## UI Helper Services

To keep `src/callbacks.js` and `src/bot.js` focused on routing/orchestration, UI formatting helpers are split into service helpers:

- `src/services/discussion-ui.js` for discussion error/preview copy shaping.
- `src/services/discussion-room-ui.js` for room header/recent/member line rendering.
- `src/services/discussion-invitations-ui.js` for stored invitation inbox and picker text shaping.
- `src/services/saved-profiles-ui.js` for saved-profile list item shaping and saved-code helpers.
- `src/services/ai-list-ui.js` for AI list/taste/suggestion text shaping.
- `src/services/ai-paid-suggestions.js` for paid extra suggestion quote/spend/refund state after free quota exhaustion.

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
- owned open discussion reservations, capped at 3
- saved profile references, capped at 50 per user
- transient public-profile card id (`publicProfileLastMessageId`)
- transient discussion member-list card id (`discussionLastMembersMessageId`)
- pending profile view code (`pendingProfileViewCode`)

Profiles are public inside bot social surfaces for now. Active-discussion visibility controls whether the user's current active discussion may be shown on that profile and should default to off unless explicitly enabled.
Profile display should stay compact: omit unset optional fields instead of showing placeholder or missing-value rows. Profiles without a real uploaded photo should render as text instead of uploading a default placeholder image.

Star balance is a self-only profile field. Render it only through an explicit authenticated own-profile context; never include it in public, saved-profile, invitation, discovery, member-list, or shareable profile rendering.

Saved profiles are private one-way bookmarks. They store references/public profile codes only, not duplicate private profile data.

## Profile Viewing Requirements

When viewing other users' profiles through discussions, a basic profile completion gate checks if the viewer has the minimum required fields. If incomplete, the gate prompts for missing fields and stores the intended profile code in `pendingProfileViewCode`. After the user completes their profile, they are automatically redirected to the intended profile instead of their own profile.

**Required fields for viewing profiles**:
- Display name (profileName or firstName)

Age is optional and not enforced by the profile viewing gate.

## Validation

- Prefer a quick syntax or runtime check after edits when available.
- Run `npm.cmd run validate:translations` on Windows after changing:
  - `src/messages.js`
  - translation keys
  - direct `messages[lang].key` usage
- Run `npm.cmd test` when behavior or shared services change.
- Run `npm.cmd run test:integration` when discussion database mutations change.
- If `node` or `npm` is unavailable in the environment, mention that in the handoff.

## Safety

- Do not hardcode secrets.
- Keep environment-specific values in `.env`.
- Do not delete user data unless the task explicitly asks for it.
- Prefer Telegram Bot API and Telegraf docs for API-shape assumptions before changing helper signatures.

## Environment Contract

- This bot is intended to launch on Telegram via Telegraf.
- `API_ROOT` is reserved for an optional custom bot platform API root (`Telegraf` `telegram.apiRoot`). Leave it empty for normal Telegram Bot API.
- `TELEGRAM_PROXY_URL` is an optional HTTP(S) proxy for Telegram Bot API calls when the host cannot reach `api.telegram.org` directly.
- `API_BASE_URL` is reserved for GapGPT/OpenAI-compatible endpoint base URL.
- `API_KEY` or `OPENAI_API_KEY` is used for GapGPT/OpenAI-compatible auth.
- `MODEL_NAME` or `OPENAI_MODEL` controls AI model selection.
- `AI_SUGGESTION_PROVIDER` controls suggestion API routing: `auto` tries chat completions then responses, `chat` uses only chat completions, and `responses` uses only the Responses API.
- `BOT_DEEP_LINK_BASE_URL` is the public bot URL for invite deep links. For Telegram use `https://t.me/BotUsername`. If it contains `{payload}`, the payload is substituted there; otherwise `?start=payload` is appended.
- `BOT_PUBLIC_URL` and `BOT_USERNAME` are still supported as fallback invite-link settings.
- `REPORT_BAN_THRESHOLD` controls how many unique reporters trigger an automatic global user ban. Default: `5`.
- Never reuse or swap `API_ROOT` and `API_BASE_URL`.
- Keep bot-platform and AI endpoint configuration separate to avoid launch failures.
- Startup validates required runtime variables and common `API_ROOT`/`API_BASE_URL` mix-ups through `src/config.js`.
