# Bot UX Rules

Bottom reply-keyboard buttons are server-authorized actions, not trusted Telegram client state. Discussion and People list buttons are bound to the exact list type and page; create-wizard, paid-capacity, profile-action, and saved-profile removal buttons are bound to their durable server-side context. Stale or manually typed labels do not activate outside that mode. Identity-bound invitation/join actions and other payload-sensitive cards remain inline where documented.

## Narrative Voice And Persian Writing

- When Muze speaks personally to the user, use first person in both languages: “I prepared… / I’ll tell you…” and «برات آماده کردم / بهت می‌گم». Do not switch that same thought to third-person “Muze / میوز”.
- Use neutral language for interface text, system state, and operational status when no personal speaker is needed.
- Use third-person “Muze / میوز” only in external or shareable copy, legal and rules text, product descriptions, interface labels, and operational notices sent when Muze itself is unavailable. Introductions such as “I’m Muze / من میوزم” still use first person.
- Keep Persian and English equivalent in speaker and point of view, including onboarding invitations, discussion guidance, service and busy messages, limited-access copy, and emoji validation.
- Keep Persian informal and friendly. Never use tanwin: write «فعلا»، «بعدا»، and «احتمالا», not «فعلاً»، «بعداً»، and «احتمالاً».
- Do not put a hamze above a final heh. When ezafe is needed, use «ی»: «درباره‌ی»، «خانه‌ی»، and «دکمه‌ی», not «دربارهٔ»، «خانهٔ»، or «دکمهٔ». Without ezafe, keep the plain final heh.

## Low-Noise Conversation

Home is a stable button-based menu. In Home and other idle section hubs, unrecognized text receives the same short instruction to use the available buttons; active discussions, onboarding, commands, deep links, and temporary input flows keep precedence.

Similar-people re-engagement is an occasional background notification, not Home content. Send it only after the dashboard-configured inactivity window and documented cooldown when normal People discovery verifies at least one newly joined eligible profile. Delivery alone never changes discussion membership. If the user taps its See People button while still in an active discussion, leave through the normal discussion navigation action before opening People. Keep the copy grouped and private; never reveal the candidate, exact overlap, count, or join time in the notification. See [Similar People Re-engagement](similar-people-reengagement.md).

- Stable destinations and converted contextual flows use persistent bottom keyboards and do not create navigation footprints. Ordinary navigation retains earlier messages and makes no Telegram delete/edit cleanup call. Legacy navigation-card IDs are forgotten without touching Telegram.
- Before sending a stable Home, Profile, Favorites, Discussions, People, or Guide reply keyboard, persist `state: idle` and its matching navigation mode together. This ordering prevents a process restart or deployment from leaving Telegram's visible keyboard ahead of the server-authorized mode. Do not reset all users at startup or erase legitimate in-progress flows globally.
- Inline cleanup is flow-specific and limited to cards whose payload can become unsafe or incorrect: indexed mutations, identity-bound actions, destructive confirmation, payment/nonce confirmation, and temporary share/member cards with explicit Close.

- Prefer one clear hub message per menu instead of sending repeated "back" or "returned" messages.
- In idle menu sections, otherwise-unrecognized text receives one short localized instruction to use the available buttons, without resetting navigation. A delayed duplicate reply-keyboard label is treated the same way. Temporary input flows and active discussion messages keep their own validation or delivery behavior.
- Bot-authored guidance, empty states, and safe error messages should start with the configured Muze marker emoji so they feel clearly from the bot. The default marker is `👩‍🦳`, and admins can change it from the dashboard. Short success confirmations can keep their action/status emoji.
- Bot-authored messages sent before normal app-context routing, such as allowlist and banned-user blocks, should still apply the configured Muze marker emoji.
- Edit an existing bot message when navigating menus if possible.
- Delete stale inline picker messages after the user chooses an item.
- When a returning user changes the interface language, retire the language picker, send the localized change confirmation, then enter the localized Home bottom mode. Old-language labels no longer resolve.
- Keep ordinary social-list cards and their identity-bound controls unchanged as chat history after actions. Revalidate those actions against current state when tapped again; edit pagination only on an explicit page tap, and reserve deletion for temporary confirmations, warnings, explicit Close/Cancel actions, and other unsafe cards.
- After a create/edit flow is confirmed or canceled, remove leftover step cards so dead inline actions are not left in chat.
- If a flow naturally moves from one picker to another, editing the same message in place is preferred.
- Do not delete user messages.
- Only delete bot messages that are temporary, stale, or invalid after the next action.
- If an inline message contains item indexes, remove or edit it after a mutating action so old buttons cannot act on shifted indexes.
- When deleting list items, confirm the removed item by name and render the current manager controls. Retained older command lists are harmless because indexed commands are validated against current state.
- Pressing "back" in non-cancel flows should not send cancel copy (for example "operation canceled").
- Back button labels should use `🔙` as the visible back emoji.
- Numeric inline button rows should be ordered so the visible numbers start from the left in both Persian and English clients.
- When leaving an AI section/manage flow via Back, return from the section Top 10 to the AI assistant menu and clear any tracked section title/list cards.
- When clearing a temporary reply keyboard before an inline menu, prefer sending the destination menu text with `remove_keyboard`, then editing that same message to attach inline buttons. Avoid separate invisible/empty cleanup bubbles and avoid sending the same visible menu text twice.
- Context titles/cards should exist only while their section is active; remove tracked title cards when user leaves that section.
- Entering a section/list should show the relevant section/list title immediately, not only after returning from submenus.
- If a user types while viewing an AI list outside an input step, keep the list unchanged and explain that they should tap Add before sending the item.

