# Muze Moderation And Safety Runbook

This is an internal operating document for the people responsible for Muze. Do
not publish private report details, Telegram IDs, database records, secrets, or
incident notes.

Before public launch, assign:

- **Safety owner:** [NAME/ROLE]
- **Backup safety owner:** [NAME/ROLE]
- **User support contact:** [EMAIL OR TELEGRAM HANDLE]
- **Privacy/security contact:** [EMAIL]
- **Operating timezone:** [TIMEZONE]
- **Normal review target:** [FOR EXAMPLE, WITHIN 24 HOURS]
- **Urgent escalation contact:** [CONTACT METHOD]

## Product Safety Model

Current Muze controls are deliberately simple:

- Discussion members can report another current member of the same open room.
- One reporter can contribute only one unique report against the same target.
- At `REPORT_BAN_THRESHOLD` unique reporters (default: 5), the target is
  automatically banned and removed from all open discussion memberships.
- Banned users are blocked from normal update handling and People discovery.
- Discussion owners can remove members and close rooms.
- Users can restrict a specific inviter, which removes pending invitations from
  that inviter and blocks future invitations and eligible new joins to rooms
  created by that inviter.
- Profile-name and discussion-input validation blocks known abusive, sexual,
  degrading, placeholder, and spam-like input patterns, but it is not a full
  moderation system.
- Muze does not use AI-generated moderation.

Important limitations:

- A report stores reporter ID, target ID, room, status, and time. It does not
  store a reason or immutable snapshot of the reported message.
- A room retains only its latest 10 messages. Evidence can disappear as new
  messages arrive, and Telegram-delivered copies can differ from current MongoDB
  state.
- The authenticated analytics dashboard has an audited unban tool in its
  Moderation section. It requires CSRF validation, a review reason, and an
  explicit `UNBAN` confirmation. Do not improvise direct database edits.
- Automatic report thresholds are signals, not proof. Coordinated false reports
  are possible and must be considered during review.

## What To Act On

Prioritize behavior involving:

- credible threats, coercion, stalking, doxxing, or exposure of precise location;
- sexual exploitation or suspected child-safety harm;
- targeted harassment, hate, degrading abuse, or repeated unwanted contact;
- impersonation, scams, malicious links, reward/referral farming, or automation;
- spam or coordinated disruption of discussions and invitations;
- attempts to evade a ban or manipulate reports; and
- exposure of Muze secrets, private bookmarks, wallet data, or infrastructure.

Do not promise a legal conclusion. Escalate suspected illegal content or an
immediate safety threat according to applicable law, the operator's legal
advice, and the emergency rules for the relevant jurisdiction.

## Severity And Response

### P0 — Immediate safety or security risk

Examples: credible imminent physical danger, suspected child sexual
exploitation, active credential/database exposure, or ongoing mass compromise.

1. Notify the safety owner immediately.
2. Preserve the minimum available evidence without forwarding it broadly.
3. Contain the risk: disable the affected feature or service, rotate exposed
   credentials, restrict beta access, or stop the bot if necessary.
4. Contact the appropriate platform, hosting provider, legal adviser, or
   emergency channel when required.
5. Record every action and time. Do not delete evidence outside the approved
   retention process.

### P1 — Serious abuse or financial-integrity incident

Examples: repeated targeted harassment, coordinated report abuse, widespread
spam, Star exploitation, refund failures after charges, or ban evasion.

1. Review within [P1 RESPONSE TARGET].
2. Preserve IDs, timestamps, room code, relevant current messages, ledger IDs,
   and operational logs. Never copy secrets into the incident record.
3. Apply the narrowest safe containment: close a room, remove access, disable a
   rollout switch, restrict beta usernames, or pause the affected Stars action.
4. For wallet issues, use ledger-backed refund/reversal/grant operations only;
   never overwrite `starBalance` or delete transactions.
5. Notify affected users with neutral language when doing so is safe and useful.

### P2 — Routine report, spam, or policy question

1. Review within [NORMAL REVIEW TARGET].
2. Check whether the report is unique, whether reporters share suspicious
   patterns, and whether current room context supports action.
3. Prefer a warning, owner removal, invitation restriction, or room closure when
   appropriate. A global ban should not be inferred from weak evidence alone.
4. Mark the report reviewed only through an approved operational process.

## Report Review Procedure

For each report or banned-user review:

1. Record the case ID, opened time, reviewer, target user ID, reporter IDs,
   discussion ID/public code, and automatic action already taken.
2. Check the latest room context promptly because only 10 messages are retained.
3. Check for duplicate identities, coordinated timing, repeated referrals,
   invitation concentration, and prior reports without exposing private saved
   profiles.
4. Separate verified facts from user allegations and reviewer inference.
5. Choose one outcome: no action, monitor, warning, member removal, room closure,
   feature containment, uphold ban, or escalate for appeal/unban review.
6. Record the reason, evidence consulted, action, reviewer, and review time.
7. Avoid storing message content longer than the approved incident-retention
   period: [INCIDENT RETENTION PERIOD].

## Appeals And False Positives

Publish one support route in the privacy policy and bot profile. For an appeal:

1. Verify the requester controls the affected Telegram account without asking
   for a Telegram password.
2. Assign a reviewer who was not the sole decision-maker in the original case
   when practical.
3. Review report coordination, available room context, prior incidents, and the
   automatic threshold action.
4. Document uphold/reverse/escalate. For a reversal, use Dashboard → Manage →
   Moderation, select the banned user, enter the case/review reason, and type
   `UNBAN` exactly.
5. Confirm the audited action reports `applied`. The tool removes only ban state;
   do not restore old room membership, invitations, or messages automatically.

## Privacy And Evidence Handling

- Access production records only through named, least-privilege operator
  accounts. Never share the production environment file.
- Do not use private saved-profile relationships as social evidence unless a
  security investigation strictly requires it.
- Do not expose reporter identity to the reported user.
- Keep incident records encrypted and accessible only to assigned operators.
- Collect the minimum evidence needed. Redact bot tokens, API keys, database
  credentials, precise location, and unrelated personal information.
- Account deletion removes or anonymizes Muze data according to
  `docs/account-deletion.md`; already-delivered Telegram messages and approved
  anonymized audit records can remain.

## Operational Checks

Daily during beta:

- review new reports and auto-bans;
- check bot heartbeat, Telegram/AI failures, restart count, and slow routes;
- check Star reconciliation, pending transactions, refund failures, and unusual
  referral concentration while Stars are enabled; and
- verify the safety/support inbox is monitored.

Weekly:

- sample auto-bans for false-report patterns;
- review `REPORT_BAN_THRESHOLD` without changing it merely to reduce workload;
- review blocked usernames, repeated invitation abuse, and ban evasion;
- test that the support and escalation contacts still work; and
- record policy, feature-switch, or runbook changes.

## Incident Record Template

```text
Case ID:
Severity: P0 / P1 / P2
Opened at / closed at:
Reviewer:
Target user ID:
Reporter user IDs:
Discussion ID/code:
Automatic action already taken:
Verified facts:
User allegations:
Evidence consulted:
Containment/action:
User notification:
Appeal status:
Follow-up owner/date:
```

## Public-Launch Decisions Still Required

- Fill and publish all contacts and response targets in this runbook.
- Choose and publish the minimum-age position in the privacy policy.
- Approve retention periods for analytics, backups, and incident records.
- Publish the support/appeal route and assign authorized dashboard reviewers.
- Decide whether report reasons/evidence snapshots are needed before scaling
  beyond the private beta.
- Confirm the privacy policy and moderation process with qualified advisers for
  the launch jurisdictions.
