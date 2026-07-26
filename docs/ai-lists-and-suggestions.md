# AI Lists And Suggestions

## Sections

- AI assistant/List menu includes the media sections only: movies, music, and books.
- On each user's first successful visit, the main Movies, Music & Books / Favorites hub is one photo card using `assets/favorites-hub-banner.jpg`, with the existing localized hub copy as its caption and normal controls beneath it. Later visits are text-only so Telegram chat history and shared media do not accumulate repeated banners. Persist the per-user banner timestamp only after successful photo delivery; a failed photo attempt falls back to the complete text hub and remains eligible for retry. Banner delivery uses the shared Mongo-backed Telegram `file_id` cache; `FAVORITES_HUB_BANNER_FILE_ID` is only an optional seed.
- Interests are edited from Profile and collected during onboarding, not shown as a fourth button inside the Lists hub.
- The internal `random` section stores profile/onboarding interests and should be treated as user-facing `🌿 علاقه‌مندی‌ها` / `🌿 Interests`, not as a leftover miscellaneous bucket.
- `🌿 علاقه‌مندی‌ها` should feel first-class in Profile and onboarding for users who are not strongly into movies, music, or books.
- Media section entry opens the section TopTen manager directly; there is no separate section home/lobby. User-facing copy presents this as Favorites while the internal storage name remains `topTen`.
- Media section entry should keep its section title visible in the active manager so users can see their path. On the first successful Movies, Music, or Books entry per user, the existing manager is sent as a single photo card using `assets/movies-section-banner.jpg`, `assets/music-section-banner.jpg`, or `assets/books-section-banner.jpg`, with the localized manager text as its caption and the normal controls beneath it; it must not send a separate banner message. Persist an independent per-section banner timestamp only after successful photo delivery. Later entries use the complete text manager without another photo, and failed photo attempts remain eligible for retry. Banner delivery reuses the global Mongo-backed Telegram `file_id`, accepts `MOVIES_SECTION_BANNER_FILE_ID` / `MUSIC_SECTION_BANNER_FILE_ID` / `BOOKS_SECTION_BANNER_FILE_ID` as optional seeds, and uploads then persists the bundled asset when no reusable ID exists. Change a banner's cache key when replacing its artwork so Telegram does not continue serving the prior cached asset. If the full manager text exceeds Telegram's photo-caption limit, retain the complete text in one text manager card instead of splitting it across messages.
- The TopTen/Favorites manager is the section home. Its actions are progressive: add a favorite, show the concrete save-for-later list only after that list has its first item, show suggestion only after three favorites, and Back. Every visible Favorites reply button, including the section-emoji Suggest button, must resolve through the exact section/list mode. Saving a suggestion as the first save-for-later item reveals the list action on subsequent Favorites renders.
- The list/watchlist manager is secondary storage. Its Back action returns to the section TopTen, not to a separate section home.
- Opening a For Later manager from a suggestion must enter the watchlist manager state. Its Favorites button retires the current manager card before opening Favorites.
- Media section actions should carry the active section emoji for orientation. User-facing secondary-list names should explicitly identify themselves as lists: Movies `Watch Later list`, Music `Listen Later list`, and Books `Read Later list`. Persian uses the natural first-person names `لیست «بعدا می‌بینم»`, `لیست «بعدا گوش می‌دم»`, and `لیست «بعدا می‌خونم»`.
- Empty media Favorites should explain that these are things the user genuinely loves, that three unlock suggestions, and that the list can grow to the configured TopTen limit.
- Favorites manager copy and its Add button should progress through empty, early (one or two), unlocked (three through limit-minus-one), and complete states. Advanced benefits should be introduced after the user starts rather than front-loaded into the empty state.
- Media Favorites titles and add buttons should name the item directly: favorite movies, songs, or books. Music accepts a song title or clearly titled audio; do not introduce artists as a separate Favorites concept.
- Media add prompts should be section-specific: an exact movie title, a song (or clearly titled audio), or a book title. Send one item per message.
- Persian suggestion actions must make the direction explicit with wording such as `از میوز پیشنهاد بگیر`; avoid a standalone `پیشنهاد` button that could be mistaken for submitting a recommendation to someone else.
- Free-form text in AI section/manage states should not trigger AI suggestions; reply with guidance to use the active card buttons.
- There is no plain section hub; stray text in a section should point back to the active card actions for add, list, or suggestion.
- In list, Top 10, or suggestion bottom modes, stray text does not activate an action or reset navigation. Keep the current mode and use concise guidance only when needed. After a suggestion result, persist the result action context so stray text or a stale Back label can only restore the same Save/Done/Reject controls; it must not expose a generic section keyboard, create a blank navigation footprint, or clear the Favorites manager.
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
- Favorites and For Later managers do not expose standalone list-sharing actions. Profile sharing is the single taste-sharing path: once any Movies, Music, or Books Favorites list contains at least three items, the own-profile card can create a shareable profile whose recipients may browse the public Favorites lists inside Muze when `showFavoritesOnProfile` is enabled. For Later lists never count toward this threshold. Turning that default-on profile privacy setting off keeps the lists available for personal suggestions, matching, and discussion eligibility while omitting Favorites and taste labels from public profiles and newly generated shareable-profile cards.
- List-return buttons should consistently say `Back to list` / `برگشت به لیست`, including Favorites, watchlists, suggestions, add flows, and shareable-list guidance. Never expose the internal `Top 10` name.
- List-level add, filters, status views, navigation, input cancel, and suggestion actions use bottom buttons bound to the exact section/list/filter mode. A filtered For Later view must keep its visible Add, Show all, and Go to favorites buttons actionable; Go to favorites must not fall through to add guidance. Inline remains for transactional confirmations and feature-specific native share/copy surfaces outside list management.
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

