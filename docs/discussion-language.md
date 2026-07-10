# Discussion Language: Implementation Specification

Status: implemented. This document describes the implemented discussion-language behavior and rollout tooling.

## Goal

Prevent users from unexpectedly browsing discussions they cannot understand, while preserving bilingual discovery for users who want it.

This is a refinement of the existing active-discussion list. Its compact language picker edits the existing list message in place; it must not send a separate filter message, add an Apply step, automatically detect language, translate user messages, or add a new discovery mode.

## Confirmed Product Behavior

### Discussion language

- Every discussion has exactly one immutable conversation language: `fa` or `en`.
- User-created discussions default to the creator's current bot language.
- The creation preview shows the selected language and has a small action for changing it before confirmation.
- Language cannot be changed after creation. Closing and recreating the room is the safe alternative.
- A room language describes the expected language of conversation. It does not translate or reject messages.
- Do not automatically detect language from the title, description, or messages.

### Active-list language filter

- The existing active-discussion list gains one inline language button. Tapping it edits the same message into a compact language picker; it does not send another message.
- The picker directly selects Persian only (`fa`), English only (`en`), or All (`all`) and returns to the refreshed list immediately without an Apply step.
- The default is the user's current interface language.
- Remember an explicit selection separately from the interface language. A later interface-language change must not overwrite an explicitly chosen discussion filter.
- Until the user explicitly changes this filter, changing interface language changes the effective default.
- The existing `Only discussions I can join` toggle remains independent.
- Any filter change resets the active list to page zero.
- Pagination preserves both filter values.
- `My discussions` is never language-filtered. A user must always see rooms they own or joined.

Suggested existing-list controls:

```text
[ 🔓 Only discussions I can join ]
[ 🇮🇷 Language: Persian ]
[ Back ]
```

The language button changes only its own value. It does not change the bot interface language.

### Direct access and invitations

- Language filtering affects active-list discovery only.
- Public links, stored invitations, saved-profile discussion lists, room commands, active-room reopening, and `My discussions` remain accessible regardless of the user's filter.
- Every preview reached outside the filtered active list must visibly show the discussion language before join/accept.
- A language mismatch is informational, not a join restriction. Do not add another confirmation or prevent joining.

### Display

- Show a compact localized language line on discussion previews and room creation previews.
- Active-list entries should show a compact flag or localized language label so `all` results remain understandable.
- Room headers should show the language so members can confirm the room convention.
- Do not repeat the language label in every delivered message.
- Titles and descriptions written by users remain unchanged; never translate them automatically.

## Starter Discussions

The current starter rooms are one shared underlying room whose title and description are localized per viewer. That can produce mixed Persian/English conversation and is incompatible with the goal.

Implement language-specific starter rooms:

- Seed one Persian and one English instance of every starter definition.
- Use stable unique seed keys such as `free-discussion:fa` and `free-discussion:en`.
- Store `language` explicitly on each seeded room.
- Render the title and description in the room's language, not the viewer's language.
- New-user smart pinning and onboarding starter invitations select only the user's effective language.
- Preserve the documented starter ordering within each language.
- Do not merge memberships or recent messages across language rooms.

Legacy starter-room rollout:

1. Seed the new language-specific rooms first.
2. Stop presenting or inviting users to the legacy shared starter rooms.
3. Keep legacy rooms accessible to existing members and old links during a transition period.
4. Mark legacy rooms with the chosen fallback language for data validity, but do not silently move users or copy messages.
5. Close legacy starter rooms only through an explicit, separately reviewed migration after notifying active members if required. Do not delete them.

## Data Model

### Discussion

Add to `src/models/discussion.js`:

```js
language: { type: String, enum: ["fa", "en"], required: true, index: true }
```

Use `language`, not `lang`, for the persisted discussion field so its meaning is explicit.

Add an active-list index suitable for the real query and sort, for example:

```js
{ status: 1, language: 1, lastActivityAt: -1, updatedAt: -1, createdAt: -1 }
```

Confirm the final index with `explain()` or query measurements before removing any existing index. Do not remove old indexes as part of this feature unless evidence shows they are redundant.

