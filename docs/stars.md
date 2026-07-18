# Stars Economy

This document is the product and implementation source of truth for Stars in Muze. It defines how Stars are earned, spent, displayed, administered, attributed, refunded, and protected from abuse.

Stars replace the earlier Premium-account direction. Muze should not split users into permanent free and premium classes. Instead, every user can earn Stars through genuine product participation and choose which optional capabilities to spend them on. Real-money Star purchases may be introduced later, but are not part of the first implementation.

## Implementation Status

Tasks 1–8 in this document are implemented as of 2026-06-22. Earning and the Advanced Search preview have safe launch defaults; spending, boost activation, and recommendation delivery remain independently disabled until an operator enables them in the Star Economy dashboard. Actual Advanced Search filters and all real-money purchasing remain deliberately unimplemented.

The wallet uses native MongoDB transactions on replica sets and sharded clusters. On standalone MongoDB it uses an idempotent, recoverable per-user wallet state machine, so deployment topology does not silently disable rewards or allow duplicate balance changes.

## Product Promise

Stars should strengthen Muze's existing loop:

1. A user builds a real taste profile.
2. Muze recognizes meaningful progress with Stars.
3. Muze shows one relevant next milestone when useful.
4. The user spends Stars on optional discovery, amplification, or AI capabilities.
5. Core lists, profiles, discussions, invitations, safety, and basic discovery remain useful without payment.

Stars are not a public status score, reputation level, or measure of personal worth. They are private product credits.

## Naming And Visual Language

- User-facing name: `Stars` in English and `ستاره` in Persian.
- Symbol: `⭐`.
- Use natural singular/plural grammar in localized copy.
- Do not use a coin emoji or make Muze look like a game economy.
- Do not place Star prices throughout main navigation. Show the price when a user opens an optional paid action and can understand what it does.
- Saved-profile wording stays unchanged, but its emoji changes from `⭐` to `🔖` everywhere. This includes the People hub, saved-profile title, save state/action, invitation pickers, profile footer/action text, guide/rules examples, and both languages.
- Discussion host labels currently also use `⭐`. Replace only that icon with `🎙️` (for example `🎙️ Host` / `🎙️ میزبان`) so `⭐` has one meaning throughout Muze.

## Product Guardrails

- A free user can still complete onboarding, build all lists and Top 10s, receive basic suggestions, create and join discussions within normal limits, use `👀 دیدن آدم‌ها` / `👀 See people`, save profiles, and send invitations.
- Do not sell moderation privileges, privacy access, join-rule bypasses, message delivery, or access to hidden profile data.
- Do not show a user's Star balance to other users.
- Do not add public Star leaderboards, wealth badges, or spending indicators.
- Do not allow Stars to be withdrawn for money or freely transferred between users.
- Do not intentionally make a free flow worse to create a Star purchase.
- Paid or boosted placement must be labeled and must remain relevance- and safety-filtered.
- Star prompts must follow Muze's low-noise UX: combine them with the success message that caused them when possible.

## Balance And Ledger Model

The visible balance is one number. Internally, every change must be an immutable ledger transaction.

Recommended transaction fields:

- `userId`
- `amount`: positive earn/refund/grant or negative spend
- `balanceAfter`, recorded after an atomic mutation for support and audit
- `bucket`: `earned | purchased | promotional`
- `type`: `earn | spend | refund | grant | purchase | reversal | expiry`
- `reason`: stable machine key such as `profile_completed` or `discussion_boost`
- `idempotencyKey`: globally unique for the event being rewarded or charged
- optional `relatedUserId`, `discussionId`, `invitationId`, `boostId`, `entitlementId`, or `paymentId`
- `settingsSnapshot`: relevant configured reward, cost, duration, or version used at transaction time
- optional safe metadata that never includes message text or private profile values
- `createdAt`
- optional `reversesTransactionId`

The ledger is the source of truth. A cached `starBalance` on the user may support fast profile rendering, but it must be changed atomically with ledger creation. Never implement Star behavior as an unguarded `balance += amount` update.

Required invariants:

- A spend cannot make a balance negative.
- An idempotency key can create at most one effective transaction.
- Retries and simultaneous callbacks return the existing result rather than charging or rewarding twice.
- A refund references the original spend and can be issued only once.
- Historical transactions keep the settings applied at that time; later admin changes are not retroactive.
- Manual admin adjustments use ledger grants/reversals with an audit reason. Admins do not directly overwrite balances.

## Earning Stars

Stars reward verified outcomes, not taps or attempts. Rewards are awarded once unless a rule explicitly describes a renewable, capped reward.

The exact amounts are admin-editable. The values below are recommended launch defaults, not hardcoded product constants.

| Milestone | Default | Frequency | Qualification |
| --- | ---: | --- | --- |
| Complete onboarding | 5 | Once per account | The configured onboarding interest goal is completed |
| First 3 TopTen items in a section | 3 | Once per section | Three valid, distinct items exist in that section's Top 10 |
| Complete a Top 10 section | 7 | Once per section | The section reaches the configured completion size; this is additional to the first-3 reward |
| Complete profile milestone | 5 | Once per account | Display name and the configured non-sensitive completion rule are satisfied |
| Create first valid discussion | 3 | Once per account | Discussion creation succeeds and the room remains valid |
| Join first discussion | 2 | Once per account | A normal discussion join succeeds |
| First successful saved-profile invite to a specific person | 1 | Once per directed inviter/invitee pair | Invitee accepts and successfully joins |
| Bring a new user through an outside referral | 10 | Once per genuinely new invitee | Invitee completes the configured qualification milestone |

### List And Top 10 Milestones

