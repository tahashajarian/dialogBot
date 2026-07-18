# Discussions

Discussion/People hub navigation and the ordinary create-discussion wizard use persistent bottom reply keyboards. Active Discussions, My Discussions, received invitations, See People results, and Saved Profiles render pagination, filters where applicable, and a final Close action inline on their cards. List Close actions remove only the tapped card and do not navigate or change the bottom keyboard. The visible hub bottom buttons remain actionable while these list cards or the Active-list language picker are open. Button text from reply-keyboard surfaces is resolved only against the user's server-side mode, exact page/filter, and durable wizard state; copied stale labels are ignored. A user may browse these lists while remaining in an active room without navigation labels being delivered as room messages.

Identity-bound invitation/join actions, member selection, destructive confirmations, and acknowledgement cards remain inline when their payload or context is safety-sensitive. Paid-capacity confirmation uses a dedicated bottom-keyboard mode whose capacity and quoted cost are stored and revalidated server-side; copied or stale confirmation labels are rejected.

> Implemented discussion-language filtering and migration behavior is specified in [Discussion Language](discussion-language.md). Starter rooms have separate Persian and English instances.

## Implementation Status

The MVP described here is implemented. The current code supports:

- discussion creation with title, optional description, capacity, and join-rule selection
- open, taste-label, and specific TopTen-item join rules
- active and owned discussion lists with pagination
- one active room per user; joining another room requires leaving the current room first
- live text delivery with last-10-message context and runtime-only native reply mapping
- shareable invite links with a revalidated preview before joining
- stored saved-profile invitations with an invitation inbox, daily invite limit, and inviter mute controls
- member lists, public-profile viewing, private saved profiles, taste-based people discovery, and saved-profile discussion discovery
- member reporting, creation/message limits, and opt-in active-discussion profile visibility
- Persian and English instances of four Muze-created starter definitions, marked only with `👩‍🦳`: one open room, two rooms gated by popular Interests TopTen items, and one room gated by the Music Metalhead badge
- onboarding starter invitations from Muze, shown in the normal invitations inbox without a Muze profile link
- private Stars, attributable invitation rewards, owner-only discussion boosts behind rollout switches, and the uncharged Advanced Search preview

Future ideas in this document are not implemented unless explicitly identified otherwise.

## Purpose

Discussions add a social layer to Muze without turning it into a generic matching or chat app. They let users talk around taste, lists, labels, and interests while keeping the existing Muze identity centered on profiles, lists, Top 10, taste labels, and suggestions.

`TopTen` remains the internal discussion-rule/storage term. User-facing discussion copy must use the current media label, Favorites / «محبوب‌ها»: ask users to add a required item to their favorites or complete all 10 favorites, rather than sending them to a screen named “Top 10” that no longer exists.

## MVP Concept

Discussions are live rooms with short memory.

The Discussions hub uses a compact reply keyboard: Active Discussions with Invitations, Create New Discussion with My Discussions, then Back on its own row.

- A discussion normally has a user-created title; the four starter rooms are Muze-created.
- A discussion can have an optional short description.
- Users can be inside one discussion at a time.
- Discussion membership means current room presence. Leaving the room removes membership.
- Each discussion has an editable capacity. Normal capacities are free; special 2-person and large-room capacities can be Stars-gated from the admin dashboard.
- Messages are broadcast live to current room members.
- Each discussion keeps only the last 10 messages as recent context.
- When a user joins or rejoins, they see the last 10 messages, not full history.
- There is no seen count in MVP. Sender only gets a delivery confirmation.
- Four broad starter rooms are created idempotently at startup using the real bot account id returned by `getMe()`.
- Starter rooms have language-qualified stable `botSeedKey` values. Their title and description are rendered in the room language; Persian and English users join separate underlying rooms.
- Their English titles are `Free Discussion`, `Gaming Hangout`, `Movie Chat`, and `Metalheads`.
- `Free Discussion` is open to everyone. `Gaming Hangout` requires the user's `🌿 Interests` TopTen to include Gaming/Game or Persian equivalents such as `گیم`/`بازی`. `Movie Chat` requires the user's `🌿 Interests` TopTen to include Movies/Film or Persian equivalents such as `فیلم`. `Metalheads` requires the user's Music taste label to be `🤘 Metalhead`.
- When starter rooms are pinned for new users, keep this seed order so the open `Free Discussion` room appears first.
- The item-gated starter rooms should use popular onboarding chips so new users can unlock at least one relevant room through the configurable Interest onboarding flow.
- Normal onboarding completion prepares at most one invitation. Prefer the most recent open, non-full, joinable discussion in the user's interface language whose specific profile-Interest rule matches an onboarding choice; the room may be user-created or Muze-created. Fall back to the matching-language open `Free Discussion` starter room. Persist the invitation before mentioning it or showing the invitation button, never auto-join, never create duplicates on retries, and exclude automated onboarding invitations from invitation-pair Star rewards.
- Recognized language-specific Muze starter rooms have a fixed effective capacity of 100 members. User-created room defaults, free capacity choices, and paid-capacity rules are unchanged. If both a relevant matching room and the matching-language `Free Discussion` room are full or unavailable, onboarding completes without a starter invitation and keeps the normal Active Discussions, My favorites, and Main menu destinations. The current implementation does not automatically increase capacity or create overflow global rooms; either scaling policy requires a separately reviewed product and moderation change based on real usage.
- Starter room cards should make the first social step obvious: the open room says to start there, unlocked gated rooms rely on their concise rule/status line, and locked rooms say which Interest TopTen item to add.
- Discussion list cards stay compact: the numbered title, description, member count, and join rule each have a clear line; repeated field labels are omitted, and language is shown only when it differs from the viewer's interface language.
- After joining a starter room, the room follow-up may include one short "say hi" style prompt tailored to that room. Avoid adding multiple quick replies or noisy onboarding controls.
- Muze-created rooms have no fake members or messages and show only a `👩‍🦳` marker beside their title.
- Muze-created rooms use the same join, full-room, and acknowledgment behavior as user-created rooms, while recognized language-specific starter rooms use the 100-member capacity exception above.
- The first successful Active Discussions list response may include one compact explanation of live rooms, relevance, and join requirements. If the user saw the first-time Invitations explanation first, that consumes the same durable Discussions guidance state. List filters, pagination, Back actions, room views, and subsequent inbox opens do not repeat it.
- **Smart discovery sorting**: Active discussion lists keep the existing `فقط قابل ورودها` / joinable toggle and use strict viewer-relevance tiers: a matching Movies/Music/Books item, then a matching taste label, then a matching profile Interest, then other joinable rooms, then locked/full rooms. Boosts, saved creators, freshness, starter-room help, recent activity, and available capacity order comparable rooms inside a tier; they never move a less-relevant room above a more-relevant tier. This helps relevant and new rooms surface without adding another discovery mode.
- When a user tries to enter a locked room from a discussion list or a `/d_CODE` command, show a standalone inline `👍 Got it` / `👍 متوجه شدم` notice. The notice should name the exact unlock path for the rule, such as `Movies, Music, Books -> Music -> complete all 10 favorites`. Keep the current reply keyboard and its navigation mode unchanged; acknowledgment only deletes the notice and does not navigate or rebuild the list.

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
- Before creating or entering any discussion, users must explicitly set a meaningful Muze profile name with 3 to 30 characters, no emoji, sensitive sexual terms, placeholder, repeated-character, or keyboard-mash text. Telegram profile names do not satisfy this gate by themselves. If they cancel the prompt, remove only the prompt card and return them to the correct previous surface. Create-flow cancels return to the discussions menu, invitation accepts return to the invitations inbox, and active-list joins return to the active discussions list.
- Age is optional and not required for viewing profiles