## Global Command Navigation

- Keep Telegram's native command menu focused on `/start`, `/menu`, `/profile`, `/taste`, `/discussions`, `/people`, and `/help`. `/lang` remains supported as an optional shortcut.
- Global navigation commands must work from normal menus, temporary input flows, and active discussions, including Telegram's `/command@BotName` form.
- Commands and deep links override stale visible keyboards and install their destination mode. Old bottom labels are harmless because resolution uses the new server-side mode; only unsafe inline cards receive explicit cleanup.
- Stable and flow-control reply keyboards request Telegram's persistent-keyboard behavior so mobile clients do not collapse them when a deep link opens an inline preview. Invite Close/Got-it paths also resend the unchanged stable destination keyboard when one can be reconstructed, covering older clients without changing the user's navigation mode or an in-progress text flow.
- Global navigation currently follows the same product behavior as Home navigation: using it while active in a discussion leaves that discussion and clears the room keyboard.
- Unknown slash commands inside an active discussion must not be delivered as room messages.

## Input Collection

- When collecting typed input, install a temporary mode with a bottom Cancel/Back action unless the prompt carries an identity-bound or transactional inline payload. Do not emit a separate empty cleanup bubble.
- Cancel/back copy should match the action: "back" should not sound like an operation was canceled unless an input flow was actually canceled.
- The discussion-entry name gate must consume localized bottom Cancel labels before profile-name validation. Cancel returns to the exact source surface and must never save the label as a name or continue into the room.
- Text inputs should be length-limited and normalized before saving.
- Profile name/city are short fields; bio can be longer.
- Normalize all visible digits at the delivery boundary: Persian UI uses Persian digits and English UI uses Latin digits, regardless of whether values came from storage, configuration, or static copy. Preserve Latin digits inside URLs, email addresses, bot commands, public codes, and callback payloads so actions remain valid.

## Home Runtime Keys

- Home supports the exact, case-insensitive English keys `status` and
  `diagnostics`, plus the exact Persian `وضعیت` alias for `status`.
  Other natural-language phrases and translated spellings are not keys.
- `status` returns a user-facing summary built from verified data: completion
  percentage across profile fields currently enabled in the product, media
  Favorites progress, self-only Star balance, saved-profile count, pending
  invitation count, and the user's open created discussions with current member
  counts. Do not show a “current discussion” row on Home because entering Home
  leaves the active room. Profile completion includes
  name, city, age, gender, bio, photo, and Interests, plus Pet and exact
  Location only while their dashboard rollout settings are enabled.
- `diagnostics` returns a sanitized support report containing only the app
  version, UTC timestamp, short reference code, the requesting user's own
  numeric id and public profile code, language, state, navigation mode, and
  compact counts. The same reference code is recorded in structured logs so a
  forwarded report can be correlated with its request. It must never include
  secrets, environment values, database document ids, message/list content, AI
  prompts or responses, or another user's data. Its template and fallback
  values are always English regardless of the user's interface language so
  support receives one consistent format.
- Only `status` / `وضعیت` is intended for normal user-facing discovery.
  `diagnostics` is an operator/support utility and should not be advertised in
  the ordinary product interface. The exact application version from
  `package.json` is included in diagnostics rather than exposed as a separate
  key.
- The Guide permanently explains that users can type `status` or `وضعیت` at
  any time while on Home to see their personal summary.
- Render replies in the user's saved interface language and keep the Home reply
  keyboard visible.
- Keys are available only while the user is idle in the persisted global Home
  mode. They must not intercept onboarding, profile/list input, another
  navigation mode, or an active discussion.
- Other ordinary Home text receives the existing concise use-buttons guidance.
  Commands, active input flows, and active discussion messages retain their
  existing routing.

## First-Session Onboarding

