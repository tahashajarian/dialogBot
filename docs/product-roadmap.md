# Product Roadmap

This document captures the future product plan. It is not the current
implementation contract. Use it to decide what to build next without drifting
into random feature work.

## Product Direction

Muze should become a taste-based social bot:

> Build your taste profile, find people and discussions around what you
> actually like.

The strongest product surface is not just AI recommendations. It is the
combination of:

- personal taste lists and Top 10s
- taste labels on profiles
- discussion rooms with taste-based join rules
- saved profiles and invitations
- lightweight discovery around shared taste

## Launch Strategy

Start with one market and one strong language before international expansion.
The current Persian experience is more polished than a fully international
product, so launch Persian-first unless there is a clear reason to do
otherwise.

Do not add payment or multi-language expansion before proving real usage.

## Phase 1: Telegram Launch Prep

Goal: prove the current bot works on Telegram without changing the product.

- [ ] Use a clean Telegram database for launch. If migrating from any older
non-Telegram environment, do not share that database with Telegram because users
and discussion members are currently keyed by numeric user ids without a
platform namespace.
- [ ] Complete and publish `docs/privacy-policy.md`, including operator contact,
provider list, retention periods, and minimum-age position.
- [ ] Assign the owners and approve the appeal/unban procedure in
`docs/moderation-runbook.md`.

Recommended Telegram launch environment:

```dotenv
BOT_TOKEN=telegram_botfather_token
MONGO_URI=your_mongo_uri
MONGO_DB_NAME=muze_telegram
API_ROOT=
TELEGRAM_PROXY_URL=
BOT_DEEP_LINK_BASE_URL=https://t.me/YourTelegramBot
```

Recommended BotFather profile copy for the current product:

```text
Name: Muze
Username: hey_muze_bot

About (fa):
میوز؛ برای ساخت لیست، پیشنهادهای شخصی، پیدا کردن آدم‌ها و گفت‌وگوهای نزدیک به سلیقه‌ات.

About (en):
Build taste lists, get suggestions, and find people and discussions around what you like.

Description (fa):
با میوز برای فیلم، سریال، موسیقی و کتاب لیست و تاپ ۱۰ بساز، علاقه‌مندی‌هایت را روی پروفایل ثبت کن، پیشنهاد بگیر، آدم‌هایی با انتخاب‌های مشترک پیدا کن و وارد گفت‌وگوهای مرتبط شو.

Description (en):
Build movie, music, and book lists and Top 10s, add interests to your profile, get suggestions, browse people, optionally unlock people with shared choices, and join relevant discussions.
```

Keep BotFather profile copy aligned with the in-bot About/guide when the product surface changes.

Smoke-test checklist:

Use [Production Smoke-Test Checklist](production-smoke-test-checklist.md) for the full repeatable pass. The short launch gate is:

- [x] `/start`
- [x] language selection and onboarding
- [x] adding Top 10 items
- [x] taste label unlock
- [x] AI suggestions
- [x] profile display
- [x] saved profiles
- [x] people discovery and discovery-list/profile Back navigation
- [x] creating, joining, leaving, and closing discussions
- [x] discussion message relay
- [x] discussion invites and deep links
- [x] reports and automatic bans
- [x] avoid feature expansion in this phase

## Phase 2: Analytics

Goal: know whether users actually move through the product.

- [x] Add a simple read-only dashboard over the existing MongoDB product state.
- [x] Add lightweight product event tracking for the first launch funnel.
- [x] Start with a simple Mongo collection. Avoid external analytics until the event
shape is stable.

Track at least:

- [ ] `user_started`
- [ ] `onboarding_started`
- [ ] `onboarding_completed`
- [ ] `topten_item_added`
- [ ] `taste_label_unlocked`
- [ ] `suggestion_requested`
- [ ] `suggestion_saved`
- [ ] `discussion_joined`
- [ ] `discussion_created`
- [ ] `invite_sent`
- [ ] `profile_saved`
- [ ] `stars_earned`
- [ ] `stars_spent`
- [ ] `stars_refunded`
- [ ] `external_referral_qualified`
- [ ] `discussion_boost_activated`
- [ ] `advanced_search_preview_viewed`
- [ ] `advanced_search_notify_requested`

Useful derived metrics:

- [ ] onboarding completion rate
- [ ] users who add at least 3 Top 10 items
- [ ] users who unlock at least one taste label
- [ ] users who join at least one discussion
- [ ] users who create at least one discussion
- [ ] D1 and D7 return rate

Analytics should stay privacy-light. Do not store message text unless it is
already part of the product data.

## Phase 3: Private Beta

Goal: test with real people before building monetization.

- [ ] Invite 20 to 50 users manually. Prefer people who are likely to use lists,
recommendations, or social discussions.

Watch for:

- [ ] do users finish onboarding?
- [ ] do users add enough Top 10 items?
- [ ] do users understand taste labels?
- [ ] do users join discussions?
- [ ] do users invite others?
- [ ] do users return the next day?