Profile discussion visibility is a separate setting that controls both the user's current discussion and open discussions they created. It defaults to on for new accounts, can be turned off from Profile Settings, and must always respect the user's saved choice.

## Core User Flows

### Open Discussions

Entry point from main menu:

```text
💬 گفت‌وگوها
```

Discussion menu:

```text
💬 گفت‌وگوها

🟢 گفت‌وگوهای فعال
➕ ساخت گفت‌وگوی جدید
🗂 گفت‌وگوهای من
🔙 برگشت
```

Show `🚪 خروج از گفت‌وگو` only inside an active room's bottom controls, not in the general discussions menu.

Inside an active discussion, use bottom buttons for room actions.

Member buttons:

```text
👥 اعضا
📨 دعوت
🚪 خروج از گفت‌وگو
```

Owner buttons:

```text
👥 اعضا
📨 دعوت
🚪 خروج از گفت‌وگو
🔒 بستن گفت‌وگو
```

Only the discussion owner can close a discussion. Regular members must not see the close button and cannot close the room through commands/callbacks.
The owner can leave their own discussion without closing it. The discussion stays open, the owner remains `creatorUserId`, and other members can continue talking. The owner can later find the discussion in `🗂 گفت‌وگوهای من`, rejoin it, or close it.
All current members can use `📨 دعوت` to open invite options for the active discussion. Members can create a shareable invite message or send a stored invitation to a saved profile. This is not a private-room feature; it only helps users bring others to the existing discussion preview.

There is no separate room-level discussion-menu/back button. `🚪 خروج از گفت‌وگو` is the explicit way to leave the room; after leaving, the bot removes the room keyboard and shows the discussions menu.

Important distinction:

- successfully joining another discussion leaves the previous discussion
- leaving a discussion removes current membership
- if a user leaves the room view, they are no longer in that discussion

### Create Discussion

Creation prompts that use mode-scoped bottom keyboards remain as harmless chat history when the wizard advances. The bot forgets their tracked message ids instead of deleting them through Telegram; stale bottom-button text is rejected outside the exact current wizard mode. Safety-sensitive mutations, paid confirmation, and indexed picker validation remain server-side and mode scoped.

Leaving a room likewise forgets tracked room headers, recent-message cards, member cards, and menu notices without deleting Telegram messages. Indexed discussion lists may have their inline markup disabled when retired, but ordinary room exit performs no Telegram delete or edit cleanup before showing the Discussions menu.

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
- Max current members: editable per user-created discussion. Normal capacities are capped at 20; the admin-controlled large paid capacity can exceed that. Recognized language-specific Muze starter rooms use the separate fixed effective capacity of 100.
- Creator must satisfy restricted join rules they create.

Title prompt:

```text
👩‍🦳 عنوان گفت‌وگو رو بنویس.

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
- reject English and Persian sexual-content terms, including joined, spaced, punctuated, and common Arabic-letter variants
- reject nonsense input: placeholders (test, asdf, تست, هیچی), Latin keyboard mash (qwerty, asdfg), Persian keyboard mash (سشبیل, شسیب), repeated characters (aaaa), long consonant-heavy chunks, long single Persian tokens with no spaces
- allow duplicate titles (discussions are not global channels with unique names)
- allow real short titles (Dune, Chess, شطرنج)

Description validation:

- minimum 3 letters (same as title)
- uses the same nonsense detection as title and TopTen input (shared `isLowQualityAiListItem` and `validateMinimumLength` from `src/services/ai-input-quality.js`)

Join rule prompt:

```text
چه کسانی بتونن وارد این گفت‌وگو بشن؟
```

Buttons:

```text
🌍 آزاد
🏷 فقط یک برچسب خاص
📌 فقط یک علاقه/آیتم خاص
لغو ساخت گفت‌وگو
```

Create/edit navigation rules:

- In create mode, title step shows only `لغو ساخت گفت‌وگو`.
- In create mode after title, show `لغو ساخت گفت‌وگو` plus a `🔙 برگشت` button to the previous step where relevant.
- In edit-from-preview mode, cancel actions should use `لغو ویرایش` and return to preview (not cancel the whole draft).
- If a user types arbitrary text during a mode-scoped picker, keep the current mode and show concise guidance; copied labels outside the mode are ignored.

Description is collected after the join rule is selected, so the bot can show the right description controls for open vs restricted discussions.
Creation prompts use durable bottom-keyboard modes for ordinary steps, including title/description cancellation and preview edits. Identity-bound, destructive, and transactional confirmation remains inline only where required.

Description prompt:

```text
یه توضیح کوتاه هم می‌خوای اضافه کنی؟
```

Restricted discussion inline buttons:

```text
رد کردن
لغو ساخت گفت‌وگو
```

Open discussion inline buttons:

```text
لغو ساخت گفت‌وگو
```

The skip button is only valid while creating a restricted discussion. Open discussions must require a description before preview/creation because anyone can join and the room needs clear context.

If an open discussion has no description:

```text
برای گفت‌وگوهای عمومی، یه توضیح کوتاه لازمه تا بقیه بدونن موضوع دقیقاً چیه.
```

For open topics, selecting `🌍 آزاد` moves to the required description step. Restricted topics move to the optional description step after the restriction is fully selected.

Room capacity is editable from the preview step:

- free allowed values: 3, 4, 5, 10, 15, 20 current members
- paid allowed values, when Star spending and the relevant rollout switch are enabled: 2 current members and the configured large capacity, default 50
- default: 20 current members
- paid capacity selection shows a `⭐` marker in the capacity picker
- paid capacity is charged only after the user confirms the mode-scoped bottom prompt; cancel returns to the preview, while insufficient balance offers Edit capacity and Back to preview
- creator counts as a member
- joining another discussion removes the user from the previous discussion

Before the create wizard starts, Muze checks the creator's active-owned room count. The normal configured allowance is free. At the limit, and only while Star spending plus the paid-extra-discussion switch are enabled, Muze shows an inline price confirmation while leaving the Discussions bottom keyboard in place. Confirmation revalidates the live price and count, spends idempotently, and stores a server-side authorization for exactly one additional owned slot before continuing to the title step. Insufficient balance is shown on an inline `Got it` card; acknowledging it quietly removes the card and leaves the Discussions menu available. Cancelled or failed creation refunds an already-charged extra-slot authorization exactly once.

For restricted topics, show a preview before creating:

```text
👩‍🦳 این گفت‌وگو ساخته بشه؟