### User preference and draft

Add to `src/models/user.js`:

```js
discussionLanguageFilter: { type: String, enum: ["", "fa", "en", "all"], default: "" },
discussionDraftLanguage: { type: String, enum: ["fa", "en", ""], default: "" },
```

An empty filter means “follow current interface language.” It is different from `all`.

The draft field is initialized from normalized `user.lang` when creation starts. All draft reset/cancel/success paths must clear it with the other draft fields.

Add focused normalization helpers rather than repeating string checks:

- `normalizeDiscussionLanguage(value, fallback = "fa")`
- `normalizeDiscussionLanguageFilter(value)`
- `getEffectiveDiscussionLanguageFilter(user)`

These helpers should live in a focused service such as `src/services/discussion-language.js` and be unit tested.

## Legacy User-Created Discussions

MongoDB cannot safely make the field required before existing documents are handled.

Use a two-stage rollout:

1. Deploy code that tolerates a missing language and uses a deterministic fallback.
2. Run a dry-run backfill report.
3. Backfill existing discussions.
4. Verify no discussion remains without a valid language.
5. Enforce the required schema behavior and create the final index.

Backfill rule:

- Prefer the creator's normalized `User.lang` when the creator exists.
- Otherwise use `fa` as the deterministic fallback, because the existing user default is Persian.
- Do not infer from title, description, member languages, or recent messages.
- Report counts for `fa`, `en`, missing creators, invalid creator language, user-created rooms, and starter rooms.
- The migration must be idempotent and must not overwrite an already valid discussion language.
- Provide dry-run and apply modes. Applying must require an explicit flag.

## Service Rules

### Creation

Update `createDiscussion` in `src/services/discussions.js` to accept `language` and normalize/validate it at the authoritative boundary.

- UI defaults are not sufficient; service-level creation must never persist an invalid value.
- Prefer returning `invalid_language` for an explicitly invalid value.
- Callers that omit language during the compatibility phase may use the creator's normalized language.
- Add `language` to privacy-safe `discussion_created` analytics metadata.

### Active discovery query

Update `listActiveDiscussions` to accept a language filter.

- `fa`/`en`: filter in MongoDB before limit, decoration, ranking, and pagination.
- `all`: query both languages.
- Never fetch the newest 100 across all languages and filter afterward; that can hide valid rooms in the selected language.
- Filtering must happen before boost decoration and ranking so boosted rooms cannot cross the chosen language filter.
- Include language in the analytics throttle key or metadata so the dashboard can distinguish use without recording user text.

### Other queries

- `listMyDiscussions`: no language filter.
- Saved-profile discussion lookup: no filter, but render labels.
- Invitations and public-code lookup: no filter, but render labels.
- Boost recommendation candidate selection must match recipient preference or interface-language default. A Persian-only recipient must not receive an English-room recommendation. `all` recipients may receive both.
- Any automated onboarding invitation must select a starter room in the user's effective language.

## Callback and Keyboard Contract

Keep the active-list callback self-contained and under Telegram's 64-byte callback-data limit.

Recommended new payload format:

```text
discussion:list:active:page:<page>:<joinability>:<language>
```

Where:

- `<joinability>` is `all` or `joinable`.
- `<language>` is `fa`, `en`, or `all`.

Compatibility requirements:

- Continue parsing current payloads with no language token.
- For old buttons, derive the effective language from the user preference/interface language.
- Reject malformed page/filter/language tokens safely and return page zero with normalized defaults.
- A joinability toggle preserves language and resets page zero.
- Opening the language picker preserves joinability; selecting a language resets page zero.
- Next/previous page preserves both values.
- Repeated taps remain protected by the centralized interaction guard.
- Continue editing the remembered list card where possible; do not send a new filter card.

Persist `discussionLanguageFilter` only when a picker option is selected. Merely opening the list or picker must not turn the implicit interface-language default into an explicit preference.

## Creation UX

Do not add a mandatory creation step.

