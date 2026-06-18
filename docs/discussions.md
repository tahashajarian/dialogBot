# Discussions

## Implementation Status

The MVP described here is implemented. The current code supports:

- discussion creation with title, optional description, capacity, and join-rule selection
- open, taste-label, and specific TopTen-item join rules
- active and owned discussion lists with pagination
- one active room per user; joining another room requires leaving the current room first
- live text delivery with last-10-message context and runtime-only native reply mapping
- shareable invite links with a revalidated preview before joining
- stored saved-profile invitations with an invitation inbox, daily invite limit, and inviter mute controls
- member lists, public-profile viewing, private saved profiles, and saved-profile discussion discovery
- member reporting, creation/message limits, and opt-in active-discussion profile visibility
- three bot-created starter rooms, marked only with `🤖`: one open room and two rooms gated by popular Interests TopTen items

Future ideas in this document are not implemented unless explicitly identified otherwise.

## Purpose

Discussions add a social layer to the bot without turning it into a generic matching or chat app. They let users talk around taste, lists, labels, and interests while keeping the existing bot identity centered on profiles, lists, Top 10, taste labels, and suggestions.

## MVP Concept

Discussions are live rooms with short memory.

- A discussion normally has a user-created title; the three starter rooms are bot-created.
- A discussion can have an optional short description.
- Users can be inside one discussion at a time.
- Discussion membership means current room presence. Leaving the room removes membership.
- Each discussion has an editable capacity from 2 to 20 current members.
- Messages are broadcast live to current room members.
- Each discussion keeps only the last 10 messages as recent context.
- When a user joins or rejoins, they see the last 10 messages, not full history.
- There is no seen count in MVP. Sender only gets a delivery confirmation.
- Three broad starter rooms are created idempotently at startup using the real bot account id returned by `getMe()`.
- Starter rooms have stable `botSeedKey` values. Their title and description are rendered in each viewer's selected language, while Persian and English users still join the same underlying room.
- Their English titles are `Free Discussion`, `Gaming Hangout`, and `Movie Chat`.
- `Free Discussion` is open to everyone. `Gaming Hangout` requires the user's `🧩 Interests` TopTen to include Gaming/Game or Persian equivalents such as `گیم`/`بازی`. `Movie Chat` requires the user's `🧩 Interests` TopTen to include Movies/Film or Persian equivalents such as `فیلم`.
- When starter rooms are pinned for new users, keep this seed order so the open `Free Discussion` room appears first.
- The item-gated starter rooms should use popular onboarding chips so new users can unlock at least one relevant room through the three-interest onboarding flow.
- Starter room cards should make the first social step obvious: the open room says to start there, unlocked gated rooms say which Interest unlocked them, and locked rooms say which Interest TopTen item to add.
- After joining a starter room, the room follow-up may include one short "say hi" style prompt tailored to that room. Avoid adding multiple quick replies or noisy onboarding controls.
- Bot-created rooms have no fake members or messages and show only a `🤖` marker beside their title.
- Bot-created rooms use the same capacity, join, full-room, and acknowledgment behavior as user-created rooms.
- **Smart pinning**: Bot-created discussions appear at the top of the active discussions list for users with fewer than 2 discussion memberships. Once a user joins 2 or more discussions, all discussions are sorted purely by activity (most recent first). This helps new users discover starter rooms while keeping the experience clean for active users.

## Non-Goals For MVP

- No direct messaging between users.
- No permanent full message archive.
- No seen/read receipts.
- No photos, stickers, files, or forwarded messages inside discussions.
- Voice messages and text messages are allowed.
- Links are not allowed in discussion messages.
- No AI-generated moderation or AI summaries.
- No age, city, gender, or profile-field-based join rules.
- No invite-only or private rooms yet. Shareable links and stored saved-profile invitations may exist, but they must not make a room private or bypass join rules.

## Identity And Profile Visibility

Discussion participation uses a lightweight public display identity:

- display name
- message text
- discussion membership while active

Profiles are public inside bot social surfaces for now. If a user clicks/taps another discussion member and chooses to view their profile, the viewer must first have a basic profile with at least a display name. If the viewer's profile is incomplete, show a profile completion gate that stores the intended profile code and redirects to it after completion.

**Profile viewing gate requirements**:
- Display name (required) - must have `profileName` or `firstName`; edited user names cannot contain emoji because emoji markers are reserved for bot-authored labels/messages.
- Age is optional and not required for viewing profiles

Active-discussion visibility remains a separate opt-in setting and must not expose a user's current active discussion unless enabled.

## Core User Flows

### Open Discussions

Entry point from main menu:

```text
💬 بحث‌ها
```

Discussion menu:

```text
💬 بحث‌ها

🟢 بحث‌های فعال
➕ ساخت بحث جدید
🗂 بحث‌های من
⬅️ برگشت
```

Show `🚪 خروج از بحث` only inside an active room's bottom controls, not in the general discussions menu.

Inside an active discussion, use bottom buttons for room actions.

Member buttons:

```text
👥 اعضا
📨 دعوت
🚪 خروج از بحث
```

Owner buttons:

```text
👥 اعضا
📨 دعوت
🚪 خروج از بحث
🔒 بستن بحث
```

Only the discussion owner can close a discussion. Regular members must not see the close button and cannot close the room through commands/callbacks.
The owner can leave their own discussion without closing it. The discussion stays open, the owner remains `creatorUserId`, and other members can continue talking. The owner can later find the discussion in `🗂 بحث‌های من`, rejoin it, or close it.
All current members can use `📨 دعوت` to open invite options for the active discussion. Members can create a shareable invite message or send a stored invitation to a saved profile. This is not a private-room feature; it only helps users bring others to the existing discussion preview.