- The four eligible sections are movies, music, books, and broad interests (`random` internally).
- Watchlists, playlists, and reading lists are free organization surfaces and do not award Stars.
- The first-3 TopTen reward is once per section, not once per item.
- The full Top 10 reward is once per section and may be earned after the first-3 reward.
- Removing items does not revoke an earned milestone and adding them again does not reward it again.
- Existing users lazily receive currently verifiable list and profile milestones when they open their private Stars overview. This is a bounded scan of four list sections and the profile, protected by the same idempotency keys. Historical discussion participation is not inferred; discussion creation/join rewards begin from live successful actions after rollout.
- Onboarding writes its choices into Interests TopTen. Its configurable completion reward replaces the normal Interests first-milestone reward for that account; the two rewards must not stack.
- The configured Top 10 completion threshold must not exceed the current TopTen item cap. The admin dashboard must validate this relationship.

### Profile Completion Milestone

Profile rewards must improve profile quality without coercing users to disclose sensitive information.

Recommended launch qualification:

- display name is set; and
- bio is set; and
- any two of city, age, gender, pet preference, or uploaded photo are set.

Exact GPS/location sharing must never be required or separately rewarded. Age and gender remain optional; a user can complete the milestone using other fields. Empty placeholders and default images do not count.

The profile completion rule must be centralized and reused by profile rendering, progress hints, and reward qualification. It is separate from the existing basic profile-view gate, which currently requires only a display name.

### Discussion Milestones

- The first valid discussion creation reward is account-wide and one-time.
- The first successful discussion join reward is also account-wide and one-time. Opening a preview, re-focusing an existing membership, or failing a join does not count.
- A failed draft, canceled wizard, rejected creation, duplicate callback, or room created by the bot does not count.
- Do not reward each created room; that would encourage low-quality room creation.
- Do not reward message count, repeated joining/leaving, closing, reporting, or member removal.
- Additional discussion achievements may be designed later, but they need quality signals and explicit anti-spam rules before becoming renewable.

### Discussion Invitation Reward

Stored invitations and attributable discussion share links remain reusable, but the Star reward is lifetime-once for each direction of a user pair.

- A to B's first accepted invitation that results in a successful join may reward A.
- Later A to B invitations never reward A again, even for another discussion.
- B may separately earn once for a successful B to A invitation.
- For stored saved-profile invitations, the target must still be saved when the invitation is created.
- For stored invitations, award only after the join mutation succeeds and the invitation is atomically accepted.
- For attributable discussion share links, award only after the invitee successfully joins from the shared discussion link.
- Leaving, rejoining, reopening an accepted invitation, repeated callbacks, duplicate invitation rows, or changing discussions creates no additional reward.
- Bot onboarding invitations and boosted recommendations do not reward any user.
- There is no earning-window cap for this reward. Different invitees can each reward once; the same invitee cannot reward the same inviter twice.

Stable reward identity:

```text
invite-pair:first-accepted:{inviterUserId}:{inviteeUserId}
```

### Outside Referral Reward

Shareable outside invitations must gain inviter attribution. The link must use an opaque invite/referral code; raw user IDs must never appear in public links.

An attributable invite record should resolve to:

- inviter user ID
- optional discussion ID/public code when the link targets a discussion
- public opaque token
- creation time and optional expiry
- first recipient/claim state when applicable
- source/platform metadata limited to safe values

Rules:

- `/start` never awards Stars.
- Opening or repeatedly opening a deep link never awards Stars.
- The first valid outside referrer for a genuinely new account is remembered and cannot be overwritten by later links.
- “Genuinely new” means the user record was inserted as part of that attributable start event. An account that already existed before the event is not a new-user referral, even if it had no onboarding activity, chat history was cleared, or `/start` is repeated.
- Self-referrals are rejected.
- The referral becomes qualified only after the new user completes the configured milestone, recommended as onboarding's first three interests. Skipping onboarding does not qualify until the equivalent product milestone is completed elsewhere.
- Invite-first users may be offered an optional quick taste setup after the invite path. It writes to the same Interests TopTen and qualifies referrals only through the same configured product milestone; dismissing the nudge does not qualify or skip onboarding.
- Each invitee can produce at most one new-user referral reward for one inviter.
- Repeated discussion share links may keep opening the discussion preview or re-focus the room, but financial idempotency must come from the ledger/claim uniqueness rules, not from transient command handling.
- If an outside discussion link belongs to an existing user, it may still open the discussion preview but does not create a new-user referral reward.

Stable reward identity:

```text
referral:new-user-qualified:{inviteeUserId}
```

## Showing Earnings And Next Steps

Every successful reward must be explained clearly. Never change the balance silently.

Preferred combined success pattern:

```text
✅ Your first 3 Music choices are saved.

⭐ You earned 3 Stars.
Your balance: 8 Stars.

💡 Add 7 more Music choices to complete this Top 10 and earn 7 more Stars.
```

Persian copy must communicate the same information naturally rather than translating word order mechanically.

Rules:

- Mention what was completed, how many Stars were earned, and the resulting balance.
- Prefer editing or extending the existing success/result card over sending a separate message.
- If the user already received the reward, do not repeat earning copy.
- A duplicate action may show the normal existing duplicate feedback but must not imply another reward.
- Show at most one next-earning suggestion at a time.
- The next suggestion must be actionable from the current context and must not point to a milestone already claimed.
- Do not nag on every profile/list open. Show progress after relevant mutations, at onboarding completion, in the private own-profile view, and in the Stars explanation surface opened from the guide.
- Do not promise an amount that is no longer current. Render amounts from the active economy settings.

Contextual next-step examples:

- After onboarding/profile Interests: show actual earned Stars when a milestone is awarded, but do not show misleading full Top 10 progress for profile Interests.
- After a Top 10 item is added: show progress only when approaching or reaching the relevant first-3 TopTen or full-TopTen milestone.
- List reward and progress wording should use the user-facing list name for Top 10 milestones and must not imply that adding to a watchlist, playlist, or reading list awards Stars.
- On an incomplete own profile: show the smallest privacy-safe set of choices that can complete the profile reward.
- After the first discussion reward: explain boosting only as an optional use, not as the required next action.
- After sending a stored invitation, show only the bot-authored sent confirmation without a Star explanation or acknowledgement button. If the invitee joins and the directed-pair reward is actually awarded, show the existing reward notice then.
- After a non-rewarding repeat invitation is accepted: do not mention Stars.

## Own Profile And Privacy

The user's own profile shows a compact private balance line:

```text
⭐ Stars: 18
```

Persian uses localized label and number formatting consistent with the rest of the profile.

- Add the line only when rendering with an explicit `isOwnProfile` context.
- Public profile rendering, member-list profile views, people discovery, saved-profile views, invitation profiles, and shareable profile text must omit balance and Star history.
- Do not infer ownership from a user ID embedded in callback data alone; use the authenticated current user and rendering context.
- Admin analytics may show aggregate economy metrics, but ordinary users never see another user's balance.
- The profile surface may show the user's private balance line, but the `Stars` action belongs in the Muze guide/help section so profile editing stays focused. The Stars action explains current balance, earning milestones, claimed milestones, and available uses without becoming a noisy store homepage.
- The own-profile surface may also show one private growth hint. It should be compact, privacy-safe, and limited to one actionable next step; public profile render paths must omit it.

## Spending Stars

All spending uses a confirmation step that shows:

- what will happen
- current configured cost
- duration or scope
- current balance
- any important eligibility or notification limitation
- confirm and cancel actions

Check eligibility before charging whenever possible. On confirmation, revalidate eligibility and cost, then atomically charge and create the effect. If effect creation fails after charging, issue an idempotent automatic refund.

Changing an admin price while a confirmation card is open makes the old card stale. On tap, show the updated price and require a new confirmation; never silently charge a different amount.

### Profile Emoji

Profile emoji is an optional cosmetic shown beside the user's display name on profile and social list surfaces. It is stored as a separate curated field, not mixed into `profileName`, and must not reuse Muze/system emojis such as the current configurable bot marker, Stars, saved profiles, or discussion host icons.

Recommended launch default:

- cost: 3 Stars
- paged curated inline picker; exact typed emoji is allowed only when it is in the same allowed set
- confirmation shows selected emoji, cost, and balance
- spend reason: `profile_emoji`

### Discussion Boost

Recommended launch default:

- cost: 10 Stars
- duration: 24 hours
- one active boost per discussion
- one owner-wide active boosted discussion at a time
- cooldown after expiry: 24 hours
- recommendation delivery cap: 10 eligible users per boost
- recipient cap: at most one boosted-discussion recommendation per 24 hours

The active room may show a clean owner/member action:

```text
🚀 Boost discussion
```

The cost appears on the confirmation card, not necessarily in the room keyboard label.
Boost confirmations remember their source. From an active room, canceling or dismissing a recoverable error should remove only the confirmation/error card and keep the user in the room flow. From `My discussions`, opening the boost should remove the old list first; cancel, successful confirmation, or dismissing a recoverable error should then return to a fresh `My discussions` list.
If boost confirmation fails for insufficient balance or another recoverable reason, show current cost and balance on a dismissible `Got it` card. Do not add extra text explaining what the `Got it` button does.

A successful boost may:

- pin the discussion near the top of a clearly labeled boosted/relevant section or position
- rank it above comparable organic results for the configured duration
- send a limited Muze-authored recommendation to relevant eligible users

A boost must not:

- bypass discussion join rules, capacity, removal/mute rules, blocks, bans, or one-active-room behavior
- guarantee members, replies, or a fixed position
- make an unsafe, closed, stale, or moderated room visible
- occupy every top result from the same owner
- look like a personal invitation
- reward the booster through invitation/referral earning rules

Only the discussion creator may purchase a boost at launch. This avoids ownership disputes and users spending Stars on a room they cannot manage. The boost may continue if the creator leaves their own open room, but ends/refunds according to policy if the room closes or becomes ineligible.

Recommendation targeting:

- recipient satisfies the discussion join rule at selection time
- recipient is not already a member
- recipient has not removed/muted the relevant source or opted out of boosted recommendations
- recipient is not banned and the room is not blocked by relationship rules
- taste relevance is required; payment alone does not create targeting
- do not repeatedly recommend the same discussion to the same recipient
- do not notify a user who is currently active in another room unless later product evidence supports that behavior
- select recipients without exposing their identities to the booster

Suggested recommendation framing:

```text
👩‍🦳 Based on your taste, this boosted discussion may interest you:

🚀 Best guitar riff ever?
🎵 Music · Metal
👥 6 people
```

Actions: preview discussion, not interested. Provide a discoverability setting to disable boosted recommendations. The notification must be labeled as a Muze recommendation and not `From: {booster}`.

Boost ordering should combine boost eligibility with organic relevance and freshness. A boost is an amplification signal inside the room's viewer-relevance tier, not an unconditional global pin, and cannot move a generic room above a direct item, taste-label, or Interest match. The discussion list must label boosted items and apply owner diversity so one buyer cannot dominate the page. Full rooms are ineligible before quoting and are rechecked before charging.

Many creators may have an active boost at the same time across Muze. For each viewer, show only join-eligible, taste-relevant boosts and reserve no more than the configured one or two boosted positions per result page. Rank or rotate competing boosts by relevance and freshness; do not show every active boost to every viewer.

Refund policy:

- If the boost cannot be created after charge, refund the full amount.
- If the discussion is already closed/ineligible before activation, do not charge.
- If Muze fails before any boost effect begins, refund fully.
- Normal lack of clicks or joins is not refundable.
- Owner-closing or violating rules after activation is not normally refundable.
- An administrative/system shutdown may receive a proportional or full refund according to a recorded reason; MVP may use full refund for simplicity.

