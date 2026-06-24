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
- A denormalized `user_taste_indexes` collection now stores normalized list tokens per user/section. Successful list add/remove/promote mutations refresh the affected section.
- Similar-people discovery and boost recipient selection prefer the taste index when it is populated, then hydrate only candidate user profiles and run the existing safety filters.

## Remaining Performance Risks

- Free People browse still scans a bounded public-profile candidate window and ranks in process. This is acceptable for small/private-beta usage, but the result quality and latency depend on scan order once the public user base grows.
- If `user_taste_indexes` is empty or unavailable, similar-people discovery falls back to the bounded legacy scan. Run `npm run rebuild:taste-index` after DB resets, imports, or legacy list migrations.
- Boost recipient selection still validates join rules in process for candidates that survive taste/mute/delivery filters. That is currently safer than duplicating rule logic in Mongo, but it remains CPU-bound for large candidate batches.
- AI cache fuzzy and semantic matching load recent candidates per category/purpose/lang and rank in process. The configured limit bounds the work, but high cache volume may reduce hit quality or increase lookup latency.

## Taste Index

Implemented shape:

- Collection: `user_taste_indexes`.
- One row per `{ userId, section }`.
- Fields: normalized `items`, `itemCount`, and `updatedAt`.
- Indexes:
  - unique `{ userId, section }`
  - `{ section, items, itemCount, userId }` for overlap candidate lookup
  - `{ updatedAt }` for operational inspection/rebuild work
- Rebuild command: `npm run rebuild:taste-index`.

Future refinements become useful when metrics show one of these thresholds:

- People discovery p95 latency above 500 ms for warm Mongo queries.
- More than 10,000 public, non-banned users with names.
- Similar-people scans regularly hit `PEOPLE_DISCOVERY_SCAN_LIMIT` while returning few/no matches.
- Boost recipient selection p95 above 1 second or candidate batches above 500.

Possible refinements:

- Add per-item rows if multikey array lookup becomes too broad at high scale.
- Add language/city filters only when those product filters exist and privacy rules are settled.
- Add sampled old/new result comparison before removing the legacy scan fallback.
- Add operational dashboard rows for taste-index row count, stale rows, and rebuild age.

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
