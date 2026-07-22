# Agent Map

Use this map before changing code. It explains where behavior belongs so future work does not drift back into giant router files.

## Runtime Entry

- `src/index.js`: loads env, creates the Telegraf bot, builds app context, applies allowlist and repeated-tap guard, starts polling.
- `src/config.js`: parses and validates runtime environment settings, including bot-platform/API endpoint separation.
- `src/db.js`: MongoDB connection only.
- `src/bot.js`: text-message dispatcher. Keep this thin; route to flow/service helpers.
- `src/callbacks.js`: callback-query dispatcher. Keep this thin; route to flow/service helpers.
- `src/flows/callback-lifecycle.js`: stale-card protection, safe callback-card cleanup, and pre-dispatch cross-feature lifecycle policy.
- `src/flows/hub-callbacks.js`: Home/Guide/Profile/Favorites/Discussions hub callback execution.
- `src/flows/language-callbacks.js`: language picker and onboarding-aware language selection callbacks.
- `src/flows/public-profile-callbacks.js`: other-user profile view/save/unsave/close callback execution and return context.
- `src/flows/bot-routing.js`: pure text command, start-payload, and close-confirmation state parsing for the text dispatcher.
- `src/services/callback-contracts.js`: shared callback payload parsing, route labels, field allowlists, and Telegram byte-limit contract.
- `src/services/analytics-dashboard.js` and `scripts/analytics-dashboard.js`: Mongo snapshot metrics and the local admin dashboard.
- `src/services/operational-limits.js` and `src/models/app-setting.js`: cached, Mongo-backed global product limits editable from the dashboard.
- `src/services/operational-health.js` and `src/models/operational-event.js`: lightweight bot heartbeat and AI API health events for the dashboard.
- `docs/analytics-dashboard.md`: how to run and protect the local analytics dashboard.
- `docs/product-roadmap.md`: future product, Telegram launch, analytics, discovery, and monetization checklist.
- `docs/privacy-policy.md`: public-facing, product-accurate privacy template; operator placeholders must be completed before publication.
- `docs/moderation-runbook.md`: internal report, ban, appeal, incident, and safety operations.
- `docs/stars.md`: source of truth, rollout rules, and remaining tasks for the implemented Stars economy.

## Discussion Boundaries

- `docs/discussions.md`: source of truth for discussion behavior.
- `docs/discussion-language.md`: implemented immutable room language, compact active-list filtering, legacy backfill, and language-specific starter-room contract.
- `src/services/discussion-language.js`: discussion language/filter normalization, effective defaults, and filter cycling.
- `src/models/discussion.js`: discussion schema.
- `src/services/discussions.js`: discussion data rules and database mutations.
  - create/join/leave/close/remove/report
  - public discussion/profile code normalization
  - membership/message/create limits
  - recent message storage
- `src/services/discussion-actions.js`: cross-user side effects around discussion mutations.
- `src/flows/discussion-room-callbacks.js`: room open/join/leave/close and member-management callback execution.
  - join/leave/close/remove notifications
  - pre-close active-member lookup before active state is cleared
- `src/services/discussion-owner-join-notifications.js` and `src/models/discussion-owner-join-notice.js`: private owner join-card delivery plus durable unique-user deduplication, scheduled summaries, atomic ten-minute throttling, and failure restoration.
- `src/services/discussion-notifications.js`: low-level discussion notification delivery helpers.
  - normalize single/multi-message payloads
  - send best-effort notifications to member lists
  - build active-member notification helpers from discussion member lookups
- `src/models/discussion-invitation.js`: stored user-to-user discussion invitation schema.
- `src/models/discussion-invitation-mute.js`: invitation mute pair schema.
- `src/services/discussion-invitations.js`: stored invitation rules and lifecycle.
  - create/list/count/accept/remove/expire/seen
  - duplicate and daily-limit checks