There is no separate room-level discussion-menu/back button. `🚪 خروج از بحث` is the explicit way to leave the room; after leaving, the bot removes the room keyboard and shows the discussions menu.

Important distinction:

- successfully joining another discussion leaves the previous discussion
- leaving a discussion removes current membership
- if a user leaves the room view, they are no longer in that discussion

### Create Discussion

Flow:

1. Ask for title.
2. Ask who can join.
3. If the rule is taste label, show creator's existing labels and verify selection.
4. If the rule is specific interest/item, show/select one of creator's TopTen items and verify selection.
5. Ask for description last.
6. If the rule is open, require a description before preview.
7. If the rule is restricted, allow description to be skipped.
8. Show preview, then create and auto-join creator after confirm.

Before asking for the title, check if the user already has 3 active discussions they created. If they do, show an error message with a "Got it" acknowledgment button that returns to "My Discussions" list, where they can close an unwanted discussion before creating a new one.

Limits:

- Title: 80 characters.
- Description: 300 characters.
- Description is required for open discussions.
- Description is optional for restricted discussions.
- Max current members: editable per discussion, capped at 20.
- Creator must satisfy restricted join rules they create.

Title prompt:

```text
🤖 عنوان بحث رو بنویس.

مثلاً:
بهترین ریف تاریخ؟
فیلمی که همه اشتباه فهمیدن؟
کتابی که ذهنت رو عوض کرد؟
```

Title validation:

- required
- minimum 3 letters (rejects AI, Go, ش, شش, but allows iOS, Dune, شما)
- max 80 characters
- normalize repeated spaces
- reject links in title
- reject nonsense input: placeholders (test, asdf, تست, هیچی), Latin keyboard mash (qwerty, asdfg), Persian keyboard mash (سشبیل, شسیب), repeated characters (aaaa), long consonant-heavy chunks, long single Persian tokens with no spaces
- allow duplicate titles (discussions are not global channels with unique names)
- allow real short titles (Dune, Chess, شطرنج)

Description validation:

- minimum 3 letters (same as title)
- uses the same nonsense detection as title and TopTen input (shared `isLowQualityAiListItem` and `validateMinimumLength` from `src/services/ai-input-quality.js`)

Join rule prompt:

```text
چه کسانی بتونن وارد این بحث بشن؟
```

Buttons:

```text
🌍 آزاد
🏷 فقط یک برچسب خاص
📌 فقط یک علاقه/آیتم خاص
لغو ساخت بحث
```

Create/edit navigation rules:

- In create mode, title step shows only `لغو ساخت بحث`.
- In create mode after title, show `لغو ساخت بحث` plus a `⬅️ برگشت` button to the previous step where relevant.
- In edit-from-preview mode, cancel actions should use `لغو ویرایش` and return to preview (not cancel the whole draft).
- If user sends text while on inline-only pickers (for example join-rule picker), show a bot-authored "select an option" message and resend a fresh picker card.

Description is collected after the join rule is selected, so the bot can show the right description controls for open vs restricted discussions.
Creation prompts use inline controls only. Do not show bottom reply-keyboard buttons while collecting the title or description.

Description prompt:

```text
یه توضیح کوتاه هم می‌خوای اضافه کنی؟
```

Restricted discussion inline buttons:

```text
رد کردن
لغو ساخت بحث
```

Open discussion inline buttons:

```text
لغو ساخت بحث
```

The skip button is only valid while creating a restricted discussion. Open discussions must require a description before preview/creation because anyone can join and the room needs clear context.

If an open discussion has no description:

```text
برای بحث‌های عمومی، یه توضیح کوتاه لازمه تا بقیه بدونن موضوع دقیقاً چیه.
```

For open topics, selecting `🌍 آزاد` moves to the required description step. Restricted topics move to the optional description step after the restriction is fully selected.

Room capacity is editable from the preview step:

- allowed values: 2, 3, 4, 5, 10, 15, 20 current members
- default: 20 current members
- max: 20 current members
- creator counts as a member
- joining another discussion removes the user from the previous discussion

For restricted topics, show a preview before creating:

```text
🤖 این بحث ساخته بشه؟

💬 بهترین ریف تاریخ؟
توضیح: بحث درباره ریف‌های ماندگار

ورود: فقط 🤘 متال‌هدها
ظرفیت: ۲۰ نفر
```

Buttons:

```text
✅ ساخت بحث
✏️ ویرایش عنوان
📝 ویرایش توضیح
🔐 ویرایش شرط ورود
👥 تغییر ظرفیت
لغو ساخت بحث
```

Restricted-topic preview is useful because join rules are harder to change mentally after creation.
At preview step, the creator should be able to edit title, description, or join rule before final confirm.

Label-restricted discussions should use only the creator's existing labels, not the full system label catalog. This prevents random gatekeeping and keeps the room connected to the creator's actual taste.

Item-restricted discussions should use the creator's own TopTen items, especially from `🧩 علاقه‌مندی‌ها`, not arbitrary free text. This enables rooms like:

```text
فقط کسانی که شطرنج توی تاپ ۱۰ علاقه‌مندی‌هاشونه
فقط کسانی که کدنویسی توی تاپ ۱۰ علاقه‌مندی‌هاشونه
فقط کسانی که قهوه توی تاپ ۱۰ علاقه‌مندی‌هاشونه
```

Creator eligibility should be validated before creation confirm wherever possible:

- Taste-label rule: creator must already have an existing label in the chosen section.
- Top-10-item rule: creator must pick an existing item from their own Top 10.

This rule is more approachable than labels for many users because it gates by a concrete shared interest.

