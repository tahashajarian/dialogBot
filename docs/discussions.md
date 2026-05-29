# Discussions Design

## Purpose

Discussions add a social layer to the bot without turning it into a generic matching or chat app. They let users talk around taste, lists, labels, and interests while keeping the existing bot identity centered on profiles, lists, Top 10, taste labels, and suggestions.

## MVP Concept

Discussions are live rooms with short memory.

- A discussion has a user-created title.
- A discussion can have an optional short description.
- Users can be in one active discussion at a time.
- Users can be members of multiple discussions, but only one discussion is active for sending messages.
- Each discussion has a maximum of 20 active members in MVP.
- Messages are broadcast live to current room members.
- Each discussion keeps only the last 10 messages as recent context.
- When a user joins or rejoins, they see the last 10 messages, not full history.
- There is no seen count in MVP. Sender only gets a delivery confirmation.

## Non-Goals For MVP

- No direct messaging between users.
- No permanent full message archive.
- No seen/read receipts.
- No photos, voice, stickers, files, or forwarded messages inside discussions.
- No AI-generated moderation or AI summaries.
- No age, city, gender, or profile-field-based join rules.
- No invite-only or private rooms yet.

## Identity And Profile Visibility

Creating or joining discussions does not require `profileDiscoverable = true`.

Discussion participation uses a lightweight public display identity:

- display name
- message text
- discussion membership while active

Profile discoverability controls profile viewing, not discussion participation.

If a user clicks/taps another discussion member and chooses to view their profile:

- if that member's profile is discoverable, show the profile
- if that member's profile is private, show a short private-profile message

This keeps discussions open and social while preserving the user's choice about profile visibility. The main use for discoverability is later people discovery/search, not basic room participation.

## Core User Flows

### Open Discussions

Entry point from main menu:

```text
💬 بحث‌ها
```

Discussion menu:

```text
💬 بحث‌ها

🔥 بحث‌های فعال
➕ ساخت بحث جدید
📌 بحث‌های من
🚪 خروج از بحث
⬅️ برگشت
```

Only show `🚪 خروج از بحث` when the user is currently inside a discussion.

Inside an active discussion, use bottom buttons for room actions.

Member buttons:

```text
👥 اعضا
📌 بحث‌های من
🚪 خروج از بحث
```

Owner buttons:

```text
👥 اعضا
📌 بحث‌های من
🔒 بستن بحث
```

Only the discussion owner can close a discussion. Regular members must not see the close button and cannot close the room through commands/callbacks.
The owner should not see `🚪 خروج از بحث` for their own discussion. To stop participating, the owner must close the discussion for everyone. This prevents orphaned ownerless rooms.

`📌 بحث‌های من` lets the user navigate to other discussions they own or have joined without leaving the current one.

Important distinction:

- switching active discussion changes where new text messages go
- leaving a discussion removes membership
- going back to other bot sections does not remove membership

### Create Discussion

Flow:

1. Ask for title.
2. Ask for description.
3. Ask who can join.
4. If the rule is open, create discussion and auto-join creator.
5. If the rule is completed Top 10, ask section, verify creator qualifies, show restricted-topic preview, then create and auto-join.
6. If the rule is taste label, show creator's existing labels, verify selection, show restricted-topic preview, then create and auto-join.
7. If the rule is specific interest/item, show/select one of creator's TopTen items, verify selection, show restricted-topic preview, then create and auto-join.

Limits:

- Title: 80 characters.
- Description: 300 characters.
- Description is required for open discussions.
- Description is optional for restricted discussions.
- Max active members: 20.
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
- max 80 characters
- normalize repeated spaces
- reject empty/meaningless titles
- avoid links in title for MVP

Description prompt:

```text
یه توضیح کوتاه هم می‌خوای اضافه کنی؟
```

Buttons:

```text
رد کردن
لغو ساخت بحث
```

The skip button is only valid while creating a restricted discussion. If the user later chooses `🌍 همه`, the bot must require a description before creating the discussion.

For open discussions, description is required because anyone can join and the room needs clear context.

If an open discussion has no description:

```text
برای بحث‌های عمومی، یه توضیح کوتاه لازمه تا بقیه بدونن موضوع دقیقاً چیه.
```

