# AI Lists And Suggestions

## Sections

- AI assistant/List menu includes the media sections only: movies, music, and books.
- Interests are edited from Profile and collected during onboarding, not shown as a fourth button inside the Lists hub.
- The internal `random` section stores profile/onboarding interests and should be treated as user-facing `🌿 علاقه‌مندی‌ها` / `🌿 Interests`, not as a leftover miscellaneous bucket.
- `🌿 علاقه‌مندی‌ها` should feel first-class in Profile and onboarding for users who are not strongly into movies, music, or books.
- Media section entry opens the section TopTen manager directly; there is no separate section home/lobby. User-facing copy presents this as Favorites while the internal storage name remains `topTen`.
- Media section entry should keep a small persistent section title card, such as `📚 Books`, above the active manager so users can see their path.
- The TopTen/Favorites manager is the section home. Its actions are progressive: add a favorite, open the concrete save-for-later list, show suggestion only after three favorites, and Back.
- The list/watchlist manager is secondary storage. Its Back action returns to the section TopTen, not to a separate section home.
- Opening a For Later manager from a suggestion must enter the watchlist manager state. Its Favorites button retires the current manager card before opening Favorites.
- Media section actions should carry the active section emoji for orientation. User-facing secondary-list names should explicitly identify themselves as lists: Movies `Watch later list`, Music `Listen later list`, and Books `Read later list` (with natural Persian equivalents).
- Empty media Favorites should explain that these are things the user genuinely loves, that three unlock suggestions, and that the list can grow to the configured TopTen limit.
- Favorites manager copy and its Add button should progress through empty, early (one or two), unlocked (three through limit-minus-one), and complete states. Advanced benefits should be introduced after the user starts rather than front-loaded into the empty state.
- Media Favorites titles and add buttons should name the item directly: favorite movies, songs, or books. Music accepts a song title or clearly titled audio; do not introduce artists as a separate Favorites concept.
- Media add prompts should be section-specific: an exact movie title, a song (or clearly titled audio), or a book title. Send one item per message.
- Persian suggestion actions must make the direction explicit with wording such as `از میوز پیشنهاد بگیر`; avoid a standalone `پیشنهاد` button that could be mistaken for submitting a recommendation to someone else.
- Free-form text in AI section/manage states should not trigger AI suggestions; reply with guidance to use the active card buttons.
- There is no plain section hub; stray text in a section should point back to the active card actions for add, list, or suggestion.
- In list, Top 10, or suggestion bottom modes, stray text does not activate an action or reset navigation. Keep the current mode and use concise guidance only when needed.
- Suggestion source, context, result, save/reject/next, and Back transitions retain prior messages. Clearing tracked suggestion/input/action IDs is database-only and must not call Telegram delete or markup-edit APIs. The callback dispatcher must never treat a reply-keyboard user message as a disposable bot callback card.
- Top 10 and For Later navigation follows the same retained-history rule. Opening add/comment modes, changing filters, returning to a list or section, and switching between the two lists only forget tracked display IDs; it does not delete or edit earlier Telegram messages. Old indexed commands are revalidated against the current list and mode before mutation.
- Replacement list-management cards should preserve their useful description. In Top 10, keep current taste-label/progress context and append only a short button-use tip.
- Media sections stay in the active list-management state; Back from the TopTen returns to the AI assistant menu.
- The AI assistant Back bottom button returns according to its current server-side mode.

## AI Lists

- AI lists are stored under `aiLists.{section}.{listType}`.
- Item objects are `{ title, comment, watched }`.
- `watchlist` is capped at 100 items per section.
- `topTen` is capped at 10 items per section.

## Watchlist

- Watchlist/list rendering should always show the section-aware status marker (`✅` done or `⏳` not done), including first entry and post-mutation refreshes.
- Watchlist supports section-aware status wording:
  - movies: watched
  - music: listened
  - books: read
  - random: done
