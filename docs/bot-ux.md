# Bot UX Rules

Bottom reply-keyboard buttons are server-authorized actions, not trusted Telegram client state. Discussion and People list buttons are bound to the exact list type and page; create-wizard, paid-capacity, profile-action, and saved-profile removal buttons are bound to their durable server-side context. Stale or manually typed labels do not activate outside that mode. Identity-bound invitation/join actions and other payload-sensitive cards remain inline where documented.

## Low-Noise Conversation

- Stable destinations and converted contextual flows use persistent bottom keyboards and do not create navigation footprints. Ordinary navigation retains earlier messages and makes no Telegram delete/edit cleanup call. Legacy navigation-card IDs are forgotten without touching Telegram.
- Before sending a stable Home, Profile, Favorites, Discussions, People, or Guide reply keyboard, persist `state: idle` and its matching navigation mode together. This ordering prevents a process restart or deployment from leaving Telegram's visible keyboard ahead of the server-authorized mode. Do not reset all users at startup or erase legitimate in-progress flows globally.
- Inline cleanup is flow-specific and limited to cards whose payload can become unsafe or incorrect: indexed mutations, identity-bound actions, destructive confirmation, payment/nonce confirmation, and temporary share/member cards with explicit Close.

- Prefer one clear hub message per menu instead of sending repeated "back" or "returned" messages.
- Ignore otherwise-unrecognized idle text without sending an error or resetting navigation. This includes a delayed duplicate bottom-button label that became stale after the first tap changed the server-side mode. Temporary input flows and active discussion messages keep their own validation/delivery behavior.
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
- Global navigation currently follows the same product behavior as Home navigation: using it while active in a discussion leaves that discussion and clears the room keyboard.
- Unknown slash commands inside an active discussion must not be delivered as room messages.

## Input Collection

- When collecting typed input, install a temporary mode with a bottom Cancel/Back action unless the prompt carries an identity-bound or transactional inline payload. Do not emit a separate empty cleanup bubble.
- Cancel/back copy should match the action: "back" should not sound like an operation was canceled unless an input flow was actually canceled.
- The discussion-entry name gate must consume localized bottom Cancel labels before profile-name validation. Cancel returns to the exact source surface and must never save the label as a name or continue into the room.
- Text inputs should be length-limited and normalized before saving.
- Profile name/city are short fields; bio can be longer.
- Normalize all visible digits at the delivery boundary: Persian UI uses Persian digits and English UI uses Latin digits, regardless of whether values came from storage, configuration, or static copy. Preserve Latin digits inside URLs, email addresses, bot commands, public codes, and callback payloads so actions remain valid.

## First-Session Onboarding