💬 بهترین ریف تاریخ؟
توضیح: گفت‌وگو درباره ریف‌های ماندگار

ورود: فقط 🤘 متال‌هدها
ظرفیت: ۲۰ نفر
```

Buttons:

```text
✅ ساخت گفت‌وگو
✏️ ویرایش عنوان
📝 ویرایش توضیح
🔐 ویرایش شرط ورود
👥 تغییر ظرفیت
لغو ساخت گفت‌وگو
```

Restricted-topic preview is useful because join rules are harder to change mentally after creation.
At preview step, the creator should be able to edit title, description, or join rule before final confirm.

Label-restricted discussions should use only the creator's existing labels, not the full system label catalog. This prevents random gatekeeping and keeps the room connected to the creator's actual taste.

Item-restricted discussions should use the creator's own existing items, not arbitrary free text. For movies, music, and books this means TopTen items; for `🌿 علاقه‌مندی‌ها` this means profile interests. This enables rooms like:

```text
فقط کسانی که شطرنج توی علاقه‌مندی‌های پروفایلشونه
فقط کسانی که کدنویسی توی علاقه‌مندی‌های پروفایلشونه
فقط کسانی که قهوه توی علاقه‌مندی‌های پروفایلشونه
```

Creator eligibility should be validated before creation confirm wherever possible:

- Taste-label rule: creator must already have an existing label in the chosen section.
- Top-10-item rule: creator must pick an existing item from their own Top 10 for movies/music/books, or from profile interests for `🌿 علاقه‌مندی‌ها`.

This rule is more approachable than labels for many users because it gates by a concrete shared interest.

If creator has no labels:

```text
برای ساخت گفت‌وگوی مخصوص یک برچسب، اول باید حداقل یک برچسب سلیقه داشته باشی.
تاپ ۱۰ فیلم، موسیقی یا کتاب رو کامل کن، یا چند علاقه‌مندی به پروفایلت اضافه کن.
```

If creator has no items for item-restricted rooms:

```text
برای ساخت گفت‌وگوی مخصوص یک علاقه، اول چند علاقه‌مندی به پروفایلت اضافه کن.
```

Missing-label and missing-item guidance does not require an inline acknowledgement. Show the guidance together with the normal join-rule bottom keyboard so the creator can immediately choose another rule.

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
💬 وارد گفت‌وگو «بهترین ریف تاریخ؟» شدی.

👩‍🦳 آخرین پیام‌ها:
👤 علی: Master of Puppets هنوز بی‌رقیبه.
👤 سارا: من Painkiller رو می‌گم.

از الان هر پیامی بفرستی برای اعضای همین گفت‌وگو ارسال میشه.
```

If there are no messages:

```text
هنوز پیامی توی این گفت‌وگو نیست. شروعش کن 🙂
```

If discussion is full:

```text
👩‍🦳 ظرفیت این گفت‌وگو تکمیل شده.

💡 می‌تونی یک گفت‌وگوی دیگه رو انتخاب کنی یا از بخش گفت‌وگوها، گفت‌وگوی خودت رو بسازی.
```

Owner rejoin:

- The creator can always rejoin their own open discussion.
- The creator bypasses join-rule checks when rejoining because they already satisfied the rule at creation time.
- The creator also bypasses capacity on rejoin so they can moderate, invite, or close the room.
- Owner rejoin must not duplicate membership.

### Invite To Discussion

Invites make active discussions easier to grow through direct sharing, without adding private chat. They complement the separate taste-based people-discovery surface.

Entry point:

- Inside an active discussion, the bottom button `📨 دعوت` opens invite options.
- Before opening invite options, revalidate the discussion's effective capacity. If the room is full, show a standalone inline full-room notice with a `Got it` acknowledgment that only deletes the notice.
- Any current member can create a shareable invite message for the active discussion.
- Any current member can also send a stored invitation to one of their saved profiles, subject to stored-invitation rules in [Discussion Invitations](discussion-invitations.md). The picker shows five eligible profiles per page and keeps Close available on every page.
- The user must still be a member at the moment they tap `📨 دعوت`; stale bottom keyboards must fail safely.
- The invite points to a discussion preview, not directly into the room.
- The invited user must still tap join and pass the normal join checks.
- If the user has no active discussion, show the discussions menu instead of generating an invite.

Invite flow:

1. Member taps `📨 دعوت` inside their active discussion.
2. Bot offers a saved-profile invitation only when the member has at least one saved profile, and always offers a shareable invite.
3. If the member chooses shareable invite, bot sends a ready-to-share message/card for that discussion.
4. User shares or forwards the invite outside the bot.
5. Recipient opens the bot through the invite/deep link or sends the invite command.
6. A recipient with completed onboarding sees a safe discussion preview. A recipient with unfinished onboarding completes it and then sees that preview automatically.
7. In either path, the recipient can join only if the discussion is open, not full, not closed, and they satisfy the join rule.

First-time/deep-link handling:

- Shared invite text should include one clear join action.
- If `BOT_DEEP_LINK_BASE_URL`, `BOT_PUBLIC_URL`, or `BOT_USERNAME` is configured, use one public bot deep link.
- If no public bot link can be built, fall back to `/join_CODE`.
- Preferred public link payload is `start=join_CODE`, for example `https://t.me/BOT_USERNAME?start=join_8K2P`.
- If the platform opens the bot through `/start join_CODE`, handle it as the shared-link entry: unfinished onboarding first, otherwise an invite preview.
- If the platform delivers a query-like startup command such as `/start?join_CODE`, handle it through the same shared-link entry.
- `/start d_CODE` may also resolve to the same shared-link entry for compatibility.
- Repeated public invite links should still open the invite preview or re-focus the room. Star rewards remain protected by directed-pair ledger idempotency, not by blocking the preview.
- Starting from a shared link never auto-joins. Users with unfinished onboarding see the original preview automatically after completion; users who already completed onboarding go straight to the preview or room re-focus without repeating the generic intro.
- If the user is already active in that exact discussion, the invite can re-focus the room and show the already-member message instead of the preview. Dismissing a same-room invite notice should stay quiet after removing the preview.
- If the user is inside another discussion, the invite preview should show `leave current and join` plus `cancel`, not a normal join button.
- If that invite is already known to be locked for the user, show the locked reason in the preview before offering any switch action.
- Canceling that invite preview must only remove/dismiss the preview and must not leave the current discussion.
- The explicit `leave current and join` action should keep the user in their current discussion if the target join fails; only leave the old discussion after the target join/open succeeds.
- Invite start commands and `/join_CODE` should be handled before section-specific states, so links work even if the user is currently inside profile edit, AI lists, saved profiles, or another bot section.

Example ready-to-share copy:

```text
📨 دعوت به گفت‌وگو

💬 «بهترین ریف تاریخ؟»

📄 گفت‌وگو درباره ریف‌های ماندگار

🔐 شرط ورود:
🌍 آزاد

ورود به گفت‌وگو 👈 https://t.me/BOT_USERNAME?start=join_8K2P
```

For locked rooms, include the join condition:

```text
📨 دعوت به گفت‌وگو

💬 «آلبوم‌های متال برای شروع»

🔐 شرط ورود:
🏷 موسیقی - 🤘 متال‌هد

ورود به گفت‌وگو 👈 https://t.me/BOT_USERNAME?start=join_9Q4M
```

Rules:

- Invites must not bypass taste-label or TopTen-item join rules.
- Invites must not bypass capacity, removed-user checks, or closed-room checks.
- Invites must not reveal private member details, full member lists, raw ids, Telegram user ids, phone numbers, or location.
- Invites should use the discussion public code, not the database id.
- Invite codes should be stable public discussion codes, not per-user tokens, for MVP.
- Invite links/messages can remain valid until the discussion is closed or unavailable.
- Old invite messages do not need to be deleted; every open/join attempt must re-read the discussion and revalidate current state.
- A user who opens an invite for their currently active discussion should see the already-member message instead of a generic preview.
- Existing members who use the invite while active elsewhere should be moved/re-focused to that discussion, matching normal `/d_CODE` behavior.
- Removed users can open the preview but must receive the same removed-user error if they try to join.
- Closed, missing, or expired discussions should show a clean unavailable state.
- If a recipient does not satisfy a restricted join rule, show a specific hint that names what is missing and where to update it, then return them to the main menu so they can update their profile/list data. Tell them they can retry the same invite/command after updating.
- Invite generation should be low-noise: send one ready-to-share card, not a chain of explanation messages. The card includes localized native Share, Copy invitation, and Close actions. Forward and Copy carry the same localized payload and attributable shared-discussion link. Keep the common payload within the platform copy-text limit by omitting an oversized description first and truncating only as a final fallback. Opening it for an already-onboarded user does not create an inbox row; the post-onboarding `shared_link` preservation rule is the narrow exception. Close quietly deletes the temporary share card because the sender is already in the active room.

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

- `/join_CODE` or a deep-link equivalent should run unfinished onboarding first and automatically show the original preview afterward; users with completed onboarding should see the invite preview immediately.
- A displayed preview should not join automatically, even for open rooms.
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
9. If the user explicitly chose `leave current and join`, leave the previous active discussion only after the target join/open succeeds.

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
👩‍🦳 این گفت‌وگو دیگه در دسترس نیست.
```

Full invite state:

```text
👩‍🦳 ظرفیت این گفت‌وگو تکمیل شده.

💡 می‌تونی یک گفت‌وگوی دیگه رو انتخاب کنی یا از بخش گفت‌وگوها، گفت‌وگوی خودت رو بسازی.
```

Already member state:

```text
👩‍🦳 تو همین الان عضو این گفت‌وگویی.

از این به بعد پیام‌هات برای همین گفت‌وگو ارسال میشه.
```

Locked invite state:

```text
👩‍🦳 برای ورود به این گفت‌وگو، باید شرط ورودش رو داشته باشی.
```

Specific locked hints:

- Taste-label room: tell the user which section/label is required and guide them to complete that section's Top 10 so the label can be calculated.
- TopTen-item room: tell the user which section/item is required and guide them to add that item to the relevant Top 10 list.
- After the hint, show the main menu reply keyboard.
- Tell the user they can use the same invite link/command again or find the discussion again from `🟢 گفت‌وگوهای فعال`.

Taste-label example:

```text
👩‍🦳 برای ورود به این گفت‌وگو باید این برچسب رو داشته باشی:
🏷 موسیقی - 🤘 متال‌هد

💡 اول تاپ ۱۰ موسیقی‌ات رو کامل کن تا برچسبت حساب بشه.
بعدش می‌تونی همین لینک دعوت رو دوباره امتحان کنی.

از منوی اصلی برو به محبوب‌های من 🎬🎵📚.
```

Profile-interest item example:

```text
👩‍🦳 برای ورود به این گفت‌وگو، «شطرنج» باید توی علاقه‌مندی‌های پروفایلت باشه:
🔑 🌿 علاقه‌مندی‌ها - شطرنج

💡 از منوی اصلی برو به 👤 من ← علاقه‌مندی‌ها و «شطرنج» رو اضافه کن.
بعدش می‌تونی همین لینک دعوت رو دوباره امتحان کنی.
```

No active discussion state:

```text
👩‍🦳 الان داخل هیچ گفت‌وگوی فعالی نیستی.