- On create start, initialize `discussionDraftLanguage` from `user.lang`.
- Add `Language: Persian/English` to `buildDiscussionPreviewText`.
- Add one `Change language` action to the existing preview keyboard.
- Tapping it may either toggle directly between `fa` and `en` and immediately redraw the same preview, or open the existing card with two choices. Prefer direct toggle because there are only two valid room languages.
- Preserve title, description, join rule, and capacity while toggling.
- Confirm creation using the draft language.
- Paid-capacity confirmation/retry must preserve and revalidate the language.
- Cancel, stale callbacks, failed validation, and successful creation must follow existing draft lifecycle rules.

## Empty and Error States

Handle the distinction between these cases:

- No open discussions exist at all: existing general empty state.
- No discussions exist in the selected language: localized message that identifies the selected language and offers the same language-picker/back controls.
- Discussions exist in the language but none are joinable under `joinableOnly`: existing joinable-empty meaning, with both toggles still present.
- Selected page becomes invalid after filtering or room closure: clamp to the last valid page, preferably page zero after a filter change.
- Invalid/missing legacy language during compatibility rollout: normalize to the documented fallback; never crash rendering.

Do not automatically switch to `all` when a language has no results. The user's choice must remain predictable.

## Interface-Language Changes

- If `discussionLanguageFilter` is empty, the next active-list open follows the newly selected interface language.
- If it is `fa`, `en`, or `all`, retain it after interface-language changes.
- Existing active list cards may be retired by normal navigation rules. Do not attempt to rewrite old cards globally.
- Discussion language itself never changes when its creator changes interface language.

## Security, Privacy, and Moderation

- Language is public room metadata and may appear in previews, lists, invitations, room headers, and analytics aggregates.
- Do not store detected message language or message samples for this feature.
- Do not moderate or reject a message solely because it differs from the room language.
- Reports, bans, mutes, capacity, join rules, ownership, Stars, and membership limits remain authoritative and unchanged.
- Language filtering must never bypass join validation; it only narrows discovery candidates.

## Files and Ownership Map

Expected implementation surfaces:

- `src/models/discussion.js`: required room language and query index.
- `src/models/user.js`: explicit filter preference and draft language.
- `src/services/discussion-language.js` (new): normalization, effective default, cycling, labels if appropriate.
- `src/services/discussions.js`: authoritative creation validation and active query filtering.
- `src/services/discussion-starters.js`: language-specific definitions/keys/seeding/order.
- `src/services/discussion-ui.js`: list, preview, and public/invitation language rendering.
- `src/services/discussion-room-ui.js`: room-header language rendering.
- `src/services/discussion-boost-notifications.js` and/or boost recipient selection service: recommendation language eligibility.
- `src/flows/discussions-callbacks.js`: active-list parsing, persistence, filtering, empty states.
- `src/flows/discussions-create-callbacks.js`: draft initialization/toggle/confirm/reset.
- `src/flows/discussions-create-text.js`: preserve language through typed steps and preview.
- `src/flows/discussions-text.js`: any text-command active-list rendering and old payload compatibility.
- `src/services/discussion-invitations.js`, invitation UI, and public invite preview paths: verify labels and no filtering.
- `src/keyboards/discussions.js`: list toggle and creation-preview language action.
- `src/constants/index.js`: new callback prefixes/tokens.
- `src/messages.js`: bilingual labels and empty/error copy.
- `src/services/analytics-events.js`: allow safe `language` metadata if used.
- `scripts/create-indexes.js`: ensure the new index is created through the existing operational path.
- New migration script under `scripts/`: dry-run/apply legacy language backfill.
- `docs/discussions.md`, `docs/architecture.md`, and `docs/agent-map.md`: final implemented behavior and boundaries.

Search all call sites rather than assuming this list is exhaustive. In particular, search for `listActiveDiscussions`, `createDiscussion`, `discussionPreview`, `botSeedKey`, `discussionListActivePage`, `buildDiscussionListText`, and discussion invite/boost rendering.

## Required Tests

### Unit tests