- Ask fresh users to choose Persian or English before showing the product overview.
- First-session language selection and the localized welcome/start step use bottom reply keyboards. Free text on either button-only step repeats the concise use-buttons guidance with that step's keyboard, matching the section picker. Append the next onboarding message instead of editing or deleting the previous prompt.
- The localized onboarding welcome is one photo card using `assets/muze-welcome-banner-cinematic-v2.jpg`, with the approved first-person Muze introduction as its caption and one Start action. For an already onboarded user, plain `/start` is a clean Home action and does not repeat the introduction. Reuse the global Telegram `file_id` cache under the current banner version, accept `MUZE_WELCOME_BANNER_V3_FILE_ID` as an optional seed, and fall back to the complete text card if media delivery fails.
- The welcome states the product promise: add Favorites, get suggestions, and later find related people and discussions.
- The welcome message should briefly teach that bottom buttons control navigation and users should send text only when Muze explicitly asks for typed input.
- After Start, ask the user to choose Movies, Series, Music, or Books. Bind the four localized labels to the exact category-selection state; typed text receives the existing button-only guidance and is never saved.
- The four-section onboarding picker mirrors the Favorites hub: Music and Books share the first row, while Movies and Series share the second row. After the section is chosen, remove the bottom keyboard, ask for one Favorite per message using the normal section prompt, visibly include that section's `🎬`, `📺`, `🎵`, or `📚` emoji, and save through `addAiListItem`. Before the first valid save, the prompt's only inline secondary control is `Choose another section`; it returns to the same four-section picker without completing onboarding. Movies Favorites may be movies or directors; Series Favorites may be series or creators; Music may be songs, albums, artists, or bands; Books may be books or authors. Archive/Library lists remain concrete works only.
- Reuse normal local quality validation, fuzzy duplicate checks, list limits, analytics, taste-index synchronization, and Star ledger behavior. Rejected input does not advance onboarding.
- Show the approved 1/3 and 2/3 progress copy. The first success explains the live `rewardFirstThreePerSection` amount; the second explains that the next valid choice unlocks suggestions. After either success, replace the section-change control with the single inline secondary `I'll finish later` action. Keep its hint short; the early-completion Home surface explains that saved choices remain available under My Favorites. Keep the text composer visible as the primary next action; never present finish-later as a large bottom-keyboard button. Keep earlier bot prompts in chat history and retire only their inline controls after the next valid save, section change, early completion, or third-item completion. Never delete user messages.
- `I'll finish later` is valid only after one or two Favorites have been saved in the selected section. Preserve those items, record the current onboarding version and normal completion timestamp, return to idle Home with the main keyboard, and track the existing `onboarding_completed` event with a safe early-completion mode and saved count. Do not set or depend on a separate skipped state.
- The third success completes onboarding before any follow-up action. Show the existing earned-Star notice only if the normal section milestone was newly applied; never award or stack `rewardOnboardingCompletion`.
- Completion offers only the section-scoped Suggestion action and Home. Suggestion enters the existing mood/genre suggestion mode for that exact completed section; Home exits normally. Typed text on the completion screen remains button guidance.
- Do not create a bot-generated starter invitation or mention one in completion copy.
- Plain `/start` resumes an unfinished category or Favorites step from persisted state and existing list count without repeating language/welcome, resetting items, or repeating a reward. A resumed zero-item section shows section change; a resumed one- or two-item section shows finish-later. Destination-bearing discussion/profile/referral starts preserve their real destination through full or early completion.
- Keep a reusable Muze guide in Home; onboarding completion can reach it through Home.
- Keep Guide and Change language out of the Home reply keyboard. They open only through `/help` and `/lang`; the normal language picker is an inline card with Persian, English, and a delete-only Close. Opening or closing it leaves the Home reply keyboard active. After a selection, retire the picker and refresh the localized Home surface. Onboarding language selection remains its separately scoped reply keyboard.
- Opening Guide must behave as an overlay: leave the current reply keyboard, server-side navigation mode, active flow, and remembered destination cards unchanged. Stars, Invite, Rules, and a delete-only Close are inline actions on the Guide card, with Stars and Invite together and Rules and Close on their own rows.
- Stars, Rules, and Invite edit the same Guide text card in place and never send a destination message during normal navigation. Stars and Rules contain only Back to Guide. Invite contains Share, Copy when available, and Back to Guide. Returning restores the Guide text and inline actions on the same message; Close deletes only that card.
- Accept Guide reply buttons once from the global mode as recovery for keyboards left visible by the temporary inline Guide experiment; each destination immediately restores its normal scoped mode.
- The About/guide should summarize Movies/Series/Music/Books favorites and lists, suggestions, Stars, discussions, profiles, people discovery, and private saved profiles, with direct actions to the Stars overview, `My favorites 🎬📺🎵📚`, and active discussions. Keep the Guide’s Stars summary focused on earning Stars; the dedicated Stars overview explains available uses without presenting any one feature as the main goal. The internal hub title remains the descriptive `🎬📺🎵📚 Movies, Series, Music & Books`.
- The main Guide hub is one text card so its full Rules and Stars views can replace it in place without Telegram's photo-caption limit. All of its controls are inline, and it never installs, removes, or replaces the reply keyboard underneath.
- Rules should reflect enforced privacy and live product limits; do not describe planned moderation or discovery behavior as if it already exists. Discussion limits must distinguish the initial active-owned allowance from each additional Star-required open room and show the overall owned-room cap.
- Persian user-facing Star copy states the amount as `ستاره موردنیاز` or `ستاره مورد نیاز`. Do not use transactional language such as `هزینه`, `خرج`, `پرداخت`, or `رایگان`; describe whether Stars are needed and show the required amount instead. Internal service, setting, and ledger terminology may remain technical.
- Bind every onboarding control to its exact server-side step, language, selected section, and saved count. Section change is authorized only at zero items, finish-later only at one or two, and stale or manually typed labels are ignored. The separate optional Interests nudge keeps its own mode.
- Normal onboarding navigation does not delete user messages or track navigation-card message IDs.
- A discussion-link recipient with unfinished onboarding completes at least one Favorite in the normal quick start. Preserve the shared discussion code and, after full or early completion, render its preview after the completion surface without joining and preserve an eligible original room as a non-rewarding `shared_link` inbox invitation.
- The post-onboarding shared-discussion preview uses only eligible inline actions and does not replace the Suggestion/Home completion keyboard underneath it.
- Some platforms may display only `/start` while still sending an invite payload to the bot. Public discussion invite payloads should always resume the appropriate shared-link flow—onboarding continuation, preview, or room re-focus; Star rewards stay one-time through ledger idempotency.
- Returning users with meaningful list, profile, saved-profile, or discussion activity should go directly to Home.

