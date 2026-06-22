# Agent Map

Use this map before changing code. It explains where behavior belongs so future work does not drift back into giant router files.

## Runtime Entry

- `src/index.js`: loads env, creates Telegraf/Bale bot, builds app context, applies allowlist and repeated-tap guard, starts polling.
- `src/config.js`: parses and validates runtime environment settings, including Bale/API endpoint separation.
- `src/db.js`: MongoDB connection only.
- `src/bot.js`: text-message dispatcher. Keep this thin; route to flow/service helpers.
- `src/callbacks.js`: callback-query dispatcher. Keep this thin; route to flow/service helpers.
- `src/services/analytics-dashboard.js` and `scripts/analytics-dashboard.js`: Mongo snapshot metrics and the local admin dashboard.
- `src/services/operational-limits.js` and `src/models/app-setting.js`: cached, Mongo-backed global product limits editable from the dashboard.
- `src/services/operational-health.js` and `src/models/operational-event.js`: lightweight bot heartbeat and AI API health events for the dashboard.
- `docs/analytics-dashboard.md`: how to run and protect the local analytics dashboard.
- `docs/product-roadmap.md`: future product, Telegram launch, analytics, discovery, and monetization checklist.

## Discussion Boundaries

- `docs/discussions.md`: source of truth for discussion behavior.
- `src/models/discussion.js`: discussion schema.
- `src/services/discussions.js`: discussion data rules and database mutations.
  - create/join/leave/close/remove/report
  - public discussion/profile code normalization
  - membership/message/create limits
  - recent message storage
- `src/services/discussion-actions.js`: cross-user side effects around discussion mutations.
  - join/leave/close/remove notifications
  - pre-close active-member lookup before active state is cleared
- `src/services/discussion-notifications.js`: low-level discussion notification delivery helpers.
  - normalize single/multi-message payloads
  - send best-effort notifications to member lists
  - build active-member notification helpers from discussion member lookups
- `src/models/discussion-invitation.js`: stored user-to-user discussion invitation schema.
- `src/models/discussion-invitation-mute.js`: invitation mute pair schema.
- `src/services/discussion-invitations.js`: stored invitation rules and lifecycle.
  - create/list/count/accept/remove/expire/seen
  - duplicate and daily-limit checks
- `src/services/discussion-invitation-mutes.js`: invitation mute rules.
  - mute future invites from a user
  - block muted users from joining discussions created by the muter
- `src/services/discussion-join-rules.js`: discussion join-rule rules.
  - validate open, taste-label, completed-TopTen, and TopTen-item payloads
  - check whether a user satisfies a discussion's join rule
- `src/services/discussion-messages.js`: persisted discussion message rules.
  - one-second burst and ten-minute quota checks
  - accepted text/voice message append
  - last-10 recent-message retention
- `src/services/discussion-starters.js`: bot-created starter rooms.
  - stable starter room definitions and seed order
  - idempotent startup seeding
  - smart-pinning sort helper for starter rooms
- `src/services/discussion-text.js`: shared discussion text helpers.
  - normalize discussion text fields
  - detect links consistently for titles and room messages
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
- `src/flows/discussion-invitations.js`: stored invitation commands/callbacks and source-specific return handling.
  - `/iv_CODE`, `/accept_inv_CODE`, `/remove_inv_CODE`
  - invitation inbox, invite saved profile, invite from saved profile, mute inviter
- `src/services/discussion-ui.js`: discussion list/preview/error formatting.
- `src/services/discussion-room-ui.js`: room header, recent messages, member list formatting.

## Profile, People, And Saved Profiles

- `src/models/user.js`: user schema and profile/discussion/people/saved-profile fields.
- `src/flows/profile-edit.js`: profile edit prompt tracking, stale prompt cleanup, and edit-start helpers.
- `src/flows/profile-text.js`: typed profile edit states, `/cancel` during profile edits, and `/resetphoto`.
- `src/flows/profile-callbacks.js`: profile edit/settings callback routing, own-profile callback rendering, and profile completion redirect handling.
- `src/flows/saved-profiles.js`: people hub callbacks, people-discovery navigation, saved-profile commands/callback helpers, public-profile rendering by code, list message tracking, and stale public-profile card cleanup.
- `src/services/people-discovery.js`: taste-based people discovery, shared-item matching, filtering, ranking, and pagination.
- `src/services/people-discovery-ui.js`: people-discovery list text and callback predicate helpers.
- `src/services/saved-profiles.js`: saved-profile bookmark mutation rules.
  - save/unsave public profile codes
  - enforce saved-profile cap
  - preserve concurrent saved-profile updates