- Per-item status command labels should use this same section-aware wording, not a generic "done" label for every section.
- Watchlist list text should include per-item command links for:
  - status toggle
  - add comment / update comment, depending on whether the item already has a comment
  - move-to-TopTen, if TopTen has room
  - remove
- Entering a non-empty list manager should show the current items directly in the manager card with command-link item actions; do not include a separate "show all" button.
- Empty watchlist managers should use an intentional empty-state message that points to adding the first item, not just repeat the list title.
- For Later lists do not show a "create shareable message" button. Favorites may show it when they have more than five items. When tapped, remove the current manager card, send the clean formatted Favorites as one standalone plain-text message, then send a separate compact guidance card with native Share and Back to list. There is no copy button because full Favorites content can exceed the platform `copy_text` limit; guidance tells users to long-press the clean list message above. The shared content should omit management command links, status toggles, and inline management controls. If a public bot base link is configured, append only the localized `Made with Muze` / `ساخته‌شده با میوز` marker and link as a small footer. Favorites shares are not referral-attributed.
- List-return buttons should consistently say `Back to list` / `برگشت به لیست`, including Favorites, watchlists, suggestions, add flows, and shareable-list guidance. Never expose the internal `Top 10` name.
- List-level add, filters, status views, navigation, input cancel, and suggestion actions use bottom buttons bound to the exact section/list/filter mode. Inline remains for native share/copy and transactional confirmations.
- Keep per-item command links compact because they repeat under every item, for example `/dn_mv_l_1`, `/cm_mv_l_1`, `/rm_mv_l_1`.
- Separate rendered items with a compact divider so the command links for one item do not visually run into the next item without making long lists too tall.
- Canceling comment input should quietly retire the input prompt and return to the refreshed list manager, without sending a separate "comment canceled" card.
- Legacy status-toggle picker callbacks may remain safe for stale cards, but new list rendering should prefer command links in the list text.
- Moving a watchlist item to TopTen is non-destructive:
  - keep the item in watchlist
  - copy it into TopTen
  - show a `🏆` badge for watchlist items already present in TopTen
- Only completed/watched/read/listened watchlist items should be eligible for move-to-TopTen.
- Already-TopTen items should be hidden from the move picker with a clear message if nothing new is eligible.

## TopTen

- TopTen items support add comment / update comment actions.
- TopTen list text should include per-item command links for comment and remove actions. Do not add per-item inline rows when the command-link list can handle the action.
- TopTen typed input should reject obvious placeholders, keyboard mash, and nonsense strings before saving.
- TopTen full-limit copy should be context-aware: direct TopTen add flows should say to remove one from this TopTen, while watchlist promotion can tell the user to go to TopTen and remove one.
- When the 10th TopTen item is saved, exit add mode and keep the completion message visible with a Back to list button. Open the full TopTen manager only after the user taps that button; do not leave an Add button on a full TopTen manager.
- List/TopTen add states accept text only, except Music may also accept an audio track or recognized audio document when Telegram provides a meaningful track title or filename. Do not guess from voice notes, unrelated documents, or generic/untitled media; ask the user to type the exact title instead.
- When typed list input is rejected, retire the previous bot input prompt and its Cancel button before sending and tracking the fresh retry prompt below the user's message.
- When an input prompt is edited in place, keep tracking its original message id if the platform's successful edit response does not include one.
- After a successful List or TopTen add, keep the user in add mode so they can send the next item immediately. The first untouched add prompt should show Cancel; post-save prompts should show Back to list and explicitly say the user can send the next title in chat.
- Post-save TopTen continuation prompts are bot-authored guidance and should carry the configured Muze marker. The success line itself may keep the short success emoji.
- List save confirmations should name both the saved item and the active user-facing list. Suggestion save confirmations should use the active user-facing list name where possible: Movies watchlist, Music playlist, or Books reading list. Avoid generic/internal wording such as "regular list" in user-facing progress copy.
- Entering add mode sends one visible prompt with a bottom Cancel/Back action. Do not send a keyboard-removal copy or duplicate prompt.
- Entering add mode and saving items retain earlier list and prompt messages; item entry must not delete Telegram messages.
- Saving a typed favorite or interest replies directly with the normal saved/progress message; it must not show an AI placeholder or generate item feedback.
- When a user enters TopTen in any section, include the current list directly in the manager message before its bottom manager controls.
- Completed TopTen manager cards should include a short command-use tip beneath the taste label so comment and remove actions remain clear.
- TopTen menus should not include a separate "show all" action.
- TopTen collector flow still supports `+`/`-` text actions when users choose to curate TopTen directly.
- TopTen includes a cheap "what does my Top 10 say about me?" insight button.
- The TopTen insight should use existing taste label/style data; do not call AI for this insight unless explicitly redesigned later.
- TopTen insight output should be readable:
  - send a standalone insight message with the emoji intro plus the label/vibe analysis
  - then send the normal TopTen manage card/buttons as the follow-up message

