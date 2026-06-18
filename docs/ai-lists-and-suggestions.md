# AI Lists And Suggestions

## Sections

- AI assistant menu includes movies, music, books, and interests sections.
- The internal `random` section should be treated as user-facing `🧩 علاقه‌مندی‌ها` / `🧩 Interests`, not as a leftover miscellaneous bucket.
- `🧩 علاقه‌مندی‌ها` should feel first-class for users who are not strongly into movies, music, or books.
- AI section entry should be a guided hub message, not an open chat prompt.
- Free-form text in AI section chat state should not trigger AI suggestions; reply with guidance to use the bottom buttons.
- In a plain section hub, stray text should keep the bottom controls and clearly direct the user to List, Top 10, or Suggestion.
- In list, Top 10, or suggestion inline-action states, stray text should retire the current inline card and send one fresh guidance card with the same relevant options.
- Replacement list-management cards should preserve their useful description. In Top 10, keep current taste-label/progress context and append only a short button-use tip.
- In AI sections, users stay in chat state until pressing the bottom text back button.
- Bottom AI-section back returns users to the AI assistant menu.
- The inline AI assistant back button returns to the main menu.

## AI Lists

- AI lists are stored under `aiLists.{section}.{listType}`.
- Item objects are `{ title, comment, watched }`.
- `watchlist` is capped at 100 items per section.
- `topTen` is capped at 10 items per section.
- Use `scripts/migrate-ai-lists.js` to move legacy flat lists into `aiLists`.
- Use `scripts/rollback-ai-lists.js` to restore legacy fields if needed.

## Watchlist

- Watchlist/list rendering should always show the section-aware status marker (`✅` done or `⬜` not done), including first entry and post-mutation refreshes.
- Watchlist supports section-aware status wording:
  - movies: watched
  - music: listened
  - books: read
  - random: done
- Watchlist includes inline actions for:
  - status toggle
  - comment edit
  - move-to-TopTen, if TopTen has room
- Status-toggle pickers should show each item's current `✅`/`⬜` marker and explain that tapping an item switches it.
- Moving a watchlist item to TopTen is non-destructive:
  - keep the item in watchlist
  - copy it into TopTen
  - show a `🏆` badge for watchlist items already present in TopTen
- Only completed/watched/read/listened watchlist items should be eligible for move-to-TopTen.
- Already-TopTen items should be hidden from the move picker with a clear message if nothing new is eligible.

## TopTen

- TopTen items support comment edit.
- TopTen typed input should reject obvious placeholders, keyboard mash, and nonsense strings before saving.
- List/TopTen add states accept text only, except Music may also accept an audio track or recognized audio document when Bale provides a meaningful track title or filename. Do not guess from voice notes, unrelated documents, or generic/untitled media; ask the user to type the exact title instead.
- When typed list input is rejected, retire the previous bot input prompt and its Cancel button before sending and tracking the fresh retry prompt below the user's message.
- When an input prompt is edited in place, keep tracking its original message id if the platform's successful edit response does not include one.
- After a successful List or TopTen add, keep the user in add mode so they can send the next item immediately. The first untouched add prompt should show Cancel; post-save prompts should show Back to list.
- If a suspicious item ever reaches taste feedback, use neutral "I do not recognize this" copy instead of complimenting it.
- Typed-item feedback should react to the item itself, not infer the user's personality.
- For recognizable works, feedback should contain one concrete reaction about the creator, form, genre, joke, theme, feeling, or atmosphere. Avoid encyclopedia-style summaries such as "X is a popular comedy about...".
- Reject generic praise such as "great choice", "cool pick", or "this says you...". If no grounded reaction is available, omit the reaction and show the normal saved/progress message instead of implying the valid item is suspicious, repeating the save confirmation, or inventing facts.
- When a user enters TopTen in any section, send the current TopTen list as a separate message before the section/manage description and inline buttons.
- TopTen menus should keep the "show all" action even though the list is also shown on entry.
- TopTen collector flow still supports `+`/`-` text actions when users choose to curate TopTen directly.
- TopTen includes a cheap "what does my Top 10 say about me?" insight button.
- The TopTen insight should use existing taste label/style data; do not call AI for this insight unless explicitly redesigned later.
- TopTen insight output should be readable:
  - send a standalone insight message with the emoji intro plus the label/vibe analysis
  - then send the normal TopTen manage card/buttons as the follow-up message

## Interests Section

The `random` section is conceptually the broad interests section.

User-facing naming should prefer:

- Persian: `🧩 علاقه‌مندی‌ها`
- English: `🧩 Interests`

This section should welcome broad life/hobby interests such as:

- chess
- coding
- cafes
- coffee
- games
- travel
- food
- sports
- photography
- anime
- podcasts
- YouTube
- fashion
- board games
- nature
- gym
- cooking
- art
- writing
- technology

TopTen items in this section do not need to be media titles. They can be activities, hobbies, places, habits, games, or topics.

Examples:

```text
شطرنج
کدنویسی
کافه‌گردی
قهوه
Elden Ring
پیاده‌روی شبانه
عکاسی خیابونی
سفر تنها
```

### Suggested Interest Chips

When the user is filling the Interests TopTen, the bot can show common interest suggestions as inline buttons/chips.

Purpose:

- make the section easier to start
- help non-media users enjoy the bot
- improve label quality with normalized/common interest inputs
- let users either tap a common item or type their own

Suggested chips should be optional, not restrictive. Users can always type anything.

