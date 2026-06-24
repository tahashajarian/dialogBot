# Performance And Scalability Notes

This note captures the June 2026 performance, UX-safety, and maintainability audit. It is a planning document, not a product behavior contract.

## Low-Risk Changes Made

- People discovery now records privacy-safe analytics for `browse` and `taste` modes with result count and coarse failure reason.
- AI response cache now records privacy-safe analytics for exact, fuzzy, semantic, disabled, failed-new-call, and new-call outcomes without storing prompt text, item text, or response text.
- Discussion boost recipient selection now batches mute and delivery-history checks across the candidate set instead of doing per-candidate delivery and mute database calls.
- Mongo indexes now better match current candidate scans:
  - `users`: boost recommendation candidate filtering by ban/active-room/opt-out state.
  - `users`: People browse candidate filtering by ban/name presence.
  - `discussionboostdeliveries`: discussion-recipient lookup and stale reserved-delivery cleanup.

## Remaining Performance Risks

- People discovery still scans a bounded candidate window and ranks in process. This is acceptable for small/private-beta usage, but the result quality and latency depend on scan order once the public user base grows.
- The similar-people lens reconstructs normalized taste items from each candidate document on every request. This repeats normalization work and pulls list fields into application memory.
- Boost recipient selection still validates join rules in process for candidates that survive taste/mute/delivery filters. That is currently safer than duplicating rule logic in Mongo, but it remains CPU-bound for large candidate batches.
- AI cache fuzzy and semantic matching load recent candidates per category/purpose/lang and rank in process. The configured limit bounds the work, but high cache volume may reduce hit quality or increase lookup latency.

## Future Taste Index

Add a denormalized taste index only when metrics show it is needed. Useful triggers:

- People discovery p95 latency above 500 ms for warm Mongo queries.
- More than 10,000 public, non-banned users with names.
- Similar-people scans regularly hit `PEOPLE_DISCOVERY_SCAN_LIMIT` while returning few/no matches.
- Boost recipient selection p95 above 1 second or candidate batches above 500.

Suggested shape:

- Store normalized tokens per user, section, and list type in a separate `user_taste_indexes` collection or a compact embedded `tasteIndex` field.
- Keep section counts and first-class `hasThreeItemsBySection` booleans so insufficient-data checks and candidate filters are cheap.
- Precompute normalized item tokens when list mutations succeed in `src/services/users.js`; do not recompute them inside discovery requests.
- Index `{ section, normalizedItem, userId }` for overlap discovery and `{ userId, section }` for profile/list refresh.
- Query candidate user IDs by intersecting three-or-more shared normalized items in the same section, then hydrate only the top candidate profiles.

Do not run a broad migration until launch metrics justify it. A safe rollout would dual-write new list mutations first, backfill in bounded batches, compare old/new discovery results in logs, then switch reads behind a feature flag.

## UX Safety Review

- Discussion, saved-profile, People, and AI flows already track transient bot message ids and generally delete or retire stale inline cards before rendering follow-up cards.
- `src/callbacks.js` has centralized stale-callback retirement for AI, saved-profile/People, profile, and discussion surfaces. This protects old indexed buttons when a newer remembered card exists.
- AI remove/toggle flows delete the consumed callback card before showing the refreshed manager, which avoids shifted-index actions lingering in chat.
- Saved-profile and People list flows clear list/profile cards on navigation and preserve the correct Back destination for saved-list versus People-list profile opens.
- Discussion close/remove/member flows still contain some inline orchestration in `src/callbacks.js`; future changes should move more of that into focused discussion flow helpers rather than adding branches.

## Maintainability Boundaries

Largest files by size remain:

- `src/messages.js`: keep as data for now; split only with translation validation support.
- `src/flows/ai-callbacks.js`: safe next extraction is suggestion callbacks versus list-management callbacks.
- `src/keyboards.js`: safe next extraction is feature-specific keyboard modules re-exported through `src/keyboards.js`.
- `src/flows/saved-profiles.js`: safe next extraction is People discovery callbacks and Advanced Search preview callbacks.
- `src/callbacks.js`: keep shrinking by moving discussion member/remove/close branches into discussion flow modules.
- `src/bot.js`: keep as a text dispatcher; new text behavior should go to focused flow modules.

Prefer extraction only when touching the related behavior for a bug or feature. Mechanical splitting without behavior changes is lower priority than query-shape and stale-card safety work.