از بخش گفت‌وگوها وارد یک گفت‌وگو شو، بعد می‌تونی دعوت بسازی.
```

No longer a member state:

```text
👩‍🦳 دیگه عضو این گفت‌وگو نیستی، برای همین نمی‌تونم دعوت بسازم.
```

Invite abuse and rate limits:

- The Discussions-menu badge counts only unseen pending invitations, including unseen bot starter invitations. Opening the inbox clears the badge, while seen pending invitations stay in the inbox until the invited user accepts or removes them, or the target discussion becomes unavailable.
- Apply the existing repeated-tap guard to the `📨 دعوت` bottom button.
- Public share-link generation can add a lightweight per-user cooldown later, for example one invite message per discussion per minute.
- Do not notify the discussion owner when someone generates or uses an invite.
- Do not broadcast invite generation inside the room.
- Joining from an invite should use the same join notification rules as normal joining.

Implementation test checklist:

- Member can generate an invite for their active discussion.
- Non-member/stale active state cannot generate an invite.
- `/join_CODE` runs unfinished onboarding and then shows the preview automatically; completed users see the preview immediately.
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

### Star-Funded Discussion Boost

Boost behavior is specified in [Stars Economy](stars.md). It is an optional discovery amplifier, not a join bypass or replacement for organic ranking.

- Only the discussion creator may buy a boost at launch.
- Multiple creators may have boosted discussions simultaneously across Muze, but each creator and each discussion may have only one active boost.
- The room action uses `🚀 Boost discussion` in English and `🚀 ارتقای گفت‌وگو` in Persian. Owners can start the same flow from `🗂 گفت‌وگوهای من` through the listed boost action; current admin-configured cost, duration, balance, and confirm/cancel actions appear on the confirmation card.
- Charge and boost creation must be atomic/idempotent, with exactly one automatic refund if activation fails after charge.
- Boosted rooms are visibly labeled and still pass open status, capacity, join-rule, removal, mute/block, ban, moderation, relevance, freshness, cooldown, and owner-diversity checks.
- A boost may improve list placement and send a capped Muze-authored recommendation to eligible taste-relevant users.
- Recommendations are not personal invitations, never count toward invitation Star rewards, never expose selected recipients to the booster, and support opt-out/not-interested controls.
- Recipient frequency, delivery count, boost duration, cost, cooldown, and per-owner active boost limit are editable Star economy settings.
- Each viewer page reserves only one or two relevant boosted positions. If more eligible boosts exist, relevance and freshness rank/rotate them; Muze does not pin every active boost for every viewer.
- A boost never guarantees joins, messages, or a fixed rank.
- Basic discussion browsing, creating, joining, and participation remain free.

### My Discussions / Switching

`🗂 گفت‌وگوهای من` shows discussions the user owns or has joined.
Discussion lists should be plain text with bot-command links instead of dense inline button rows.
Long discussion lists use exact-page bottom pagination and Back. Active-discussion filters are also bound to the current server-side list mode.
For this toggle, keep the icon stable across states and change only the text label.
If the list is empty, show a short empty-state notice with a useful tip and a single `Got it` acknowledgment that returns to the discussions menu. If closing a discussion from this list leaves the user with no discussions, show the same style of notice instead of immediately rendering the list again.

Example:

```text
🗂 گفت‌وگوهای من

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

When a user with an active discussion sends a global navigation command such as `/menu`, `/profile`, `/taste`, `/discussions`, `/people`, `/help`, or `/lang`, leave the discussion before opening the requested surface. Notify the remaining active members through the normal leave notification. Tell the departing user that they left the named discussion, remove the room keyboard, and then show the requested surface. Never store or broadcast the command itself as a discussion message.

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
👩‍🦳👥 اعضای این گفت‌وگو

1. 👤 علی — 🎙️ میزبان
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

- Do not expose raw database ids, Telegram user ids, phone numbers, or location.
- Use a stable short public profile code such as `publicProfileCode`.
- Public profile codes reveal the matching profile.
- The member list shows all current members. User-created rooms normally cap at 20 unless an enabled paid capacity applies; recognized language-specific Muze starter rooms can contain up to 100.
- The current user can be shown as `تو` without a profile link.
- Mark the discussion host clearly with `🎙️ میزبان`. `⭐` is reserved for the Stars economy.
- Do not show a separate active/presence marker. If a user is in the member list, they are currently in the discussion.
- Member lists should be plain text command links, not inline button rows.
- Profile/report/remove actions should be shown with labels and pointer emojis on separate lines (e.g., `👁 View profile 👈 /u_CODE`, `🚩 Report 👈 /report_CODE`, `🗑 Remove 👈 /remove_CODE`).
- Separate member blocks with a simple line divider when multiple members are shown.
- Users stay inside the discussion after viewing the member list; no back button is needed on the member list.
- Keep the member list low-noise: remember the latest member-list bot message and remove it when the user opens the member list again, opens a profile from that list, leaves the discussion, or the discussion closes.
- Profiles opened from the members list are transient identity-bound cards. Show inline Save only when unsaved, a non-action Saved tag when saved, and Close; omit People-only active-discussion actions.

Private profile response:

```text
👩‍🦳 این کاربر پروفایلش رو خصوصی نگه داشته.
```

This keeps discussion messages clean while still making profile discovery possible.

### Owner Member Management

The owner can remove members from their own discussion.

In the owner view of `👥 اعضا`, show owner-only remove links/actions under non-owner members:

```text
👩‍🦳👥 اعضای این گفت‌وگو

1. 👤 علی — 🎙️ میزبان

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
  - A toast notification at the top: `میزبان گفت‌وگو قبلاً تو رو از این گفت‌وگو حذف کرده.`
  - A regular message: `👩‍🦳 میزبان گفت‌وگو قبلاً تو رو از این گفت‌وگو حذف کرده.`
- If the removed member's `activeDiscussionId` is this discussion, clear it, remove their room bottom keyboard, send a bot-message explaining they were removed, and show the discussions menu.
- If the removed member is not currently in this discussion, remove membership quietly without notifying them.
- Do not expose raw ids in remove links; use the same safe public/member code style.

Remove confirmation for owner:

```text
👩‍🦳 عضو از گفت‌وگو حذف شد.
```

Removed member notification:

```text
👩‍🦳 از گفت‌وگو «بهترین ریف تاریخ؟» توسط میزبان حذف شدی.
```

If a non-owner somehow triggers remove:

```text
👩‍🦳 فقط میزبان گفت‌وگو می‌تونه اعضا رو حذف کنه.
```

Report confirmation:

```text
👩‍🦳 گزارشت ثبت شد. فعالیت این کاربر بررسی میشه.
```

Reports should store enough data for later review:

- discussion id
- reporter user id
- reported/target user id
- report status
- created time

Auto-ban rule:

- `REPORT_BAN_THRESHOLD` controls how many different reporters are required before a user is banned. Default: `5`.
- Count unique reporters across open discussion reports. Multiple reports from the same reporter against the same target should not move the target closer to a ban.
- Every newly accepted report should notify the reported user privately with their current report count, the threshold, and how many unique reports remain before a full Muze ban.
- Normal report warnings should not remove the user's current bottom keyboard; clearing it can expose platform fallback controls. Only the final ban/access-denied messages should clear the bottom keyboard.
- When the threshold is reached, set a global Muze ban on the reported user. A banned user can no longer use messages, commands, callbacks, lists, profiles, invites, or discussions. Any future interaction should only return a short banned-account message with an admin-contact hint.
- When a user is auto-banned, remove them from all active discussion memberships, clear their `activeDiscussionId`, and notify the remaining active members in each affected discussion that the user was removed. Keep the room notification calm and do not include report counts.
- Do not let reports from banned users count toward another user's ban.
- Do not publicly expose reporter identities or raw report counts in room notifications.

### Leave Discussion

Member leaving:

- Remove user from members.
- Clear user's active discussion id.
- Remove the discussion from the user's memberships.

Response:

```text
👩‍🦳 از گفت‌وگو «بهترین ریف تاریخ؟» خارج شدی.
```

After this response, remove the room bottom keyboard and show the discussions menu.

Owners can leave their own active/open discussion. This removes them from current members and clears their `activeDiscussionId`, but does not close the discussion or change `creatorUserId`.

Joining another discussion leaves the old one after the new join succeeds. If the new join fails, the user stays in the old discussion.

### Close Discussion

Only the owner can close a discussion.
Close confirmation uses discussion-bound inline Confirm/Cancel buttons. Cancel removes only the confirmation card without navigating. After successful closure, the same card shows the owner response as plain text with no inline buttons; it does not automatically render Active Discussions, My Discussions, or another content screen.

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
👩‍🦳 گفت‌وگو «بهترین ریف تاریخ؟» بسته شد.
```

When closure started inside the room, replace the now-invalid room bottom keyboard with the Discussions menu. This keyboard correction does not replace the inline result card or open another content list.

Member notification:

```text
👩‍🦳 میزبان گفت‌وگو، این گفت‌وگو رو بست.

💬 «بهترین ریف تاریخ؟»

می‌تونی از بخش گفت‌وگوها وارد گفت‌وگوی دیگه‌ای بشی.
```

After close, the room should not appear in `🟢 گفت‌وگوهای فعال` or `🗂 گفت‌وگوهای من`.

## Notifications

Notifications should be useful but quiet.

## Join/Leave/Remove/Close Notifications

**Who gets notified:**
- Only current members of that specific discussion
- The person performing the action (joiner/leaver/owner) does NOT receive the notification
- Members in other menus or other discussions do NOT receive notifications

**Join notification:**

```text
👩‍🦳 «سارا» وارد گفت‌وگو شد.
```

**Leave notification:**

```text
👩‍🦳 «سارا» از گفت‌وگو خارج شد.
```

**Remove notification (to removed member):**

```text
👩‍🦳 از گفت‌وگو «بهترین ریف تاریخ؟» توسط میزبان حذف شدی.
```

**Remove notification (to other current members):**

```text
👩‍🦳 «سارا» از گفت‌وگو توسط میزبان حذف شد.
```

**Close notification (to current members):**

```text
👩‍🦳 گفت‌وگو توسط میزبان بسته شد.
```

**Format rules:**
- All notifications use Muze emoji 👩‍🦳 (not door 🚪)
- Member names appear in quotes/guillemets: «name»
- Notifications are sent only to members actively viewing that discussion at the moment

Anti-noise rules:

- If multiple users join close together, batch or throttle notifications when possible.
- Suggested throttle: at most 1 join notification per discussion per 10 minutes.
- If throttled, the next notification can summarize:

```text
👩‍🦳 چند نفر جدید وارد گفت‌وگوت شدن.

💬 بهترین ریف تاریخ؟
👥 الان ۶ نفر داخل گفت‌وگون.
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

User must have a specific item in the selected section. For movies, music, and books this is a TopTen item. For `🌿 علاقه‌مندی‌ها`, this is a profile interest.

Profile interests make this rule useful for broad interest rooms.

Example:

```text
فقط کسایی که شطرنج توی علاقه‌مندی‌های پروفایلشونه
```

Matching should use the same normalization/duplicate matching approach as list items, so small spelling differences do not block valid users.

The creator must have the item in their own TopTen or profile interests before creating this kind of room.

If the creator has no eligible items in the selected section during rule selection, show a bot message with the exact section name and a tip to add at least one TopTen item in that section first, or a profile-interest-specific tip for `🌿 علاقه‌مندی‌ها`.

## Discussion Listing

Active discussion list should show both joinable and locked discussions.
The joinable-only list should use smart discovery sorting so relevant and fresh joinable rooms appear above generic older rooms. Do not pin a current active discussion here; users leave the active room before browsing bot sections.
Join-rule lines in list cards should use user-facing section names (for example `🌿 علاقه‌مندی‌ها`, not raw keys like `random`) and include a short join-condition header.
Recommended compact rule formatting:

- `🔐 شرط ورود:` / `🔐 Join condition:`
- Open rule: `🌍 ...`
- Taste-label rule: `🏷 {section} - {badge emoji} {badge title}`
- TopTen-item rule: `🔑 {section} - {item}`; known Interests items should include their chip emoji, for example `🔑 Interests - ♟ Chess`

Joinable example:

```text
✅ بهترین ریف تاریخ؟
👥 ۵ نفر داخل گفت‌وگو
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
- `maxMembers`: user-created values follow the configured free/paid capacity choices; recognized language-specific Muze starter seeds are normalized to 100
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
- `ownedOpenDiscussionIds`, normally capped by the configured free limit and able to reach the overall 10-room membership cap only through one-charge-per-extra-room server authorizations; it remains the atomic reservation list
- `discussionMembershipIds`, capped at 10 in MVP
- optional muted discussion ids/preferences
- optional discussion rate-limit metadata

## Rate Limits

MVP should include basic limits:

- Max 3 free active (open) discussions created per user by default; each additional concurrently open owned room requires a fresh paid authorization, up to the overall 10-room membership cap.
- Max 30 discussion messages per user per 10 minutes.
- Max title length: 80.
- Max description length: 300.
- Max message length: 500.
- Max current members per discussion: 20.

Implementation rules:

- Message quota checks should be atomic within the current time window so fast repeated sends cannot bypass the limit.
- Recent-message appends should be atomic and capped to the last 10 messages so concurrent sends do not overwrite each other.
- Join capacity checks should be part of the join mutation so concurrent joins cannot exceed the configured room capacity.

