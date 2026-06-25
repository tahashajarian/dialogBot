# Discussion Invitations

This document is the product and implementation spec for the discussion invitations MVP.

## Goal

Discussion invitations let a user invite a saved profile into a discussion from inside Muze.

Muze can also create one-time starter invitations during onboarding. These use the same invitations inbox and join/remove actions, but are clearly shown as coming from Muze and do not expose an inviter profile or inviter mute action.

The feature should connect existing social surfaces:

- Discussions create profile discovery.
- Saved profiles let users privately remember people.
- Invitations let users bring saved people back into relevant discussions.

This should not become private chat, friendship, or a general people-discovery system.

## Implementation Principle

This feature should be additive.

Do not rewrite existing discussion join logic, public invite logic, saved-profile logic, profile rendering, or router structure. Reuse the current service and flow behavior wherever possible, and add only the minimum hooks needed for stored invitations.

In particular:

- Keep the existing shareable invite behavior intact.
- Keep existing `/join_CODE`, `/d_CODE`, and discussion preview behavior intact.
- Keep existing join failure behavior intact, including `Got it` acknowledgement and return destinations.
- Keep existing discussion membership, capacity, removed-user, and join-rule checks as the source of truth.
- Keep saved profiles one-way and private; do not turn them into contacts or friendships.
- Keep `src/bot.js` and `src/callbacks.js` thin dispatchers.
- Prefer small new invitation modules over expanding existing routers.
- Do not duplicate discussion eligibility logic in the invitation layer. The invitation layer should call existing discussion services or small extracted helpers.
- Do not change current user data semantics unless a new invitation field/model is required.
- Do not change onboarding behavior globally; only preserve invitation continuation when an invite is the entry path.

Focused refactor is allowed when it supports reuse.

Acceptable refactors:

- Extract an existing inline join-error acknowledgement helper so invitation joins can return to the correct source.
- Extract existing discussion eligibility or preview formatting into a shared helper if the same rules would otherwise be copied.
- Extract existing shareable invite generation from the active-room bottom-button path so the new invite-mode menu can call it without changing the output.
- Extract saved-profile list/profile-code resolution helpers if invitation flows need the same checks.

Avoid broad cleanup, naming churn, behavior changes, or unrelated file movement. Any extraction should preserve current behavior and be covered by focused tests.

## Existing Invite Behavior

The current discussion invite flow is public-code based:

1. A member is inside an active discussion.
2. They tap the bottom button `📨 دعوت`.
3. The bot generates one ready-to-share invite message/link.
4. The user forwards that message outside the bot.
5. A recipient opens the invite preview.
6. The recipient must still tap join and pass normal join checks.

That flow should remain. It is useful when the inviter has an outside/private way to contact someone.

This new feature adds a stored in-bot invite path for saved profiles.

## Stars Integration

[Stars Economy](stars.md) is the source of truth for invitation rewards, outside attribution, ledger integrity, reward copy, and admin-editable amounts. The invitation behavior in this document remains reusable even when no Star reward is available.

### Stored Saved-Profile Invitations

- Sending an invitation never awards Stars.
- The inviter may earn the configured reward only after the invitee accepts and the normal discussion join succeeds.
- Reward eligibility is lifetime-once for each directed inviter/invitee pair across all discussions.
- A to B and B to A are separate directions and may each qualify once.
- Repeated invitations, different rooms, leaving/rejoining, reopening accepted shortcuts, duplicate callbacks, and duplicate stored rows never award again.
- Bot onboarding invitations and future boosted recommendations never count.
- A configurable invitation-earning cap/window limits renewable abuse without changing the existing invitation sending limit.
- Invitation send success copy may explain that the inviter can earn Stars if this is their first rewarded invitation to that person and the person joins. It must not promise or display an earned balance before acceptance.
- The acceptance/join and reward must be idempotent. A reward failure must not cause a second membership mutation when retried.

Stable reward identity:

```text
invite-pair:first-accepted:{inviterUserId}:{inviteeUserId}
```

### Outside Shareable Invitations

Shareable outside links must be upgraded to carry opaque inviter attribution while keeping existing non-attributed `/join_CODE` and `start=join_CODE` links backward compatible.