Media taste labels are suggested only after all 10 Favorites are complete. The bot sends the complete section list, including optional comments, to the configured AI provider and asks for up to three meaningful section-label keys ordered from strongest to weaker match. The code must not contain title, creator, author, artist, or alias dictionaries for media classification. Provider output is accepted only as compact structured data containing allowlisted keys. Unknown titles must not become genre evidence merely from how their words sound, look, or are spelled; when most entries cannot be recognized or understood from their comments, the provider should return no specific matches. The application appends the section's broad Book Buff, Movie Buff, or Music Buff fallback as the final choice, for at most four label choices total.

An AI shortlist is not an active label until the user taps one choice. Selecting a ranked option confirms it in one tap and returns to the refreshed Favorites list; `No label` does the same without a badge. A result may also include one optional, factual sentence about the shared pattern across the choices. Keep it to 5–18 words and 120 characters, describe the list rather than the user's personality, and show it only when at least one specific label matches and the provider supplies at least four exact recognized titles as hidden evidence. Wrong-language, multiline, malformed, weakly evidenced, fallback-only, or overlong insights are discarded without failing the badge result. Later, `Change label` reopens only that latest saved shortlist, marks the active choice with the same plain `✓` used by Interest pickers, and includes an inline Close action that deletes only the picker card. The full label catalog is never offered for arbitrary selection, and the server rejects labels outside the saved shortlist. The bot edits one placeholder through honest still-waiting messages while the provider call runs and never claims that completion is near. When the first AI check is unavailable or returns invalid output, show `Try again` and `Back to list`; explain that the completed Favorites list keeps its `Taste label` reply-keyboard action so the user can retry later. A failed provider call does not consume the first successful free check. Suggestions and profiles continue to use the actual Favorites data; the label is an optional identity/discovery badge rather than an objective verdict.

Classification is cached by a versioned fingerprint of the exact ordered list and its comments. Reopening an unchanged completed list must not make another provider request. The first arrival at 10 Favorites makes one automatic free-check attempt; record that attempt separately from the first successful free result. If the automatic attempt fails, later retries remain free but are user-triggered from `Taste label`. Dropping below 10 and refilling the list must return directly to the refreshed list with its saved-item confirmation, never an automatic label card, provider call, waiting sequence, or repeated label-ready copy. Keep the latest saved shortlist and optional insight rather than presenting them as a fresh result.

The first successful classification in each Favorites section is free. A confirmed label remains earned after items are removed. A saved `No label` choice also retains its shortlist. While fewer than 10 items remain, keep `Taste label` visible only for an earned label or saved No-label choice, allow switching among the saved shortlist or removing the label, hide paid recheck, and show `Complete this section’s Favorites to check again ({count}/10)`. Once the list returns to exactly 10, paid recheck may be requested even when `No label` is active, subject to the economy, spending, and dashboard switch. Rechecks require price/balance confirmation, revalidate the current price, exact list, and snapshotted current choice before spending, and refund through the Star ledger if no usable result is produced. A usable recheck replaces the saved shortlist but leaves the active label—or No label—unchanged until the user taps a choice.

The stable internal keys keep these approved user-facing titles:

| Section | Persian | English |
| --- | --- | --- |
| Music | `🤘 متال‌هد`, `🎸 راکر`, `🌌 پست‌راکر`, `⚡ پانک`, `🎤 پاپ‌باز`, `🎧 هیپ‌هاپ‌هد`, `🎛️ الکترونیک‌باز`, `🎼 کلاسیک‌باز`, `🎷 جزباز`, `🌙 روح‌ایندی`, `🪕 سنتی‌باز`, `🎧 موزیک‌باز` | `Metalhead`, `Rocker`, `Post-Rocker`, `Punk`, `Pop Lover`, `Hip-Hop Head`, `Electronic Fan`, `Classical Listener`, `Jazz Head`, `Indie Spirit`, `Traditional Music Fan`, `Music Buff` |
| Movies | `🚀 علمی‌تخیلی‌باز`, `💥 اکشن‌باز`, `🎭 درام‌باز`, `🔎 معما و تریلر`, `😄 کمدی‌باز`, `🕯️ ترسناک‌باز`, `💌 عاشقانه‌باز`, `🐉 فانتزی‌باز`, `✨ انیمیشن‌باز`, `🎥 مستندبین`, `🎞️ سینه‌فیل`, `🎬 فیلم‌باز` | `Sci-Fi Fan`, `Action Junkie`, `Drama Lover`, `Mystery & Thriller Fan`, `Comedy Fan`, `Horror Fan`, `Romance Fan`, `Fantasy Fan`, `Animation Lover`, `Documentary Viewer`, `Cinephile`, `Movie Buff` |
| Books | `📖 رمان‌خوان`, `📜 روح قدیمی`, `🐉 خیال‌پرداز`, `🚀 کاوشگر علمی‌تخیلی`, `🔎 کارآگاه بالفطره`, `💌 رمانتیک درمان‌ناپذیر`, `🧠 فیلسوف نیمه‌شب`, `🪞 روان‌کاو آماتور`, `💡 حقیقت‌یاب`, `✒️ شاعرانه`, `📚 کتاب‌باز` | `Novel Reader`, `Old Soul`, `Fantasy Dreamer`, `Sci-Fi Explorer`, `Natural Detective`, `Hopeless Romantic`, `Midnight Philosopher`, `Amateur Psychoanalyst`, `Truth Seeker`, `Poetic Soul`, `Book Buff` |

Changing display titles must not rename internal label keys because stored profiles and discussion join rules depend on those keys.

- TopTen items support add comment / update comment actions.
- TopTen list text should include per-item command links for comment and remove actions. Do not add per-item inline rows when the command-link list can handle the action.
- TopTen typed input should reject obvious placeholders, keyboard mash, and nonsense strings before saving.
- TopTen full-limit copy should be context-aware: direct TopTen add flows should say to remove one from this TopTen, while watchlist promotion can tell the user to go to TopTen and remove one.
- When the 10th TopTen item is saved, exit add mode. A media section's first completion continues into its automatic taste check. On later media refills, return directly to the refreshed full manager with the saved-item confirmation prefixed; do not require a Back-to-list tap or repeat the label-ready copy. Other completion cards may remain visible with Back to list. Never leave an Add button on a full TopTen manager.
- Where a 10th-item Back to list action is shown, it remains valid after add mode transitions to the completed manager state. Any manager re-render must pass the current item count to its keyboard so a full list can never display empty-list actions.
- List/TopTen add states accept text only, except Music may also accept an audio track or recognized audio document when Telegram provides a meaningful track title or filename. Typed Music choices may name a song, album, artist, or band. Do not guess from voice notes, unrelated documents, or generic/untitled media; ask the user to type the title instead.
- When typed list input is rejected, retire the previous bot input prompt and its Cancel button before sending and tracking the fresh retry prompt below the user's message.
- When an input prompt is edited in place, keep tracking its original message id if the platform's successful edit response does not include one.
- After a successful List or TopTen add, keep the user in add mode so they can send the next item immediately. The first untouched add prompt should show Cancel; post-save prompts should show Back to list and explicitly say the user can send the next title in chat.
- Post-save TopTen continuation prompts are bot-authored guidance and should carry the configured Muze marker. The success line itself may keep the short success emoji.
- List save confirmations should name both the saved item and the active user-facing list. Suggestion save confirmations should use Watch Later, Listen Later, or Read Later and their documented Persian names. Avoid generic/internal wording such as "regular list" or legacy watchlist/playlist wording in user-facing progress copy.
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
- improve suggestion and discussion matching with normalized/common interest inputs
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

Profile Interests do not generate taste labels. They appear directly on the profile and may support suggestions, discovery relevance, and concrete Interest-based discussion rules. Do not infer, store, render, or offer an Interests badge from either typed interests or curated chips.

