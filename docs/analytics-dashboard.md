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
- AI API calls, failures, failure rate, average latency, recent failure reasons,
  and a billing/access alert when the provider explicitly reports exhausted quota,
  payment, authentication, or access errors
- slow bot updates by route with p50/p95 latency, Telegram API time, and loaded
  user-document size for the last 24 hours
- total, new, onboarded, named, active, saved-profile, and banned users
- Top 10 and watchlist activity per section
- users with 3+ items and full Top 10s, plus unlocked taste labels for Movies, Music, and Books only
- discussion counts, open/closed rooms, bot starter rooms, members, messages,
  reports, and recent activity
- invitation status counts
- AI response cache size and hit counts
- product events for the last 24 hours and seven days
- simple seven-day funnel with unique users
- guided seven-day journey rows for onboarding start/completion, starter-invitation preparation/opening, onboarding destination choices, discussion-list opening/joining, and first Favorites/People guidance exposure
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

The dashboard includes a separate **Star Economy** section. It reuses the existing `AppSetting`, form, and normalization patterns through a focused settings service rather than mixing financial configuration into Bot Limits.

It exposes the rewards, costs, future entitlement durations, boost/notification caps, earning windows, milestone thresholds, and economy/feature kill switches defined in [Stars Economy](stars.md). Each field has a label, description, unit, default, minimum, maximum, and cross-setting validation where applicable.

Implemented behavior:

- show currently persisted values and last update time
- explain that bot restart is required after saving
- audit old/new settings and update context
- apply changes only to future transactions and confirmations
- store the relevant settings snapshot with every Star transaction/effect
- never provide an unaudited direct balance overwrite form

The dashboard also reports aggregate Star ledger totals, outstanding balances, earners/spenders, qualified referrals, active boosts, and wallet reconciliation mismatches. Product events cover reward/spend activity, boost delivery and responses, and Advanced Search preview/notification interest. Analytics remains privacy-light and does not include message text, list item text, private profile values, sensitive filter values, or payment credentials.

The dashboard page auto-refreshes every 60 seconds so admin-visible metrics stay current while being watched. It skips the automatic reload after a settings form has been edited, so unsaved admin input is not lost.

The interface is split into four focused views:

- **Overview** shows the few numbers and health signals needed for a quick check.
- **Manage** contains bot limits, appearance, and Star settings. Only one editor
  opens at a time, larger editors are split into collapsible setting groups, and
  search opens the relevant group directly.
- **Insights** contains user, funnel, discussion, list, invitation, and cache analytics.
- **System** contains service health, AI failures, and Star ledger checks.

The selected view and expanded sections are remembered in the browser. Settings
stay collapsed until needed to keep routine monitoring uncluttered.

Use [Stars Operations Checklist](stars-operations.md) for the daily Star Economy operating habit. Dashboard metrics are for inspection and alerting; balances remain ledger-backed and should not be overwritten directly.

## Bot Appearance Administration

The dashboard includes a small **Bot Appearance** section near the top, after **Bot Limits**, for the Muze marker emoji used in bot-authored guidance. The configured marker is cached briefly by bot processes, applied to newly sent or edited messages, and reserved from user profile emoji choices.

## Next Step

This dashboard reads the product state that already exists and records a very
small amount of operational health data.

Operational health data is intentionally lightweight:

- bot heartbeat is recorded about once per minute
- AI provider attempts are recorded without message text
- discussion-list open events are throttled per user/source
- health events expire automatically after seven days
- failures in health logging do not block bot behavior
- only updates taking at least 1.5 seconds create performance events; they contain
  route and numeric timing/size metadata, never message text or user/profile content

Product analytics events are also fire-and-forget. They should never block the
bot response path, and metadata is restricted to small safe fields such as
section, count, source, join-rule type, onboarding destination, and section-tip
key. Interest text, list items, titles, message text, and other user-authored
content are not stored in these events.