- `src/services/discussion-invitation-mutes.js`: directional invitation-restriction rules (historical filename retained).
  - restrict/list/count/allow future invites from one user
  - block restricted users from newly joining discussions created by the restricting user
- `src/services/discussion-join-rules.js`: discussion join-rule rules.
  - validate open, taste-label, completed-TopTen, and TopTen-item payloads
  - check whether a user satisfies a discussion's join rule
- `src/services/discussion-messages.js`: persisted discussion message rules.
  - one-second burst and ten-minute quota checks
  - accepted text/voice message append
  - last-10 recent-message retention
- `src/services/discussion-starters.js`: bot-created starter rooms.
  - stable starter room definitions and seed order
  - idempotent startup seeding and fixed 100-member capacity for recognized language-specific seeds
  - smart-pinning sort helper for starter rooms
- `src/services/discussion-text.js`: shared discussion text helpers.
  - normalize discussion text fields
  - detect links consistently for titles and room messages
- `src/services/link-detection.js`: shared explicit-link, email-address, and bare-domain detection used by discussion text and profile-name validation.
- `src/services/public-codes.js`: public profile/discussion code helpers.
  - normalize public profile and discussion codes
  - generate missing public codes safely
  - lookup discussions by public code
- `src/services/discussion-invitations-ui.js`: stored invitation inbox and picker rendering.
- `src/services/discussion-delivery-memory.js`: runtime-only discussion message delivery id mapping for platform-native replies.
  - do not persist reply metadata or delivered message ids
- `src/flows/discussions-text.js`: text commands and bottom-keyboard discussion flow.
  - `/d_CODE`, `/leave_CODE`, `/close_CODE`
  - `/join_CODE` invite/deep-link entry when discussion invites are implemented
  - `/remove_CODE`, `/report_CODE`
  - active room bottom buttons
  - text close-confirm state
- `src/flows/discussion-messages.js`: active-room message handling.
  - text/voice validation and unsupported-content replies
  - recent-message append orchestration
  - live member delivery and runtime native-reply mapping
- `src/flows/discussions-create-text.js`: typed discussion-create wizard states.
  - title text input and validation
  - description text/skip handling
  - join-rule text fallback prompts
- `src/flows/discussions-create-callbacks.js`: inline discussion-create wizard callbacks.
  - active discussion limit check and draft reset
  - join-rule pickers
  - preview edits, capacity, confirm/cancel
- `src/flows/discussions-callbacks.js`: discussion callback housekeeping, predicates, list/menu callbacks, and join-error acknowledgements.
  - remembered room/list/menu cards
  - stale discussion card cleanup predicates
  - create-flow state predicates
  - first successful Active Discussions guidance delivery
- `src/flows/discussion-invitations.js`: stored invitation commands/callbacks and source-specific return handling.
  - `/iv_CODE`, `/accept_inv_CODE`, `/remove_inv_CODE`
  - invitation inbox, invite saved profile, invite from saved profile, confirm inviter restriction
  - first inbox explanation shares the durable Discussions guidance state with Active Discussions
- `src/services/discussion-ui.js`: discussion list/preview/error formatting.
- `src/services/discussion-room-ui.js`: room header, recent messages, member list formatting.
- `src/services/discussion-member-profiles.js`: focused user-profile reads for discussion member cards and removal actions.

## Profile, People, And Saved Profiles

- `src/services/account-deletion.js`: durable, resumable account cleanup and audit-identity anonymization; contains no Telegram copy.
- `src/models/account-deletion.js`: deletion progress, unique tombstone identity, and keyed anti-abuse fingerprint.
- `docs/account-deletion.md`: deletion, retention, retry, and recreation contract.