If creator has no labels:

```text
برای ساخت بحث مخصوص یک برچسب، اول باید حداقل یک برچسب سلیقه داشته باشی.
از بخش لیست‌ها، تاپ ۱۰ یک بخش رو کامل کن.
```

If creator has no TopTen items for item-restricted rooms:

```text
برای ساخت بحث مخصوص یک علاقه، اول باید تاپ ۱۰ علاقه‌مندی‌هات رو بسازی.
```

### Join Discussion

When user joins:

**Error handling:**
- When a user tries to join and fails (from discussion list or invitation link):
  1. Show the error message with a "Got it" / "فهمیدم" button
  2. Wait for the user to press the button
  3. Delete the error message and redirect to appropriate screen:
     - From discussion list → show the same list type (active/mine)
     - From saved-profile discussions → show that same saved user's discussions again
     - From invite (requirement/removed errors) → show main menu
     - From invite (other errors) → show discussions menu

- If they are already inside another discussion, reject the join and ask them to leave the current room first.
- If the new join fails, do not remove them from their current discussion.
- If the discussion has reached its configured capacity, do not allow joining.
- Add the user to current members.
- Set user's active discussion id.
- Show discussion info.
- Show last 10 messages.
- Explain that new text messages go to this discussion.

Example:

```text
💬 وارد بحث «بهترین ریف تاریخ؟» شدی.

🤖 آخرین پیام‌ها:
👤 علی: Master of Puppets هنوز بی‌رقیبه.
👤 سارا: من Painkiller رو می‌گم.

از الان هر پیامی بفرستی برای اعضای همین بحث ارسال میشه.
```

If there are no messages:

```text
هنوز پیامی توی این بحث نیست. شروعش کن 🙂
```

If discussion is full:

```text
🤖 ظرفیت این بحث تکمیل شده.

💡 می‌تونی یک بحث دیگه رو انتخاب کنی یا از بخش بحث‌ها، گفتگوی خودت رو بسازی.
```

Owner rejoin:

- The creator can always rejoin their own open discussion.
- The creator bypasses join-rule checks when rejoining because they already satisfied the rule at creation time.
- The creator also bypasses capacity on rejoin so they can moderate, invite, or close the room.
- Owner rejoin must not duplicate membership.

### Invite To Discussion

Invites make active discussions easier to grow without adding private chat or a people-discovery section.

Entry point:

- Inside an active discussion, the bottom button `📨 دعوت` opens invite options.
- Any current member can create a shareable invite message for the active discussion.
- Any current member can also send a stored invitation to one of their saved profiles, subject to stored-invitation rules in [Discussion Invitations](discussion-invitations.md).
- The user must still be a member at the moment they tap `📨 دعوت`; stale bottom keyboards must fail safely.
- The invite points to a discussion preview, not directly into the room.
- The invited user must still tap join and pass the normal join checks.
- If the user has no active discussion, show the discussions menu instead of generating an invite.

Invite flow:

1. Member taps `📨 دعوت` inside their active discussion.
2. Bot asks whether to invite a saved profile or create a shareable invite.
3. If the member chooses shareable invite, bot sends a ready-to-share message/card for that discussion.
4. User shares or forwards the invite outside the bot.
5. Recipient opens the bot through the invite/deep link or sends the invite command.
6. Bot shows a safe discussion preview.
7. Recipient can join only if the discussion is open, not full, not closed, and they satisfy the join rule.

First-time/deep-link handling:

- Shared invite text should include one clear join action.
- If `BOT_DEEP_LINK_BASE_URL`, `BOT_PUBLIC_URL`, or `BOT_USERNAME` is configured, use one public bot deep link.
- If no public bot link can be built, fall back to `/join_CODE`.
- Preferred public link payload is `start=join_CODE`, for example `https://ble.ir/@BOT_USERNAME?start=join_8K2P`.
- If the platform opens the bot through `/start join_CODE`, handle it as an invite preview.
- If the platform delivers a query-like startup command such as `/start?join_CODE`, handle it as an invite preview too.
- `/start d_CODE` may also resolve to the same invite preview for compatibility.
- If the same user later receives the same hidden start payload again from the platform Start button, treat it as normal `/start` so clearing chat history does not reopen an old invite. A new start invite code and explicit `/join_CODE` still open the preview.
- Starting from an invite should not auto-join the user. It should welcome them, then show the invite preview.
- If the user is already active in that exact discussion, the invite can re-focus the room and show the already-member message instead of the preview.
- If the user is inside another discussion, the invite join action should ask them to leave the current room first.
- If the invite join fails, keep the user in their current discussion.
- Invite start commands and `/join_CODE` should be handled before section-specific states, so links work even if the user is currently inside profile edit, AI lists, saved profiles, or another bot section.

Example ready-to-share copy:

```text
📨 دعوت به بحث

💬 «بهترین ریف تاریخ؟»

📄 بحث درباره ریف‌های ماندگار

🔐 شرط ورود:
🌍 آزاد

ورود به بحث 👈 https://ble.ir/@BOT_USERNAME?start=join_8K2P
```

For locked rooms, include the join condition:

```text
📨 دعوت به بحث

💬 «آلبوم‌های متال برای شروع»

🔐 شرط ورود:
🏷 موسیقی - 🤘 متال‌هد

ورود به بحث 👈 https://ble.ir/@BOT_USERNAME?start=join_9Q4M
```

Rules:

- Invites must not bypass taste-label or TopTen-item join rules.
- Invites must not bypass capacity, removed-user checks, or closed-room checks.
- Invites must not reveal private member details, full member lists, raw ids, Bale ids, phone numbers, or location.
- Invites should use the discussion public code, not the database id.
- Invite codes should be stable public discussion codes, not per-user tokens, for MVP.
- Invite links/messages can remain valid until the discussion is closed or unavailable.
- Old invite messages do not need to be deleted; every open/join attempt must re-read the discussion and revalidate current state.
- A user who opens an invite for their currently active discussion should see the already-member message instead of a generic preview.
- Existing members who use the invite while active elsewhere should be moved/re-focused to that discussion, matching normal `/d_CODE` behavior.
- Removed users can open the preview but must receive the same removed-user error if they try to join.
- Closed, missing, or expired discussions should show a clean unavailable state.
- If a recipient does not satisfy a restricted join rule, show a specific hint that names what is missing and where to update it, then return them to the main menu so they can update their profile/list data. Tell them they can retry the same invite/command after updating.
- Invite generation should be low-noise: send one ready-to-share message, not a chain of explanation messages.

Ready-to-share message rules:

- Keep the invite short enough to be forwarded cleanly.
- Include title and public join command/link.
- Include description only if present.
- Include join condition for restricted rooms.
- Do not include live member names.
- Do not include recent messages.
- Do not include "private", "friend", "DM", or connection-request wording.
- If a public deep link is available, do not include a second `/join_CODE` line in the shared copy. Keep the command only as fallback when no deep link can be built.

Opening an invite:

- `/join_CODE` or a deep-link equivalent should show the invite preview first.
- The preview should not join automatically, even for open rooms.
- The preview message should be safe for non-members.
- If the discussion is closed/missing/unavailable, show the unavailable state and return to the main menu.
- If the discussion exists but is full, show the full-room state and return to the discussions menu.
- If the viewer was removed by the owner, show the removed-user message and return to the main menu.
- If the viewer does not satisfy a join rule, show the specific locked hint and return to the main menu.

Join attempt validation order:

1. Resolve the public discussion code.
2. Verify the discussion exists and is open.
3. Load the current user.
4. Check whether the user was removed from the discussion.
5. Check whether the user is already a member.
6. Check discussion capacity.
7. Check the discussion join rule.
8. Atomically join the target discussion.
9. A user who is already active elsewhere must leave that discussion before joining from the invite.

This order keeps sensitive details quiet while still giving useful recovery messages. If a room is closed or missing, do not reveal whether the user would have satisfied its join rule.
It also keeps users from being ejected from their current room when a target join fails because of capacity, permissions, closure, or stale invite/list state.

Callback and stale-state behavior:

- Invite preview join buttons must encode only the public discussion code.
- When a user taps an old preview button, revalidate from the database before joining.
- If the preview is stale because the room became full, closed, or unavailable, edit/remove the stale preview when possible and show the current state.
- Repeated taps should use the centralized interaction guard and join should be idempotent for existing members.
- If editing the old preview fails, send a fresh bot message with the current state.

Invite preview:

- Show title.
- Show short description if present.
- Show current member count/capacity.
- Show join condition.
- Do not show the full member list.
- Do not show creator location or active discussion details.
- Use one inline join action when possible, plus Back.

Unavailable invite state:

```text
🤖 این بحث دیگه در دسترس نیست.
```

Full invite state:

```text
🤖 ظرفیت این بحث تکمیل شده.

💡 می‌تونی یک بحث دیگه رو انتخاب کنی یا از بخش بحث‌ها، گفتگوی خودت رو بسازی.
```

Already member state:

```text
🤖 تو همین الان عضو این بحثی.

از این به بعد پیام‌هات برای همین بحث ارسال میشه.
```

Locked invite state:

```text
🤖 برای ورود به این بحث، باید شرط ورودش رو داشته باشی.
```

Specific locked hints:

- Taste-label room: tell the user which section/label is required and guide them to complete that section's Top 10 so the label can be calculated.
- TopTen-item room: tell the user which section/item is required and guide them to add that item to the relevant Top 10 list.
- After the hint, show the main menu reply keyboard.
- Tell the user they can use the same invite link/command again or find the discussion again from `🟢 بحث‌های فعال`.

Taste-label example:

```text
🤖 برای ورود به این بحث باید این برچسب رو داشته باشی:
🏷 موسیقی - 🤘 متال‌هد

💡 اول تاپ ۱۰ موسیقی‌ات رو کامل کن تا برچسبت حساب بشه.
بعدش می‌تونی همین لینک دعوت رو دوباره امتحان کنی.

از منوی اصلی برو به بخش لیست‌ها.
```

TopTen-item example:

```text
🤖 برای ورود به این بحث باید این مورد توی تاپ ۱۰ت باشه:
🏆 🧩 علاقه‌مندی‌ها - شطرنج

💡 اول این مورد رو به تاپ ۱۰ علاقه‌مندی‌هات اضافه کن.
بعدش می‌تونی همین لینک دعوت رو دوباره امتحان کنی.

از منوی اصلی برو به بخش لیست‌ها.
```

No active discussion state:

```text
🤖 الان داخل هیچ بحث فعالی نیستی.

از بخش بحث‌ها وارد یک گفتگو شو، بعد می‌تونی دعوت بسازی.
```

No longer a member state:

```text
🤖 دیگه عضو این بحث نیستی، برای همین نمی‌تونم دعوت بسازم.
```

Invite abuse and rate limits:

- Stored invitation inbox counts should show unseen pending invitations; seen invitations stay in the list until the invited user accepts, removes them, or the target discussion becomes unavailable.
- Apply the existing repeated-tap guard to the `📨 دعوت` bottom button.
- Public share-link generation can add a lightweight per-user cooldown later, for example one invite message per discussion per minute.
- Do not notify the discussion owner when someone generates or uses an invite.
- Do not broadcast invite generation inside the room.
- Joining from an invite should use the same join notification rules as normal joining.