### Paid Discussion Capacities

Normal discussion capacities remain free. Special capacities are optional Star spends controlled from the Star Economy dashboard:

- 2-person focused room, default 3 Stars
- large room, default 50 members for 10 Stars

The capacity picker labels paid capacities with `⭐` only when Star spending and that paid-capacity switch are enabled. Selecting a paid capacity does not charge immediately. The final create action opens a dedicated bottom-keyboard confirmation mode showing the current cost and balance. Its visible label is never trusted: the server-side mode binds the exact quoted capacity and cost, and stale or manually copied labels outside that mode are rejected. Cancel returns to the draft preview; insufficient balance offers Edit capacity and Back to preview. On confirmation, Muze revalidates the current cost and capacity, spends Stars idempotently, creates the room, and refunds automatically if room creation fails after charging.

Paid capacity never bypasses discussion join rules, active-room limits, owner-created room caps, report/removal rules, or moderation.

### Paid Extra Active Discussions

The normal active-owned discussion allowance remains free. When a creator is already at that limit, the create entry may offer one additional concurrently open owned room for the dashboard-configured price (default 5 Stars). This offer is controlled by the master economy/spending switches and its own paid-extra-discussions switch.

The offer appears before the create wizard as an inline confirmation while the Discussions bottom keyboard remains visible. Confirmation rechecks the current owned count and current price, then spends idempotently and persists a server-side authorization for exactly the next slot. Only after that succeeds does the title step begin. Insufficient balance edits the offer into a one-button `Got it` card. Cancellation or creation failure refunds the extra-slot spend exactly once. A paid capacity and a paid extra-owned slot are independent products and may both be charged when both are explicitly confirmed.

Paid overflow is bounded by the existing 10-room membership cap and never bypasses join rules, moderation, capacity, or active-room behavior.

### People Discovery

User-facing entry:

```text
👀 دیدن آدم‌ها
```

English:

```text
👀 See people
```

Rules:

- `👀 دیدن آدم‌ها` is a core free Muze feature and must not charge Stars.
- It shows people with at least 3 normalized shared items in one section, based on public/social taste data the viewer has already entered.
- If the viewer lacks enough taste data, explain that they need at least 3 choices in one media Top 10 or profile Interests and offer the lists entry.
- If the viewer has enough taste data but no eligible match exists, show a distinct no-match message.
- Shared-section counts may be shown, but hidden profile data, private discussion membership, and Star balances must never be exposed.
- Keep the language low-pressure. Do not call it dating, matching, friendship, private chat, or compatibility scoring.
- Pagination and profile-return behavior should return to the People list the profile was opened from. Legacy `people:taste` callbacks may route to the free list for old inline cards.

### Advanced Search Preview

Advanced Search is not available in the first Stars release. Muze may show a locked entry in the People hub, but the unavailable card should stay minimal and avoid roadmap/product explanations.

User-facing entry:

```text
🎛 Advanced Search
```

On tap, say only that Advanced Search is not available yet. Actions are optional notification signup and Back when enabled by settings.

Preview rules:

- Do not charge Stars.
- Do not show a price or pretend the filters work.
- Clearly state that the feature is unavailable.
- Record preview taps and a one-time notification preference.
- Do not promise a launch date or explain planned filters in user-facing copy.
- Keep the card low-noise and return cleanly to the People hub.

### Future Advanced Search Behavior

If the feature is approved after the safety/product review, it may become a time-limited Star entitlement that unlocks filter controls, not access to private data.

Potential controls:

- age range
- gender
- shared-interest section
- minimum shared item count
- public city, only if city remains a documented public profile field
- has a publicly visible active discussion

Rules:

- Filters use only fields users voluntarily supplied and that the normal public profile/discovery contract permits.
- Never infer age, gender, city, or identity attributes.
- Age uses ranges for filtering; do not expose exact ages merely because a filter was purchased.
- `Any` remains the default for age/gender-like controls.
- Profiles with an unset filtered field are excluded from that filtered query, not treated as a guessed value.
- Do not expose counts that could reveal sensitive small groups.
- Filters do not bypass the existing shared-taste threshold or any privacy, ban, mute, block, display-name, or active-discussion visibility rule.
- Muze remains taste-first and must not describe this as dating, friendship, private chat, or unrestricted people search.
- Define and test a minors/age-safety policy before enabling age filters. Until then, the feature can launch with non-age taste controls or remain feature-disabled.
- Before charging, perform a coarse safe availability check. Do not promise results. If there are clearly no eligible profiles for the selected filter, let the user adjust it without charging.
- During an active entitlement, filter changes do not cost additional Stars.

Before implementation, decide whether Muze is adults-only or supports a mixed-age discovery model. Age and gender filters must not ship merely because the preview receives taps. City filtering may be evaluated separately and could remain a free relevance/filter control rather than a paid feature.

### Future Star Uses

Possible later uses include optional taste reports or additional cosmetics. Each needs a separate product rule, cost, refund behavior, and admin setting before implementation. Do not treat this list as authorization to build them.

## Admin Dashboard And Economy Settings

The dashboard should add a dedicated **Star Economy** section. Do not hide Star prices among unrelated Bot Limits even if both use the existing `AppSetting` infrastructure.

Recommended settings groups:

### Rewards

- first-3-TopTen-per-section reward
- full-TopTen-per-section reward
- profile completion reward
- first discussion reward
- first discussion join reward
- stored invitation pair reward
- external new-user referral reward
- outside-referral qualification milestone/version

### Costs And Entitlements