- Ask fresh users to choose Persian or English before showing the product overview.
- First-session language selection and the localized welcome/start step use bottom reply keyboards. Append the next onboarding message instead of editing or deleting the previous prompt.
- The normal `/start` greeting and the localized onboarding welcome should each be sent as one photo card using `assets/muze-welcome-banner-cinematic-v2.jpg`, with a concise first-person Muze introduction as its caption and the appropriate controls. Returning-user copy should reintroduce the broader product and point to the menu; fresh-onboarding copy should lead into the Interest quick start and retain the bottom-button/text-input guidance. Reuse the global Telegram `file_id` cache under the current banner version, accept `MUZE_WELCOME_BANNER_V3_FILE_ID` as an optional seed, upload the local asset when needed, and fall back to the complete text card if media delivery fails.
- The welcome message should state the product promise: build taste, get personal suggestions, and find related discussions.
- The welcome message should briefly teach that bottom buttons control navigation and users should send text only when Muze explicitly asks for typed input.
- Offer recent, empty accounts a quick start that asks for three broad interests by default.
- Show a small rotating set of interests instead of one oversized picker; let users request more options.
- Let users type a custom interest through a dedicated input state with admin-managed length validation and a clear return action.
- After a user types a custom interest, consume the old picker and send the updated progress or result as a fresh message below the user's text; do not edit a card above the user's message.
- Save onboarding choices into the existing Interests TopTen; do not create a separate preference store.
- Show compact progress after each choice without repeating the product explanation. Immediately before the progress count, render each saved choice as its own `- item` line without an extra heading. Selected chips should remain in their original grid position with a `✓` marker, and tapping them removes the interest.
- Auto-complete onboarding immediately when the admin-configured minimum is reached; it defaults to three. Do not require a separate Continue action after the final choice.
- Keep Interest chip rows to three item buttons per row; onboarding should show four stable chip rows before the More/Custom controls. Do not render partial one- or two-chip rows.
- Completion should confirm the number of saved interests without repeating the full selection list. Profile Interests never generate a taste label; labels belong only to completed Movies, Music, and Books Favorites. Briefly explain that media favorites improve personal suggestions and help users find relevant discussions. Send the final completion as a normal text card with its completion controls.
- End with active discussions as the primary action so users can choose a room themselves. Offer `My favorites 🎬🎵📚` and Home as secondary actions.
- Keep a reusable Muze guide in Home; onboarding completion can reach it through Home.
- Keep Change language in the Home reply keyboard. Its normal picker is an inline card with Persian, English, and a delete-only Close; opening or closing it leaves the Home reply keyboard active. After a selection, retire the picker and refresh the localized Home surface. Onboarding language selection remains its separately scoped reply keyboard.
- Opening Guide must behave as an overlay: leave the current reply keyboard, server-side navigation mode, active flow, and remembered destination cards unchanged. Stars, Invite, Rules, and a delete-only Close are inline actions on the Guide card, with Stars and Invite together and Rules and Close on their own rows.
- Stars, Rules, and Invite edit the same Guide text card in place and never send a destination message during normal navigation. Stars and Rules contain only Back to Guide. Invite contains Share, Copy when available, and Back to Guide. Returning restores the Guide text and inline actions on the same message; Close deletes only that card.
- Accept Guide reply buttons once from the global mode as recovery for keyboards left visible by the temporary inline Guide experiment; each destination immediately restores its normal scoped mode.
- The About/guide should summarize Movies/Music/Books favorites and lists, suggestions, Stars, discussions, profiles, people discovery, and private saved profiles, with direct actions to the Stars overview, `My favorites 🎬🎵📚`, and active discussions. Keep the Guide’s Stars summary focused on earning Stars; the dedicated Stars overview explains available uses without presenting any one feature as the main goal. The internal hub title remains the descriptive `🎬🎵📚 Movies, Music & Books`.
- The main Guide hub is one text card so its full Rules and Stars views can replace it in place without Telegram's photo-caption limit. All of its controls are inline, and it never installs, removes, or replaces the reply keyboard underneath.
- Rules should reflect enforced privacy and live product limits; do not describe planned moderation or discovery behavior as if it already exists. Discussion limits must distinguish the free active-owned allowance from each Star-paid additional open room and show the overall owned-room cap.
- If onboarding offers a direct active-discussions action, it should open the active discussion list directly, not the intermediate discussions menu.
- Show the product overview first with one clear bottom "choose interests" action; append the Interest picker after the user taps it.
- Bind every onboarding bottom label to its exact server-side step, language, and Interest page. The optional taste nudge and completion destinations use their own modes; stale or manually typed labels are ignored.
- Like the Profile Interests editor, the onboarding picker accepts a short typed interest directly. Do not show a separate custom-interest button or move the user into another prompt; keep the same page and localize known Interest chips in the current interface language.
- Normal onboarding navigation must not delete or edit earlier prompts and must not track navigation-card message IDs. This keeps the history understandable and avoids extra Telegram round trips.
- Do not send a new user from onboarding into a generic section hub as the primary continuation.
- Normal onboarding may prepare at most one stored starter invitation after the Interest goal is completed. Prefer a recent, open, non-full room in the user's effective language whose profile-Interest condition matches one of the user's choices; otherwise use that language's open, non-full `Free Discussion` starter room. Never auto-join the user. Show the invitation action only after the invitation is persisted successfully; Active Discussions and My favorites remain available completion destinations.
- Completion copy should distinguish an Interest-matched invitation from the open fallback, say that the invitation is a preview rather than an automatic join, and tell the user that Muze will explain any missing join requirement. If no eligible invitation exists, use neutral completion copy and do not imply that a room was prepared.
- A discussion-link recipient with unfinished onboarding must choose language and complete the normal Interest quick start before seeing the shared discussion, regardless of account age. After language selection, use the normal onboarding welcome without a separate invitation announcement. Preserve the shared discussion code throughout onboarding and automatically render the original preview after completion without joining. Preserve the available original room as a non-rewarding `shared_link` inbox invitation whether it is currently joinable or locked by an unmet condition. The shared-link path also prepares the same normal joinable onboarding starter invitation as every other completed onboarding.
- The post-onboarding shared-discussion preview uses only an eligible inline Join action and a delete-only Close action; it has no Back action. Keep the ordinary onboarding-completion reply keyboard available for Active Discussions, Favorites, and Home; do not add a shared-discussion continuation button or show the optional quick-taste reply keyboard after joining.
- Some platforms may display only `/start` while still sending an invite payload to the bot. Public discussion invite payloads should always resume the appropriate shared-link flow—onboarding continuation, preview, or room re-focus; Star rewards stay one-time through ledger idempotency.
- Returning users with meaningful list, profile, saved-profile, or discussion activity should go directly to Home.