Suggested early signals:

- 60%+ complete onboarding
- 30%+ add at least 3 Top 10 items
- 10-20% join a discussion
- some users return on day 1

- [ ] Fix friction and confusing copy first. Avoid big new features during beta.

## Phase 4: Discovery Upgrade

Goal: help users find relevant people and discussions.

Current baseline: `👀 دیدن آدم‌ها` is a free shared-taste discovery mode. It should improve relevance without implying dating, friendship, private chat, compatibility scoring, online status, or unrestricted people search.

- [ ] Add city/area only as an optional profile field. Do not require exact GPS.

Discussion creator options can later include:

- [ ] anywhere
- [ ] same city
- [ ] same city plus taste label
- [ ] same city plus Top 10 item

- [ ] The active discussion list can then sort or filter by city when the user has
set one.

Keep privacy clear:

- [ ] city is optional
- [ ] exact location is not required for discovery
- [ ] discussion cards should say when a room is city-limited

## Phase 5: Earn-Only Stars Foundation

Goal: prove that a private participation economy improves the existing product before accepting money.

- [x] Implement the idempotent Star ledger, balance reconciliation, economy settings, and kill switches from [Stars Economy](stars.md).
- [x] Show balance only on the user's own profile.
- [x] Change only the saved-profile icon from `⭐` to `🔖` and discussion-host icon from `⭐` to `🎙️`; keep their wording and behavior.
- [x] Reward first-3/full-Top-10 milestones, privacy-safe profile completion, first discussion creation/join, first successful directed saved-profile invitation pair, and qualified outside referrals.
- [x] Add clear combined earning confirmations and one eligible next-step hint.
- [x] Keep list reward/progress copy user-facing and never imply watchlist/playlist/reading-list additions award Stars.
- [x] Add one private own-profile growth hint for weak taste/profile data.
- [x] Update onboarding so its profile Interest choices use the normal Interests milestone without double rewards.
- [x] Add opaque inviter attribution to outside links without breaking old discussion invite links.
- [ ] Observe distribution, farming attempts, completion lift, and whether users understand Stars.

## Phase 6: Star Spending Validation

Goal: test optional uses while core Muze stays complete and free.

- [x] Add owner-only discussion boosts with clear labels, one active boost per creator/discussion, limited relevant slots, cooldowns, notification caps, opt-out, idempotent charging, and refunds.
- [x] Add an honest `Advanced Search` coming-soon preview with a close-only card; show no price and charge no Stars.
- [x] Track Advanced Search interest while keeping its city/age/gender filters unimplemented.
- [x] Keep prices out of primary navigation and show current cost/scope at confirmation.
- [x] Track earning-to-spending conversion, boost relevance, recommendation opt-outs, refunds, and Advanced Search preview interest.
- [ ] Tune rewards, costs, durations, and caps through the admin dashboard.

Do not expand to many Star uses until these first two produce real value. Paid amplification must never replace organic relevance or dominate discussion discovery.

## Phase 7: Real-Money Stars

Only add real payment after the earn/spend economy demonstrates healthy use and balance integrity.

- [ ] Select a supported payment route for the launch platform and market.
- [ ] Review platform rules, refunds, consumer disclosure, accounting/tax, minors, and local legal requirements at implementation time.
- [ ] Keep earned, purchased, and promotional Stars distinguishable in the ledger while showing one user balance.
- [ ] Add verified, idempotent payment callbacks and support reconciliation.
- [ ] Define deterministic spending-bucket order and refund behavior.
- [ ] Roll purchases out behind a separate feature flag.

User-to-user transfers, cash-out, creator revenue sharing, and Star trading remain out of scope.

## Phase 8: Public Launch

Launch publicly only after:

- [ ] Telegram launch prep is stable
- [ ] analytics are implemented
- [ ] private beta has real usage
- [ ] the earn/spend Stars economy has healthy usage and abuse controls
- [ ] moderation/reporting works under real usage

Launch message should stay simple:

> Build your taste profile, find people and discussions around what you
> actually like.

## Later: International Expansion

Do not start international-first.

International support multiplies:

- payment complexity
- moderation complexity
- support burden
- copy quality requirements
- cultural matching differences

When the Persian product proves retention, add language support intentionally:

- [ ] move user-facing copy through translation validation
- [ ] decide whether discussions are language-specific
- [ ] add language-aware discovery filters
- [ ] test onboarding separately per language

## Near-Term Code Priorities

Recommended order:

1. [x] Add analytics/event tracking.
2. [x] Add Telegram deployment notes and launch checklist.
3. [ ] Add optional city field and city-aware discussion discovery.
4. [ ] Implement the earn-only Stars foundation and invitation attribution.
5. [ ] Run private beta, tune rewards, and fix friction.
6. [ ] Validate discussion boosts with earned Stars and Advanced Search through its uncharged preview.
7. [ ] Decide payment path only after Star earning/spending proves useful and safe.
