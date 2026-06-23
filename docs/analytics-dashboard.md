# Analytics Dashboard

This is a small admin dashboard for checking useful product data and changing
bot-wide product limits. Limit values are stored in MongoDB and cached briefly
by the bot process, so normal updates do not add database reads per message.

## Run Locally

```powershell
npm.cmd run dashboard
```

Then open:

```text
http://127.0.0.1:8787
```

The dashboard also exposes a JSON snapshot:

```text
http://127.0.0.1:8787/api/snapshot
```

## Environment

```dotenv
ADMIN_DASHBOARD_HOST=127.0.0.1
ADMIN_DASHBOARD_PORT=8787
ADMIN_DASHBOARD_TOKEN=
```

Without `ADMIN_DASHBOARD_TOKEN`, the dashboard can only bind to localhost. If
you want to bind it to a public or private network interface, set a strong
token first.

Token access works with any of these:

```text
Authorization: Bearer your_token
x-dashboard-token: your_token
http://127.0.0.1:8787/?token=your_token
```

## Current Metrics

- dashboard server uptime
- MongoDB connection state
- bot heartbeat freshness, when the bot process is running
- AI API calls, failures, failure rate, average latency, and recent failure
  reasons
- total, new, onboarded, named, active, saved-profile, and banned users
- Top 10 and watchlist activity per section
- users with 3+ items, full Top 10s, and unlocked taste labels
- discussion counts, open/closed rooms, bot starter rooms, members, messages,
  reports, and recent activity
- invitation status counts
- AI response cache size and hit counts
- product events for the last 24 hours and seven days
- simple seven-day funnel with unique users
- Top 10 adds and suggestion requests by section

## Bot Limits

The **Bot Limits** section updates the enforced caps for lists, profile
Interests, onboarding Interest selection, saved profiles, suggestions,
discussions, room capacity, and in-bot saved-profile invitations. Rolling-window durations,
typed-interest character limits, and the discussion-message burst interval are
editable too. Existing values remain the defaults until an admin saves the form,
and running bot processes load the saved values once at startup. Restart the bot
after saving changes in the dashboard.

The invitation cap applies only to stored user-to-user invitations created
inside the bot, such as inviting a saved profile. Public shareable discussion
links can be generated and used without this cap.

After saving, the dashboard confirms the write and shows when the global limits
were last changed. The form always displays the currently persisted values.

These settings are global. Lowering a cap does not delete existing user data;
it only prevents new additions until usage is below the new cap. Onboarding
Interest values are normalized so the minimum cannot exceed the auto-complete
maximum, and the onboarding maximum cannot exceed the profile Interest cap.

## Star Economy Administration

The dashboard includes a separate **Star Economy** section. It reuses the existing `AppSetting`, form, normalization, and cache patterns through a focused settings service rather than mixing financial configuration into Bot Limits.

It exposes the rewards, costs, future entitlement durations, boost/notification caps, earning windows, milestone thresholds, and economy/feature kill switches defined in [Stars Economy](stars.md). Each field has a label, description, unit, default, minimum, maximum, and cross-setting validation where applicable.

Implemented behavior:

- show currently persisted values and last update time
- explain the bounded cache/refresh delay after saving
- audit old/new settings and update context
- apply changes only to future transactions and confirmations
- store the relevant settings snapshot with every Star transaction/effect
- never provide an unaudited direct balance overwrite form

The dashboard also reports aggregate Star ledger totals, outstanding balances, earners/spenders, qualified referrals, active boosts, and wallet reconciliation mismatches. Product events cover reward/spend activity, boost delivery and responses, and Advanced Search preview/notification interest. Analytics remains privacy-light and does not include message text, list item text, private profile values, sensitive filter values, or payment credentials.

## Bot Appearance Administration

The dashboard includes a small **Bot Appearance** section for the Muze marker emoji used in bot-authored guidance. The configured marker is cached briefly by bot processes, applied to newly sent or edited messages, and reserved from user profile emoji choices.

## Next Step

This dashboard reads the product state that already exists and records a very
small amount of operational health data.

Operational health data is intentionally lightweight:

- bot heartbeat is recorded about once per minute
- AI provider attempts are recorded without message text
- discussion-list open events are throttled per user/source
- health events expire automatically after seven days
- failures in health logging do not block bot behavior

Product analytics events are also fire-and-forget. They should never block the
bot response path, and metadata is restricted to small safe fields such as
section, count, source, and join-rule type.