- The public token resolves internally to the inviter and optional target discussion; raw user IDs never appear in the URL.
- `/start` and preview opening never award Stars.
- The first valid referrer for a genuinely new account is locked and cannot be replaced by repeated or later start payloads.
- Existing accounts, self-referrals, repeated `/start`, clearing chat history, previewing, and joining without the configured new-user qualification do not award.
- Recommended qualification is completion of the first three onboarding Interests or the equivalent milestone outside onboarding.
- Each new invitee can reward at most one outside inviter.
- Preserve referral attribution through language selection and invite-first onboarding without forcing the general onboarding card before the invitation preview.
- Existing repeated-start handling is UX protection only. Durable claim and transaction uniqueness provide financial protection.

### Reward Privacy And Notifications

- Do not tell the invitee whether the inviter was rewarded.
- Do not expose inviter/invitee IDs or pair reward history.
- Add the reward confirmation to the inviter's next appropriate bot response or send one low-noise private confirmation after successful acceptance. This is a Star event, not a room notification.
- Normal invitation acceptance remains useful even after the pair's reward was already claimed.

## Product Summary

Add a received invitations entry:

```text
Invitations (0)
Invitations (3)
```

Persian copy can be:

```text
دعوت‌ها (0)
دعوت‌ها (3)
```

Users can send stored discussion invitations in two places:

- From an active discussion: choose a saved profile to invite to the current room.
- From a saved profile: choose one of the inviter's eligible discussions.

Invitees can open the invitations section, review each pending discussion invitation, join if eligible, or remove the invite.
Accepted invitations stay visible as recent joined shortcuts so a user can return to a discussion later even after leaving it.

## MVP Rules

- Any current member of an open discussion can invite a saved profile.
- The inviter does not need to be the discussion owner.
- The invitee does not need to have saved the inviter.
- The invitee can be invited even if they have never joined a discussion before.
- The invite does not bypass join rules, capacity, removed-user checks, closed-room checks, or one-active-room behavior.
- Duplicate pending invites for the same recipient and discussion are blocked.
- Inbox display and counts collapse duplicate stored rows by inviter and discussion, including recent joined shortcuts from accepted invites.
- Sender daily invite limits are enforced.
- Invitation counts show all pending invites, including seen pending and bot starter invites.
- Seen pending invites stay in the list until accepted, removed, or expired.
- Accepted invitations are excluded from the count, but the inbox can show the most recent accepted invites under a separate recent section.
- Accepted invitation shortcuts stay until the invitee removes them or the target discussion becomes unavailable.
- Invitees can mute future invitations from a specific inviter.
- A muted user cannot join future discussions created by the user who muted them.
- The inviter should not receive an acceptance notification in MVP.
- The discussion owner should not receive an invite-sent notification in MVP.
- The invitee should receive one low-noise bot-authored notification when a new stored invite is created.
- Duplicate or failed invitation attempts should not notify the invitee.
- Invite generation should not broadcast anything into the room.
- Saved profiles remain private one-way bookmarks.
- Invitations are not friendship requests and must not imply private chat.

## Entry Points

### Received Invitations Entry

Recommended placement:

- Add an `Invitations (N)` button near `Discussions` in the main menu, or
- Add it inside the discussions menu as a first-class action.

Preferred MVP placement: discussions menu.

Reason:

- Invitations are discussion-specific.
- It avoids making the main menu too busy.
- Counts can still be shown in the discussions menu label.

Future option:

- If invitations become central, show the count in the main menu too.

### Active Discussion Invite Button

The existing bottom button `📨 دعوت` currently creates a ready-to-share public invite message.

For the new feature, tapping `📨 دعوت` from an active discussion should open an invite menu instead of immediately generating only a share card.

Recommended menu:

```text
📨 دعوت به بحث

می‌خوای چطور دعوت کنی؟
```

Actions:

- Invite saved profile
- Create shareable invite
- Back to room

English:

```text
📨 Invite to discussion

How do you want to invite?
```

Actions:

- Invite saved profile
- Create shareable invite
- Back to room

This preserves the current public share behavior while adding the saved-profile path.

### Saved Profile Invite Action

Saved-profile list items currently use command links for view, discussions, and remove actions.
Do not show an invite action in each saved-profile row; it makes the list too busy.

The backend still accepts the stable legacy/manual command `/iv_CODE` for compatibility.

`CODE` is the saved user's public profile code, not a raw user id.

When viewing a saved profile card, it can also expose an inline action:

- Invite to discussion
- Back to saved profiles

For MVP, prefer the saved-list command link because saved-profile lists already use text command links for per-profile actions.

## Sender Flow A: Invite From Active Discussion

Scenario: user is currently inside a discussion and wants to invite someone they saved.

1. User taps `📨 دعوت` in the active discussion bottom keyboard.
2. Bot verifies the user still has an active discussion.
3. Bot verifies the user is still a member of that active discussion.
4. Bot verifies the discussion is still open.
5. Bot shows invite mode menu:
   - Invite saved profile
   - Create shareable invite
   - Back to room
6. User taps `Invite saved profile`.
7. Bot shows the user's saved profiles as selectable invite targets.
8. User selects a saved profile.
9. Bot creates or reuses a pending invitation.
10. If a new invitation was created, bot sends the invitee a short notification pointing to `Discussions → Invitations`.
11. Bot shows `Invitation sent to {name}.`
12. User taps `Got it`.
13. Bot returns to the current discussion room.

If the inviter has no saved profiles:

```text
🤖 You do not have saved profiles yet.

💡 For now, create a shareable invite and send it to people. Later, save interesting profiles from member lists so you can invite them directly.
```

Actions:

- Create shareable invite
- Back to room

Persian:

```text
🤖 هنوز پروفایل ذخیره‌شده‌ای نداری.

💡 می‌تونی فعلاً یک دعوت قابل اشتراک بسازی و برای دیگران بفرستی. بعداً هم از لیست اعضا پروفایل‌های جالب رو ذخیره کن تا مستقیم دعوتشون کنی.
```

Actions:

- ساخت پیام قابل اشتراک
- برگشت به بحث

### Invite Target Picker

Use stable public profile codes in callbacks or command links.

Do not use list indexes for mutating invite actions unless the picker card is deleted or edited immediately after selection.

Recommended inline picker:

```text
🔖 Saved profiles

Choose who to invite to:
Movie Night
```

Rows:

- Sara
- Ali
- More / Previous
- Back

Callback payload should include:

- public discussion code or discussion id
- invitee public profile code
- return destination

Avoid raw user ids in callback data if public codes are available.

## Sender Flow B: Invite From Saved Profile

Scenario: user sends the legacy/manual saved-profile invite command.

1. User sends `/iv_CODE`.
2. Bot resolves `CODE` to a saved profile.
3. Bot verifies the target is actually saved by the inviter.
4. Bot loads inviter's eligible discussions.
5. Bot shows discussion picker.
6. User selects one discussion.
8. Bot creates or reuses a pending invitation.
9. If a new invitation was created, bot sends the invitee a short notification pointing to `Discussions → Invitations`.
10. Bot shows `Invitation sent to {name}.`
11. User taps `Got it`.
12. Bot returns to the saved profiles list.

Eligible discussions:

- Open.
- Inviter is currently a member.
- Target user is not already a member.
- Target user is not removed from that discussion.

The picker may include both discussions the inviter created and discussions they joined.

If inviter has no eligible discussions:

```text
🤖 You need an open discussion before inviting someone.
```

Actions:

- Browse discussions
- Create discussion
- Back to saved profiles

Persian:

```text
🤖 برای دعوت کردن، باید عضو یک بحث باز باشی.
```

Actions:

- بحث‌های فعال
- ساخت بحث
- برگشت به ذخیره‌شده‌ها

If all discussions are ineligible because the target is already a member or removed, show a specific safe message:

```text
🤖 There is no available discussion to invite this profile to.
```

Do not reveal sensitive moderation details unless the inviter already has permission to know them. For example, "removed from this room" can be shown to the room owner, but not necessarily to a regular member.

## Invitee Flow: Received Invitations

1. Invitee opens `Invitations (N)`.
2. Bot lists pending invitations and, below them, recent accepted invitation shortcuts.
3. Each invitation shows:
   - discussion title
   - optional short description
   - inviter display name
   - join rule summary
   - current availability state
   - join/open action if allowed
   - remove/dismiss action
   - optional inviter profile link
4. Invitee taps join.
5. Bot revalidates current state.
6. If join succeeds, bot opens the discussion room.
7. If join fails, bot shows a safe reason and keeps or removes the invite depending on the reason.

Join failures should match the existing discussion join-error UX:

- Show one clear failure message.
- Include a `Got it` acknowledgement button.
- After `Got it`, return the user to where they came from.
- For invitation-list joins, return to the invitations list.
- For saved-profile discussion joins, return to that saved user's discussions view.
- For public invite previews, return to the current invite-preview/main-menu behavior.

Do not strand the user in a dead state after a failed join. The invitation should remain visible when the failure is recoverable, such as a missing TopTen item or taste label requirement.

Example:

```text
📨 Invitations

1. Movie Night
From: Sara
🌍 Open | 4/20 members
Join 👉 /accept_inv_ABC123
Inviter profile 👉 /u_SARA12
Remove 👉 /remove_inv_ABC123

-----

2. Metal Albums For Starters
From: Ali
🔒 Requires: Music - Metalhead
Complete Music Top 10 first.
Remove 👉 /remove_inv_DEF456
```

Persian pointer convention:

```text
ورود 👈 /accept_inv_ABC123
پروفایل دعوت‌کننده 👈 /u_SARA12
حذف دعوت 👈 /remove_inv_ABC123
```

Use stable invitation public codes, not array indexes.

If there are no pending invites but the user has recently joined from invitations, keep the inbox useful:

```text
📨 Invitations

🤖 No invitations right now.

Recently joined from invitations:

1. ✅ Movie Night
From: Sara
📄 Weekend movie talk
👥 4/20
🔐 Join condition:
🌍 Open ✅
Join 👉 /accept_inv_ABC123
Remove invitation 👉 /remove_inv_ABC123
```

The recent section is a shortcut list, not a pending-invite count. `Invitations (0)` can still show while recent accepted shortcuts are visible, but pending invitations stay counted after they are seen.

## Invitation Count And Seen State

The count should represent all pending received invitations.

Recommended MVP count:

- Count invitations with status `pending`.
- Exclude invitations removed by the recipient.
- Exclude invitations accepted by the recipient.
- Do not perform expensive join-rule evaluation for every menu render.

When the invitee opens the invitations list, each invite is revalidated for display.

Recommended MVP:

- Show unseen pending invites with `🆕`.
- Show seen pending invites with `📨` while still counting them.
- After a page renders successfully, set `seenAt` on invitations shown on that page.
- Keep stale pending invites visible once with a clear unavailable state and a remove action.
- Show up to the most recent accepted invitations as shortcuts below pending invitations.
- Accepted shortcuts use the same `/accept_inv_CODE` command to reopen/rejoin the discussion and the same `/remove_inv_CODE` command to hide the shortcut.
- Use pagination for long lists, with 5 invitations per page.
- Keep the list keyboard limited to pagination plus Back.

This avoids surprising count changes.

## Join Validation

Stored invitations must use the same join rules as public invite previews.

Validation order when accepting an invite:

1. Resolve invitation by public invitation code.
2. Verify invitation exists and belongs to the current user.
3. Verify invitation status is pending or accepted.
4. Load discussion fresh from the database.
5. Verify discussion exists and is open.
6. Verify inviter still exists enough to render safe display, if needed.
7. Load current invitee user.
8. Check whether invitee was removed from the discussion.
9. Check whether invitee is already a member.
10. Check capacity.
11. Check join rule.
12. Check one-active-room behavior.
13. Atomically join/open the target discussion.
14. Mark invitation accepted if it was pending; accepted invitation shortcuts can be reopened without creating duplicate membership.
15. Open the room and send normal join notifications.

Important:

- A failed join must not remove the user from their current active discussion.
- If the user is active in another discussion, follow the existing discussion join behavior.
- If existing behavior requires leaving first, show that message and keep the invite pending.

## Edge Cases

### Inviter Is Not Owner

Allowed in MVP if:

- inviter is a current member
- discussion is open

Reason:

- Members naturally invite relevant people.
- Join rules still protect room relevance.
- The owner can remove members if needed.

Future option:

- Add owner-only invite mode or per-room invite permissions.

### Inviter No Longer Member

From active discussion:

- Stale bottom keyboard should fail safely.
- Show `You are no longer a member of this discussion.`

From saved profile flow:

- Do not list discussions where inviter is no longer a member.

Existing pending invites:

- Keep valid if the discussion is open and invitee is eligible.
- The invite records who sent it, but membership at accept time should not necessarily depend on inviter still being present.

Reason:

- The invitation was sent at a real past moment.
- Discussion availability and invitee eligibility matter more at accept time.