Join rule prompt:

```text
چه کسانی بتونن وارد این بحث بشن؟
```

Buttons:

```text
🌍 همه
🏆 فقط تاپ ۱۰ کامل
🏷 فقط یک برچسب خاص
🎯 فقط یک علاقه/آیتم خاص
لغو
```

For open topics, create immediately after rule selection only if description is filled. If description is empty, ask for it before creating.

Room capacity is fixed in MVP:

- default: 20 active members
- max: 20 active members
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
❌ لغو
```

Restricted-topic preview is useful because join rules are harder to change mentally after creation.

Label-restricted discussions should use only the creator's existing labels, not the full system label catalog. This prevents random gatekeeping and keeps the room connected to the creator's actual taste.

Item-restricted discussions should use the creator's own TopTen items, especially from `🧩 علاقه‌مندی‌ها`, not arbitrary free text. This enables rooms like:

```text
فقط کسانی که شطرنج توی تاپ ۱۰ علاقه‌مندی‌هاشونه
فقط کسانی که کدنویسی توی تاپ ۱۰ علاقه‌مندی‌هاشونه
فقط کسانی که قهوه توی تاپ ۱۰ علاقه‌مندی‌هاشونه
```

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

- If they are already active in another discussion, switch active discussion to the new one.
- Do not remove them from the old discussion unless they explicitly leave it.
- If they already belong to the maximum number of discussions, do not allow joining until they leave one.
- If the discussion already has 20 active members, do not allow joining.
- Add the user to current members.
- Set user's active discussion id.
- Show discussion info.
- Show last 10 messages.
- Explain that new text messages go to this discussion.

Example:

```text
💬 وارد بحث «بهترین ریف تاریخ؟» شدی.

آخرین پیام‌ها:
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
این بحث فعلاً پره.
ظرفیت: ۲۰ نفر
```

If user has reached membership limit:

```text
🤖 فعلاً عضو حداکثر تعداد بحث‌ها هستی.

برای ورود به بحث جدید، اول از یکی از بحث‌های قبلیت خارج شو.
```

Recommended MVP membership limit:

- max joined/owned discussions per user: 10
- this keeps navigation manageable and prevents users from quietly accumulating too many stale rooms

### My Discussions / Switching

`📌 بحث‌های من` shows discussions the user owns or has joined.

Example:

```text
📌 بحث‌های من

✅ بهترین ریف تاریخ؟
👥 ۳ نفر
آخرین فعالیت: ۵ دقیقه پیش

💬 فیلمی که همه اشتباه فهمیدن؟
👥 ۱۲ نفر
آخرین فعالیت: امروز
```

Buttons per discussion:

```text
ورود
خروج
```

If owner:

```text
ورود
بستن
```

Owners should see `بستن`, not `خروج`, for discussions they created.

Opening a discussion from this list sets it as `activeDiscussionId` and shows the room info plus last 10 messages.

Leaving a discussion from this list removes membership. If it was the active discussion, clear `activeDiscussionId`.
For owner-created discussions, this list should offer close instead of leave.

### Send Message

When a user with an active discussion sends normal text:

- Validate text.
- Add it to the discussion's recent messages.
- Keep only the last 10 messages.
- Broadcast it to current members except sender.
- Confirm delivery to sender.

Sender confirmation:

```text
✅ پیام ارسال شد.
👥 برای {count} نفر داخل بحث فرستادم.
```

If there are no other active members:

```text
🤖 فعلاً کسی داخل این بحث نیست.
آخرین پیام‌ها برای نفرات بعدی که وارد بشن نمایش داده میشه.
```

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

1. علی 👑 صاحب بحث — /u_8K2P
2. سارا — /u_9Q4M
3. تو
```

The profile code acts like a bot command/link. When the user sends or taps `/u_8K2P`, the bot resolves it to that member.

Rules:

- Do not expose raw database ids, Bale user ids, phone numbers, or location.
- Use a stable short public profile code such as `publicProfileCode`.
- Public profile codes only reveal a profile if that user's `profileDiscoverable` is true.
- If the target profile is private, show a short private-profile message.
- The member list can show all members because MVP room capacity is 20.
- The current user can be shown as `تو` without a profile link.
- Mark the discussion owner clearly with `👑 صاحب بحث`.

