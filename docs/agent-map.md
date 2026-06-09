# Agent Map

Use this map before changing code. It explains where behavior belongs so future work does not drift back into giant router files.

## Runtime Entry

- `src/index.js`: loads env, creates Telegraf/Bale bot, builds app context, applies allowlist and repeated-tap guard, starts polling.
- `src/db.js`: MongoDB connection only.
- `src/bot.js`: text-message dispatcher. Keep this thin; route to flow/service helpers.
- `src/callbacks.js`: callback-query dispatcher. Keep this thin; route to flow/service helpers.

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
- `src/services/discussion-delivery-memory.js`: runtime-only discussion message delivery id mapping for platform-native replies.
  - do not persist reply metadata or delivered message ids
- `src/flows/discussions-text.js`: text commands and bottom-keyboard discussion flow.
  - `/d_CODE`, `/leave_CODE`, `/close_CODE`
  - `/join_CODE` invite/deep-link entry when discussion invites are implemented
  - `/remove_CODE`, `/report_CODE`
  - active room bottom buttons
  - text close-confirm state
- `src/flows/discussions-create-text.js`: typed discussion-create wizard states.
  - title text input and validation
  - description text/skip handling
  - join-rule text fallback prompts
- `src/flows/discussions-create-callbacks.js`: inline discussion-create wizard callbacks.
  - create quota check and draft reset
  - join-rule pickers
  - preview edits, capacity, confirm/cancel
- `src/flows/discussions-callbacks.js`: discussion callback housekeeping, predicates, list/menu callbacks, and join-error acknowledgements.
  - remembered room/list/menu cards
  - stale discussion card cleanup predicates
  - create-flow state predicates
- `src/services/discussion-ui.js`: discussion list/preview/error formatting.
- `src/services/discussion-room-ui.js`: room header, recent messages, member list formatting.

## Profile And Saved Profiles

- `src/models/user.js`: user schema and profile/discussion/saved-profile fields.
- `src/flows/profile-edit.js`: profile edit prompt tracking, stale prompt cleanup, and edit-start helpers.
- `src/flows/profile-callbacks.js`: profile edit/settings callback routing and own-profile callback rendering.
- `src/flows/saved-profiles.js`: saved-profile commands/callback helpers, public-profile rendering by code, saved-list message tracking, and stale public-profile card cleanup.
- `src/services/profile.js`: profile validation, profile text/photo rendering, location payload helpers.
- `src/services/saved-profiles-ui.js`: saved-profile list shaping, pagination text, saved footer text.
- Saved profiles are private one-way bookmarks. Do not notify the saved user.

## AI Lists And Suggestions

- `docs/ai-lists-and-suggestions.md`: source of truth for AI list behavior.
- `src/flows/ai-text.js`: AI text states for section chat, list management, comments, and suggestion-context prompts.
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
- New discussion side-effect orchestration: `src/services/discussion-actions.js`.
- New discussion delivery/reply runtime mapping: `src/services/discussion-delivery-memory.js`.
- New discussion text command or bottom-button flow: `src/flows/discussions-text.js`.
- New discussion invite preview/callback flow: `src/flows/discussions-callbacks.js`.
- New discussion list/menu callback action: `src/flows/discussions-callbacks.js`.
- New discussion-create typed input step: `src/flows/discussions-create-text.js`.
- New discussion-create inline callback step: `src/flows/discussions-create-callbacks.js`.
- New discussion callback housekeeping/predicate: `src/flows/discussions-callbacks.js`.
- New discussion rendering text: `src/services/discussion-ui.js` or `src/services/discussion-room-ui.js`.
- New profile rendering rule: `src/services/profile.js`.
- New profile edit/settings callback action: `src/flows/profile-callbacks.js`.
- New profile edit prompt lifecycle rule: `src/flows/profile-edit.js`.
- New saved-profile action or public-profile card lifecycle rule: `src/flows/saved-profiles.js`.
- New saved-profile list rendering rule: `src/services/saved-profiles-ui.js`.
- New AI text state or section bottom-button behavior: `src/flows/ai-text.js`.
- New AI callback action: `src/flows/ai-callbacks.js`.
- New AI rendering/copy helper: `src/services/ai-list-ui.js`.
- New AI list mutation or taste helper: `src/services/users.js`.

## Validation Shortcuts

- Translation or `messages[lang].key` changes: `npm.cmd run validate:translations`.
- Behavior/service/flow changes: `npm.cmd test`.
- Small docs-only changes: no test required, but mention that tests were not run.
