# Architecture Notes

## Account deletion boundary

`src/flows/profile-callbacks.js` owns the two confirmation cards and nonce validation. It invokes `src/services/account-deletion.js` only after final confirmation. The service coordinates collection cleanup, persists resumable progress in `AccountDeletion`, anonymizes the minimum Star/referral audit facts with a per-user tombstone, and deletes the User document last. `src/index.js` prevents arbitrary updates from recreating missing users and atomically consumes the completed deletion's one-time restart claim before creating a fresh onboarding account. Telegram copy remains in the message catalogs.

`src/services/reply-keyboard-navigation.js` owns reply-keyboard modes, localized text normalization, and text-to-action resolution. Flow modules set modes through `setNavigationMode`; `src/bot.js` and `src/callbacks.js` only dispatch the resolved action. The mode is persisted for real users because exact pages, filters, source profiles, wizard drafts, and quoted payments must survive restarts and two devices. Synthetic test contexts may keep it locally. Telegram's currently visible keyboard is never authority. As a one-time compatibility path, an idle user whose persisted mode is empty may use stable labels from a legacy visible keyboard; in-progress flows and active discussions remain mode-gated.

Public-profile entry captures the underlying mode in `publicProfileReturnNavigationMode`. Profile, public Favorites, and profile-discussion child views preserve it; their Close actions consume it and restore the exact underlying reply-keyboard authority instead of merely deleting the inline card.

Ordinary navigation is append-only chat history: converted destinations do not send footprint messages, track navigation-card IDs, or delete/edit earlier bot messages. Legacy navigation-card IDs are forgotten without Telegram cleanup. Inline cleanup is reserved for consumed indexed, identity-bound, destructive, or transactional cards whose stale payload could be unsafe.

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
- `src/bot.js` also owns global Telegram command routing and the shared cleanup performed before command navigation.
- `src/callbacks.js` dispatches callback queries.
- `src/flows/ai-text.js` owns AI text states for section chat, list management, comments, and suggestion-context prompts.
- `src/flows/ai-hub.js` owns delivery of the single Movies, Music & Books / Favorites hub banner card.
- `src/flows/ai-callbacks.js` owns AI callback routes and AI section/list callback actions.
- `src/flows/ai-cards.js` owns remembered AI list/section card IDs and stale AI card cleanup helpers.
- `src/flows/profile-edit.js` owns profile edit prompt tracking and stale prompt cleanup.
- `src/flows/profile-text.js` owns typed profile edit states, profile edit cancellation, and reset-photo text commands.
- `src/flows/profile-callbacks.js` owns inline profile-picker routing, legacy settings-callback compatibility, and own-profile card restoration.
- `src/flows/profile-sharing.js` owns share-card delivery and Back-to-own-profile restoration; `src/services/profile-sharing.js` owns caption shaping and media-Favorites eligibility.
- `src/flows/profile-favorites.js` owns inline browsing of another user's public Movies/Music/Books Favorites; `src/services/profile-favorites-ui.js` owns its caption-safe text shaping.
- `src/services/public-profile-navigation.js` owns public-profile source-mode parsing and capture/restoration of the reply-keyboard mode beneath profile child cards.
- `src/flows/saved-profiles.js` owns the people hub, its durable first-visit guidance, people-discovery callbacks, saved-profile commands/callback helpers, public-profile viewing by code, list message tracking, and stale public-profile card cleanup.
- `src/flows/discussions-text.js` owns discussion text commands and bottom-keyboard controls.
- `src/flows/onboarding.js` owns the append-only first-session flow, starter-invitation completion copy, and completion-destination analytics, including durable discussion/profile share destinations that render only after the normal completion surface; `src/services/reply-keyboard-navigation.js` resolves its language, welcome, page-aware Interest, custom-input, taste-nudge, and completion labels only in the matching durable mode.
- `src/flows/discussion-messages.js` owns active-room text/voice message validation, recent-message append orchestration, delivery, and runtime reply mapping.
- `src/flows/discussions-create-text.js` owns typed discussion-create wizard states.
- `src/flows/discussions-create-callbacks.js` owns inline discussion-create wizard callbacks.
- `src/flows/discussions-callbacks.js` owns discussion callback housekeeping, predicates, list/menu callbacks, join-error acknowledgements, and first Active Discussions guidance delivery.
- `src/flows/discussion-invitations.js` owns stored user-to-user discussion invitation commands/callbacks, inbox rendering flow, invite source return handling, and the shared first Discussions-guidance state when Invitations is visited first.
- `src/services/discussion-actions.js` owns discussion side-effect orchestration such as notifications.
- `src/services/discussion-owner-join-notifications.js` owns private owner join-card orchestration, unique-joiner batching, the durable due-summary scan, copy shaping, bounded delivery, and atomic claim/restore calls. `src/models/discussion-owner-join-notice.js` stores stable ids needed for per-window deduplication and minimal per-discussion throttle state; it never stores names, Telegram message ids, or notification text.
- `src/services/discussion-invitations.js` owns stored invitation creation, lookup, lifecycle, daily-limit checks, and received-invite listing.
- `src/services/discussion-invitation-mutes.js` owns directional invitation-restriction pairs, list/count/unrestrict operations, and the cross-feature "restricted user cannot join the restricting user's created discussions" predicate. The historical filename/model remain for compatibility.
- `src/services/discussion-join-rules.js` owns discussion join-rule payload validation and user eligibility checks.
- `src/services/discussion-notifications.js` owns low-level discussion notification payload normalization and best-effort member delivery helpers.
- `src/services/discussion-messages.js` owns discussion message quota checks and recent-message append rules.
- `src/services/discussion-starters.js` owns bot-created starter room seed definitions, idempotent startup seeding, the fixed 100-member recognized-starter capacity, and starter-room sort order.
- `src/services/discussion-text.js` owns shared discussion text normalization and link detection.
- `src/services/discussion-delivery-memory.js` owns runtime-only delivered-message id mapping for platform-native discussion replies. Reply metadata and delivered ids should not be persisted.
- `src/services/public-codes.js` owns public profile/discussion code normalization, generation, and lookup helpers.
- `src/services/people-discovery.js` owns shared-item filtering, `showProfileInPeopleDiscovery` enforcement, ranking, and pagination for the free `👀 دیدن آدم‌ها` People entry.
- `src/services/people-taste-matches.js` contains legacy time-limited Stars entitlement helpers kept for old callback/data compatibility; current People discovery does not charge Stars.
- `src/services/people-discovery-ui.js` owns people-discovery list text and callback predicate helpers.
- `src/services/saved-profiles.js` owns saved-profile bookmark mutation rules and caps.
- Public share-link discussion invite behavior should keep the same split: command/deep-link handling in `src/flows/discussions-text.js`, invite preview/callback handling in `src/flows/discussions-callbacks.js`, data lookups in `src/services/discussions.js`, and invite copy/rendering in `src/services/discussion-ui.js`.
- Stored saved-profile invitations should use `src/flows/discussion-invitations.js`, `src/services/discussion-invitations.js`, `src/services/discussion-invitation-mutes.js`, and `src/services/discussion-invitations-ui.js`.