- Normalize valid and invalid room languages.
- Effective filter follows interface language while stored preference is empty.
- Explicit `fa`, `en`, and `all` survive interface-language changes.
- The language picker directly exposes every supported filter and marks the current selection.
- Active-list keyboard preserves language across pagination and joinability toggles.
- Old callback payloads remain valid.
- Malformed payloads fail safely.
- Opening the language picker edits the same message; selecting an option returns to that list at page zero.
- Creation defaults to creator language.
- Creation preview shows language in Persian and English UI.
- Creation toggle preserves every other draft field.
- Invalid language is rejected at the service boundary.
- List and room renderers show language without translating user content.
- `My discussions`, invitations, and direct links do not filter rooms out.
- Language-specific empty states retain both controls.
- Boost recommendation eligibility respects effective language filter.
- Starter localization is based on room language, not viewer language.

### Integration tests

- Create Persian and English discussions and persist the correct language.
- Persian active query excludes English rooms; English excludes Persian; `all` returns both.
- Database filtering happens before limit (create enough opposite-language rooms to prove it).
- Joinable and language filters compose correctly.
- Existing membership/direct invite can open a room outside the active filter.
- Concurrent creation remains within ownership limits with language included.
- Language-specific starter seeding is idempotent and produces unique stable keys.
- Backfill is idempotent and does not overwrite valid language.
- Missing creator and invalid creator language use the documented fallback.

### Regression tests

- Pagination, smart ranking, boosts, capacity, join rules, saved creators, and starter pinning still work within the filtered set.
- Stored invitations, public links, onboarding invitations, leave/close/remove/report, and native replies remain unchanged except for metadata display.
- Translation validation passes.
- Callback data remains below Telegram's limit.

## Rollout and Verification

1. Add helpers and compatibility behavior with tests.
2. Add nullable/tolerant model fields and creation persistence.
3. Add dry-run migration and review counts.
4. Backfill user-created discussions without overwriting valid values.
5. Seed language-specific starter rooms and stop new discovery/invites to legacy shared rooms.
6. Add active-list filtering, remembered preference, compact picker, and displays.
7. Add boost/onboarding automation filtering.
8. Verify no invalid/missing language remains.
9. Enforce required model behavior and create/verify indexes.
10. Run `npm.cmd run validate:translations`, `npm.cmd test`, and `npm.cmd run test:integration`.
11. Manually smoke-test Persian, English, and `all` on page zero and later pages; creation; public invites; stored invitations; My discussions; starter rooms; and interface-language changes.
12. Roll out while watching active-list result counts, empty states, joins, and recommendation delivery by language. Do not log discussion text.

## Implementation Checklist for a Future Agent

The implementing agent should complete these in order and not mark the task done early:

- [x] Read `AGENTS.md`, `docs/discussions.md`, this specification, `docs/bot-ux.md`, and `docs/architecture.md`.
- [x] Inspect the current dirty worktree and preserve unrelated user changes.
- [x] Locate every creation, list, starter, invitation, boost, and rendering call site listed above.
- [x] Implement and test the focused language helpers.
- [x] Add compatible model fields without breaking legacy documents.
- [x] Thread immutable room language through every creation/draft path.
- [x] Add preview/header/list labels in both languages.
- [x] Add a compact active-list language button whose picker edits the same message, with no Apply step and backward-compatible callback parsing.
- [x] Filter in the database before limit/ranking/pagination.
- [x] Keep My discussions and direct/invited access unfiltered.
- [x] Make starter rooms language-specific and safely handle legacy starters.
- [x] Apply language eligibility to automated invitations and boost recommendations.
- [x] Add dry-run/apply backfill tooling; operators must review dry-run counts before applying.
- [x] Add unit, integration, migration, and regression coverage.
- [x] Update source-of-truth documentation to implemented status.
- [x] Run the full validation suite and report exact results plus any migration/operator steps.

## Explicit Non-Goals

- Automatic language detection.
- Translating titles, descriptions, or messages.
- Per-message language enforcement.
- More than Persian and English.
- A separate filter screen or Apply button.
- Filtering My discussions or blocking direct invites.
- Changing a discussion's language after creation.
- Moving users or copying messages between starter rooms automatically.