Alternative stricter rule:

- Invalidate invite if inviter left.

MVP recommendation:

- Do not invalidate solely because inviter left.

### Invitee Never Used Discussions

Allowed.

This is a good onboarding path into discussions.

If invitee has never completed onboarding:

- Preserve pending invite.
- If language selection is required, ask language first.
- After language selection, take the user directly to the invitation preview/list.
- Do not force interests onboarding before the invite preview.
- Show a short tip that explains what discussions are and what the user can do next.

This should mirror current invite deep-link behavior.

First-time tip example:

```text
🤖 Discussions are live rooms around shared interests.

You can preview this invitation first. If the room has a join condition, I will show you what to complete before joining.
```

Persian:

```text
🤖 بحث‌ها گفتگوهای زنده درباره علاقه‌های مشترکن.

اول می‌تونی این دعوت رو ببینی. اگر بحث شرط ورود داشته باشه، بهت می‌گم برای ورود چی رو کامل کنی.
```

The tip should be shown once around the invitation entry, not repeatedly on every invitations-list open.

### Invitee Has No Display Name

Joining can use profile name or first name fallback, matching current discussion behavior.

Do not block invitation viewing.

If later the product requires a display name before joining, gate only at join time and redirect back to the invite after completion.

### Invitee Already Member

When listing:

- Show `Already joined` and offer `Open room` if appropriate.
- Or mark accepted/clear it.

Recommended MVP:

- On list open, show once as `Already joined` with remove/open.
- On accept, mark accepted and open the room.

### Invitee Already Active In Same Discussion

Accepting should re-focus/open the room.

Do not duplicate membership.

Mark invitation accepted.

### Invitee Active In Another Discussion

Follow existing one-active-room behavior.

If current behavior requires leaving first:

- Show a join-error acknowledgement.
- Keep invitation pending.
- Return destination should be invitations list after `Got it`.

If current behavior switches rooms:

- Mark invitation accepted only after successful switch/join.

### Discussion Closed Or Missing

List state:

```text
🤖 This discussion is no longer available.
Remove 👉 /remove_inv_CODE
```

Accept:

- Show unavailable message.
- Keep or mark stale.
- Prefer marking stale/expired to remove from count.

### Discussion Full

List state:

```text
🤖 This discussion is full.
Remove 👉 /remove_inv_CODE
```

Accept:

- Show capacity message.
- Keep pending unless product wants full rooms to expire invites.

Recommended MVP:

- Keep pending so the user can retry later if capacity opens.

### Invitee Removed From Discussion

List state:

- Show locked/unavailable safely.
- Do not reveal unnecessary moderation detail.

Accept:

- Use the same removed-user error as normal discussion join.
- Keep or expire the invite.

Recommended MVP:

- Mark invite stale/blocked after removed-user failure.

### Join Rule Not Satisfied

The invite should appear as locked.

Show the exact missing requirement:

- taste label requirement
- TopTen item requirement
- TopTen completion requirement if supported

Actions:

- Go to the relevant list/section if practical.
- Remove invitation.

Keep invite pending so the user can complete the requirement and return.

### Duplicate Invite

If a pending invite already exists for recipient + discussion:

- Do not create another.
- Tell inviter `Invitation already sent.`
- `Got it` returns to the previous place.

If an invite was removed by the recipient:

- Allow a new invite after a cooldown or after explicit sender action.

Recommended MVP:

- Allow re-invite if previous invite is removed/expired/accepted.
- Block only pending duplicates.

### Inviting Yourself

Should be impossible through saved profiles, but guard anyway.

Show:

```text
🤖 You cannot invite yourself.
```

### Target User Not Found

If the saved public profile code no longer resolves:

- Show saved-profile not found.
- Offer to remove the saved profile.

Do not create invite.

### Target Not Actually Saved

If user sends `/iv_CODE` manually for someone not saved:

- Reject.
- Show `This profile is not in your saved profiles.`

This keeps invites tied to the saved-profile feature.

### Invite Spam And Daily Limits

MVP protections:

- Duplicate pending invite block.
- Existing repeated-tap guard.
- Per-sender daily cap.

Recommended MVP limit:

- Max 3 created invitations per sender per rolling 24 hours.
- Count newly created invitations only.
- Do not count duplicate attempts where an existing pending invite is reused/reported.
- Do not count shareable public invite message generation; this limit applies only to stored user-to-user invitations.
- Optional extra guard: max 5 pending invitations from the same sender to the same recipient.
- Read the numeric limit from a centralized user-limits module/config, not from hardcoded invitation-flow constants.

Limit reached copy:

```text
🤖 You have reached today's invitation limit.

Try again later.
```

Persian:

```text
🤖 امروز به سقف ارسال دعوت رسیدی.

بعدا دوباره امتحان کن.
```

When the sender hits the limit:

- Do not create a new invitation.
- Do not modify existing invitations.
- Return to the previous source after acknowledgement:
  - active room if inviting from discussion
  - saved profiles if inviting from saved profile

Implementation note:

- Query `DiscussionInvitation` by `inviterUserId` and `createdAt >= now - 24h`.
- This is simpler and safer than storing a denormalized counter on `User` for MVP.
- Keep the limit definition centralized, for example in `src/constants/limits.js` or `src/services/user-limits.js`.
- Invitation code should read the global sender limit/window from the Mongo-backed operational limits service used by the admin dashboard.
- The sending limit applies equally regardless of Star balance or purchases. Stars must not buy a spam allowance.
- The separate Star invitation-earning cap/window belongs to Star economy settings and controls rewards only; it does not increase how many invitations can be sent.

### Invitation Mutes

Invitation mutes let an invitee stop future invitations from one inviter.

Entry point:

- Only show the mute action on an inviter profile opened from the invitations list.
- Do not show it on normal saved-profile or discussion-member profile views.

Behavior:

- The invitee taps `Don't receive invites from this user`.
- The bot creates a mute pair: `muterUserId` and `mutedUserId`.
- Existing pending invitations from that inviter to that invitee are marked removed.
- Future stored invitation attempts from that inviter to that invitee fail.
- Sender-facing copy stays vague: `This profile can't receive invitations from you.`
- Do not notify the muted inviter.
- Do not remove either user's saved profiles.

Discussion privacy rule:

- A muted user cannot join future discussions created by the user who muted them.
- This applies only when joining a discussion where the muter is the creator.
- It should fail with generic unavailable copy, not with "you were muted".
- It should not remove the muted user from rooms they already joined before the mute.

Suggested model:

```js
{
  muterUserId: Number,
  mutedUserId: Number,
  sourceInvitationId: ObjectId,
  createdAt: Date
}
```

Unique index:

- `{ muterUserId: 1, mutedUserId: 1 }`

### Blocking And Reports

No user-level block model exists in the current repo.

For MVP:

- Respect discussion removed-user checks.
- Keep report/remove moderation inside discussions.

Future:

- If user blocking is added, prevent invitations from blocked users.

### Sender Deletes Saved Profile After Inviting

Invitation remains pending.

Reason:

- Removing a saved profile is local/private.
- The invite was already sent.

### Recipient Removes Invitation

Mark invitation removed/dismissed for that recipient.

Do not notify inviter.

### Sender Wants To Cancel Sent Invite

Not in MVP.

Reason:

- Keeps UI simple.
- Invitee can ignore/remove.
- Join rules still apply.

Future:

- Add sent invitations management.

## Data Model Recommendation

Use a separate `DiscussionInvitation` model rather than embedding invites on `User`.

Stars add separate transaction/referral records; do not overload the invitation document as a wallet ledger. The existing `inviterUserId` already attributes stored in-bot invitations. Outside shareable invitations need a separate opaque attribution record because their recipient is not known when the link is created. See [Stars Economy](stars.md).

Reason:

- Invitations have lifecycle and timestamps.
- Counts and duplicate checks are cleaner.
- Avoids unbounded growth in the user document.
- Easier to index recipient/status and discussion/recipient uniqueness.

Suggested fields:

```js
{
  publicInvitationCode: String,
  discussionId: ObjectId,
  discussionPublicCode: String,
  inviterUserId: Number,
  inviteeUserId: Number,
  inviteePublicProfileCode: String,
  status: "pending" | "accepted" | "removed" | "expired",
  source: "room" | "saved_profile",
  createdAt: Date,
  acceptedAt: Date,
  removedAt: Date,
  expiredAt: Date,
  seenAt: Date,
  lastOpenedAt: Date
}
```

Indexes:

- unique non-empty `publicInvitationCode`
- `{ inviteeUserId: 1, status: 1, createdAt: -1 }`
- unique pending duplicate guard on `{ inviteeUserId, discussionId, status: pending }`
- `{ inviterUserId: 1, createdAt: -1 }` if sent-invite management is added later

For Mongo partial unique index:

- unique on `{ inviteeUserId: 1, discussionId: 1, status: 1 }`
- partial filter: `{ status: "pending" }`

## Service Boundaries

Recommended new modules:

- `src/models/discussion-invitation.js`
- `src/services/discussion-invitations.js`
- `src/services/discussion-invitations-ui.js`
- `src/flows/discussion-invitations.js`

Responsibilities:

### `src/models/discussion-invitation.js`

- Mongoose schema and indexes.

### `src/services/discussion-invitations.js`

- Create invitation.
- Block duplicate pending invites.
- Count all pending received invites.
- List received invites.
- Mark accepted/removed/expired/seen.
- Resolve invitation public code.
- Validate inviter can send invite.
- Validate invitee can accept invite by delegating to discussion join services where possible.

### `src/services/discussion-invitations-ui.js`

- Render invitations list.
- Render invite sent acknowledgement text.
- Render empty state.
- Render locked/stale/full states.
- Render discussion picker for inviting from saved profile.
- Render saved-profile invite target picker.

### `src/flows/discussion-invitations.js`

- Callback routing for invitation inbox.
- Text commands:
  - `/iv_CODE`
  - `/accept_inv_CODE`
  - `/remove_inv_CODE`
- Active-room invite mode callbacks.
- Return destination handling:
  - room
  - saved profiles
  - invitations list
  - discussions menu

Keep `src/bot.js` and `src/callbacks.js` as dispatchers only.

## Callback And Command Naming

Suggested callback prefixes:

```js
discussionInvitations: "discussion:invitations",
discussionInvitationAccept: "discussion:invitation:accept:",
discussionInvitationRemove: "discussion:invitation:remove:",
discussionInviteMode: "discussion:invite:mode:",
discussionInviteSavedPicker: "discussion:invite:saved-picker:",
discussionInviteSavedTarget: "discussion:invite:saved-target:",
discussionInviteDiscussionPicker: "discussion:invite:discussion-picker:",
discussionInviteDiscussionTarget: "discussion:invite:discussion-target:",
discussionInvitationAck: "discussion:invitation:ack:",
```

Suggested text commands:

```text
/iv_PROFILECODE
/accept_inv_INVITECODE
/remove_inv_INVITECODE
```

Use stable public codes, not indexes.

## UI And Cleanup Rules

- Do not delete user messages.
- Delete or edit stale invite picker cards after selection.
- If a picker contains paginated indexes, remove/edit it after a mutating action.
- After `Invitation sent`, use one `Got it` button.
- `Got it` should return to the correct source:
  - active-room invite flow returns to room
  - saved-profile invite flow returns to saved profiles
  - invitations accept error returns to invitations list
- If a user navigates to main menu, clear temporary invite picker cards where possible.
- Do not send multiple explanatory messages for one invite action.
- Use callback notifications for repeated taps or no-op actions.

## Menu Count Strategy

Counting invitations on every main/discussion menu render may require a database query.

Recommended MVP:

- Count when rendering discussions menu.
- Optionally count when rendering main menu if the main-menu button includes invitations.
- Do not store denormalized count on user unless performance requires it.

If denormalized later:

- Maintain `pendingInvitationCount` on `User`.
- Update atomically when create/remove/accept/expire happens.
- Reconcile periodically or on inbox open.

## Copy Drafts

English:

```text
📨 Invitations
```

```text
🤖 No invitations right now.
```

```text
✅ Invitation sent to {name}.
```

```text
🤖 Invitation already sent.
```

```text
🤖 This invitation is no longer available.
```

```text
🤖 This profile can't receive invitations from you.
```

```text
🤖 You won't receive discussion invitations from this user anymore.
```

```text
🤖 You need to join or create an open discussion before inviting someone.
```

Persian:

```text
📨 دعوت‌ها
```

```text
🤖 فعلا دعوتی نداری.
```

```text
✅ دعوت برای {name} ارسال شد.
```

```text
🤖 این دعوت قبلا ارسال شده.
```

```text
🤖 این دعوت دیگه در دسترس نیست.
```