## First-Visit Section Guidance

- Show compact guidance once for each of Active Discussions, My favorites, and People. Put it inside the section's existing first successful response instead of sending an extra message.
- Invitations and Active Discussions have separate one-time guidance because they teach different actions. Active Discussions first-visit guidance explains relevance ordering and locked-room requirements. Its independent durable marker lets existing users receive the new explanation once even if they previously saw invitation guidance. Every populated Active Discussions page also keeps one compact permanent `💡` line explaining that users can use the room's Join command to enter directly and that Muze will explain an unmet condition; do not describe this direct `/d_CODE` path as a preview. Keep it shorter than the first-visit guidance and use invitational “you can” wording instead of commands.
- My favorites guidance distinguishes genuine favorites from Watch/Listen/Read Later and explains that favorites improve suggestions and relevance. Keep the existing three-item suggestion threshold and ten-item taste-label explanation visible in the same hub response.
- People guidance explains discovery through shared saved choices and says saved profiles are private bookmarks for finding or inviting someone later. Keep internal product-boundary language out of the user-facing tip.
- Persist independent first-shown timestamps in `sectionTipsShownAt`, including separate `discussions` invitation guidance and `activeDiscussions` first-visit guidance. Mark a first-visit tip only after its containing Telegram response succeeds; failed delivery or failed persistence must not block navigation. Filters, pagination, and later visits retain only the compact permanent Active Discussions direct-entry line, not the richer first-visit explanation.

Stars UX rules:

- Explain Stars briefly before or at the first reward, not as a store pitch on the welcome card.
- Onboarding Interests use the normal Interests milestone. Do not add a separate onboarding reward for the same data.
- The onboarding card may show actual earned Stars, but should not show misleading Top 10 completion progress for profile Interests.
- `/start`, language selection, repeated onboarding callbacks, and bot-created starter invitations never award Stars by themselves.
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
- Keep the Profile reply keyboard compact and limited to typed/media actions: Name/City, Bio paired with Add photo or optional Location where possible, photo controls, then Back. Put Privacy & Safety as a full-width inline action on the profile card; it edits that profile card's text or photo caption in place to show See People visibility, discussion visibility, invitation restrictions, Delete account, and Back. Privacy Back restores the same profile card without sending profile guidance or another profile message. The Profile reply keyboard remains available underneath. Do not delete and resend the card, and do not add a More Settings step.
- Own-profile inline cards are authoritative only while the user's server-side navigation mode remains in Profile or one of its active child flows. After the user leaves Profile through the bottom keyboard or another destination, tapping any old own-profile inline control must only retire the tapped card; it must not mutate profile data, recreate Profile, or replace the currently authoritative bottom keyboard.
- Keep the separate owner-profile guidance message because it installs and preserves Telegram's Profile reply keyboard. Do not repeat that editing guidance on the card. Instead, put a distinct `💡` owner-only tip at the top of the owner's profile text or photo caption pointing to Privacy & Safety for profile/discussion visibility, invitation restrictions, and account deletion; never show that card tip on another user's profile. The profile card retains its inline quick controls.
- During rollout, labels from the retired Profile and Profile Settings keyboards remain server-scoped compatibility actions. More Settings redirects to the flattened Profile destination; it must not render another settings screen.
- Canceling or completing the location-sharing prompt returns to the main Profile menu, where the action started.
- Profile display names must be emoji-free. Profile emoji is a separate paid cosmetic chosen from a paged curated picker, appears after the display name, and users may also type exactly one allowed emoji. Reserved system emojis, including the current bot marker, are not available there. Users should get a clear retry prompt if they submit emoji in their typed name.
- People and saved-profile lists use text command links for item actions plus page-bound inline pagination and a delete-only Close action. Their People-hub bottom keyboard remains visible and actionable. Show saved-profile `/ds_CODE` links only when the user has a visible/open discussion.
- Every other-user public profile shows `❤️ Favorites` when at least one Movies, Music, or Books Favorite exists. The Favorites hub exposes only those Favorite lists and their stored taste labels—never Watch/Listen/Read Later—and Back restores the same public-profile card where possible. If `showActiveDiscussionOnProfile` is enabled and the profile owns or is currently in an open discussion, every public-profile source also shows the discussions action; this visibility never depends on whether the viewer saved the profile. Source-specific Save/Remove, restrictions, invitation return, and Close behavior remain unchanged.
- If saved-profile and invitation return state both appear possible, the currently visible saved-profile list takes priority. Do not show invitation-only controls, such as invite mute, when the profile was opened from saved profiles.
- Paginated social-list headers show the full result count in parentheses, including Saved Profiles, People discovery, Active Discussions, and My Discussions. Use the full filtered result count, not the number of items on the current page; keep empty-state notices unchanged.
- People discovery and Saved Profiles rows use the profile's selected gender emoji (`👩`, `👨`, or `🧬`) when set, and fall back to neutral `👤` when gender is unset or unrecognized. If public age is set, show it compactly on the same line as `— 🎂 age`; omit the entire age suffix when unset.
- The Saved Profiles empty state should explain that users can save people found through shared favorites so they can find them later or invite them to discussions. The Guide should also connect shared-favorite discovery and saving with later invitations, and clarify that another user's discussion can be joined from their profile only when they choose to show it there. Keep this detail out of first-session onboarding.
- The main People and Discussions hub messages should each use their matching bundled wide banner as a single photo card with the localized hub copy as its caption and the normal bottom controls. Reuse the global Telegram `file_id` cache, upload the local asset when needed, and fall back to the complete text card if media delivery fails.
- The Saved Profiles cap notice keeps the current surface unchanged, suggests removing someone from the saved list to make room, and has one inline `Got it` action that only deletes the notice.
- Profile discussion views use inline Join, Back, and Close controls with no bottom keyboard. When opened from a profile's inline Discussions button, edit that same text/photo card; Back restores the profile on the same card and Close deletes only the card. A `/ds_CODE` command cannot edit the user's command message, so it sends one new inline discussion card. If a join from that view fails, the acknowledgment should return to the same user's discussions.
- If a profile's discussion list contains the viewer's current active room, prefix its displayed title with `🟢 Current discussion` / `🟢 گفت‌وگوی فعلی` and omit an inline action for that row entirely. A stale pre-deployment action for the same room must still be consumed safely without membership mutation, notifications, acknowledgements, or room redraw.
- Profiles opened from People should return to `👀 دیدن آدم‌ها`, not the saved-profile list. Legacy `people:taste` return state may be accepted but should resolve back to the free People list.
- People discovery distinguishes insufficient list data from no current matches; only insufficient data asks the user to add the admin-configured minimum number of items in one section (default: 2).
- Shareable discussion invites should be one ready-to-share bot message/card. Stored saved-profile invitations and post-onboarding `shared_link` entries stay in the invitation inbox and show unseen state through the count/marker. Every invite path must use an explicit preview/join step, never auto-join recipients, and never bypass normal join checks. Old invite previews should be revalidated on tap and edited/removed when stale where possible.
- If joining is blocked because the user is already in another discussion, preserve the existing bottom keyboard and show one compact warning with a single inline delete-only `Got it` action. Avoid `Close` wording because it can sound like closing the active discussion.
- If accepting an invitation fails because a taste, favorite, or profile-Interest rule is unmet, keep the invitation retryable and preserve the current bottom keyboard. Show the exact completion path with one inline delete-only `Got it` action.
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
- The restriction count belongs in the restriction-list title, not its Privacy & Safety button. Opening restrictions edits the same Privacy & Safety text or photo caption in place. Restriction rows use identity-bound command links for View profile and Allow invitations again; the inline keyboard contains pagination when needed and one Back button. Back restores Privacy & Safety on that same card and leaves the Profile reply keyboard unchanged. The empty state points to the restriction option on an inviter's profile instead of telling the user to create a restriction from the list.
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