Initial common chips can include:

```text
♟ شطرنج
💻 کدنویسی
☕ قهوه
🏙 کافه‌گردی
🎮 گیم
🍜 غذا
✈️ سفر
📸 عکاسی
🏃 ورزش
🎨 هنر
🧘 آرامش
🎧 پادکست
📺 یوتیوب
🌿 طبیعت
🍳 آشپزی
🧠 روانشناسی
💪 سلامتی
🌱 رشد فردی
💼 کسب‌وکار
💰 سرمایه‌گذاری
🧩 بازی فکری
🎭 تئاتر
```

Implementation notes:

- Chips should use the same add flow as typed input, including duplicate detection and TopTen limit checks.
- The Interests TopTen editor and onboarding should share the same curated chip catalog.
- Show nine Interests chips at a time with a More Options action instead of displaying the full catalog at once.
- After a chip is selected, delete the chip picker message so the old options do not stay in chat.
- Chip selection should show the same placeholder/feedback flow as typed TopTen input.
- Known chips should have predefined meaningful feedback, so common choices such as `کدنویسی`, `گیم`, `شطرنج`, and `Coffee` do not need a first-time AI call.
- Every built-in Interests chip should have predefined feedback, so choosing one never calls AI or shows unknown-item copy.
- If a user types the same known chip text manually, the predefined feedback should still apply.

### Interests Labels

The Interests section should have cooler and more specific labels than a generic "multi-interest" fallback.

Potential labels:

- `♟ استراتژی‌باز` / strategy-minded
- `💻 تکنولوژی‌دوست` / tech-minded
- `☕ کافه‌گرد` / cafe lover
- `🍜 فودی` / foodie
- `🎮 گیمر` / gamer
- `🌍 ماجراجو` / explorer
- `🎨 خلاق` / creator
- `🏃 فعال` / active
- `🧘 آرام‌جو` / mindful
- `🎉 اجتماعی` / social
- `📸 لحظه‌ساز` / photo/story seeker
- `🧩 چندعلاقه‌ای` / multi-interest

Labels should be inferred from both typed items and suggested chips.

## Taste Labels

- Taste labels are stored in `aiTaste.{section}` with:
  - `labelKey`
  - `emoji`
  - confidence
  - sample count
  - updated time
- Derive translated label titles at render time.
- Taste labels are temporary after 3 TopTen items and stronger after 10.
- Recalculate labels whenever TopTen changes.

## Duplicate Detection

- AI list duplicate detection should run across all sections and list types, not just music.
- Duplicate detection should return match data for better duplicate messages.
- After a mutation, do not build follow-up copy from stale `ctx.user` when the service already returned updated items.
- Use the updated result to avoid incorrect full/progress messages.
- Track the last bot-sent AI list message (`aiLastListMessageId`, section, type) so stale list displays can be deleted after mutating actions.

## Suggestions

- Suggestions in AI sections return exactly one item plus a very short reason.
- Interests suggestions should recommend a concrete activity, hobby step, game, creator, channel, podcast, place, tool, community, course, or experience tied to the user's saved interests.
- Interests suggestions must not default to books, movies, or songs unless the user's Interests TopTen explicitly points toward that medium.
- Prefer named resources and tightly-defined actions over generic containers such as joining a class, group, club, or workshop.
- Reasons must mention the relevant saved interest and explain the concrete connection; reject generic skill/social-benefit copy.
- Avoid repeating the same recommendation family across recent Interests suggestions even when the wording differs.
- Do not include type labels such as `(activity)` / `(فعالیت)` in saved suggestion titles.
- OpenAI-compatible providers may use either Chat Completions or Responses payloads; suggestion handling should accept both response shapes and show a visible fallback instead of failing silently.
- Users are not forced to complete TopTen before receiving suggestions, but they must add at least three TopTen items in that section before suggestions are allowed.
- Pressing the section suggestion button should first show a choice prompt:
  - suggest from TopTen
  - or collect one short mood/genre note
- Do not call AI until the user chooses.
- The mood/genre suggestion input state should hide the bottom keyboard and provide an inline cancel button.
- Cancel returns to the same section entry message and keyboard.
- Suggestions should avoid duplicates from:
  - user's TopTen
  - user's watchlist
  - `aiRecentSuggestions`
- `aiRecentSuggestions.{section}` is capped at 20 stored titles.
- Suggestion prompts should send all TopTen items but only a capped recent slice of watchlist titles, currently 30.
- Local duplicate checks must still use the full watchlist.
- Suggestions are limited to 10 per hour per user per section via `aiSuggestionUsage`.
- Failed/no-response suggestion calls should refund the quota slot.
- Suggestion reasons are saved as item comments when adding from suggestion buttons.
- Suggestions should not auto-send the next item after a status action; users should explicitly press the inline "another suggestion" button.

## AI Cost Rules

- Normalize user text before AI/cache work:
  - lowercase
  - trim
  - collapse spaces
  - remove filler phrases and unnecessary punctuation
- Use cache lookup before response generation:
  - exact normalized match
  - conservative fuzzy match
  - optional embedding/semantic match
- Keep fuzzy/semantic thresholds configurable.
- Bias toward avoiding false positives over saving one API call.
- Store reusable AI responses with:
  - original input
  - normalized input
  - category
  - response
  - embedding when enabled
  - hit count
  - last-used time
- Log cache match type: `exact`, `fuzzy`, `semantic`, `new_api_call`.
- For recommendation prompts, send only the context the model needs.