## Media Taste Labels

- Movies, Music, and Books taste labels are stored in `aiTaste.{section}` with:
  - `labelKey`
  - ranked suggested label keys
  - the optional evidence-gated shortlist insight
  - `emoji`
  - confidence
  - sample count
  - source and confirmation status
  - classifier version and input fingerprint
  - first-free-check and confirmation timestamps
  - updated time
- Derive translated label titles at render time.
- Movies, Music, and Books unlock suggestions after 3 TopTen items without showing a preliminary label. Their taste label appears only after all 10 favorites are complete.
- Reclassify an unconfirmed result only when a completed TopTen fingerprint or classifier version changes. Lists below 10 clear pending suggestions but retain user-confirmed labels.
- The first completed-list classification is free. Later user-requested rechecks use the explicit paid confirmation/refund flow described above and are offered only when the list has exactly 10 items and the dashboard-controlled feature is available.

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
- Suggestion requests use a 20-second provider timeout by default; the single edited thinking sequence continues during slower calls, and timeout failures immediately restore Suggest/Back controls. The visible placeholder watchdog stays three seconds beyond the provider timeout to avoid racing a valid response or its refund path.
- While generating a suggestion, send a plain editable placeholder and edit it through each short thinking message and the final result. The Suggest/Back keyboard is one-time so Telegram hides it after the first tap. Persist a generating state and loading navigation mode before starting provider work; queued reply-keyboard taps must be ignored until success, failure, or timeout restores valid controls. Never delete the placeholder as an edit fallback. If an intermediate edit fails, leave it intact and retry on the next state; only send a separate terminal result when Telegram cannot edit the original at all. On success, show the normal result actions. On failure, edit that placeholder into the shared failure message and restore Suggest/Back controls in a valid suggestion mode.
- Users are not forced to complete TopTen before receiving suggestions, but they must add at least three TopTen items in that section before suggestions are allowed.
- If a user asks for a suggestion before the section has three TopTen items, retire the current manager card and show a short `👍 Got it` / `👍 متوجه شدم` acknowledgement card that returns to the section TopTen manager.
- Pressing the section suggestion button explains that Favorites are always the suggestion base. In that prompt, users either type one optional short mood/genre directly or tap Suggest; there is no separate add-mood step.
- Optional mood/genre input is limited to 80 normalized characters. Ask for one short sentence in the normal prompt; mention the exact 80-character limit only when asking the user to shorten oversized input instead of silently truncating it.
- The suggestion prompt must include Suggest and Back actions; Back returns to the section TopTen manager.
- Do not call AI until the user taps Suggest or sends a mood/genre.
- If a typed mood/genre is invalid, the retry prompt provides a section-scoped bottom Cancel button.
- Cancel returns to the section TopTen manager.
- A mood/genre is temporary session context. Suggestion results display it, and Another suggestion reuses it after saves or rejections without asking again. Returning to Favorites and starting Suggestion again begins a fresh session with no mood.
- Suggestions should avoid duplicates from:
  - user's TopTen
  - user's watchlist
  - `aiRecentSuggestions`
- `aiRecentSuggestions.{section}` is capped at 20 stored titles.
- Suggestion prompts should send all TopTen items but only a capped recent slice of watchlist titles, currently 30.
- Local duplicate checks must still use the full watchlist.
- Suggestions are limited to 10 per hour per user per section via `aiSuggestionUsage`.
- Failed/no-response suggestion calls should refund the quota slot.
- On free-suggestion failure, restore the visible retry/back UI before quota cleanup so a slow refund cannot trap the user without controls. Refund errors should be logged without removing the restored UI.
- When the free suggestion limit is reached, Muze may offer one extra suggestion for the configured Star cost. This must be explicit: show the free-limit state, wait time, cost, balance, and Confirm/Cancel buttons. Never charge automatically.
- The paid-suggestion offer should have one combined Cancel-and-return-to-Favorites action, not separate Cancel and Back buttons.
- Paid extra suggestions do not bypass the requirement for at least 3 TopTen items in that section.
- If a paid extra suggestion cannot produce a usable result, refund the Star with a linked ledger transaction and show a short refund notice.
- A paid suggestion that reaches the visible timeout must refund before showing the retry state; a late API result must never complete that timed-out purchase.
- Suggestion reasons are saved as item comments when adding from suggestion buttons.
- Suggestion cards include a `👎 No` action. It should record the rejected title per section, clear the pending suggestion, and avoid repeating rejected titles in future suggestions.
- Expired Save, completed, or reject actions return directly to that section's Favorites manager with the expiry notice included; they must not leave dead suggestion controls active.
- Suggestion results include a native inline `Copy name` action for the exact suggested title. Save, completed, and reject remain in the scoped bottom action prompt sent immediately after the result.
- Suggestions do not auto-send the next item after a status action; users explicitly press the bottom "another suggestion" action or Back to the section manager.
- Suggestion cards that link to both stored destinations should name them as actions: `Go to {For Later list}` and `Go to favorites`, rather than using an ambiguous generic Back/List label.
- For Later navigation and list titles use the section emoji plus `📋` (`🎬📋`, `🎵📋`, `📚📋`). Keep `🗂` for discussions and use `✅` / `⏳` only for item status.
- After saving a suggestion to the section list, the follow-up card should offer another suggestion, the concrete section list, and Back to the section TopTen manager.
- Saving a suggestion as already watched/listened/read/done should use that same three-destination follow-up keyboard and the current section-aware For Later name; do not use legacy `watchlist` wording.

