# Performance And Scalability Notes

This note captures the June 2026 performance, UX-safety, and maintainability audit. It is a planning document, not a product behavior contract.

## Low-Risk Changes Made

- Update processing now logs privacy-safe stage timings for appearance refresh, referral lookup, user lookup, and handler work when an update exceeds the slow-update threshold. Error logs include timings completed before failure.
- Existing bot heartbeats now include event-loop lag and process memory measurements, making host saturation and memory growth distinguishable from network latency.
- Own-profile navigation uses fewer Telegram API calls: text profile Back navigation edits the card into the main menu, while photo profiles preserve delete-then-send behavior required by Telegram.
- Opening an own profile with a custom photo sends the photo directly instead of creating and deleting a temporary loading message. This removes two sequential Telegram API calls without changing profile content or controls.
- People discovery now records privacy-safe analytics for `browse` and `taste` modes with result count and coarse failure reason.
- AI response cache now records privacy-safe analytics for exact, fuzzy, semantic, disabled, failed-new-call, and new-call outcomes without storing prompt text, item text, or response text.
- Discussion boost recipient selection now batches mute and delivery-history checks across the candidate set instead of doing per-candidate delivery and mute database calls.
- Mongo indexes now better match current candidate scans:
  - `users`: boost recommendation candidate filtering by ban/active-room/opt-out state.
  - `users`: People browse candidate filtering by ban/name presence.
  - `users`: active discussion membership cleanup by `activeDiscussionId`.
  - `discussions`: creator-owned open room lists sorted by recent activity.
  - `discussioninvitations`: inbox unseen-state queries and inviter daily rate-limit scans.
  - `discussionboostdeliveries`: discussion-recipient lookup and stale reserved-delivery cleanup.
- `npm run create:indexes` creates declared Mongoose indexes during deployment without dropping existing indexes.
- AI suggestion routing can be pinned with `AI_SUGGESTION_PROVIDER=chat` or `responses` to avoid sequential provider timeouts when one API shape is unsupported or too slow.
- AI cache reads use lean/projection reads and share candidate loading between fuzzy and semantic matching.
- A denormalized `user_taste_indexes` collection now stores normalized list tokens per user/section. Successful list add/remove/promote mutations refresh the affected section.
- Similar-people discovery and boost recipient selection prefer the taste index when it is populated, then hydrate only candidate user profiles and run the existing safety filters.

## Remaining Performance Risks

- Telegram API latency depends on the deployment network path. Production testing from an Iran-hosted server using `TELEGRAM_PROXY_URL` showed intermittent per-call latency around 0.8-2.7 seconds, while Mongo user lookup remained around 4-15 ms. Moving to a host with direct Telegram access is expected to provide a larger improvement than further request-path micro-optimizations.
- Photo-card navigation still requires separate delete and send operations when moving to a text-only destination because Telegram cannot convert a photo message into a text message.
- Free People browse still scans a bounded public-profile candidate window and ranks in process. This is acceptable for small/private-beta usage, but the result quality and latency depend on scan order once the public user base grows.
- If `user_taste_indexes` is empty or unavailable, similar-people discovery falls back to the bounded legacy scan. For the launch workflow, new list mutations repopulate the index as users test the bot.
- Boost recipient selection still validates join rules in process for candidates that survive taste/mute/delivery filters. That is currently safer than duplicating rule logic in Mongo, but it remains CPU-bound for large candidate batches.
- AI cache fuzzy and semantic matching load recent candidates per category/purpose/lang and rank in process. The configured limit bounds the work, but high cache volume may reduce hit quality or increase lookup latency.

## Large-User-Count Review

The current codebase is suitable for launch and private-beta scale. A 1,000,000-user environment should be treated as a separate capacity target, not as a reason to rewrite before launch.

Highest-risk query/work areas:

- People discovery:
  - `👀 دیدن آدم‌ها` should keep using `user_taste_indexes` for overlap candidates, then hydrate only the small visible page.
  - Load-test first with many named, non-banned public profiles and sparse taste overlap.
- Taste index:
  - The multikey `{ section, items, itemCount, userId }` index is the current scaling path for shared-item lookup.
  - Watch stale-row count and rebuild age after imports, migrations, or failed list mutation jobs.
  - If overlap queries become broad, evaluate per-item rows before changing product behavior.
- Boost recipient selection:
  - Taste-index candidate lookup, mute/delivery-history batching, and recipient caps keep database calls bounded.
  - Join-rule validation remains in process. Load-test candidate batches above 500 and p95 above 1 second before denormalizing join-rule eligibility.
- Analytics dashboard:
  - Aggregate Star/event metrics should remain operational, not user-facing request-path dependencies.
  - At high volume, prefer daily rollups or cached dashboard snapshots over repeatedly aggregating unbounded event/ledger collections.
- Star reconciliation:
  - `reconcileStarBalances` is deliberately bounded. Run it as an operational check with a limit, then investigate mismatches rather than increasing limits blindly.
  - Pending transaction recovery should stay capped so one bad deployment cannot monopolize the process.

Expected index coverage to verify before high-scale rollout:

- `users`: public-profile discovery filters, banned-state filters, profile-name presence, active-room/boost-recipient fields, and cached `starBalance` lookup by `userId`.
- `user_taste_indexes`: unique `{ userId, section }`, overlap lookup `{ section, items, itemCount, userId }`, and stale-row inspection by `updatedAt`.
- `startransactions`: unique idempotency key, per-user transaction history, pending status recovery, and reconciliation scans.
- `starreferrallinks` / `starreferralclaims`: public code lookup, invitee uniqueness, pending claim lookup, and qualification status.
- `discussionboosts` / `discussionboostdeliveries`: active boost lookup, owner/discussion active uniqueness, recipient delivery dedupe, and stale reserved delivery cleanup.
- `discussions`: active/open room listing, owner/member lookup, public code lookup, and join-rule fields used by current list queries.

Load-test first:

- Shared-taste People discovery with 100k+ named users and limited profile data.
- Similar-people lookup with 1M taste-index rows and unevenly popular items.
- Boost recipient selection with many eligible users, mutes, and prior deliveries.
- Dashboard Star/event aggregate refresh with production-like ledger/event counts.
- Star reconciliation and pending recovery with realistic ledger volume and a small injected mismatch set.

## Taste Index

Implemented shape:

- Collection: `user_taste_indexes`.
- One row per `{ userId, section }`.
- Fields: normalized `items`, `itemCount`, and `updatedAt`.
- Indexes:
  - unique `{ userId, section }`
  - `{ section, items, itemCount, userId }` for overlap candidate lookup
  - `{ updatedAt }` for operational inspection/rebuild work
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