- discussion boost cost
- boost duration
- boost cooldown
- max active boosts per discussion
- max active boosted discussions per owner
- max recommendation recipients per boost
- boosted recommendation recipient window/cap
- paid 2-person discussion enabled/cost
- paid large discussion enabled/capacity/cost
- paid extra AI suggestion cost
- profile emoji cost
- future Advanced Search cost
- future Advanced Search duration

### Milestone Thresholds And Rollout

- first TopTen milestone item count, default 3
- Top 10 completion count, constrained by the TopTen operational cap
- economy enabled/disabled switch
- earning enabled/disabled switch
- spending enabled/disabled switch
- boost recommendations enabled/disabled switch
- paid extra AI suggestions enabled/disabled switch
- Advanced Search preview enabled/disabled switch
- Advanced Search notification signup enabled/disabled switch
- future Advanced Search purchase/filter switch, disabled until separately approved

Recommended launch definitions:

| Setting key | Default | Min | Max | Unit/group |
| --- | ---: | ---: | ---: | --- |
| `rewardFirstThreePerSection` | 3 | 0 | 1,000 | Stars |
| `rewardFullTopTenPerSection` | 7 | 0 | 1,000 | Stars |
| `rewardProfileCompletion` | 5 | 0 | 1,000 | Stars |
| `rewardFirstDiscussion` | 3 | 0 | 1,000 | Stars |
| `rewardFirstDiscussionJoin` | 2 | 0 | 1,000 | Stars |
| `rewardSavedInvitePair` | 1 | 0 | 1,000 | Stars |
| `rewardExternalReferral` | 10 | 0 | 10,000 | Stars |
| `firstTopTenMilestoneItems` | 3 | 1 | current TopTen cap | items |
| `topTenCompletionItems` | 10 | first milestone | current TopTen cap | items |
| `discussionBoostCost` | 10 | 0 | 1,000,000 | Stars |
| `discussionBoostDurationHours` | 24 | 1 | 8,760 | hours |
| `discussionBoostCooldownHours` | 24 | 0 | 8,760 | hours |
| `discussionBoostsPerDiscussion` | 1 | 1 | 1 | concurrent boosts |
| `discussionBoostsPerOwner` | 1 | 1 | 1 | concurrent boosts |
| `discussionBoostedSlotsPerPage` | 1 | 1 | 2 | relevant boosted positions |
| `discussionBoostRecipientCap` | 10 | 0 | 100,000 | recipients/boost |
| `boostRecipientWindowHours` | 24 | 1 | 8,760 | hours |
| `boostRecommendationsPerRecipientWindow` | 1 | 0 | 1,000 | recommendations |
| `paidTwoPersonDiscussionsEnabled` | true | false | true | rollout switch |
| `paidTwoPersonDiscussionCost` | 3 | 0 | 1,000,000 | Stars |
| `paidLargeDiscussionsEnabled` | true | false | true | rollout switch |
| `paidLargeDiscussionCapacity` | 50 | 21 | 10,000 | members |
| `paidLargeDiscussionCost` | 10 | 0 | 1,000,000 | Stars |
| `profileEmojiCost` | 3 | 0 | 1,000,000 | Stars |
| `advancedSearchCost` | 5 | 0 | 1,000,000 | future Stars setting; inactive |
| `advancedSearchDurationHours` | 24 | 1 | 8,760 | future hours setting; inactive |

Boolean feature switches have explicit defaults: economy and earning enabled for controlled rollout; spending and boost delivery disabled until their implementation phase is validated. The Advanced Search preview may be enabled independently, while its actual filters and purchase switch remain disabled. A zero reward disables that milestone. A zero feature cost means free activation but must still create an auditable zero-cost entitlement/effect if the future feature is enabled.

All settings require:

- label, description, group, unit, default, minimum, and maximum
- server-side normalization and cross-setting validation
- persisted updated timestamp
- admin confirmation after saving
- an audit record containing actor/context where authentication makes it available, old values, new values, and timestamp
- cached bot reads so normal messages do not query settings
- a settings snapshot on each transaction/effect

Economy settings should use a separate AppSetting key such as `star-economy`, with a focused service rather than expanding `operational-limits.js` into unrelated financial behavior. The same dashboard form/rendering patterns may be reused.

Running bot processes load Star settings at startup. After saving Star Economy changes in the dashboard, restart the bot process to activate them; running bot processes should not periodically refresh these settings.

Admin settings changes affect only future qualification/spending confirmations. They do not rewrite historical rewards, charge existing entitlements again, or change active boost/entitlement duration unless an explicit migration is performed.

## Analytics And Operations

Add privacy-light events and aggregate dashboard metrics. Star ledger records are product/accounting data; analytics events remain best-effort and never authorize a balance change.

Suggested events:

- `stars_earned` with reason and amount
- `stars_spent` with reason and amount
- `stars_refunded` with reason and amount
- `star_earning_hint_shown` with milestone key
- `discussion_boost_viewed`
- `discussion_boost_confirmed`
- `discussion_boost_activated`
- `boost_recommendation_sent`
- `boost_recommendation_opened`
- `advanced_search_preview_viewed`
- `advanced_search_notify_requested`
- future `advanced_search_unlocked`
- `external_referral_claimed`
- `external_referral_qualified`
- `invite_pair_reward_qualified`
- future `star_purchase_started/completed/failed/refunded`

Dashboard metrics:

- total Stars earned, spent, refunded, granted, and outstanding
- unique earners and spenders
- rewards by milestone
- spend by feature
- boost activation/open/join funnel
- Advanced Search preview/notification-interest funnel and, later, unlock/use funnel
- referral claim-to-qualification funnel
- duplicate/idempotency rejections and failed-effect refunds
- suspicious invitation/referral concentration for review

Do not store list item text, discussion message text, sensitive filter values, raw payment credentials, or private profile values in analytics metadata.

Operational alerts should cover ledger/balance mismatches, repeated refund failures, negative-balance attempts, high duplicate rates, and boost delivery failures.