## Interests Section

The `random` section is conceptually the broad interests section, but it is surfaced through Profile and onboarding rather than as a fourth Lists hub button.

User-facing naming should prefer:

- Persian: `🌿 علاقه‌مندی‌ها`
- English: `🌿 Interests`

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

When the user is filling Interests, common suggestions are page-bound bottom chips; selected chips stay in place with a check mark.

Purpose:

- make the section easier to start
- help non-media users enjoy the bot
- improve label quality with normalized/common interest inputs
- let users either tap a common item or type their own

Suggested chips should be optional, not restrictive. Users can always type anything.

Initial common chips can include:

```text
🎬 فیلم
📚 کتاب
🎵 موسیقی
♟ شطرنج
💻 کدنویسی
🔬 علم
🧠 روانشناسی
🏛 تاریخ
✍️ نوشتن
🎨 هنر
📸 عکاسی
🧩 بازی فکری
🎲 منچ
🎭 تئاتر
🎧 پادکست
📺 یوتیوب
✈️ سفر
🌿 طبیعت
🧗 کوهنوردی
🐶 حیوانات
🚶 پیاده‌روی
☕ قهوه
🏙 کافه‌گردی
🍳 آشپزی
🍜 غذا
💪 سلامتی
🧘 آرامش
🌱 رشد فردی
💼 کسب‌وکار
💰 سرمایه‌گذاری
⚽ فوتبال
🏋️ باشگاه
🏊 شنا
🎮 گیم
🍥 انیمه
🗣 زبان‌آموزی
🎤 خوانندگی
👗 مد و فشن
🎉 دورهمی
```

Implementation notes:

- Profile Interests and onboarding should share the same curated chip catalog.
- Profile/onboarding Interest pickers should keep selected built-in chips in their original grid position with a `✓` marker; tapping a selected chip removes it. Custom typed interests can appear as removable selected chips above the built-in grid. Do not render partial one- or two-chip item rows.
- Show a rotating page of Interest chips with a More Options action instead of displaying the full catalog at once.
- Profile and onboarding Interest limits and typed-interest character limits are admin-managed operational limits.
- Built-in Interests chips and typed interests use the same normal saved/progress response and never call AI for item feedback.
- Built-in chip selections should be stored canonically and displayed in the current UI language; custom typed interests should keep the user's original text.

### Interests Labels

The Interests section should have cooler and more specific labels than a generic "multi-interest" fallback.

Potential labels:

- `♟ استراتژی‌باز` / strategy-minded
- `💻 تکنولوژی‌باز` / tech fan
- `☕ کافه‌گرد` / cafe lover
- `🍜 فودی` / foodie
- `🎮 گیمر` / gamer
- `🌍 ماجراجو` / explorer
- `🎨 اهل ساختن` / maker
- `🏃 اسپرتی` / sporty
- `🧘 آرام‌جو` / mindful
- `🎉 اهل جمع` / people person
- `📸 لحظه‌ساز` / photo/story seeker
- `🌿 چندعلاقه‌ای` / multi-interest

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
- Duplicate responses are bot-authored messages and keep the same continuous-add bottom controls as a successful non-final add.
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
- Animated AI placeholders must serialize edits so a late loading step cannot overwrite the final result. Suggestion placeholders must also end in a visible retry state after a bounded timeout.
- Users are not forced to complete TopTen before receiving suggestions, but they must add at least three TopTen items in that section before suggestions are allowed.
- If a user asks for a suggestion before the section has three TopTen items, retire the current manager card and show a short `👍 Got it` / `👍 متوجه شدم` acknowledgement card that returns to the section TopTen manager.
- Pressing the section suggestion button should first show a choice prompt:
  - suggest from TopTen
  - or collect one short mood/genre note
- The suggestion choice prompt must include a Back action that returns to the section TopTen manager.
- Do not call AI until the user chooses.
- The mood/genre suggestion input state provides a section-scoped bottom Cancel button.
- Cancel returns to the section TopTen manager.
- Suggestions should avoid duplicates from:
  - user's TopTen
  - user's watchlist
  - `aiRecentSuggestions`
- `aiRecentSuggestions.{section}` is capped at 20 stored titles.
- Suggestion prompts should send all TopTen items but only a capped recent slice of watchlist titles, currently 30.
- Local duplicate checks must still use the full watchlist.
- Suggestions are limited to 10 per hour per user per section via `aiSuggestionUsage`.
- Failed/no-response suggestion calls should refund the quota slot.
- When the free suggestion limit is reached, Muze may offer one extra suggestion for the configured Star cost. This must be explicit: show the free-limit state, wait time, cost, balance, and Confirm/Cancel buttons. Never charge automatically.
- The paid-suggestion offer should have one combined Cancel-and-return-to-Favorites action, not separate Cancel and Back buttons.
- Paid extra suggestions do not bypass the requirement for at least 3 TopTen items in that section.
- If a paid extra suggestion cannot produce a usable result, refund the Star with a linked ledger transaction and show a short refund notice.
- Suggestion reasons are saved as item comments when adding from suggestion buttons.
- Suggestion cards include a `👎 No` action. It should record the rejected title per section, clear the pending suggestion, and avoid repeating rejected titles in future suggestions.
- Suggestions do not auto-send the next item after a status action; users explicitly press the bottom "another suggestion" action or Back to the section manager.
- Suggestion cards that link to both stored destinations should name them as actions: `Go to {For Later list}` and `Go to favorites`, rather than using an ambiguous generic Back/List label.
- After saving a suggestion to the section list, the follow-up card should offer another suggestion, the concrete section list, and Back to the section TopTen manager.
- Saving a suggestion as already watched/listened/read/done should use that same three-destination follow-up keyboard and the current section-aware For Later name; do not use legacy `watchlist` wording.

## Stars Milestones

The Stars economy rewards list completion without charging for normal list use. [Stars Economy](stars.md) is the source of truth.

- Each section may award once when its TopTen reaches the configured first milestone, recommended as 3 distinct valid items.
- Each section may award once again when its TopTen reaches the configured completion size.
- Watchlists, playlists, and reading lists do not award Stars.
- Interests chosen during onboarding are ordinary Interests TopTen items and use the same milestone records; onboarding must not double-award them.
- Removing and re-adding items never awards a milestone twice.
- List mutation helpers remain centralized in `src/services/users.js`. Star qualification happens only after a successful mutation and uses an idempotent ledger key.
- Relevant Top 10 success/progress copy may show the earned amount, resulting balance, and one unclaimed next milestone.
- Basic suggestions and list management remain free. Paid extra suggestions are only offered after the free quota is exhausted and must follow the explicit confirmation/refund rules above.

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