- `src/models/user.js`: user schema and profile/discussion/people/saved-profile fields, including independent `sectionTipsShownAt` timestamps for invitation guidance, Active Discussions browsing, Favorites, and People.
- `src/services/users.js`: stable user-service facade and centralized AI-list access/mutations.
- `src/services/user-core.js`: core user lookup and generic field/state updates, re-exported through `src/services/users.js`.
- `src/services/user-section-tips.js`: whitelisted, atomic section-tip first-write helpers and exposure analytics, re-exported through `src/services/users.js`.
- `src/flows/profile-edit.js`: profile edit prompt tracking, stale prompt cleanup, edit-start helpers, and remembered inline-card refresh for typed Interests.
- `src/flows/profile-text.js`: typed profile edit states, `/cancel` during profile edits, and `/resetphoto`.
- `src/flows/profile-privacy.js`: Privacy & Safety navigation, See People and public-Favorites visibility mutations, and invitation-restriction management.
- `src/services/profile-privacy-ui.js`: invitation-restriction list rendering.
- `src/flows/profile-callbacks.js`: inline profile-picker routing, legacy settings-callback compatibility, own-profile card restoration, and profile completion redirect handling.
- `src/flows/profile-sharing.js`: static shareable-profile banner delivery and in-place Back-to-own-profile restoration where Telegram supports it.
- `src/services/profile-sharing.js`: first-person, caption-safe public taste teaser shaping and complete-media-Favorites eligibility.
- `src/flows/profile-favorites.js`: source-aware public Favorites hub/section callbacks and Back-to-profile restoration.
- `src/services/profile-favorites-ui.js`: public Movies/Music/Books Favorites and stored taste-label rendering; excludes every For Later list.
- `src/services/public-profile-navigation.js`: public-profile mode parsing plus capture/restoration of the reply-keyboard mode beneath profile child cards.
- `src/flows/saved-profiles.js`: people hub callbacks and first-visit guidance, people-discovery navigation, saved-profile commands/callback helpers, public-profile rendering by code, list message tracking, and stale public-profile card cleanup.
- `src/flows/saved-profile-message-state.js`: remembered Saved Profiles, People, profile-discussion, and viewed-profile message state plus safe retirement.
- `src/flows/saved-profiles-routing.js`: Saved Profiles and People callback recognition.
- `src/services/saved-profile-discussions-ui.js`: source-aware profile-discussion parsing, return controls, and viewer-current-room decoration.
- `src/services/profile-discussions.js`: read-only visible-open-discussion queries for public profile surfaces.
- `src/services/people-discovery.js`: free shared-item matching, ranking, and pagination for `👀 دیدن آدم‌ها`.
- `src/services/people-taste-matches.js`: legacy people entitlement helpers kept only for compatibility with old callbacks/data; do not use for the current free People entry.
- `src/services/people-discovery-ui.js`: people-discovery list text and callback predicate helpers.
- `src/services/saved-profiles.js`: saved-profile bookmark mutation rules.
  - save/unsave public profile codes
  - enforce saved-profile cap
  - preserve concurrent saved-profile updates
- `src/services/profile.js`: profile validation, profile text/photo rendering, location payload helpers.
- `src/services/saved-profiles-ui.js`: saved-profile list shaping, pagination text, saved footer text.
- People discovery is free, taste-first, and should not imply dating, friendship, private chat, online status, or compatibility scoring. Saved profiles are private one-way bookmarks. Do not notify the saved user.
- Profile viewing gate requires only display name; after completion, users are redirected to the intended profile via `pendingProfileViewCode`.
- Attributable profile-share starts persist `pendingProfileShareCode` through unchanged onboarding, then render the destination after the normal completion message and keyboard.

## Onboarding

- `src/flows/onboarding.js`: first-session configurable Interest quick start.
  - eligibility for recent, empty accounts
  - rotating stable interest pages, selected-chip `✓` markers, custom typed interests, and validation
  - progress and completion rendering
  - server-scoped bottom onboarding language/welcome/chip/remove/more/completion handling, plus direct typed Interests
  - append-only onboarding prompt transitions without Telegram delete/edit cleanup
  - optional post-invite quick taste setup nudge for invite-first users who have not completed onboarding
  - handoff to starter invitations, Lists, discussions, or Home
  - completion destination analytics without Interest text or other user content