## Data Model Rules

- Update `src/services/users.js` when adding or changing user fields or state helpers.
- `User.sectionTipsShownAt` stores independent durable timestamps for invitation Discussions guidance, Active Discussions browsing guidance, Favorites, and People. `src/services/users.js` owns the whitelisted atomic first-write helpers; flows call the context-aware helper only after their containing Telegram response succeeds.
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
- `src/services/profile-privacy-ui.js` for invitation-restriction list text shaping.
- `src/services/profile-favorites-ui.js` for caption-safe public media Favorites and taste-label rendering.
- `src/services/saved-profiles-ui.js` for saved-profile list item shaping and saved-code helpers.
- `src/services/ai-list-ui.js` for AI list/taste/suggestion text shaping.
- `src/services/banner-media.js` for global Telegram banner `file_id` lookup, first-upload persistence in `AppSetting`, invalid-cache recovery, and bundled-asset fallback.
- `src/services/ai-paid-suggestions.js` for paid extra suggestion quote/spend/refund state after free quota exhaustion.

When adding new discussion/profile UI flows, prefer extending these helpers or focused flow modules instead of growing inline formatting logic inside callbacks.

Every other-user public-profile source shares the same Favorites and visible-discussions actions. Save/Remove, restriction controls, and return behavior remain source-specific. Discussion-member profiles remain transient identity-bound inline cards, while People and Saved Profiles preserve their People-hub bottom keyboard beneath the card.

Visible discussions opened from a public-profile card edit that same text or photo message and use inline Join/Back/Close controls. Back reconstructs the profile in place. The command entry point sends a new inline card because Telegram user messages cannot be edited by the bot.

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
- See People discovery visibility (`showProfileInPeopleDiscovery`); missing values are treated as visible
- owned open discussion reservations, capped at 3
- saved profile references, capped at 50 per user
- transient public-profile card id (`publicProfileLastMessageId`)
- transient invitation-restrictions list card id (`profileInvitationRestrictionsLastMessageId`)
- transient discussion member-list card id (`discussionLastMembersMessageId`)
- pending profile view code (`pendingProfileViewCode`)
- pending attributable profile-share destination (`pendingProfileShareCode`)
- reply-keyboard mode beneath a public profile (`publicProfileReturnNavigationMode`)

Profiles are public inside bot social surfaces for now. See People visibility is only a discovery opt-out, not a private-profile switch. Discussion visibility controls whether the user's current and created open discussions may be shown on that profile. Both preferences default to on for new accounts; missing legacy values are treated as on and existing saved choices remain unchanged.
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
- `DISCUSSION_OWNER_JOIN_NOTICES_ENABLED` enables private, throttled discussion-owner join cards. It defaults off; create the `DiscussionOwnerJoinNotice` indexes before rollout.
- Never reuse or swap `API_ROOT` and `API_BASE_URL`.
- Keep bot-platform and AI endpoint configuration separate to avoid launch failures.
- Startup validates required runtime variables and common `API_ROOT`/`API_BASE_URL` mix-ups through `src/config.js`.

## Referral And Shared-Link Continuation

- `src/flows/guide-referrals.js` builds the focused Guide referral card from startup-loaded Star settings. `src/services/invite-links.js` builds safe deep links and `src/services/star-referrals.js` owns opaque links, first-referrer claims, qualification, and reward idempotency.
- Shared-discussion continuation is stored on the User and consumed by the existing onboarding and normal discussion-preview flows. It never enters stored invitation services. Directed-pair rewards accept only stored `saved_profile` invitation sources.
- `src/services/share-actions.js` owns platform-native share URL construction and safe copy-button limits. Referral, discussion, and Favorites flows provide their own localized content and attribution semantics.