## Stars Milestones

The Stars economy rewards list completion without charging for normal list use. [Stars Economy](stars.md) is the source of truth.

- Each section may award once when its TopTen reaches the configured first milestone, recommended as 3 distinct valid items.
- Each section may award once again when its TopTen reaches the configured completion size.
- Watch Later, Listen Later, and Read Later lists do not award Stars.
- Interests chosen during onboarding are ordinary Interests TopTen items and use the same milestone records; onboarding must not double-award them.
- Removing and re-adding items never awards a milestone twice.
- List mutation helpers remain centralized in `src/services/users.js`. Star qualification happens only after a successful mutation and uses an idempotent ledger key.
- Relevant Top 10 success/progress copy may show the earned amount, resulting balance, and one unclaimed next milestone.
- Basic suggestions and list management remain free. Paid extra suggestions are only offered after the free quota is exhausted and must follow the explicit confirmation/refund rules above.

## Inline For Later Capture

Telegram inline mode provides a narrow capture entry point for the three media For Later lists. It does not add Favorites/TopTen or Interests.

- The user types the item directly after the bot username, for example `@MuzeBot Dune`.
- The Guide explains this under `Quick save to a list` / `ذخیره سریع در لیست`, using the runtime bot username with the configured `BOT_USERNAME` as fallback. The first Movies, Music, or Books For Later manager opened after rollout also appends one compact inline-capture tip; `sectionTipsShownAt.forLaterInline` is marked only after that list card is delivered successfully.
- Inline Movie, Music, and Book article choices include distinct 72px thumbnails so Telegram mobile clients do not render their generic question-mark placeholder. These use version-pinned Twemoji PNG URLs; thumbnail delivery is cosmetic and a CDN failure must not affect saving.
- A non-empty query returns exactly three choices: save to Watch Later, Listen Later, or Read Later. An empty query returns no hint or result.
- Selecting a result sends a small visible confirmation into the current chat; it does not redirect the user away from the chat. Existing users save immediately through `addAiListItem`.
- Keep confirmation copy minimal. Telegram provides native inline-bot attribution, and one localized text-link footer may explicitly open the bot for users who want their full lists. Build it from the validated runtime bot username, use message entities rather than parse mode, and disable link previews.
- Inline answers are personal and uncached. Result identifiers are bound to the Telegram user, selected section, and normalized query; malformed, copied, or altered selections change nothing.
- People who have not started Muze also receive results. Their explicit selections are kept in a separate pending record (maximum 10 items, 30-day TTL) rather than creating a partial User account. Onboarding completion silently imports them through the normal list mutation service; a later `/start` retries a transiently failed import without adding another user-facing message.
- Known banned accounts receive no results, and chosen results always revalidate account state before saving or staging. A short-lived user cache prevents a database read for every typed character.
- Inline-query rate limiting is isolated from ordinary bot interaction. The normal message/callback path performs no inline-capture work, and AI is never called.
- Pending import deletes only the revision it read, so a selection made concurrently with onboarding cannot be lost. Duplicate selections are idempotent, account deletion and product-data cleanup remove pending records, and expired records are removed by MongoDB's TTL index.
- Enable inline mode through `@BotFather` with `/setinline`, then enable `/setinlinefeedback` at 100% so every chosen result reaches the save handler.

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
- Keep exclusion context compact. Use at most two generation attempts, and retry only when local duplicate detection rejects an otherwise valid result.
- Cap suggestion output at 60 tokens for the required two-line response.
- Record provider-reported input, output, and total token usage with AI operational events when available.