Implementation test checklist:

- Member can generate an invite for their active discussion.
- Non-member/stale active state cannot generate an invite.
- `/join_CODE` shows preview before joining.
- Open invite join succeeds when room is available.
- Restricted invite join succeeds only when user satisfies the rule.
- Invite join failures use two-step acknowledgment:
  1. Show error message with "Got it" / "فهمیدم" button
  2. After user presses button, redirect to main menu (for requirement/removed errors) or discussions menu (for other errors)
- Restricted invite join failure gives a specific hint about what's missing and where to update it.
- Closed/missing discussion invite shows unavailable message.
- Full discussion invite shows capacity reached message.
- Removed user cannot rejoin through an invite.
- An existing active member using an invite re-focuses the same discussion without duplicate membership.
- Old preview button revalidates current state before joining.

Future possibilities:

- Owner-only invites if spam becomes a problem.
- Expiring invite links.
- Invite usage counters.
- Admin controls for disabling invites on a room.
- Optional per-room invite settings if invite abuse becomes a problem.

### My Discussions / Switching

`🗂 بحث‌های من` shows discussions the user owns or has joined.
Discussion lists should be plain text with bot-command links instead of dense inline button rows.
Long discussion lists should be paginated, with an inline back button below the text list. Active-discussion lists should also include an inline toggle for showing only discussions the user can currently join.
For this toggle, keep the icon stable across states and change only the text label.

Example:

```text
🗂 بحث‌های من

✅ بهترین ریف تاریخ؟
👥 ۳ نفر
آخرین فعالیت: ۵ دقیقه پیش
ورود 👈 /d_8K2P
خروج 👈 /leave_8K2P

💬 فیلمی که همه اشتباه فهمیدن؟
👥 ۱۲ نفر
آخرین فعالیت: امروز
ورود 👈 /d_9Q4M
بستن 👈 /close_9Q4M
```

Commands per discussion:

```text
ورود 👈 /d_CODE
خروج 👈 /leave_CODE
```

If owner:

```text
ورود 👈 /d_CODE
بستن 👈 /close_CODE
```

Owners should see both rejoin/open and close actions for discussions they created.

Opening a discussion from this list joins/rejoins it, sets it as `activeDiscussionId`, and shows the room info plus last 10 messages.

Leaving a discussion from this list removes membership. If it was the active discussion, clear `activeDiscussionId`.
For owner-created discussions, this list should offer rejoin/open and close. Owners can close their created discussions even when they are not currently members.

### Send Message

When a user with an active discussion sends normal text:

- Validate text.
- Add it to the discussion's recent messages.
- Keep only the last 10 messages.
- Broadcast it to current members except sender.
- Do not send a per-message delivery confirmation to the sender; it makes the chat noisy.

If there are no other current members, still store the message silently so it appears in recent messages for future members.

Do not say "seen" or "read" unless the platform later provides reliable read receipts.

### Receive Message

Other members receive:

```text
💬 بهترین ریف تاریخ؟
👤 علی:
Master of Puppets هنوز بی‌رقیبه.
```

Do not attach profile buttons to every received message. That makes the chat noisy and uncomfortable.

Profile viewing should be intentional through the members list.

### Members List And Profile Links

Inside an active discussion, the bottom button `👥 اعضا` shows the current room members.

Example:

```text
🤖👥 اعضای این بحث

1. 👤 علی — ⭐ میزبان
دیدن پروفایل 👈 /u_8K2P
گزارش 👈 /report_8K2P

────────

2. 👤 سارا
دیدن پروفایل 👈 /u_9Q4M
گزارش 👈 /report_9Q4M

────────

3. 👤 تو
```

The profile code acts like a bot command/link. When the user sends or taps `/u_8K2P`, the bot resolves it to that member.

Rules:

- Do not expose raw database ids, Bale user ids, phone numbers, or location.
- Use a stable short public profile code such as `publicProfileCode`.
- Public profile codes reveal the matching profile.
- The member list can show all members because room capacity is capped at 20.
- The current user can be shown as `تو` without a profile link.
- Mark the discussion host clearly with `⭐ میزبان`.
- Do not show a separate active/presence marker. If a user is in the member list, they are currently in the discussion.
- Member lists should be plain text command links, not inline button rows.
- Profile/report/remove actions should be shown with labels and pointer emojis on separate lines (e.g., `👁 View profile 👈 /u_CODE`, `🚩 Report 👈 /report_CODE`, `🗑 Remove 👈 /remove_CODE`).
- Separate member blocks with a simple line divider when multiple members are shown.
- Users stay inside the discussion after viewing the member list; no back button is needed on the member list.
- Keep the member list low-noise: remember the latest member-list bot message and remove it when the user opens the member list again, opens a profile from that list, leaves the discussion, or the discussion closes.
- Profiles opened from the members list are transient public-profile cards. Do not attach an extra "Got it" inline button to those profile cards; clear the previous viewed profile card when the user navigates onward or opens another profile.

Private profile response:

```text
🤖 این کاربر پروفایلش رو خصوصی نگه داشته.
```

This keeps discussion messages clean while still making profile discovery possible.

### Owner Member Management

The owner can remove members from their own discussion.

In the owner view of `👥 اعضا`, show owner-only remove links/actions under non-owner members:

```text
🤖👥 اعضای این بحث

1. 👤 علی — ⭐ میزبان

2. 👤 سارا
دیدن پروفایل 👈 /u_9Q4M
گزارش 👈 /report_9Q4M
حذف 👈 /remove_9Q4M

────────

3. 👤 رضا
دیدن پروفایل 👈 /u_7N1A
گزارش 👈 /report_7N1A
حذف 👈 /remove_7N1A
```

Rules:

- Only the owner sees remove actions.
- Owner cannot remove themselves; they can leave or close the discussion.
- Members do not see remove actions.
- Every user can report another member from the member list.
- A removed member is removed from `memberIds`, added to `removedUserIds`, and removed from their discussion memberships.
- **Removed users cannot rejoin**: If a user who was previously removed by the owner tries to join the discussion again, they will receive an error message.
- Removed users will not see the discussion in their "My Discussions" list anymore.
- **Removed users see discussions but can't join**: Discussions where a user has been removed appear in the regular "Active Discussions" list, but are filtered out when "Show only joinable discussions" is enabled.
- If a removed user somehow attempts to join (e.g., via a saved link or command), they get both:
  - A toast notification at the top: `میزبان بحث قبلاً تو رو از این بحث حذف کرده.`
  - A regular message: `🤖 میزبان بحث قبلاً تو رو از این بحث حذف کرده.`
- If the removed member's `activeDiscussionId` is this discussion, clear it, remove their room bottom keyboard, send a bot-message explaining they were removed, and show the discussions menu.
- If the removed member is not currently in this discussion, remove membership quietly without notifying them.
- Do not expose raw ids in remove links; use the same safe public/member code style.

Remove confirmation for owner:

```text
🤖 عضو از بحث حذف شد.
```

Removed member notification:

```text
🤖 از بحث «بهترین ریف تاریخ؟» توسط میزبان حذف شدی.
```

If a non-owner somehow triggers remove:

```text
🤖 فقط میزبان بحث می‌تونه اعضا رو حذف کنه.
```

Report confirmation:

```text
🤖 گزارشت ثبت شد. فعالیت این کاربر بررسی میشه.
```

Reports should store enough data for later review:

- discussion id
- reporter user id
- reported/target user id
- report status
- created time

### Leave Discussion

Member leaving:

- Remove user from members.
- Clear user's active discussion id.
- Remove the discussion from the user's memberships.

Response:

```text
🤖 از بحث «بهترین ریف تاریخ؟» خارج شدی.
```

After this response, remove the room bottom keyboard and show the discussions menu.

Owners can leave their own active/open discussion. This removes them from current members and clears their `activeDiscussionId`, but does not close the discussion or change `creatorUserId`.

Joining another discussion leaves the old one after the new join succeeds. If the new join fails, the user stays in the old discussion.

### Close Discussion

Only the owner can close a discussion.

Closing behavior:

- Set discussion status to closed.
- Notify all current members except the owner.
- Remove the discussion from active listings.
- Remove the discussion from all member discussion memberships.
- Clear `activeDiscussionId` for any current member of that discussion.
- Do not allow new messages or joins.
- For MVP, closed discussions are not reopened.

Owner response:

```text
🤖 بحث «بهترین ریف تاریخ؟» بسته شد.
```

After this response, remove the room bottom keyboard and show the discussions menu.

Member notification:

```text
🤖 میزبان بحث، این گفتگو رو بست.

💬 «بهترین ریف تاریخ؟»

می‌تونی از بخش بحث‌ها وارد گفتگوی دیگه‌ای بشی.
```

After close, the room should not appear in `🟢 بحث‌های فعال` or `🗂 بحث‌های من`.

## Notifications

Notifications should be useful but quiet.

## Join/Leave/Remove/Close Notifications

**Who gets notified:**
- Only current members of that specific discussion
- The person performing the action (joiner/leaver/owner) does NOT receive the notification
- Members in other menus or other discussions do NOT receive notifications

**Join notification:**

```text
🤖 «سارا» وارد بحث شد.
```

**Leave notification:**

```text
🤖 «سارا» از بحث خارج شد.
```

**Remove notification (to removed member):**

```text
🤖 از بحث «بهترین ریف تاریخ؟» توسط میزبان حذف شدی.
```

**Remove notification (to other current members):**

```text
🤖 «سارا» از بحث توسط میزبان حذف شد.
```

**Close notification (to current members):**

```text
🤖 بحث توسط میزبان بسته شد.
```

**Format rules:**
- All notifications use bot emoji 🤖 (not door 🚪)
- Member names appear in quotes/guillemets: «name»
- Notifications are sent only to members actively viewing that discussion at the moment

Anti-noise rules:

- If multiple users join close together, batch or throttle notifications when possible.
- Suggested throttle: at most 1 join notification per discussion per 10 minutes.
- If throttled, the next notification can summarize:

```text
🤖 چند نفر جدید وارد بحثت شدن.

💬 بهترین ریف تاریخ؟
👥 الان ۶ نفر داخل بحثن.
```

Message notifications are not in MVP. They can be added later with careful rules such as mentions, quiet-period summaries, or explicit room subscriptions.

## Join Rules

MVP supports only these user-facing creation rules:

### Open

Any user can join, unless the discussion has a stricter join rule.

### Taste Label

User must have a specific taste label in a selected section.

Example:

```text
فقط 🤘 متال‌هدها
```

The creator must satisfy the restriction they create.

If the creator has no eligible taste label for the selected section during rule selection, show a bot message with the exact section name and a tip to complete Top 10 in that section first.

### Specific TopTen Item / Interest

User must have a specific item in their TopTen for a selected section.

This is especially useful for `🧩 علاقه‌مندی‌ها`.

Example:

```text
فقط کسایی که شطرنج توی تاپ ۱۰ علاقه‌مندی‌هاشونه
```