## AI Lists And Suggestions

- `docs/ai-lists-and-suggestions.md`: source of truth for AI list behavior.
- `src/flows/ai-text.js`: AI text states for section chat, list management, comments, and suggestion-context prompts.
- `src/flows/ai-list-input.js`: list-add prompt selection plus typed/audio input extraction for AI lists.
- `src/flows/ai-callbacks.js`: AI callback routes, section entry actions, and list action callbacks.
- `src/flows/ai-callback-routing.js`: AI callback recognition plus state/list/filter token validation.
- `src/flows/ai-suggestion-callbacks.js`: suggestion quota, paid fallback/refunds, AI retry, duplicate rejection, and result-state orchestration.
- `src/flows/ai-taste-labels.js`: taste-label result/current/failure card presentation and progressive review delivery.
- `src/flows/ai-cards.js`: remembered AI list/section card IDs and stale-card cleanup helpers shared by AI text/callback flows.
- `src/services/users.js`: centralized AI list storage helpers and media taste-label state.
- `src/services/ai.js`: AI suggestion requests and recommendation parsing.
- `src/services/ai-list-ui.js`: AI list/taste/suggestion text rendering helpers.
- `src/services/ai-paid-suggestions.js`: paid extra suggestion quote/spend/refund rules after free quota exhaustion.
- `src/services/taste-label-classifier.js`: allowlisted media label catalog, conservative structured AI classification, ranked shortlist, evidence-gated optional insight, and list fingerprinting.
- `src/services/taste-label-rechecks.js`: dashboard-gated paid recheck quotes, exact-list validation, Star spending, completion, cancellation, and refunds.
- `src/models/ai-taste-recheck.js`: durable paid taste-label recheck lifecycle and result snapshot.
- `src/services/ai-section.js`: section labels, media taste labels, state-to-section helpers.
- `src/services/ai-list-duplicates.js`: duplicate matching.
- `src/constants/ai.js`: AI list and suggestion limits.

## UI And Copy

- `src/messages.js`: translation/copy keys.
- `src/keyboards.js`: inline and reply keyboard builders.
- `src/keyboards/ai.js`: AI section, suggestion, list-management, taste-label, and input-control keyboard builders.
- `src/services/reply-keyboard-navigation.js`: durable reply-keyboard modes, localized label normalization, exact-mode action resolution, and shared mode persistence. Keep label matching out of dispatchers and feature flows.
- `docs/bot-ux.md`: bot UX rules, stale-card cleanup, low-noise behavior.

## Stars Economy

- Keep `src/bot.js` and `src/callbacks.js` as dispatchers.
- Use focused ledger, settings, milestone, referral, boost, People entitlement, future Advanced Search, and UI services described in `docs/stars.md`.
- Do not put Star mutations directly in onboarding, list, profile, invitation, or discussion routers. Those flows should request an idempotent domain operation only after the underlying product action succeeds.
- Own-profile balance rendering belongs in `src/services/profile.js`; other-user render paths must omit it.
- Admin-editable Star rewards/costs belong in a separate Star economy settings service/AppSetting key, surfaced by the existing dashboard.
- Outside invite attribution belongs in focused invite/referral services and must use opaque public tokens rather than raw user IDs.

## Where To Put New Work