```text
🤖 این پروفایل نمی‌تونه از تو دعوت دریافت کنه.
```

```text
🤖 دیگه دعوتی از این کاربر دریافت نمی‌کنی.
```

```text
🤖 برای دعوت کردن، باید عضو یک بحث باز باشی یا یک بحث بسازی.
```

## Testing Checklist

Stars-specific invitation tests are required in addition to the existing checklist:

- [ ] Sending, opening, or viewing an invitation does not award Stars.
- [ ] Stored invitation reward occurs only after successful acceptance/join.
- [ ] A-to-B awards at most once across different discussions and repeated joins.
- [ ] B-to-A can independently award once.
- [ ] Simultaneous/repeated accept callbacks create one membership result and one reward.
- [ ] Bot starter and boost recommendation sources never reward inviters.
- [ ] Invitation Star earning cap/window is enforced atomically.
- [ ] Attributable outside links do not expose raw IDs.
- [ ] Repeated `/start`, language selection retries, cleared chat, old accounts, and self-referrals cannot duplicate/steal referral attribution.
- [ ] One new invitee qualifies at most one outside inviter after the configured milestone.
- [ ] Legacy public discussion links continue to preview and join without attribution rewards.

Service tests:

- Member can invite saved profile to open discussion.
- Non-member cannot invite to discussion.
- Non-owner member can invite.
- Owner can invite.
- Closed discussion cannot receive new invitations.
- Duplicate pending invite is blocked.
- Removed invitee cannot be invited or cannot accept, depending selected rule.
- Target must be in inviter's saved profiles.
- Self-invite is rejected.
- Pending invitation count includes all pending invitations, including bot starter invitations.
- Opening the invitation list marks displayed invitations seen after rendering.
- Seen invitations stay listed with a seen marker.
- Mute inviter hides existing pending invites from that inviter.
- Muted inviter cannot create future stored invites for that invitee.
- Muted user cannot join discussions created by the muter.
- Removing invitation excludes it from count.
- Accepting invitation marks accepted only after successful join.
- Failed join keeps invitation pending unless stale/blocked reason should expire it.

Flow tests:

- Active discussion `📨 دعوت` opens invite mode menu.
- Shareable invite path still works.
- Invite saved profile path returns to room after `Got it`.
- No saved profiles state offers shareable invite and back to room.
- Saved profile `/iv_CODE` opens discussion picker.
- No eligible discussions state offers browse/create/back.
- Invite sent from saved profile returns to saved profiles after `Got it`.
- Invitations list renders pending invites with stable actions.
- Accept invite succeeds and opens room.
- Remove invite removes it and refreshes list.
- Locked invite shows missing join requirement.
- Full discussion invite shows full state.
- Closed/missing discussion invite shows unavailable state.
- Already-member invite opens/refocuses room without duplicate membership.
- Active-in-another-room failure returns to invitations list after acknowledgement.

Integration tests:

- Create users A and B.
- A saves B.
- A joins discussion D.
- A invites B to D.
- B sees `Invitations (1)`.
- B accepts and becomes member of D.
- Invitation is accepted and count becomes zero.
- B can still see D as a recent accepted shortcut in invitations until B removes it.
- Normal join notifications fire.

Translation validation:

- Run `npm.cmd run validate:translations` after adding message keys.

Behavior tests:

- Run `npm.cmd test`.
- Run `npm.cmd run test:integration` if discussion invitation acceptance mutates discussion membership.

## Open Product Decisions Before Implementation

1. Should `Invitations (N)` live in the main menu, discussions menu, or both?
2. Should the active discussion `📨 دعوت` first show a mode menu, or should it default to saved-profile invites and include shareable invite as a secondary action?
3. Should pending invites expire automatically after 30 days?
4. Should full-room invites stay pending so invitees can retry later?
5. Should removed-user invite failures mark the invite expired/blocked immediately?
6. Should there be a sender daily invite limit in MVP?
7. Should invitee see inviter profile link by default?

Recommended MVP answers:

1. Discussions menu first.
2. Show mode menu to preserve current shareable invite behavior.
3. No automatic expiry in first implementation, but store timestamps.
4. Keep pending.
5. Mark stale/blocked after accept failure.
6. Yes. Use max 3 newly created stored invitations per sender per rolling 24 hours.
7. Yes, show inviter profile link using public profile code.