Matching should use the same normalization/duplicate matching approach as list items, so small spelling differences do not block valid users.

The creator must have the item in their own TopTen before creating this kind of room.

If the creator has no TopTen items in the selected section during rule selection, show a bot message with the exact section name and a tip to add at least one TopTen item in that section first.

## Discussion Listing

Active discussion list should show both joinable and locked discussions.
Join-rule lines in list cards should use user-facing section names (for example `🧩 علاقه‌مندی‌ها`, not raw keys like `random`) and include a short join-condition header.
Recommended compact rule formatting:

- `🔐 شرط ورود:` / `🔐 Join condition:`
- Open rule: `🌍 ...`
- Taste-label rule: `🏷 {section} - {badge emoji} {badge title}`
- TopTen-item rule: `🏆 {section} - {item}`

Joinable example:

```text
✅ بهترین ریف تاریخ؟
👥 ۵ نفر داخل بحث
🔓 ورود آزاده
```

Locked example:

```text
🔒 آلبوم‌های متال برای شروع
نیازمند: 🤘 متال‌هد
```

Locked discussions can motivate users to complete Top 10 and earn labels, but they must clearly explain why they are locked.

## Data Model Draft

### DiscussionTopic

- `title`
- `description`
- `creatorUserId`
- `status`: `open | closed`
- `joinRuleType`: `open | taste_label | top_ten_item`
- legacy-compatible `joinRuleType`: `top_ten_completed`
- `ruleSection`: `movies | music | books | random | ""`
- `requiredLabelKey`
- `requiredTopTenItem`
- `requiredTopTenItemNormalized`
- `memberIds`
- `maxMembers`, allowed values: 1, 2, 3, 4, 5, 10, 15, 20
- `recentMessages`
- `replyCount`
- `createdAt`
- `updatedAt`
- `lastActivityAt`

### Recent Message

Stored inside `recentMessages`, capped at 10:

- `senderUserId`
- `senderDisplayName`
- `text`
- `createdAt`

### User Additions

- `activeDiscussionId`
- `ownedOpenDiscussionIds`, capped at 3 and used as an atomic reservation list for the active owned discussion limit
- `discussionMembershipIds`, capped at 10 in MVP
- optional muted discussion ids/preferences
- optional discussion rate-limit metadata

## Rate Limits

MVP should include basic limits:

- Max 3 active (open) discussions per user at any time.
- Max 30 discussion messages per user per 10 minutes.
- Max title length: 80.
- Max description length: 300.
- Max message length: 500.
- Max current members per discussion: 20.

Implementation rules:

- Message quota checks should be atomic within the current time window so fast repeated sends cannot bypass the limit.
- Recent-message appends should be atomic and capped to the last 10 messages so concurrent sends do not overwrite each other.
- Join capacity checks should be part of the join mutation so concurrent joins cannot exceed the configured room capacity.

The 3 active discussions limit applies to all users without exception, including test accounts. This prevents users from accumulating too many open discussions.

## Moderation

MVP minimum:

- Creator can close their discussion.
- Closing is owner-only and should be available from the owner's active-discussion bottom button.
- If a non-owner somehow triggers a close action, reject it safely with a short permission message.
- Closed discussions cannot receive new messages.
- Owner can leave their own open discussion without closing it.
- Closing removes the discussion from active listings and member memberships.
- Closing should notify current members that the discussion was closed.
- Text and voice messages only; no photos, stickers, files, or forwarded messages.
- Links are not allowed in any discussion messages.
- Profile viewing is public inside bot social surfaces.

Future:

- Reopen closed discussion.
- Report message.
- Admin review tools for existing member reports.
- Admin close/hide tools.
- Basic blocked-word filter.

## Display Name

Use:

1. `profileName`
2. `firstName`
3. fallback user label such as `کاربر`

Do not expose:

- phone number
- raw user id
- location
- sensitive profile fields

## Delivery And Room Messaging

MVP message behavior:

- If a user has `activeDiscussionId` set, normal text messages should be sent to that active discussion.
- Sending text should append to `recentMessages` (capped to last 10) and be broadcast to current members.
- If the message replies to a previous bot-delivered discussion message, forward it as a platform-native reply when the runtime delivery map can resolve the matching message id in each member's chat. Do not add "replying to..." text and do not persist reply metadata in `recentMessages`.
- Sender should receive a short delivery confirmation.
- Text and voice messages are supported (no photos/stickers/files/forwards).
- Links are blocked in all discussion messages to prevent spam and phishing.
- Accept at most one discussion message per user per second. Reject faster messages before storage or broadcast with a short localized slow-down notice.
- Keep the broader limit of 30 accepted discussion messages per user within 10 minutes.
- When an active-room user sends unsupported content (photos, stickers, files, forwards), do not forward or store it. Reply directly to that unsupported message with a short localized `🤖` notice explaining that discussions currently support text and voice only; fall back to a normal message if native reply metadata is rejected.
- When a user sends a message containing links, reject it immediately with a localized `🤖` notice that links are not allowed in discussions.
- Keep this unsupported-content notice separate from valid-text delivery failures; a failed text send should ask the user to reopen the discussion and retry.

## Member/Profile Viewing

MVP should allow users to identify who sent a message by display name and view profiles through the members list.

Profile-view interaction:

1. User presses `👥 اعضا`.
2. Bot sends a member list with display names and public profile codes.
3. User taps/sends a profile code.
3. Bot shows the target user's profile.

Bale may not support clickable names in plain bot text, so public profile codes are preferred over inline buttons under every message.
Implementation note: member lists can include `/u_CODE` buttons and still support manual typed `/u_CODE` lookup.

