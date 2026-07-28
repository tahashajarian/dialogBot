# Similar People Re-engagement

## Purpose

Muze may send one low-frequency message when genuinely new People discovery results become available while a user has been away. This is a re-engagement notification, not a presence alert, compatibility score, or claim that another person joined because of the recipient.

## Eligibility

A recipient is eligible only when all of these are true:

- the dashboard master switch `similarPeopleReengagementEnabled` is on;
- the recipient falls inside the deterministic `similarPeopleReengagementRolloutPercent`;
- onboarding is complete or skipped;
- the account is not banned;
- `similarPeopleNotificationsEnabled` is not `false`;
- `lastActiveAt` is older than the dashboard-configured inactivity window (`similarPeopleInactiveDays`, default three days);
- no successful similar-people notification was sent inside the dashboard-configured cooldown (`similarPeopleNotificationCooldownDays`, default three days);
- no non-stale delivery claim is active; and
- normal `findPeopleBySharedTaste` discovery returns at least one unsaved profile created after the newer of `lastActiveAt` and `similarPeopleLastNotifiedAt`.

Existing accounts without `lastActiveAt` are not eligible. Their first interaction initializes activity naturally, preventing a surprise notification immediately after rollout.

The master switch defaults off. Deployments collect activity timestamps and expose the preview without sending anything. An administrator should review the preview, choose a small rollout percentage, and enable delivery only after the People pool is large enough.

## Matching and privacy

The notification must reuse `src/services/people-discovery.js`. It must not implement a second similarity definition.

Candidates retain the normal configured overlap, taste-label, visibility, ban, display-name, language, and saved-profile rules. In particular, `peopleDiscoveryMinSharedItems` from the admin dashboard is read by the shared People matcher: setting it to 3, 10, or another allowed value applies equally to See People results and re-engagement eligibility. The notification service must never introduce or override a separate overlap threshold. The message does not reveal a name, exact shared item, exact count, join time, online status, or compatibility score. Its button opens the ordinary `👀 See people` flow, where current eligibility is evaluated again.

The successful-delivery timestamp is also the candidate watermark. A later notification requires at least one eligible profile created after that timestamp, so lowering the cooldown never repeats the same arrivals.

## Delivery behavior

- Scan at most 25 inactive recipients per run.
- Inspect at most 250 inactive records to assemble that rollout-aware batch.
- Run the background scan every six hours.
- Claim a recipient atomically before delivery.
- Treat claims older than thirty minutes as stale.
- Record `similarPeopleLastNotifiedAt` only after successful Telegram delivery.
- Restore failed delivery claims so a later scan may retry.
- Persist activity at most once per hour to avoid a write on every update.
- Do not emit normal People-browse analytics for background matching.

## Dashboard preview

The Manage view shows a cached, bounded dry-run preview:

- whether delivery is enabled;
- total inactive users passing the database eligibility query;
- users assigned to the next rollout batch;
- users in that batch with verified new People matches;
- configured inactivity and cooldown days;
- rollout percentage; and
- the shared-item minimum inherited from See People.

Opening the dashboard preview never sends a notification.

## Copy

Persian:

> 👩‍🦳 آدم‌های تازه‌ای با سلیقه‌ای نزدیک به تو به میوز اضافه شدن.

English:

> 👩‍🦳 New people with taste similar to yours have joined Muze.

The notification action uses a dedicated callback that opens the normal `👀 See people` flow. Receiving or ignoring the notification never changes discussion membership. If the user taps the button while still in an active discussion, the callback first uses the normal discussion-navigation leave action, including the normal notice to remaining members, and only then opens People.