## First-Visit Section Guidance

- Show compact guidance once for each of Active Discussions, My favorites, and People. Put it inside the section's existing first successful response instead of sending an extra message.
- Telegram sizes text cards from their visible content. Text-only profile cards and public Favorites-section cards use the same modest visible divider beneath their title so short names or list items do not collapse the card width. Prefer this consistent divider over filler tips, padding, or invisible characters.
- Invitations and Active Discussions have separate one-time guidance because they teach different actions. Active Discussions first-visit guidance explains relevance ordering and locked-room requirements. Its independent durable marker lets existing users receive the new explanation once even if they previously saw invitation guidance. Every populated Active Discussions page also keeps one compact permanent `💡` line explaining that users can use the room's Join command to enter directly and that Muze will explain an unmet condition; do not describe this direct `/d_CODE` path as a preview. Keep it shorter than the first-visit guidance and use invitational “you can” wording instead of commands.
- My favorites guidance distinguishes genuine favorites from media Libraries and explains that favorites improve suggestions and relevance. Keep the existing three-item suggestion threshold and ten-item taste-label explanation visible in the same hub response.
- People guidance explains discovery through shared saved choices or a same-section taste label and says saved profiles are private bookmarks for finding or inviting someone later. Keep internal product-boundary language out of the user-facing tip.
- Persist independent first-shown timestamps in `sectionTipsShownAt`, including separate `discussions` invitation guidance and `activeDiscussions` first-visit guidance. Mark a first-visit tip only after its containing Telegram response succeeds; failed delivery or failed persistence must not block navigation. Filters, pagination, and later visits retain only the compact permanent Active Discussions direct-entry line, not the richer first-visit explanation.

Stars UX rules:

- Explain Stars briefly before or at the first reward, not as a store pitch on the welcome card.
- Full onboarding saves three Favorites in one media section and uses only that section's existing first-three milestone. Early completion after one or two items preserves progress but does not award that milestone. Do not add or stack the retired onboarding-completion reward.
- The first saved Favorite explains the live first-three reward; the third may show the existing earned-Star notice only when the ledger applied it.
- `/start`, language selection, repeated onboarding callbacks, and completion actions never award Stars by themselves.
- Preserve invite-first onboarding. A pending external invite/referral may be remembered through language selection, but reward qualification happens only after the configured product milestone.

## Stars Feedback And Purchase UX

- Follow [Stars Economy](stars.md) for all earning, spending, refund, privacy, and admin-controlled amount rules.
- Combine earning confirmation with the existing success/result message when possible; do not add a second celebratory bubble for every milestone.
- State the completed action, amount earned, and resulting balance.
- Show no more than one context-relevant next earning step, and never show a milestone already claimed.
- Main navigation and room keyboards should use clean feature labels. Show the current Star price, duration/scope, balance, and confirm/cancel actions only after the user opens a paid capability.
- A stale price confirmation must be replaced with the current price and reconfirmed.
- Insufficient-balance copy should show the balance and one relevant earning path without pressuring the user to buy Stars.
- Refunds and failed effects require clear, low-noise confirmation.
- `⭐` is reserved for Stars. Saved-profile wording stays unchanged but uses `🔖` after the Stars UI rollout.
- A coming-soon paid-feature preview must clearly say it is unavailable, show no price, and charge nothing. Advanced Search uses one low-noise preview card with only an inline Close action; the persistent People keyboard handles navigation after the card is removed.

## Long-Running Actions

- Long-running AI actions should send one placeholder message.
- If delayed, update that same placeholder through short natural waiting copy.
- Edit the placeholder into the final response when possible.
- For shortcut actions that still need AI/cache feedback, show the same placeholder behavior as the equivalent typed flow so the user is not left waiting with no visible response.
- If AI returns no usable response, show a clear retry/other-section fallback message.

## Interaction Guard

- Repeated identical user interactions are guarded in `src/services/interaction-guard.js` and applied from `src/index.js`.
- Keep duplicate-tap protection centralized.
- The guard should be conservative: block obvious duplicate interactions for a short window, but do not block normal follow-up text, different buttons, or intentional repeated actions after the window expires.
- A successfully accepted different interaction resets the previous action's duplicate cooldown, so flows such as opening a list, closing its card, and immediately reopening that list remain responsive.
- The guard should fail open if unsure, so bot features keep working even if guard state is missing or malformed.

## Callback Acknowledgements