## Payment-Ready Design, Later Phase

Real-money purchase support is intentionally deferred, but the first implementation must not block it.

- Purchased Stars use the same visible balance and ledger with `bucket: purchased`.
- Payment provider callbacks require their own idempotency keys and verified signatures.
- Store provider transaction references, currency, amount, status, and timestamps; never store card credentials.
- Define which Star bucket spends first before payment launch and keep that ordering deterministic.
- Define refund/reversal behavior with the chosen platform and applicable law before collecting money.
- User-to-user transfers, cash-out, marketplace trading, and creator revenue sharing are out of scope.
- Do not market Stars as an investment or promise monetary value.

## Failure And Edge-Case Rules

- Database unavailable: do not claim a reward or spend succeeded. Preserve the original product action when safe and tell the user Star processing could not complete if needed.
- Reward service unavailable after a non-financial milestone succeeds: record/retry through a durable reconciliation path or show a safe pending state; do not make users repeat destructive actions.
- Duplicate callback/retry: return the already-created transaction/effect.
- Insufficient balance: do not partially charge; show current cost and balance. For discussion boosts, show this as a dismissible `Got it` card; room-origin boosts stay in the active room flow, and My-discussions-origin boosts return to a fresh My discussions list after acknowledgement.
- Stale confirmation: re-render with current settings and require confirmation.
- User banned: earning and spending are disabled. Existing balance remains ledgered; do not delete it.
- Discussion closes during boost confirmation: do not charge.
- Discussion closes after activation: end the boost; apply the documented refund rule once.
- Admin disables economy: existing balances and history remain intact; new earnings/spends stop according to the separate switches.
- Lowering a reward/cost is not retroactive.
- Deleting or editing milestone data after reward does not remove Stars unless fraud/admin reversal is explicitly recorded.

## Service And Module Boundaries

Recommended focused modules:

- `src/models/star-transaction.js`: immutable Star ledger and unique idempotency index
- optional `src/models/star-referral.js`: opaque external referral/invite attribution and first-claim state
- optional `src/models/discussion-boost.js`: boost lifecycle, targeting/delivery state, and refund linkage
- `src/services/stars.js`: atomic earn/spend/refund/grant operations and balance reads
- `src/services/star-settings.js`: cached Mongo-backed economy settings and validation
- `src/services/star-milestones.js`: pure qualification and next-milestone helpers; watchlists, playlists, and reading lists do not qualify for Stars
- `src/services/star-referrals.js`: outside attribution and qualification
- `src/services/discussion-boosts.js`: boost eligibility/lifecycle/data mutations
- `src/services/discussion-boost-notifications.js`: low-noise, best-effort targeted delivery
- `src/services/advanced-discovery.js`: entitlement and filter validation, separate from base ranking
- `src/services/stars-ui.js`: shared balance, earning, confirmation, and insufficient-balance copy shaping
- focused `src/flows/stars-callbacks.js` if Star actions become more than small hooks

Existing module responsibilities remain:

- `src/services/users.js` remains the centralized list mutation access point; it calls a milestone hook only after a real mutation succeeds.
- `src/services/profile.js` owns own/public profile rendering and must enforce owner-only balance visibility.
- `src/flows/onboarding.js` uses the normal Interests milestone result; it does not create a separate reward path.
- `src/services/discussion-invitations.js` owns invitation acceptance and calls Star qualification after successful acceptance/join orchestration.
- `src/services/invite-links.js` builds opaque attributable links but does not award Stars.
- `src/services/discussions.js` remains the source of truth for room mutations and eligibility.
- `src/services/people-discovery.js` remains the base discovery filter/ranker; the preview does not change ranking, and any future Advanced Search filters must compose with it rather than duplicate it.
- `src/services/ai-paid-suggestions.js` owns paid extra suggestion quote/spend/refund state. AI text/callback flows may request it only after the normal free suggestion quota is exhausted and the user confirms.
- `src/bot.js` and `src/callbacks.js` remain dispatchers.
- `src/messages.js` and keyboard helpers own localized copy/actions.
- `src/services/analytics-dashboard.js` and `scripts/analytics-dashboard.js` expose aggregate metrics and editable settings, not arbitrary balance mutation.

## Affected Surface Map

This map describes the implemented module boundaries and is not permission to place large feature bodies in existing routers.

