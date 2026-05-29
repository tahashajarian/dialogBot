# Discussions Design

## Purpose

Discussions add a social layer to the bot without turning it into a generic matching or chat app. They let users talk around taste, lists, labels, and interests while keeping the existing bot identity centered on profiles, lists, Top 10, taste labels, and suggestions.

## MVP Concept

Discussions are live rooms with short memory.

- A discussion has a user-created title.
- A discussion can have an optional short description.
- Users can be in one active discussion at a time.
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

- If they are already in another discussion, leave the old discussion automatically.
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

### Leave Discussion

Leaving:

- Remove user from members.
- Clear user's active discussion id.

Response:

```text
🚪 از بحث خارج شدی.
```

Joining another discussion automatically leaves the old one.

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
- optional discussion rate-limit metadata

## Rate Limits

MVP should include basic limits:

- Max 3 discussions created per user per day.
- Max 30 discussion messages per user per 10 minutes.
- Max title length: 80.
- Max description length: 300.
- Max message length: 500.
- Max active members per discussion: 20.

## Moderation

MVP minimum:

- Creator can close their discussion.
- Closed discussions cannot receive new messages.
- Text only.
- Profile viewing must respect `profileDiscoverable`.

Future:

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

MVP should allow users to identify who sent a message by display name.

Future/profile-view interaction:

1. User selects or clicks a sender/member.
2. Bot offers a "view profile" action.
3. If the target user's profile is discoverable, bot shows their profile.
4. If private, bot says the profile is private.

Open design detail: Bale may not support clickable names in message text, so this may need inline buttons, a member list, or numbered sender/member entries.

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