- Answer callback buttons silently for normal AI section/list navigation; do not show top callback notifications for section changes.
- Use visible bot messages or edits for user-facing context changes.
- If a repeated button press keeps the visible message effectively unchanged, silently acknowledge it unless there is a real error or safety reason to show text.
- If a callback belongs to an old/stale flow state, ignore it safely (or remove that stale card) instead of applying state changes from outdated buttons.
- When a command-link action fails from a list, remove or refresh the stale list and show the relevant list again after the bot explanation when practical.
- For command-link action lines, make the pointer face the command link. English uses `Join 👉 /d_CODE`; Persian uses `ورود 👈 /d_CODE`, which displays with the command on the left in RTL chat.
- Discussion lists should separate each discussion block with a simple line divider when multiple items are shown.
- Member lists inside a discussion use plain text command links, not inline buttons. Use the same pointer-link convention for profile, report, and owner-only remove actions, and separate member blocks with simple line dividers. When at least one other profile command is available, keep one permanent `💡` header line explaining that users can view and optionally save another member's profile; omit it when the viewer is alone.
- Delivered discussion text should stay compact as `sender: message`; distinguish the sender with formatting only, currently bold sender names via escaped Telegram HTML.
- Discussion message replies should use platform-native replies when the runtime delivery map can resolve the target message. Do not add visible "replying to..." text, persist reply metadata, or create thread cards/extra acknowledgements for simple replies.
- Temporary keyboard-cleanup messages, such as leaving an active discussion and showing the discussions menu, should be removed when the user leaves the discussion menu.
- Discussion-visibility status rows are self-only. Other users viewing a profile should not see that setting.
- Profile edit prompts use temporary bottom modes. After save or cancel, switch modes and leave the prompt as harmless history; do not delete it.
- Selection and chip-based Profile editors—age, gender, Interests, optional pet preference, and Profile emoji—are inline actions on the own-profile card. Their pickers edit that same text or photo card and restore the refreshed profile card after Save, inline Close, or the persistent Profile Back button. Back must never be treated as picker input or redraw a second picker. Interests still accepts custom typed entries; those refresh the remembered profile card rather than creating a second picker. Pet preference is controlled by the dashboard `profilePetPreferenceEnabled` switch and Location by `profileLocationEnabled`; both default off. While off, each field is absent from profile rendering and routing without deleting saved data. Hidden Pet also does not count toward profile-completion rewards.
- Keep the Profile reply keyboard compact and limited to typed/media actions: Name/City, Bio paired with Add photo or optional Location where possible, photo controls, then Back. Put Privacy & Safety as a full-width inline action on the profile card; it edits that profile card's text or photo caption in place to show See People visibility, discussion visibility, invitation restrictions, Delete account, and Back. Privacy Back restores the same profile card without sending profile guidance or another profile message. The Profile reply keyboard remains available underneath. Hide Profile emoji from users who have not unlocked it while first Star spending is unavailable; permanently unlocked users retain the free change action. Do not delete and resend the card, and do not add a More Settings step.
- Own-profile inline cards are authoritative only while the user's server-side navigation mode remains in Profile or one of its active child flows. After the user leaves Profile through the bottom keyboard or another destination, tapping any old own-profile inline control must only retire the tapped card; it must not mutate profile data, recreate Profile, or replace the currently authoritative bottom keyboard.
- Keep the separate owner-profile guidance message because it installs and preserves Telegram's Profile reply keyboard. Do not repeat that editing guidance on the card. Instead, put a distinct `💡` owner-only tip at the top of the owner's profile text or photo caption pointing to Privacy & Safety for profile/discussion visibility, invitation restrictions, and account deletion; never show that card tip on another user's profile. The profile card retains its inline quick controls.
- During rollout, labels from the retired Profile and Profile Settings keyboards remain server-scoped compatibility actions. More Settings redirects to the flattened Profile destination; it must not render another settings screen.
- Canceling or completing the location-sharing prompt returns to the main Profile menu, where the action started.
- Profile display names must be emoji-free and cannot contain explicit links, email addresses, or bare/domain-like website addresses. Profile emoji is a separate paid cosmetic chosen from a paged curated picker, appears after the display name, and users may also type exactly one allowed emoji. Reserved system emojis, including the current bot marker, are not available there. Users should get a clear retry prompt for invalid names.
- People and saved-profile lists use text command links for item actions plus page-bound inline pagination and a delete-only Close action. Their People-hub bottom keyboard remains visible and actionable. Show saved-profile `/ds_CODE` links only when the user has a visible/open discussion.
- Every other-user public profile shows `❤️ Favorites` when at least one Movies, Music, or Books Favorite exists and `showFavoritesOnProfile` is enabled. This setting defaults on, is managed under Profile → Privacy & safety, and hides public media Favorites and taste labels without deleting lists or disabling suggestions, matching, or discussion eligibility. Newly generated shareable-profile cards also omit hidden Favorites and taste labels. The Favorites hub exposes only visible Favorite lists and their stored taste labels—never media Libraries—and Back restores the same public-profile card where possible. If `showActiveDiscussionOnProfile` is enabled and the profile owns or is currently in an open discussion, show the discussions action on Saved Profiles, See People, and shared/direct profile sources regardless of whether the viewer saved the profile. Hide it on profiles opened from a discussion member list, invitation flow, or invitation-restriction flow, where it is redundant or distracts from the scoped action. Source-specific Save/Remove, restrictions, invitation return, and Close behavior remain unchanged.
- Real-user invitation rows put their inviter-profile command beside the inviter's name, including accepted rows; bot and shared-link sources omit it. Invitation-list inviter-profile commands carry their source explicitly, so their one-tap invitation-restriction action remains available even while the invitee is active in a discussion. Revalidate the invitation relationship before showing and applying it. The profile card also offers the normal Save or Remove-saved action and refreshes that same card after either action. Because the invitation list remains visible, the separate profile card ends with delete-only Close instead of Back; Close removes only that card and leaves the list untouched. Do not show invitation-only controls when the profile was opened from saved profiles, People, or a discussion member list.
- Discussion-member profiles use compact one-tap saved-state behavior: Save refreshes that profile card to Remove-saved, and Remove-saved immediately refreshes it back to Save. Neither direction sends a confirmation or status message, and the live room and retained member list stay untouched.
- Paginated social-list headers show the full result count in parentheses, including Saved Profiles, People discovery, Active Discussions, and My Discussions. Use the full filtered result count, not the number of items on the current page; keep empty-state notices unchanged.
- People discovery and Saved Profiles rows use the profile's selected gender emoji (`👩`, `👨`, or `🧬`) when set, and fall back to neutral `👤` when gender is unset or unrecognized. If public age is set, show it compactly on the same line as `— 🎂 age`; omit the entire age suffix when unset.
- The Saved Profiles empty state should explain that users can save people found through shared favorites so they can find them later or invite them to discussions. The Guide should also connect shared-favorite discovery and saving with later invitations, and clarify that another user's discussion can be joined from their profile only when they choose to show it there. Keep this detail out of first-session onboarding.
- Show saved profiles newest-saved first everywhere the saved-profile collection is presented, including the Saved Profiles list, its pagination, invitation pickers, and the saved section appended to People discovery. Keep the stored append order unchanged and reverse it when shaping the view so existing users receive the ordering without a migration.
- On each user's first successful visit, the main People and Discussions hubs should each use their matching bundled wide banner as a single photo card with the localized hub copy as its caption and the normal bottom controls. Persist separate per-user banner timestamps only after successful photo delivery. Later visits should send the complete hub text and normal bottom controls without another photo so Telegram chat history and shared media do not fill with repeated banners. Reuse the global Telegram `file_id` cache, upload the local asset when needed, and fall back to the complete text card if media delivery fails; a failed photo attempt must remain eligible for a later retry.
- The Saved Profiles cap notice keeps the current surface unchanged, suggests removing someone from the saved list to make room, and has one inline `Got it` action that only deletes the notice.
- Profile discussion views start with one short tip explaining that the rooms are the profile user's current or created discussions. Treat Active and Created as independent sections: the Active section shows the room they are presently in, while Created lists every open room they created. If their active room is also theirs, include it in both sections, count it in Created, and prefix its Created-row title with only `🟢`—do not repeat a “Current discussion” label there. Avoid duplicate room actions even when the room appears in both sections. Put each joinable room's existing public command link directly under that room, matching the other discussion lists; locked and current rooms remain visible without an action. Keep only navigation actions in the inline keyboard. When opened from a profile's Discussions button, edit that same text/photo card; Back restores the profile on the same card and Close deletes only the card. A `/ds_CODE` command cannot edit the user's command message, so it sends one new inline discussion card with Close but no misleading Back action. If a join from that view fails after revalidation, the acknowledgment should return to the same user's discussions.
- If a profile's discussion list contains the viewer's current active room, prefix its displayed title with `🟢 Current discussion` / `🟢 گفت‌وگوی فعلی` and omit an inline action for that row entirely. A stale pre-deployment action for the same room must still be consumed safely without membership mutation, notifications, acknowledgements, or room redraw.
- Profiles opened from People should return to `👀 دیدن آدم‌ها`, not the saved-profile list. Legacy `people:taste` return state may be accepted but should resolve back to the free People list.
- People discovery qualifies a profile when either one section reaches the admin-configured shared-item minimum (default: 2) or the users have the exact same confirmed taste-label key in Movies, Music, or Books. A same-label result shows the matching section plus the normal localized taste-label emoji and title; never expose the internal key. Rank same-label matches as a strong additional signal while retaining shared-item ranking. Distinguish insufficient data from no current matches; only a viewer with neither enough items in any section nor any confirmed media taste label receives the insufficient-data state.
- Order People discovery with every eligible unsaved profile before a clearly labeled Saved Profiles section so existing bookmarks do not crowd out discovery. Append all Saved Profiles independently of taste and language filters and deduplicate them from new discovery, but exclude saved rows from the displayed new-person count. If no new profiles remain, keep showing the saved section and offer `Add more favorites`; when all four media Favorites sections are full, label the same action `View favorites` instead. Within new discovery, keep descending five-point relevance bands and rotate profiles inside each band deterministically once per UTC day. The order must remain identical across bot instances and repeated pagination requests during that day; do not persist exposure state or change matching, scoring, query limits, or eligibility.
- In See People rows, show `💬 Active discussions (N)` only when that person has at least one unique open current/created discussion and profile discussion visibility is enabled. Count a current room they also created only once. Keep View profile and Save profile as the only row commands; the count is an informational hint, not another action.
- Shareable discussion invites should be one ready-to-share bot message/card. Stored saved-profile invitations and post-onboarding `shared_link` entries stay in the invitation inbox and show unseen state through the count/marker. Every invite path must use an explicit preview/join step, never auto-join recipients, and never bypass normal join checks. Old invite previews should be revalidated on tap and edited/removed when stale where possible.
- If joining is blocked because the user is already in another discussion, preserve the existing bottom keyboard and show one compact warning with a single identity-bound `Leave current and join` action. Revalidate the invitation, target room, capacity, and join rules when tapped; leave the current discussion only after the target join succeeds.
- Successful invitation entry emits at most one status line: show `Joined` for a new membership, but do not follow it with a redundant `Discussion opened` line. Reopening an already-joined invitation goes straight to the room; a Star reward notice remains independently visible when applicable.
- If accepting an invitation fails because a taste, favorite, or profile-Interest rule is unmet, keep the invitation retryable and preserve the current bottom keyboard. Show the exact completion path with one inline delete-only `Got it` action.
- A newly received invitation notification opens only that identity-bound invitation, not the full inbox. Edit the notification into a single preview whose Join/Open, inviter-profile, Remove, and Close actions are all inline. The preview must preserve the current destination and reply keyboard, especially inside a live discussion, so tapping it can never submit a slash-command message to the room. Its inviter-profile action sends one temporary profile card with only the server-revalidated `Restrict invitations from this person` action and delete-only Close; after restriction, refresh that profile in place with only Close. Closing it reveals the untouched invitation preview underneath. Do not expose profile-discussion or Back-to-invitations actions on this temporary profile. The normal Invitations inbox may keep its existing list commands because users deliberately entered the Discussions destination.
- If an invitation or shared discussion link is missing, closed, or otherwise unavailable, an already-onboarded user keeps the current bottom keyboard, navigation mode, and in-progress flow state. A new or unfinished user still completes normal onboarding first; afterward, show the unavailable notice without replacing the normal onboarding-completion keyboard. Use one inline `Got it` action that only deletes the notice; do not redirect to Home or rebuild another menu.
- A standalone `Got it` / `متوجه شدم` acknowledgement is always an inline action attached to its notice, never a bottom reply-keyboard button. Sending the notice must not replace or remove the user's current reply keyboard.