| Surface | Existing files likely affected | Required change |
| --- | --- | --- |
| Runtime/user context | `src/index.js`, `src/services/app-context.js`, `src/models/user.js` | Load safe balance/context; add only necessary cached/private fields and startup settings refresh |
| Stars foundation | new focused models/services listed above | Ledger, settings, milestones, referrals, effects, idempotency, reconciliation |
| Onboarding | `src/flows/onboarding.js`, `src/messages.js`, `src/keyboards.js` | Normal Interests milestone, earned/balance/next-step copy, pending referral preservation, no `/start` reward |
| Lists and Top 10 | `src/services/users.js`, `src/flows/ai-text.js`, `src/flows/ai-callbacks.js`, `src/services/ai-list-ui.js` | Qualify after successful mutations; render progress/reward once without duplicating list logic |
| Paid extra suggestions | `src/models/ai-paid-suggestion.js`, `src/services/ai-paid-suggestions.js`, AI text/callback flows, keyboards/messages | Confirmed one-off Star spend after free quota exhaustion; one combined Cancel-and-return-to-Favorites action; no requirement bypass; refund on generation failure |
| Profile | `src/services/profile.js`, `src/flows/profile-text.js`, `src/flows/profile-callbacks.js`, `src/messages.js`, `src/keyboards.js` | Central profile milestone, self-only balance/progress, privacy-safe hints |
| Saved-profile visuals | `src/messages.js`, `src/services/saved-profiles-ui.js`, `src/services/people-discovery-ui.js`, invitation pickers/keyboards | Replace only saved-profile `⭐` icons with `🔖`; preserve wording and behavior |
| Discussion host visuals | `src/services/discussion-room-ui.js`, related messages/examples | Replace only host `⭐` with `🎙️`; preserve host semantics |
| Discussion milestones | `src/services/discussions.js`, `src/services/discussion-actions.js`, discussion create/join flows | Reward first successful create/join after authoritative mutations |
| Stored invitations | `src/models/discussion-invitation.js`, `src/services/discussion-invitations.js`, `src/flows/discussion-invitations.js`, invitation UI | Directed-pair qualification after successful accept/join, idempotency |
| Outside invitations | `src/services/invite-links.js`, `src/flows/discussions-text.js`, `src/flows/discussions-callbacks.js`, `src/bot.js` | Opaque inviter-attributed payloads, legacy link compatibility, repeated-link compatibility |
| Boost purchase/effect | discussion room/list flows and UI plus new boost services/model | Owner action, confirmation, charge/refund, labeled ranking, targeting, delivery/opt-out |
| People discovery | `src/services/people-discovery.js`, `src/services/people-discovery-ui.js`, `src/flows/saved-profiles.js`, keyboards/messages | Free shared-taste People discovery; coming-soon Advanced Search preview/notify preference; future filters deferred |
| Admin settings | `src/models/app-setting.js`, new Star settings service, `src/services/analytics-dashboard.js`, `scripts/analytics-dashboard.js`, `docs/analytics-dashboard.md` | Editable values, validation, cache state, audit, aggregate metrics |
| Analytics | `src/services/analytics-events.js`, `src/services/analytics-dashboard.js` | Privacy-light Star/referral/boost/entitlement events and funnels; never authorize balances from analytics |
| Translations | `src/messages.js`, `src/keyboards.js` | Persian/English earning, progress, confirmation, refund, privacy, and guide/rules copy using live values |
| Tests | unit/integration tests for every service/flow above | Duplicate/concurrency, privacy, backfill, settings, refund, link compatibility, and feature behavior |
| Documentation | this file plus architecture, UX, lists, discussions, invitations, dashboard, roadmap, agent map | Keep planned/implemented status and final values aligned during each phase |

Expected migrations/backfills:

- create ledger/referral/boost indexes before enabling feature switches
- initialize cached balances to zero without overwriting any future nonzero value
- backfill or lazily recognize already-completed milestones according to the selected rollout policy
- migrate no private balance into public/profile snapshots
- preserve old public invite links while new attributable tokens roll out
- change icons through localized copy/UI only; do not mutate saved-profile or discussion ownership data

## Implementation Tasks And Status

Implement in phases so balance integrity is proven before users can spend or buy Stars.

### Task 1: Economy Foundation

Status: implemented.

- Add economy settings definitions, persistence, cache, validation, and dashboard form.
- Add Star transaction schema with unique idempotency keys and indexes.
- Add atomic earn, spend, refund, grant, and balance-read services.
- Add user cached balance only if needed, with reconciliation tests.
- Add economy kill switches.
- Add unit/integration tests for concurrency, duplicate retries, insufficient balance, refunds, and settings snapshots.

Acceptance criteria:

- The same event cannot reward or charge twice, including concurrent calls.
- Failed spending cannot create a negative balance.
- Admin changes appear in new confirmations/rewards but not historical transactions.
- A ledger-to-balance reconciliation check passes.

### Task 2: Private Profile And Stars Explanation

Status: implemented.

- Show balance only on the authenticated user's own profile.
- Add a compact Stars explanation/progress surface.
- Change saved-profile emoji from `⭐` to `🔖` and discussion-host emoji from `⭐` to `🎙️` everywhere without changing their wording or behavior.
- Update Muze guide and rules with earning/spending/privacy language.
- Add bilingual copy and translation validation.

Acceptance criteria:

- No public/profile-sharing path renders balance.
- Saved profiles no longer visually conflict with Stars.
- Economy copy uses current admin values.

### Task 3: Milestone Rewards And Contextual Guidance

Status: implemented, including bounded lazy claiming for existing Top 10/profile progress.

- Implement centralized qualification for first-3 TopTen, full Top 10, profile completion, first discussion creation, and first discussion join milestones.
- Decide and implement existing-user backfill/on-next-open policy.
- Attach rewards only after successful underlying mutations.
- Add combined success copy with amount, balance, and at most one eligible next step. Watchlist, playlist, and reading-list additions should show only the normal save copy.
- Ensure onboarding uses the Interests first-3 milestone and does not double-award.
- Add tests for removals/re-adds, preexisting users, concurrent list additions, repeated create callbacks, and profile privacy choices.

Acceptance criteria:

- Every configured milestone awards once at most.
- Users receive clear earning confirmation.
- Hints never advertise a claimed milestone or require exact location/sensitive fields.

### Task 4: Stored Invitation Pair Reward

Status: implemented.

- Add lifetime directed-pair reward uniqueness.
- Award only after a stored invitation is accepted and join succeeds.
- Exclude bot starter invitations, boost recommendations, duplicate/rejoin paths, and failed joins.
- Explain reward eligibility at send time without promising it.
- Test A-to-B versus B-to-A, different discussions, rejoin, duplicate callbacks, public share links, and concurrent accepts.

Acceptance criteria:

- A can earn from B only once across all discussions.
- B can independently earn once from A.
- Normal invitation reuse remains unchanged after reward eligibility is exhausted.

### Task 5: Attributable Outside Invitations

Status: implemented; legacy discussion join payloads remain supported.

- Add opaque external invitation/referral records that contain inviter attribution without exposing raw IDs.
- Update shareable discussion and general referral links to use attributable payloads while preserving old `/join_CODE` links.
- Preserve pending attribution through language selection and invite-first onboarding.
- Lock first valid new-user referrer.
- Qualify after the configured onboarding/product milestone, never on `/start`.
- Add expiry/invalid/self/existing-user/repeated-start/concurrency tests.