- `src/services/profile.js`: profile validation, profile text/photo rendering, location payload helpers.
- `src/services/saved-profiles-ui.js`: saved-profile list shaping, pagination text, saved footer text.
- People discovery is taste-based and should not imply matching, dating, friendship, private chat, or online status. Saved profiles are private one-way bookmarks. Do not notify the saved user.
- Profile viewing gate requires only display name; after completion, users are redirected to the intended profile via `pendingProfileViewCode`.

## Onboarding

- `src/flows/onboarding.js`: first-session three-interest quick start.
  - eligibility for recent, empty accounts
  - rotating interest pages, custom typed interests, and validation
  - progress and completion rendering
  - onboarding chip/more/custom/skip callback handling
  - handoff to Interests, discussions, or the main menu

## AI Lists And Suggestions

- `docs/ai-lists-and-suggestions.md`: source of truth for AI list behavior.
- `src/flows/ai-text.js`: AI text states for section chat, list management, comments, and suggestion-context prompts.
- `src/flows/ai-list-input.js`: list-add prompt selection plus typed/audio input extraction for AI lists.
- `src/flows/ai-callbacks.js`: AI callback routes, section entry actions, and list action callbacks.
- `src/flows/ai-cards.js`: remembered AI list/section card IDs and stale-card cleanup helpers shared by AI text/callback flows.
- `src/services/users.js`: centralized AI list storage helpers and taste label inference.
- `src/services/ai.js`: AI requests, predefined taste feedback, recommendation parsing.
- `src/services/ai-list-ui.js`: AI list/taste/suggestion text rendering helpers.
- `src/services/ai-response-cache.js`: reusable AI response cache.
- `src/services/ai-section.js`: section labels, taste labels, state-to-section helpers.
- `src/services/ai-list-duplicates.js`: duplicate matching.
- `src/constants/ai.js`: AI list and suggestion limits.

## UI And Copy

- `src/messages.js`: translation/copy keys.
- `src/keyboards.js`: inline and reply keyboard builders.
- `docs/bot-ux.md`: bot UX rules, stale-card cleanup, low-noise behavior.

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
- New discussion invite preview/callback flow: `src/flows/discussions-callbacks.js`.
- New stored discussion invitation behavior: `src/flows/discussion-invitations.js`, `src/services/discussion-invitations.js`, `src/services/discussion-invitation-mutes.js`, and `src/services/discussion-invitations-ui.js`.
- New discussion list/menu callback action: `src/flows/discussions-callbacks.js`.
- New discussion-create typed input step: `src/flows/discussions-create-text.js`.
- New discussion-create inline callback step: `src/flows/discussions-create-callbacks.js`.
- New discussion callback housekeeping/predicate: `src/flows/discussions-callbacks.js`.
- New discussion rendering text: `src/services/discussion-ui.js` or `src/services/discussion-room-ui.js`.
- New profile rendering rule: `src/services/profile.js`.
- New typed profile edit state or reset-photo command: `src/flows/profile-text.js`.
- New profile edit/settings callback action: `src/flows/profile-callbacks.js`.
- New profile edit prompt lifecycle rule: `src/flows/profile-edit.js`.
- New saved-profile storage/mutation rule: `src/services/saved-profiles.js`.
- New saved-profile action or public-profile card lifecycle rule: `src/flows/saved-profiles.js`.
- New saved-profile list rendering rule: `src/services/saved-profiles-ui.js`.
- New AI text state or section bottom-button behavior: `src/flows/ai-text.js`.
- New first-session onboarding behavior: `src/flows/onboarding.js`.
- New AI callback action: `src/flows/ai-callbacks.js`.
- New AI rendering/copy helper: `src/services/ai-list-ui.js`.
- New AI list mutation or taste helper: `src/services/users.js`.

## Validation Shortcuts

- Translation or `messages[lang].key` changes: `npm.cmd run validate:translations`.
- Behavior/service/flow changes: `npm.cmd test`.
- Small docs-only changes: no test required, but mention that tests were not run.