The normal active-owned limit applies to all users, including test accounts. Paid overflow does not remove the limit: each room above it consumes one separately confirmed Star spend, and atomic reservation still prevents unpaid or concurrent callbacks from exceeding the authorized cap.

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
- Delivered text messages keep the compact `sender: message` shape. Render the sender display name in bold using Telegram HTML parse mode, and HTML-escape both sender names and message text before delivery.
- If the message replies to a previous bot-delivered discussion message, forward it as a platform-native reply when the runtime delivery map can resolve the matching message id in each member's chat. Do not add "replying to..." text and do not persist reply metadata in `recentMessages`.
- Sender should receive a short delivery confirmation.
- Text and voice messages are supported (no photos/stickers/files/forwards).
- Links are blocked in all discussion messages to prevent spam and phishing.
- Accept at most one discussion message per user per second. Reject faster messages before storage or broadcast with a short localized slow-down notice.
- Keep the broader limit of 30 accepted discussion messages per user within 10 minutes.
- When an active-room user sends unsupported content (photos, stickers, files, forwards), do not forward or store it. Reply directly to that unsupported message with a short localized `👩‍🦳` notice explaining that discussions currently support text and voice only; fall back to a normal message if native reply metadata is rejected.
- When a user sends a message containing links, reject it immediately with a localized `👩‍🦳` notice that links are not allowed in discussions.
- Keep this unsupported-content notice separate from valid-text delivery failures; a failed text send should ask the user to reopen the discussion and retry.

## Member/Profile Viewing

MVP should allow users to identify who sent a message by display name and view profiles through the members list.

Profile-view interaction:

1. User presses `👥 اعضا`.
2. Bot sends a member list with display names and public profile codes.
3. User taps/sends a profile code.
3. Bot shows the target user's profile.

Public profile codes are preferred over inline buttons under every message so member lists stay compact and work reliably as plain bot text.
Implementation note: member lists can include `/u_CODE` buttons and still support manual typed `/u_CODE` lookup.

## People, Saved Profiles, And Discovery

The `👥 آدم‌ها` / `👥 People` hub is the lightweight people surface connected to discussion profile viewing.

Main menu entry:

```text
👥 آدم‌ها
```

People hub:

```text
👥 آدم‌ها

👀 دیدن آدم‌ها
🔖 ذخیره‌شده‌ها
🔙 برگشت
```

### Seeing People

`👀 دیدن آدم‌ها` is the free, taste-first People discovery entry. It helps users browse public Muze profiles with at least a few shared choices, without adding direct messages, friendship, dating, private chat, or online status.

Discovery rules:

- The viewer must have at least 3 items in one AI list section.
- A candidate appears only when they share at least 3 normalized items with the viewer in the same section.
- Matching uses movies, music, books, and broad interests list data.
- Exclude the viewer, banned users, users without a display name, and users whose `showProfileInPeopleDiscovery` value is explicitly `false`. A missing value remains visible for backward compatibility.
- A user without a public profile code remains eligible; create the code lazily only when that user appears on the visible page.
- Apply the visibility filter in both indexed hydration and fallback scans before result counts, pagination, analytics, or public-code generation. Turning visibility off does not delete taste-index rows, and it does not prevent that user from browsing See People.
- Do not expose private profile fields or private discussion membership.
- Active discussion visibility remains controlled by `showActiveDiscussionOnProfile`.
- Results use page-bound inline Next and Previous actions plus a final Close that deletes only the result card. Profile entries remain code-based commands. The People-hub bottom keyboard remains visible and actionable.
- Shared lines may show the matching section and count, but never private list metadata beyond the overlap count.

Empty-state behavior:

- Empty discovery results use inline `My favorites 🎬🎵📚` and Close actions on the result card while leaving the People-hub bottom keyboard available.
- If the user lacks enough taste data, explain that they need at least 3 choices in one media favorites list or profile Interests and offer a `My favorites 🎬🎵📚` button. Empty discovery states may mention profile Interests, but should not link directly to their editor until that flow can return to People discovery instead of Profile.
- If the user already has enough taste data but no eligible match exists, use a separate no-match message and do not ask them to add the first 3 choices again.
- The old `people:taste` callbacks may route to the free `👀 دیدن آدم‌ها` list so stale inline cards do not break.

Insufficient-list-data state:

```text
👩‍🦳🤷‍♀️ برای دیدن آدم‌ها، اول حداقل ۳ انتخاب به یکی از بخش‌های فیلم، موسیقی و کتاب یا علاقه‌مندی‌های پروفایلت اضافه کن.
```

### Advanced Search Preview

V1 may show `🎛 Advanced Search` as a locked/unavailable entry. The filters and Star purchase are not implemented. [Stars Economy](stars.md) is the source of truth.

- It must clearly say only that the feature is unavailable, show no price, charge no Stars, and return no pretend results.
- The preview has only an inline Close action. Closing removes the card without sending another People message; the persistent People keyboard remains available for navigation.
- Do not promise a launch date.
- Actual age/gender filtering remains blocked until Muze chooses and documents an adults-only or mixed-age discovery policy.
- City filtering may later be evaluated separately and may belong in free discovery rather than the paid feature.

### Saved Profiles

Saved profiles are a lightweight private bookmark layer connected to discussion profile viewing and people discovery.

Recommended behavior:

- A user can save a profile privately.
- Saving is one-way; the saved user is not notified.
- Saved profiles are not friendships and do not open private chat.
- Users can remove saved profiles.
- Saved profiles are mainly created after viewing someone through discussions/member lists.
- Cap saved profiles to keep the feature manageable.

Recommended MVP limit:

- max saved profiles per user: 50
- Saving the 51st profile is rejected atomically across every profile surface. The bot leaves the current UI unchanged and explains that the user can remove someone from Saved Profiles to make room for a new profile. Show this as a temporary inline notice with one `Got it` action that only deletes the notice.

When viewing another user's profile from People or Saved Profiles, show inline profile actions ending in a delete-only Close and keep the People hub bottom keyboard actionable. Discussion-member profiles keep their smaller identity-bound inline Save/Saved and Close surface:

```text
🔖 ذخیره پروفایل
🔙 برگشت
```

If already saved:

```text
🗑 حذف از ذخیره‌شده‌ها
🔙 برگشت
```

If the saved user has at least one visible/open discussion, add the discussion action above remove:

```text
💬 دیدن گفت‌وگوها
🗑 حذف از ذخیره‌شده‌ها
🔙 برگشت
```

