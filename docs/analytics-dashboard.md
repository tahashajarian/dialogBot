# Analytics Dashboard

This is a small read-only dashboard for checking useful product data from the
existing MongoDB collections. It is meant as the first practical analytics
step, before adding full event tracking.

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

## Next Step

This dashboard reads the product state that already exists and records a very
small amount of operational health data. It does not yet track user events such
as button taps, funnel steps, or retention. Add a small event collection next
when product usage needs deeper answers.

Operational health data is intentionally lightweight:

- bot heartbeat is recorded about once per minute
- AI provider attempts are recorded without message text
- discussion-list open events are throttled per user/source
- health events expire automatically after seven days
- failures in health logging do not block bot behavior

Product analytics events are also fire-and-forget. They should never block the
bot response path, and metadata is restricted to small safe fields such as
section, count, source, and join-rule type.