Private profile response:

```text
🤖 این کاربر پروفایلش رو خصوصی نگه داشته.
```

This keeps discussion messages clean while still making profile discovery possible.

### Owner Member Management

The owner can remove members from their own discussion.

In the owner view of `👥 اعضا`, show owner-only remove links/actions next to non-owner members:

```text
🤖👥 اعضای این بحث

1. علی 👑 صاحب بحث — /u_8K2P
2. سارا — /u_9Q4M — /remove_9Q4M
3. رضا — /u_7N1A — /remove_7N1A
```

Rules:

- Only the owner sees remove actions.
- Owner cannot remove themselves; they can only close the discussion.
- Members do not see remove actions.
- A removed member is removed from `memberIds` and from their discussion memberships.
- If the removed member's `activeDiscussionId` is this discussion, clear it.
- Notify the removed member with a short message.
- Do not expose raw ids in remove links; use the same safe public/member code style.

Remove confirmation for owner:

```text
✅ سارا از بحث حذف شد.
```

Removed member notification:

```text
🤖 از بحث «بهترین ریف تاریخ؟» خارج شدی.
```

If a non-owner somehow triggers remove:

```text
🤖 فقط صاحب بحث می‌تونه اعضا رو حذف کنه.
```

### Leave Discussion

Member leaving:

- Remove user from members.
- Clear user's active discussion id.
- Remove the discussion from the user's memberships.

Response:

```text
🚪 از بحث خارج شدی.
```

Owners cannot leave their own active/open discussion. They can only close it.

If the owner presses a leave-style action on their own discussion:

```text
🤖 چون این بحث رو تو ساختی، نمی‌تونی فقط ازش خارج بشی.
برای پایان دادن به بحث، از «بستن بحث» استفاده کن.
```

Joining another discussion switches the active discussion but does not leave the old one. Leaving is explicit through `🚪 خروج از بحث` or the `خروج` action in `📌 بحث‌های من` for non-owner memberships.

### Close Discussion

Only the owner can close a discussion.

Closing behavior:

- Set discussion status to closed.
- Notify all current members except the owner.
- Remove the discussion from active listings.
- Remove the discussion from all member discussion memberships.
- Clear `activeDiscussionId` for any user currently active in that discussion.
- Do not allow new messages or joins.
- For MVP, closed discussions are not reopened.

Owner response:

```text
✅ بحث بسته شد.
```

Member notification:

```text
🤖 صاحب بحث، این گفتگو رو بست.

💬 «بهترین ریف تاریخ؟»

می‌تونی از بخش بحث‌ها وارد گفتگوی دیگه‌ای بشی.
```

After close, the room should not appear in `🔥 بحث‌های فعال` or `📌 بحث‌های من`.

## Notifications

Notifications should be useful but quiet.

MVP notifications:

- Notify the owner when someone joins their discussion.
- Do not notify every member for every message.
- Do not notify the owner if they are currently active inside that discussion.
- Include an inline button to open the discussion.
- Consider a simple mute action per discussion.

Owner join notification:

```text
🤖 یه نفر وارد بحثت شد.

💬 بهترین ریف تاریخ؟
👤 سارا وارد شد.
👥 الان ۳ نفر داخل بحثن.
```

Buttons:

```text
ورود به بحث
بی‌صدا کردن این بحث
```

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

MVP supports only these rules:
MVP can start with open, completed TopTen, and taste label. Item-specific join rules are strongly recommended for the interests-focused phase and should be designed alongside MVP if implementation scope allows.

### Open

Any user can join, unless the discussion has a stricter join rule.

### Completed Top 10

User must have completed Top 10 in a selected section.

Example:

```text
فقط کسایی که تاپ ۱۰ موسیقی‌شون کامله
```

### Taste Label

User must have a specific taste label in a selected section.

Example:

```text
فقط 🤘 متال‌هدها
```

The creator must satisfy the restriction they create.

### Specific TopTen Item / Interest

User must have a specific item in their TopTen for a selected section.

This is especially useful for `🧩 علاقه‌مندی‌ها`.

Example:

```text
فقط کسایی که شطرنج توی تاپ ۱۰ علاقه‌مندی‌هاشونه
```

Matching should use the same normalization/duplicate matching approach as list items, so small spelling differences do not block valid users.

The creator must have the item in their own TopTen before creating this kind of room.

## Discussion Listing

Active discussion list should show both joinable and locked discussions.

Joinable example:

```text
✅ بهترین ریف تاریخ؟
👥 ۵ نفر داخل بحث
🔓 همه می‌تونن وارد بشن
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
- `joinRuleType`: `open | completed_top_ten | taste_label`
- future/optional `joinRuleType`: `top_ten_item`
- `ruleSection`: `movies | music | books | random | ""`
- `requiredLabelKey`
- `requiredTopTenItem`
- `requiredTopTenItemNormalized`
- `memberIds`
- `maxMembers`, fixed to 20 in MVP
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
- `discussionMembershipIds`, capped at 10 in MVP
- optional muted discussion ids/preferences
- optional discussion rate-limit metadata

## Rate Limits

MVP should include basic limits:

- Max 3 discussions created per user per day.
- Max 10 discussion memberships per user.
- Max 30 discussion messages per user per 10 minutes.
- Max title length: 80.
- Max description length: 300.
- Max message length: 500.
- Max active members per discussion: 20.

## Moderation

MVP minimum:

- Creator can close their discussion.
- Closing is owner-only and should be available from the owner's active-discussion bottom button.
- If a non-owner somehow triggers a close action, reject it safely with a short permission message.
- Closed discussions cannot receive new messages.
- Owner cannot leave their own open discussion; they must close it.
- Closing removes the discussion from active listings and member memberships.
- Text only.
- Profile viewing must respect `profileDiscoverable`.

Future:

- Reopen closed discussion.
- Report discussion.
- Report message.
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
- private profile fields

## Member/Profile Viewing

MVP should allow users to identify who sent a message by display name and view discoverable profiles through the members list.

Profile-view interaction:

1. User presses `👥 اعضا`.
2. Bot sends a member list with display names and public profile codes.
3. User taps/sends a profile code.
3. If the target user's profile is discoverable, bot shows their profile.
4. If private, bot says the profile is private.

Bale may not support clickable names in plain bot text, so public profile codes are preferred over inline buttons under every message.

## Saved Profiles And Discussion Discovery

Saved profiles are a future/fast-follow social layer, not required for discussion MVP.

Recommended behavior:

- A user can save a discoverable profile privately.
- Saving is one-way; the saved user is not notified.
- Saved profiles are not friendships and do not open private chat.
- Users can remove saved profiles.
- If a saved profile later becomes private, opening it should show the private-profile message.

Discussion discovery from another user's profile should be privacy-safe.

MVP-safe rule:

- Show discussions created by that user if their profile is discoverable and the discussion is not closed.
- Do not show all discussions they joined.
- Do not show membership history.
- Do not show last seen or activity status.

Active discussion visibility should be opt-in only.

Setting:

```text
نمایش بحث فعالم روی پروفایل: روشن/خاموش
```

Rules:

- Default: off.
- If off, profile viewers cannot see the user's active discussion.
- If on, profile viewers can see the user's current active discussion on their profile.
- If the viewer qualifies for the discussion's join rule, show a join action.
- If the viewer does not qualify, show the lock reason.
- Never reveal active discussion automatically without this setting.
- Store this as a user profile setting, e.g. `showActiveDiscussionOnProfile`, default `false`.
- The profile should show the current setting even before the discussion feature is fully implemented.

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

## Open Decisions

These are currently preferred but should be confirmed before implementation:

- Locked discussions are visible with clear lock reasons.
- Creating and joining do not require discoverable profile.
- Viewing another user's full profile requires that user's profile to be discoverable.
- Creator automatically joins after creating.
- Discussion room uses bottom keyboard for leave/info.
- Open discussions do not require completed Top 10.
- Item-specific join rules are useful for interests-based rooms; decide whether they are included in MVP or fast-follow.

## Product Rule

Discussions are a social layer, not the whole bot.

The bot remains centered on:

- profile
- lists
- Top 10
- taste labels
- suggestions
- taste-based discussion rooms