Acceptance criteria:

- Repeated `/start` cannot create multiple rewards.
- Existing links continue to preview/join discussions.
- Each genuinely new invitee can reward at most one inviter.

### Task 6: Discussion Boost

Status: implemented behind separate spending, boost, and recommendation switches.

- Add boost settings and lifecycle model/service.
- Add owner-only room action and price confirmation.
- Revalidate and atomically charge/create the boost.
- Add labeled relevance-aware boosted ordering with owner diversity.
- Add capped, preference-aware recommendation selection/delivery.
- Add opt-out/not-interested behavior and delivery deduplication.
- Add automatic refund paths and operational metrics.
- Test close/ban/report/capacity/rule/cooldown/stale-price/concurrent-boost cases.

Acceptance criteria:

- Payment never bypasses discussion safety or relevance.
- A user cannot be charged twice or receive repeated recommendations.
- A failed activation produces exactly one refund.

### Task 7: Advanced Search Preview

Status: implemented as an uncharged preview only.

- Add the People-hub `Advanced Search` entry behind its own feature switch.
- Render minimal unavailable copy without showing a price or describing planned filters.
- Keep the unavailable preview close-only and rely on the persistent People keyboard for navigation.
- Track preview taps without collecting sensitive filter selections.
- Keep actual filters, entitlement purchase, and Star charging unimplemented.

Acceptance criteria:

- Basic discovery remains free and unchanged.
- The preview cannot charge Stars or return fake results.
- Notification signup is stored once and can survive repeated taps.
- The future filter implementation remains blocked on a documented age/minor/privacy decision.

### Task 8: Analytics, Reconciliation, And Rollout

Status: implemented; operational rollout and tuning remain operator activities.

- Add aggregate economy metrics/events and operational alerts.
- Add reconciliation tooling/reporting without exposing arbitrary mutation endpoints.
- Roll out behind earning/spending/feature flags.
- Observe reward distribution, invite abuse, boost relevance, notification opt-outs, refunds, and spend concentration.
- Tune settings through the admin panel before considering real payments.

Acceptance criteria:

- Economy can be disabled without losing balances/history.
- Operators can explain every balance from ledger entries.
- Launch monitoring detects abuse and financial integrity failures.

### Task 9: Real-Money Stars, Deferred

Status: intentionally deferred.

- Select a payment route only after the earn/spend economy has demonstrated value.
- Review platform rules, refunds, consumer disclosures, tax/accounting, minors, and local legal requirements at implementation time.
- Add verified provider callbacks, purchase ledger entries, receipts/status UX, and support reconciliation.
- Keep purchase rollout behind a separate feature flag.

This task is explicitly deferred and must not be bundled into the first Stars release.

## Required Validation

- Run translation validation after copy/key changes.
- Run unit tests for every service and flow change.
- Run integration tests for ledger, invitation, discussion, boost, and settings database mutations.
- Add concurrency tests for duplicate milestone qualification, invitation acceptance, referral qualification, spending, and refunds.
- Add privacy tests proving Stars never appear in other-user profile renderings.
- Add migration/backfill dry-run counts before changing existing accounts.
- Manually smoke-test Persian and English onboarding, profile, lists, invitation deep links, discussion boost, discovery purchase, insufficient balance, stale confirmation, refund, and admin setting changes.

## Decisions Confirmed

- The currency is called Stars and uses `⭐`.
- Saved-profile wording stays the same and only its emoji changes to `🔖`.
- Discussion-host wording stays the same and only its emoji changes to `🎙️`.
- Star balance is visible on the user's own profile only.
- Stars are earned from meaningful milestones and invitations.
- Stored saved-profile invitation rewards are once per directed user pair across all discussions.
- Outside invitations must carry opaque inviter attribution.
- `/start` never awards Stars; qualification happens later and is idempotent.
- Discussion boosting is the first implemented Star spending feature and remains rollout-controlled.
- Advanced Search appears only as an uncharged coming-soon preview in the first release; its filters and Star purchase are deferred.
- Multiple discussions may be boosted across Muze, but each creator and each discussion may have only one active boost.
- Star prices, rewards, durations, limits, and feature switches are editable from the admin dashboard.
- Real-money Star purchases are a later phase.

## Remaining Launch Decisions

- Review the recommended reward/cost defaults in the admin dashboard before enabling spending.
- Decide whether boost recommendations launch with boosted list placement or in a later sub-phase; they have separate switches.
- Complete the age/minor/privacy review before implementing Advanced Search filters or entitlement purchase.
- Complete payment-provider, legal, refund, accounting, and deterministic bucket-spending review before beginning Task 9.

## Invitation UX Separation

The Guide's bilingual Invite action creates an opaque, expiring general referral with no discussion destination. Its user-facing share copy describes favorites, people with similar tastes, and live discussions; it never exposes the internal `TopTen` name or retired “Top 10” wording. A genuinely new user completes normal onboarding and reaches the main menu. The first valid referrer is locked and is rewarded only when the startup-loaded `firstTopTenMilestoneItems` threshold is reached; amount and lifetime use `rewardExternalReferral` and `externalReferralLinkExpiryDays`.

An attributable shared-discussion link preserves its discussion code through onboarding and restarts, then automatically renders the original preview after onboarding without joining. Muze preserves an available joinable or join-condition-locked destination as a `shared_link` inbox entry, which is explicitly excluded from directed-pair rewards and bypasses no join rule. The shared link may qualify only for the external new-user reward. Directed-pair rewards are accepted only for successfully joined stored `saved_profile` invitations, so shared links cannot trigger both identities. All awards remain ledger-backed and idempotent.