- Show the full-width `🔗 Create shareable profile` inline action on the own-profile card only after at least one Movies, Music, or Books Favorites list reaches the configured full-list goal.
- Send the bundled `assets/shared-profile-banner.jpg` as one universal photo; never generate, compose, or store a per-user banner. Its caption is first-person (`✨ My Muze profile` / `✨ پروفایل میوزِ من`), appends the user's profile emoji when present, and includes at most five Profile Interests, available media taste labels, one Favorite from each non-empty media section, and the attributable opaque link.
- The share caption must omit the user's name, age, gender, city/location, pet preference, Stars, private growth hints, For Later lists, and private settings. Keep it within Telegram's media-caption limit. The guidance mentions only forwarding; it does not advertise the Star reward.
- Creating the card does not delete or edit the existing own-profile message. Keep the banner card and send one separate compact Back guidance message. Back edits that guidance into the own profile when possible; use media restoration for a photo profile and fall back to sending the correct photo profile only when Telegram cannot convert the existing message.
- Existing onboarded recipients open a valid shared public profile immediately. Every recipient with unfinished onboarding completes the existing onboarding without altered steps or copy, receives its normal completion message and reply keyboard, and then receives the promised public profile. A missing profile destination fails safely.
- Saving a shared/direct public profile edits only that existing card's inline controls into their saved state. It must not delete and resend the profile, flash the photo/text away, or disturb the onboarding-completion keyboard underneath.
- Opening a public profile or its Favorites views must remember the exact server-side reply-keyboard mode already visible underneath. Close consumes the card and restores that mode so existing users can immediately continue with the same Home, Favorites, Discussions, People, Profile, Guide, Privacy, or onboarding-completion keyboard.

## Guide Referral Card

Place `🎁 Invite someone to Muze` / `🎁 دعوت به میوز` in Guide beside Stars and Rules, not in Home, Discussions, People, or Saved Profiles. It edits the Guide card in place with the localized invitation text, opaque link, short guidance, live startup-loaded reward, and the `Home → Me → Create shareable profile` path. Share and Copy use the exact invitation payload shown in that view; Back to Guide restores the Guide on the same message. The copy briefly explains favorites, taste-based people discovery, and discussions. Detailed qualification belongs in Rules. Do not expose the internal `TopTen` name or the retired “Top 10” product wording in referral copy. Shared-discussion onboarding ends with an explicit preview action and must never imply an automatic join.

Discussion Forward and Copy carry the same localized invitation payload and attributable discussion link. Keep that shared payload within the platform copy-text limit; omit the description first and truncate only as a final fallback. Its final action is `Close` / `بستن`, because the user is already in the active room; it quietly deletes the temporary card without a confirmation message. Favorites managers do not create standalone share messages; the shareable profile is the single taste-sharing path and leads recipients to the public Favorites views inside Muze.