- New discussion data rule: `src/services/discussions.js`.
- New public profile/discussion code rule: `src/services/public-codes.js`.
- New discussion join-rule or eligibility rule: `src/services/discussion-join-rules.js`.
- New discussion message quota or recent-message append rule: `src/services/discussion-messages.js`.
- New starter-room seed, order, or smart-pinning rule: `src/services/discussion-starters.js`.
- New shared discussion text normalization/link rule: `src/services/discussion-text.js`.
- New discussion side-effect orchestration: `src/services/discussion-actions.js`.
- New discussion notification payload/delivery helper: `src/services/discussion-notifications.js`.
- New discussion delivery/reply runtime mapping: `src/services/discussion-delivery-memory.js`.
- New discussion text command or bottom-button flow: `src/flows/discussions-text.js`.
- New active-room text/voice delivery rule: `src/flows/discussion-messages.js`.
- New public discussion invite preview/deep-link flow: `src/flows/discussions-text.js`.
- New public discussion invite join/switch/dismiss callback: `src/flows/discussion-room-callbacks.js`.
- New stored discussion invitation behavior: `src/flows/discussion-invitations.js`, `src/services/discussion-invitations.js`, `src/services/discussion-invitation-mutes.js`, and `src/services/discussion-invitations-ui.js`.
- New discussion list/menu callback action: `src/flows/discussions-callbacks.js`.
- New discussion-create typed input step: `src/flows/discussions-create-text.js`.
- New discussion-create inline callback step: `src/flows/discussions-create-callbacks.js`.
- New discussion callback housekeeping/predicate: `src/flows/discussions-callbacks.js`.
- New discussion rendering text: `src/services/discussion-ui.js` or `src/services/discussion-room-ui.js`.
- New profile rendering rule: `src/services/profile.js`.
- New typed profile edit state or reset-photo command: `src/flows/profile-text.js`.
- New profile inline edit or legacy settings callback action: `src/flows/profile-callbacks.js`.
- New profile edit prompt lifecycle rule: `src/flows/profile-edit.js`.
- New saved-profile storage/mutation rule: `src/services/saved-profiles.js`.
- New saved-profile action: `src/flows/saved-profiles.js`; message-id lifecycle: `src/flows/saved-profile-message-state.js`; other-user profile callbacks: `src/flows/public-profile-callbacks.js`.
- New saved-profile list rendering rule: `src/services/saved-profiles-ui.js`.
- New AI text state or section bottom-button behavior: `src/flows/ai-text.js`.
- New first-session onboarding behavior: `src/flows/onboarding.js`.
- New Star earning/spending/refund rule: the focused Stars ledger service specified in `docs/stars.md`.
- New Star milestone qualification/hint: the focused milestone/UI helpers specified in `docs/stars.md`, called from the existing owning mutation service.
- New discussion boost rule: focused boost services plus small hooks in discussion list/room flows.
- New People discovery rule: keep matching/ranking in `src/services/people-discovery.js`; do not add Star charging to `👀 دیدن آدم‌ها`.
- New Advanced Search preview rule: keep it in the People flow/UI with no charging; any future entitlement/filter service must compose with `src/services/people-discovery.js`.
- New AI callback action: `src/flows/ai-callbacks.js`; suggestion-generation callback orchestration: `src/flows/ai-suggestion-callbacks.js`.
- New AI rendering/copy helper: `src/services/ai-list-ui.js`.
- New paid extra suggestion rule: `src/services/ai-paid-suggestions.js`; AI flows should only offer it after free quota exhaustion and explicit confirmation.
- New AI list mutation or taste helper: `src/services/users.js`.

## Validation Shortcuts

- Translation or `messages[lang].key` changes: `npm.cmd run validate:translations`.
- Behavior/service/flow changes: `npm.cmd test`.
- Small docs-only changes: no test required, but mention that tests were not run.

## Referral UX Ownership

- `src/flows/guide-referrals.js`: focused Guide referral-card construction using startup-loaded Star settings and opaque invite links.
- `src/services/star-referrals.js`: opaque external links, expiry, atomic first-referrer locking, and qualification.
- Shared discussion destinations persist on User fields and resume through `src/flows/onboarding.js` into the normal preview. After onboarding, an available joinable or join-condition-locked destination is preserved by `src/services/discussion-invitations.js` as a non-rewarding `shared_link` inbox row; directed saved-profile invitations remain separate.
- `src/services/share-actions.js`: reusable native-share URL and safe Copy/Back keyboard construction. Callers retain ownership of content, destination, and referral attribution.
