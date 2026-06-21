# Product Roadmap

This document captures the future product plan. It is not the current
implementation contract. Use it to decide what to build next without drifting
into random feature work.

## Product Direction

DialogBot should become a taste-based social bot:

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

## Phase 1: Telegram Staging

Goal: prove the current bot works on Telegram without changing the product.

- [ ] Use a clean Telegram database. Do not share the Bale database with Telegram,
because users and discussion members are currently keyed by numeric user ids
without a platform namespace.

Recommended Telegram staging environment:

```dotenv
BOT_TOKEN=telegram_botfather_token
MONGO_URI=your_mongo_uri
MONGO_DB_NAME=dialogbot_telegram
API_ROOT=
BOT_DEEP_LINK_BASE_URL=https://t.me/YourTelegramBot
```

Smoke-test checklist:

- [ ] `/start`
- [ ] language selection and onboarding
- [ ] adding Top 10 items
- [ ] taste label unlock
- [ ] AI suggestions
- [ ] profile display
- [ ] saved profiles
- [ ] creating, joining, leaving, and closing discussions
- [ ] discussion message relay
- [ ] discussion invites and deep links
- [ ] reports and automatic bans
- [ ] avoid feature expansion in this phase

## Phase 2: Analytics

Goal: know whether users actually move through the product.

- [x] Add a simple read-only dashboard over the existing MongoDB product state.
- [x] Add lightweight product event tracking for the first launch funnel.
- [ ] Start with a simple Mongo collection. Avoid external analytics until the event
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
- [ ] `premium_clicked`
- [ ] `premium_notify_requested`

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

## Phase 5: Premium Fake Door

Goal: test payment interest before building payment.

- [ ] Add a `✨ Premium` entry and track taps. Do not collect money yet.

Suggested copy:

```text
✨ Premium is coming soon

Possible benefits:
• more daily suggestions
• better people/discussion matching
• advanced filters
• private or curated rooms
```

Actions:

- [ ] `Notify me`
- [ ] `Back`

Track:

- [ ] `premium_clicked`
- [ ] `premium_notify_requested`

This validates demand without committing to payment infrastructure.

## Phase 6: Pick Monetization

Choose monetization based on beta data.

If users love suggestions:

- [ ] free: limited daily suggestions
- [ ] premium: more suggestions and deeper taste insights

If users love discussions:

- [ ] free: normal discussion discovery
- [ ] premium: advanced filters and private/curated rooms

If users love profiles and saved users:

- [ ] free: save profiles
- [ ] premium: better matching and search

Current best bet:

- premium discovery
- higher AI limits
- later, private or curated rooms

Avoid pay-to-boost too early. Boosting discussions can hurt trust if relevance
is not already strong.

## Phase 7: Real Payment

Only add real payment after fake-door interest is visible.

Possible payment paths:

- [ ] Telegram Stars for Telegram-native digital features, if suitable
- [ ] a web payment page for card/local payments
- [ ] manual activation for the first small set of paid users

For a first paid test, manual activation is acceptable. Automation can come
after the offer is proven.

## Phase 8: Public Launch

Launch publicly only after:

- [ ] Telegram staging is stable
- [ ] analytics are implemented
- [ ] private beta has real usage
- [ ] the premium offer has measurable interest
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

1. [ ] Add analytics/event tracking.
2. [ ] Add Telegram deployment notes and staging checklist.
3. [ ] Add optional city field and city-aware discussion discovery.
4. [ ] Add Premium fake-door.
5. [ ] Run private beta and fix friction.
6. [ ] Decide payment path only after premium interest is measured.