## Pinning

- Pin/unpin flows must use the active chat id and must not swallow API errors silently.
- Only persist a pinned message id after the pin request succeeds.
- If Telegram pinning fails, log the chat id, message id, and error so the cause is visible.

## Profile UX

- Profile actions should always fail safely and fall back to text if photo rendering fails.
- When a user has no profile photo, show the local default avatar from `assets/default_profile.png`.
- Age selection uses a two-step bottom mode: ranges first, then exact ages. Start at 13, keep compact buckets and preserve left-to-right numeric display in both languages.
- Keep all profile editors at the main Profile destination. Put Age, Gender, Interests, Profile emoji, feature-switched Pet preference, and the Privacy & Safety entry inline on the profile card; keep Name, City, Bio, photo, and feature-switched Location on the compact reply keyboard. Put See People visibility, discussion visibility, invitation restrictions, and Delete account in the Privacy & Safety child screen.
- Privacy toggle actions edit the same card in place, retaining the full Privacy & Safety title and explanation, adding the compact bot-marked success text as a footer, and refreshing all inline controls. They must not replace the Profile reply keyboard underneath.
- Keep the See People and discussion-visibility state actions together on one inline row; restrictions, Delete account, and Back remain full-width inline rows. Delete account retains its warning, short-lived nonce, and explicit final confirmation. Cancelling either deletion step edits the same message back to the Privacy & Safety card; it must not remove or replace the Profile reply keyboard.
- The restriction count belongs in the restriction-list title, not its Privacy & Safety button. Opening restrictions edits the same Privacy & Safety text or photo caption in place. Available rows use an identity-bound View profile command that retains the restrictions list and sends a separate profile card. That profile contains `Allow invitations again` and a delete-only Close. Close removes only the profile card; Allow applies immediately, keeps the profile card while removing its now-invalid Allow action, and refreshes the retained restriction list in place. If Telegram cannot edit the retained list, retire its stale inline controls and send one refreshed list without deleting unrelated messages. Missing-profile rows retain a direct identity-bound Allow command so every restriction remains reversible. The restriction list keeps only pagination and one Back button; its Back restores Privacy & Safety on that same card and leaves the Profile reply keyboard unchanged.
- Keep shared profile rendering/location helpers in `src/services/profile.js` and reuse them from `src/bot.js` and `src/callbacks.js`.
- Profile should show existing section taste labels under a separate label heading, with spacing from the rest of the profile.
- Profiles are public inside bot social surfaces; do not show a public/private profile setting. `showProfileInPeopleDiscovery` is a narrow opt-out from new taste-based See People results only. Saved profiles, discussion/member surfaces, invitations, and direct public-profile codes remain reachable.
- Showing a user's discussions on their profile is a separate setting that covers both their current room and open discussions they created. It defaults to on for new accounts, must respect existing saved choices, and hides both categories when turned off.
- The discussion-visibility row on the user's own profile should include a short self-only explanation command link, such as `(یعنی چی؟ /ad_help)`, only until the user opens that explanation and taps the acknowledgement button. Keep it compact so the profile row stays readable; the explanation card should have one acknowledgement button that only removes the help card and preserves the current Profile destination and keyboard.
- The user's own profile may show one compact private growth hint when taste/profile data is still weak. Render it as a footer at the very bottom with one blank line above it. Name one concrete action—such as adding Interests, Favorites, a bio, city, age, gender, or photo—and explain its value where useful. Never use abstract counters such as “complete 2 more profile fields,” and never show this hint on public, saved-profile, discovery, member-list, or invitation profile views.
- Saved profiles should feel like private bookmarks, not friendship. Saving/removing a profile should not notify the other user and should not imply private chat. People discovery should stay taste-first and should not imply dating, friendship, private chat, online status, or compatibility scoring.
- When viewing another user's profile from discussions, check that the viewer has at least a display name. If missing, show a profile completion gate with inline edit buttons for missing fields.
- The profile viewing gate requires only display name; age is optional and not enforced.
- When a user completes their profile through the gate, redirect them to the intended profile they were trying to view, not their own profile. The intended profile code is stored in `pendingProfileViewCode` and cleared after redirect.
- A Star balance is visible only on the authenticated user's own profile. Never include it in public profile cards, shareable text, member-list views, saved-profile views, discovery results, or invitation profile views.