## Saved Profiles And Discussion Discovery

Saved profiles are a lightweight social layer connected to discussion profile viewing.

They should have a main-menu entry once discussion profile viewing exists:

```text
⭐ پروفایل‌های ذخیره‌شده
```

Recommended behavior:

- A user can save a profile privately.
- Saving is one-way; the saved user is not notified.
- Saved profiles are not friendships and do not open private chat.
- Users can remove saved profiles.
- Saved profiles are mainly created after viewing someone through discussions/member lists.
- Cap saved profiles to keep the feature manageable.

Recommended MVP limit:

- max saved profiles per user: 50

When viewing another user's profile from a discussion, show:

```text
🤖 ⭐ ذخیره پروفایل 👈 /save_8K2P
```

If already saved:

```text
🤖 ⭐ ذخیره‌شده
```

Do not show inline save/remove buttons on public profile views.

Saved profiles main menu:

```text
⭐ پروفایل‌های ذخیره‌شده

1. 👤 علی
دیدن پروفایل این کاربر 👈 /u_8K2P
💬 دیدن بحث‌های این کاربر 👈 /discussions_8K2P
📨 دعوت این کاربر به بحث 👈 /invite_8K2P
حذف از ذخیره‌شده‌ها 👈 /unsave_8K2P

2. 👤 سارا
دیدن پروفایل این کاربر 👈 /u_9Q4M
💬 دیدن بحث‌های این کاربر 👈 /discussions_9Q4M
📨 دعوت این کاربر به بحث 👈 /invite_9Q4M
حذف از ذخیره‌شده‌ها 👈 /unsave_9Q4M
```

Saved-profile lists should use text command links for view/discussions/remove actions, not per-profile inline buttons.
The saved-profile list can use inline list-navigation controls (pagination + Back) only.
When opening a profile from the saved list, delete the list message when possible and show the profile with only one inline Back button to return to the saved-profile list. The Back button should still appear if deleting the stale list message fails.

### Viewing Discussions From Saved Profiles

Users can view discussions of people in their saved profiles list via `/discussions_CODE` command.

The discussions view shows:
- Title with user's name: `💬 بحث‌های {name}`
- Active discussion (if `showActiveDiscussionOnProfile` is enabled)
- Created discussions (up to 10, open status only)
- Empty state with "Got it" button if no discussions
- Back button to return to saved profiles list

Empty state example:

```text
🤖 علی هیچ بحثی نداره.

[درست] (inline button → returns to saved profiles)
```

Discussions list example:

```text
💬 بحث‌های علی

📌 بحث فعال
1. بهترین ریف تاریخ؟
   توضیحات: گیتار رو...
   🌍 آزاد ✅ | 5 نفر
   ورود 👈 /d_XY2Z

📌 بحث‌های ساخته‌شده
1. آلبوم‌های متال برای شروع
   توضیحات: دوست دارم...
   🏷 متال‌هد 🔒 | 3 نفر
   ورود 👈 /d_AB3C

[⬅️ برگشت به ذخیره‌شده‌ها] (inline button)
```

Technical notes:
- Query discussions by `creatorUserId` field (not `ownerId`)
- Active discussion only shows if `showActiveDiscussionOnProfile: true`
- Discussions are formatted using `buildDiscussionListText` for consistency
- Empty state uses acknowledgment button (`saved:back` callback)
- Non-empty lists use regular back button (`savedProfiles` callback)
- If joining one of these discussions fails, the "Got it" acknowledgment must return to this saved user's discussions, not the generic active-discussions list.

Rules:

- Do not notify someone when their profile is saved or removed.
- Do not expose raw user ids.
- Use public profile codes for lookup/display.
- If a saved user's public code no longer resolves, show a not-found message and let the user remove it.
- Saved profiles should not show friendship status, online status, or private discussion membership.

Discussion discovery from another user's profile should be privacy-safe.

MVP-safe rule:

- Show discussions created by that user if the discussion is not closed.
- Do not show all discussions they joined.
- Do not show membership history.
- Do not show last seen or activity status.

Active discussion visibility should be opt-in only.

Setting:

```text
نمایش بحث‌های فعال: روشن/خاموش
```

Rules:

- Default: off.
- If off, profile viewers cannot see the user's active discussion.
- If on, profile viewers can see the user's current active discussion on their profile.
- If the viewer qualifies for the discussion's join rule, show a join action.
- If the viewer does not qualify, show the lock reason.
- Never reveal active discussion automatically without this setting.
- Store this as a user profile setting, e.g. `showActiveDiscussionOnProfile`, default `false`.
- The profile shows the current setting to its owner.
- Show this setting only to the profile owner, not to other users viewing the profile.

Example:

```text
💬 بحث فعلی علی:
بهترین ریف تاریخ؟

🔓 می‌تونی وارد بشی
```

Locked example:

```text
💬 بحث فعلی علی:
آلبوم‌های متال برای شروع

🔒 نیازمند: 🤘 متال‌هد
```

This keeps social discovery possible without turning profile viewing into presence tracking.

## Implemented Product Decisions

- Locked discussions are visible with clear lock reasons.
- Profiles are public inside bot social surfaces.
- The creator automatically joins after creating.
- Discussion rooms use a bottom keyboard for members, invites, leaving, and owner close controls.
- Open discussions do not require a completed Top 10.
- Completed-Top-10 rules are supported by the service layer but are not user-facing in the creation flow.
- Item-specific TopTen join rules are included in the MVP.

## Product Rule

Discussions are a social layer, not the whole bot.

The bot remains centered on:

- profile
- lists
- Top 10
- taste labels
- suggestions
- taste-based discussion rooms
