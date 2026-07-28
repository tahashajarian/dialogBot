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

When `NODE_ENV=production`, the dashboard requires
`ADMIN_DASHBOARD_TOKEN` to contain at least 32 characters even on localhost.

When a token is configured, open the dashboard normally:

```text
http://127.0.0.1:8787
```

The dashboard shows a sign-in page and creates an HTTP-only, same-site session
cookie after the token is accepted. The session expires after eight hours and
can be ended earlier with **Log out**. Tokens in URL query strings and
`x-dashboard-token` headers are deliberately not accepted, so the secret does
not enter browser history or copied dashboard links.

For scripted read-only snapshot access, send
`Authorization: Bearer your_token` to `/api/snapshot`. Configuration-changing
routes require the browser session and their per-session CSRF token.

For access from another machine, keep the dashboard bound to `127.0.0.1` and
place it behind a trusted HTTPS reverse proxy or an SSH tunnel. Do not expose
the dashboard over plain HTTP. The reverse proxy must forward
`X-Forwarded-Proto: https` so the dashboard marks its session cookie `Secure`.

When no token is configured, localhost keeps its direct-open workflow. The
dashboard silently creates a temporary local session so mutation forms still
receive CSRF protection; that session is invalidated when the dashboard
process restarts.

## Current Metrics

- VPS health with CPU load, available/used memory, root-disk usage, host uptime,
  platform, and the systemd state of the bot and dashboard services; these
  read-only OS metrics are cached for 30 seconds and remain behind the same
  dashboard authentication
- dashboard server uptime
- MongoDB connection/readiness state, including connected, connecting,
  disconnecting, and disconnected lifecycle information
- bot heartbeat freshness, when the bot process is running
- AI API calls, failures, failure rate, average latency, recent failure reasons,
  and a billing/access alert when the provider explicitly reports exhausted quota,
  payment, authentication, or access errors
- update performance by route with p50/p95 latency, Telegram API time, and
  loaded user-document size for the last 24 hours; this includes every slow
  update plus a stable five-percent baseline sample
- total, new, onboarded, named, active, saved-profile, and banned users
- Top 10 and watchlist activity per section
- users with 3+ items and full Top 10s, plus unlocked taste labels for Movies, Music, and Books only
- discussion counts, open/closed rooms, bot starter rooms, members, messages,
  reports, and recent activity
- invitation status counts
- AI response cache size and hit counts
- product events for the last 24 hours and seven days
- visual seven-day product journey with unique users, backed by the exact event table
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

The Manage view also includes a bounded Similar People rollout preview. Its master switch defaults off, its rollout percentage is deterministic per user, and the preview shows inactive eligibility plus verified matches for the next batch without sending notifications. The inactivity days, notification cooldown days, rollout percentage, and inherited People shared-item minimum are visible together before activation.

Implemented behavior:

- show currently persisted values and last update time
- explain that bot restart is required after saving
- audit old/new settings and update context
- apply changes only to future transactions and confirmations
- store the relevant settings snapshot with every Star transaction/effect
- never provide an unaudited direct balance overwrite form

The dashboard also reports aggregate Star ledger totals, outstanding balances, earners/spenders, qualified referrals, active boosts, and wallet reconciliation mismatches. Product events cover reward/spend activity, boost delivery and responses, and Advanced Search preview/notification interest. Analytics remains privacy-light and does not include message text, list item text, private profile values, sensitive filter values, or payment credentials.

The dashboard page auto-refreshes every 60 seconds so admin-visible metrics stay current while being watched. It skips the automatic reload after a settings form has been edited, so unsaved admin input is not lost.

Dashboard snapshots are cached for 30 seconds, and concurrent page/JSON
requests share the same in-progress snapshot build. User and list totals are
calculated inside MongoDB rather than loading complete user documents into the
dashboard process. Dashboard query groups have a ten-second execution limit;
if a non-critical group fails, the page keeps the available metrics and shows
a partial-data warning. Saving any dashboard setting invalidates the cache
immediately.

The interface is split into four focused views:

- **Overview** shows the few numbers and health signals needed for a quick check,
  plus compact progress visuals for onboarding, discussion availability, and AI
  reliability.
- **Manage** contains bot limits, appearance, and Star settings. Only one editor
  opens at a time, larger editors are split into collapsible setting groups, and
  search opens the relevant group directly. The real collapsible section headers
  are the only controls above each editor; no decorative shortcut cards are shown.
- **Insights** contains user, product-journey, discussion, list, invitation, and
  cache analytics. Accessible horizontal bars make relative activity easier to
  scan while the adjacent tables preserve exact values.
- **System** contains service health, AI failures, Star ledger checks, and a
  p95 route-latency comparison beside the detailed performance table.

The visualizations are rendered from the existing server snapshot with HTML and
CSS. They add no browser analytics, third-party chart library, CDN dependency,
or additional MongoDB query. Busy event and performance charts show the ten most
important rows while their detailed tables continue to show every returned row.

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
- overload rejections are grouped by resource and reason without user ids,
  message text, prompts, profile data, or notification payloads
- discussion-list open events are throttled per user/source
- health events expire automatically after seven days
- failures in health logging do not block bot behavior
- every update taking at least 1.5 seconds and a deterministic five-percent
  baseline create performance events; they contain route and numeric
  timing/size metadata, never message text or user/profile content

The **Overload protection** system alert reports rejected AI and cross-user
notification work from the last 24 hours. These records use the same seven-day
TTL as other operational events. A nonzero value means the bounded queue
protected the process; use the resource/reason breakdown to distinguish
duplicate user requests, full queues, and queue wait timeouts.

Product analytics events are also fire-and-forget. They should never block the
bot response path, and metadata is restricted to small safe fields such as
section, count, source, join-rule type, onboarding destination, and section-tip
key. Interest text, list items, titles, message text, and other user-authored
content are not stored in these events.