Back should return to the surface the profile was opened from: saved profiles or the People discovery list.

Saved profiles inside the people hub:

```text
🔖 آدم‌های ذخیره‌شده

1. 👤 علی
دیدن پروفایل 👈 /u_8K2P
💬 دیدن گفت‌وگوهای این کاربر 👈 /ds_8K2P
حذف از ذخیره‌شده‌ها 👈 /rm_8K2P

2. 👤 سارا
دیدن پروفایل 👈 /u_9Q4M
حذف از ذخیره‌شده‌ها 👈 /rm_9Q4M
```

Saved-profile lists should use text command links for view/discussions/remove actions, not per-profile buttons. Show `/ds_CODE` only when the saved user has at least one visible/open discussion. Once a profile is opened from Saved Profiles or See People, its profile-level Save/Remove and visible-discussions actions are inline and bound to the exact profile code and saved state, followed by a Close action that deletes only the profile card. Discussion-member profile cards keep their separate inline Save/Close behavior.
Saved-profile pagination uses inline Previous/Next actions bound to the exact page and a final Close that deletes only the list card. The People-hub bottom keyboard remains visible and actionable.
Removing a saved profile requires an inline confirmation bound to the exact profile, source, and source page. When Delete starts from an inline public-profile card, replace that card's action buttons with Confirm/Cancel in place; Cancel restores the same profile actions without sending another card. Command/list removal may use a separate confirmation card. Stale confirmation callbacks are ignored.
After Save—whether triggered by `/save_CODE` directly on See People results or from the opened profile—return to the same See People results page instead of rendering the profile. After confirming removal from a viewed profile, return to the same source list page; only Cancel returns to the profile.
Ordinary People results and Saved Profiles lists are edited only for inline pagination and deleted only when their Close action is tapped; navigating onward merely forgets their tracking state. Public-profile previews and their visible-discussion views use inline actions with delete-only Close. Safety-sensitive invitation and discussion-member inline cards retain explicit cleanup/Close behavior.
The visible-discussions view opened from a Saved Profiles or See People profile edits the same profile card, including photo captions, and provides inline Join actions plus Back and Close. Back restores the same profile card and retains its original source page; Close deletes only the card. The `/ds_CODE` list-command entry sends a new inline card because the bot cannot edit a user-authored command message.
When opening a profile from the saved list, retire the list card and render the profile with Remove, visible discussions when available, and a delete-only Close. Saving or removing from a list confirms by name and returns to the list instead of re-rendering the profile.

### Viewing Discussions From Saved Profiles

Users can view discussions of people in their saved profiles list via `/ds_CODE` command when that command is shown. Manually typed/stale `/ds_CODE` commands may still open the discussions view and show the empty state if no visible discussions remain.

The discussions view shows:
- Title with user's name: `💬 گفت‌وگوهای {name}`
- Active discussion (if `showActiveDiscussionOnProfile` is enabled)
- Created discussions (up to 10, open status only)
- Empty state with "Got it" button if no discussions
- Back button to return to saved profiles list

Empty state example:

```text
👩‍🦳 علی هیچ گفت‌وگوی نداره.

[درست] (inline button → returns to saved profiles)
```

Discussions list example:

```text
💬 گفت‌وگوهای علی

📌 گفت‌وگوی فعال
1. بهترین ریف تاریخ؟
   توضیحات: گیتار رو...
   🌍 آزاد ✅ | 5 نفر
   ورود 👈 /d_XY2Z

📌 گفت‌وگوهای ساخته‌شده
1. آلبوم‌های متال برای شروع
   توضیحات: دوست دارم...
   🏷 متال‌هد 🔒 | 3 نفر
   ورود 👈 /d_AB3C

[🔙 برگشت به ذخیره‌شده‌ها] (inline button)
```

Technical notes:
- Query discussions by `creatorUserId` field (not `ownerId`)
- Active discussion only shows if `showActiveDiscussionOnProfile: true`
- Discussions are formatted using `buildDiscussionListText` for consistency
- Empty and non-empty lists use a profile Back button (`profile:view:code:` callback) so Back returns to the profile card first.
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

Active discussion visibility is a separate profile preference and defaults on.

Setting:

```text
نمایش گفت‌وگوهای فعال: روشن/خاموش
```

Rules:

- Default: on, including legacy records where the field is missing.
- If off, profile viewers cannot see the user's active discussion.
- If on, profile viewers can see the user's current active discussion on their profile.
- If the viewer qualifies for the discussion's join rule, show a join action.
- If the viewer does not qualify, show the lock reason.
- Never reveal active discussion when this setting is explicitly off.
- Store this as `showActiveDiscussionOnProfile`, default `true`.
- The profile shows the current setting to its owner.
- Show this setting only to the profile owner, not to other users viewing the profile.

Example:

```text
💬 گفت‌وگو فعلی علی:
بهترین ریف تاریخ؟

🔓 می‌تونی وارد بشی
```

Locked example:

```text
💬 گفت‌وگو فعلی علی:
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

Stars remain a private supporting economy. Paid boosts or filters must not turn discussions and People discovery into unrestricted advertising, dating, wealth ranking, or pay-to-bypass social access.

## Shared Links And Direct Invitations

- Users who have already completed onboarding see a public discussion share-link preview immediately without creating a new inbox row. New users and existing users with unfinished onboarding complete the normal onboarding flow first; referral attribution and the public discussion code persist on the User across restarts, and the available original room is preserved as described below.
- After shared-link onboarding completes, Muze immediately renders the original discussion preview and preserves the available original room as a `shared_link` inbox invitation whether it is joinable or locked by an unmet condition. A joinable preview has inline Join and delete-only Close; a locked preview has its requirement guidance and delete-only Close; neither has Back. Keep the ordinary completion reply keyboard available for other sections and also prepare the normal Interest-matched or Free Discussion starter invitation. Do not preserve missing, closed, full, removed-user, or already-member shared rooms. Joining remains explicit and applies the normal profile-name, open/full, capacity, ban, mute, restriction, active-room, and taste rules. Do not show the optional post-join Interests nudge or leave its reply keyboard active inside the room.
- Only a direct in-bot invitation addressed to a specific existing saved profile may earn the directed-pair reward after its first eligible successful acceptance. A joinable or locked shared-link destination preserved during onboarding is a non-rewarding inbox entry; shared links can otherwise earn only the genuinely-new external-referral reward.
- If the room becomes unavailable during onboarding, continuation uses the normal unavailable/join error without replacing or duplicating attribution.