### Shareable Profile Card

- Show the full-width `🔗 Create shareable profile` inline action on the own-profile card only after at least one Movies, Music, or Books Favorites list contains at least three items. Archive/Library lists do not count. Revalidate the same condition when the action is pressed.
- Send the bundled `assets/shared-profile-banner.jpg` as one universal photo; never generate, compose, or store a per-user banner. Its caption is first-person (`✨ My Muze profile` / `✨ پروفایل میوزِ من`), appends the user's profile emoji when present, and includes at most five Profile Interests, available media taste labels, one Favorite from each non-empty media section, and the attributable opaque link.
- The share caption must omit the user's name, age, gender, city/location, pet preference, Stars, private growth hints, Archive/Library lists, and private settings. Keep it within Telegram's media-caption limit. The guidance mentions only forwarding; it does not advertise the Star reward.
- Creating the card does not delete or edit the existing own-profile message. Keep the banner card and send one separate compact Back guidance message. Back edits that guidance into the own profile when possible; use media restoration for a photo profile and fall back to sending the correct photo profile only when Telegram cannot convert the existing message.
- Existing onboarded recipients open a valid shared public profile immediately. Every recipient with unfinished onboarding completes the existing onboarding without altered steps or copy, receives its normal completion message and reply keyboard, and then receives the promised public profile. A missing profile destination fails safely.
- Saving a shared/direct public profile edits only that existing card's inline controls into their saved state. It must not delete and resend the profile, flash the photo/text away, or disturb the onboarding-completion keyboard underneath.
- Opening a public profile or its Favorites or discussion views must remember the exact server-side reply-keyboard mode already visible underneath. That underlying keyboard remains server-actionable while the overlay is open, including Profile controls beneath restriction profiles; controls from other destinations must not leak into the overlay. Close consumes the card and restores the remembered mode so existing users can immediately continue with the same Home, Favorites, Discussions, People, Profile, Guide, Privacy, or onboarding-completion keyboard.

## Guide Referral Card

Place `🎁 Invite someone to Muze` / `🎁 دعوت به میوز` in Guide beside Stars and Rules, not in Home, Discussions, People, or Saved Profiles. The main Guide explains that this button creates the user's invitation link, that a qualifying new user earns Stars, and that the profile card can also be shared from `Home → Me → Create shareable profile`. Opening Invite edits the Guide card in place with only the localized shareable invitation text and opaque link—no pointer or additional tip. Share and Copy use that exact payload; Back to Guide restores the Guide on the same message. The copy briefly explains favorites, taste-based people discovery, and discussions. Detailed qualification belongs in Rules. Do not expose the internal `TopTen` name or the retired “Top 10” product wording in referral copy. Shared-discussion onboarding ends with an explicit preview action and must never imply an automatic join.

Discussion Forward and Copy carry the same localized invitation payload and attributable discussion link. Keep that shared payload within the platform copy-text limit; omit the description first and truncate only as a final fallback. Its final action is `Close` / `بستن`, because the user is already in the active room; it quietly deletes the temporary card without a confirmation message. Favorites managers do not create standalone share messages; the shareable profile is the single taste-sharing path and leads recipients to the public Favorites views inside Muze.

## Muze identity in conversation

- Muze is both the Telegram bot and the speaking personality. It speaks as “I”.
- In normal conversation, the interface is called “here” or by the exact section name. Muze does not describe itself as a separate place or third party.
- Avoid phrases such as “explore Muze”, “in Muze”, “Muze can help”, or “I can help about Muze”.
- The name Muze is used directly when defining the bot, in labels, or when the user explicitly asks what Muze is.
## Nearby rollout

Nearby People and Local Discussions are optional, independently switched features. Exact Telegram coordinates
are private matching inputs: never render coordinates, exact distance, direction, or maps. Profile city remains
display-only. Nearby results are placed before other normally eligible results while preserving the existing
order within both groups.

When Nearby People is enabled, a user without a saved location sees one tip on the People hub explaining that
adding location in Profile places nearby people higher. When Local Discussions is enabled, the same user sees a
separate one-time tip on the Discussions hub explaining that profile location unlocks local discussion creation.
Do not defer these setup tips until the result lists or the final discussion preview. The Guide keeps the broader
nearby explanation available permanently.
