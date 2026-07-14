# Bot UX Rules

Bottom reply-keyboard buttons are server-authorized actions, not trusted Telegram client state. Discussion and People list buttons are bound to the exact list type and page; create-wizard, paid-capacity, profile-action, and saved-profile removal buttons are bound to their durable server-side context. Stale or manually typed labels do not activate outside that mode. Identity-bound invitation/join actions and other payload-sensitive cards remain inline where documented.

## Low-Noise Conversation

- Stable destinations and converted contextual flows use persistent bottom keyboards and do not create navigation footprints. Ordinary navigation retains earlier messages and makes no Telegram delete/edit cleanup call. Legacy navigation-card IDs are forgotten without touching Telegram.
- Inline cleanup is flow-specific and limited to cards whose payload can become unsafe or incorrect: indexed mutations, identity-bound actions, destructive confirmation, payment/nonce confirmation, and temporary share/member cards with explicit Close.

- Prefer one clear hub message per menu instead of sending repeated "back" or "returned" messages.
- Ignore otherwise-unrecognized idle text without sending an error or resetting navigation. This includes a delayed duplicate bottom-button label that became stale after the first tap changed the server-side mode. Temporary input flows and active discussion messages keep their own validation/delivery behavior.
- Bot-authored guidance, empty states, and safe error messages should start with the configured Muze marker emoji so they feel clearly from the bot. The default marker is `👩‍🦳`, and admins can change it from the dashboard. Short success confirmations can keep their action/status emoji.
- Bot-authored messages sent before normal app-context routing, such as allowlist and banned-user blocks, should still apply the configured Muze marker emoji.
- Edit an existing bot message when navigating menus if possible.
- Delete stale inline picker messages after the user chooses an item.
- When a returning user changes the interface language, retire the language picker, send the localized change confirmation, then enter the localized main-menu bottom mode. Old-language labels no longer resolve.
- When an inline card is consumed and the next step sends a fresh card/message, delete the old inline card first instead of leaving dead buttons in the chat.
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

## Global Command Navigation

- Keep Telegram's native command menu focused on `/start`, `/menu`, `/profile`, `/taste`, `/discussions`, `/people`, and `/help`. `/lang` remains supported as an optional shortcut.
- Global navigation commands must work from normal menus, temporary input flows, and active discussions, including Telegram's `/command@BotName` form.
- Commands and deep links override stale visible keyboards and install their destination mode. Old bottom labels are harmless because resolution uses the new server-side mode; only unsafe inline cards receive explicit cleanup.
- Global navigation currently follows the same product behavior as main-menu navigation: using it while active in a discussion leaves that discussion and clears the room keyboard.
- Unknown slash commands inside an active discussion must not be delivered as room messages.

## Input Collection

- When collecting typed input, install a temporary mode with a bottom Cancel/Back action unless the prompt carries an identity-bound or transactional inline payload. Do not emit a separate empty cleanup bubble.
- Cancel/back copy should match the action: "back" should not sound like an operation was canceled unless an input flow was actually canceled.
- The discussion-entry name gate must consume localized bottom Cancel labels before profile-name validation. Cancel returns to the exact source surface and must never save the label as a name or continue into the room.
- Text inputs should be length-limited and normalized before saving.
- Profile name/city are short fields; bio can be longer.

## First-Session Onboarding

- Ask fresh users to choose Persian or English before showing the product overview.
- First-session language selection and the localized welcome/start step use bottom reply keyboards. Append the next onboarding message instead of editing or deleting the previous prompt.
- The welcome message should state the product promise: build taste, get personal suggestions, and find related discussions.
- Offer recent, empty accounts a quick start that asks for three broad interests by default.
- Show a small rotating set of interests instead of one oversized picker; let users request more options.
- Let users type a custom interest through a dedicated input state with admin-managed length validation and a clear return action.
- After a user types a custom interest, consume the old picker and send the updated progress or result as a fresh message below the user's text; do not edit a card above the user's message.
- Save onboarding choices into the existing Interests TopTen; do not create a separate preference store.
- Show compact progress after each choice without repeating the product explanation. Selected chips should remain in their original grid position with a `✓` marker, and tapping them removes the interest.
- Auto-complete onboarding immediately when the admin-configured minimum is reached; it defaults to three. Do not require a separate Continue action after the final choice.
- Keep Interest chip rows to three item buttons per row; onboarding should show four stable chip rows before the More/Custom controls. Do not render partial one- or two-chip rows.
- Completion should confirm the number of saved interests without repeating the full selection list or inferring a taste label from only three broad choices. Briefly explain that media favorites improve personal suggestions and help users find relevant discussions.
- End with active discussions as the primary action so users can choose a room themselves. Offer `🎬🎵📚 Movies, Music, Books` and the main menu as secondary actions.
- Keep a reusable Muze guide in the main menu; onboarding completion can reach it through the main menu.
- The About/guide should summarize Movies/Music/Books Top 10s and lists, suggestions, Stars, discussions, profiles, people discovery, and private saved profiles, with direct actions to the Stars overview, `🎬🎵📚 Movies, Music, Books`, and active discussions.
- Rules should reflect enforced privacy and product limits; do not describe planned moderation or discovery behavior as if it already exists.
- If onboarding offers a direct active-discussions action, it should open the active discussion list directly, not the intermediate discussions menu.
- Show the product overview first with one clear bottom "choose interests" action; append the Interest picker after the user taps it.
- Bind every onboarding bottom label to its exact server-side step, language, and Interest page. The optional taste nudge and completion destinations use their own modes; stale or manually typed labels are ignored.
- Like the Profile Interests editor, the onboarding picker accepts a short typed interest directly. Do not show a separate custom-interest button or move the user into another prompt; keep the same page and localize known Interest chips in the current interface language.
- Normal onboarding navigation must not delete or edit earlier prompts and must not track navigation-card message IDs. This keeps the history understandable and avoids extra Telegram round trips.
- Do not send a new user from onboarding into a generic section hub as the primary continuation.
- Normal onboarding does not prepare an automatic invitation. Its primary action opens the active-discussions list, where the global room can appear alongside other available rooms.
- Onboarding must not interrupt discussion invite entry. A fresh invite recipient may choose language first, but the pending invite must be preserved and continue directly to the localized invite preview without showing the interests onboarding action.
- Invitation deep links are intent-first: users who arrive from a discussion invite should see that invite before full onboarding. If they have not completed onboarding and still have too few Interests, Muze may offer a one-time optional quick taste setup after the invite is joined or dismissed, but dismissing that nudge must not mark onboarding complete.
- Some platforms may display only `/start` while still sending an invite payload to the bot. Public discussion invite payloads should always open the invite preview or re-focus the room; Star rewards stay one-time through directed-pair ledger idempotency.
- Returning users with meaningful list, profile, saved-profile, or discussion activity should go directly to the main menu.

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
- A coming-soon paid-feature preview must clearly say it is unavailable, show no price, and charge nothing. Advanced Search uses one low-noise preview card with `Let me know` and Back; repeated notification signup is idempotent.

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
- The guard should fail open if unsure, so bot features keep working even if guard state is missing or malformed.

## Callback Acknowledgements

- Answer callback buttons silently for normal AI section/list navigation; do not show top callback notifications for section changes.
- Use visible bot messages or edits for user-facing context changes.
- If a repeated button press keeps the visible message effectively unchanged, silently acknowledge it unless there is a real error or safety reason to show text.
- If a callback belongs to an old/stale flow state, ignore it safely (or remove that stale card) instead of applying state changes from outdated buttons.
- When a command-link action fails from a list, remove or refresh the stale list and show the relevant list again after the bot explanation when practical.
- For command-link action lines, make the pointer face the command link. English uses `Join 👉 /d_CODE`; Persian uses `ورود 👈 /d_CODE`, which displays with the command on the left in RTL chat.
- Discussion lists should separate each discussion block with a simple line divider when multiple items are shown.
- Member lists inside a discussion use plain text command links, not inline buttons. Use the same pointer-link convention for profile, report, and owner-only remove actions, and separate member blocks with simple line dividers.
- Delivered discussion text should stay compact as `sender: message`; distinguish the sender with formatting only, currently bold sender names via escaped Telegram HTML.
- Discussion message replies should use platform-native replies when the runtime delivery map can resolve the target message. Do not add visible "replying to..." text, persist reply metadata, or create thread cards/extra acknowledgements for simple replies.
- Temporary keyboard-cleanup messages, such as leaving an active discussion and showing the discussions menu, should be removed when the user leaves the discussion menu.
- Active-discussion visibility status rows are self-only. Other users viewing a profile should not see that setting.
- Profile edit prompts use temporary bottom modes. After save or cancel, switch modes and leave the prompt as harmless history; do not delete it.
- Profile display names must be emoji-free. Profile emoji is a separate paid cosmetic chosen from a paged curated picker, appears after the display name, and users may also type exactly one allowed emoji. Reserved system emojis, including the current bot marker, are not available there. Users should get a clear retry prompt if they submit emoji in their typed name.
- People and saved-profile lists use text command links for item actions plus page-bound bottom pagination and Back. Show saved-profile `/ds_CODE` links only when the user has a visible/open discussion.
- Public profiles from People or Saved Profiles retain the source list and use profile-bound bottom actions: Save when unsaved, Remove when saved, discussions when visible, and Back to the exact source/page. Discussion-member profiles use their separate inline Save/Saved and Close contract.
- If saved-profile and invitation return state both appear possible, the currently visible saved-profile list takes priority. Do not show invitation-only controls, such as invite mute, when the profile was opened from saved profiles.
- Profile discussion views should behave as their own return destination. Their Back button returns to the public profile card first, preserving whether the user came from saved profiles or People discovery. If a join from that view fails, the `👍 Got it` / `👍 متوجه شدم` acknowledgment should return to the same user's discussions.
- Profiles opened from People should return to `👀 دیدن آدم‌ها`, not the saved-profile list. Legacy `people:taste` return state may be accepted but should resolve back to the free People list.
- People discovery distinguishes insufficient list data from no current matches; only insufficient data asks the user to add their first 3 items in one section.
- Shareable discussion invites should be one ready-to-share bot message/card. Stored saved-profile invitations should stay in the invitation inbox, show unseen state through the count/marker, and use Back-only navigation from the list/profile views. Both invite types must open a preview/join step and must not auto-join recipients or bypass normal join checks. Old invite previews should be revalidated on tap and edited/removed when stale where possible.

## Pinning

- Pin/unpin flows must use the active chat id and must not swallow API errors silently.
- Only persist a pinned message id after the pin request succeeds.
- If Telegram pinning fails, log the chat id, message id, and error so the cause is visible.

## Profile UX

- Profile actions should always fail safely and fall back to text if photo rendering fails.
- When a user has no profile photo, show the local default avatar from `assets/default_profile.png`.
- Age selection uses a two-step bottom mode: ranges first, then exact ages. Start at 13, keep compact buckets and preserve left-to-right numeric display in both languages.
- Keep high-frequency profile edits on the main profile card: name, age, photo, city, and gender. Put longer/lower-frequency details/settings such as bio, pet preference, location, and active-discussion visibility behind the profile settings card.
- Keep shared profile rendering/location helpers in `src/services/profile.js` and reuse them from `src/bot.js` and `src/callbacks.js`.
- Profile should show existing section taste labels under a separate label heading, with spacing from the rest of the profile.
- Profiles are public inside bot social surfaces; do not show a public/private profile setting for now.
- Showing a user's active discussion on their profile is a separate opt-in setting. The active room must not be exposed unless the setting is enabled.
- The active-discussion visibility row on the user's own profile should include a short self-only explanation command link, such as `(یعنی چی؟ /ad_help)`, only until the user opens that explanation and taps the acknowledgement button. Keep it compact so the profile row stays readable; the explanation card should have one acknowledgement button that removes the help card and returns to the user's own profile.
- The user's own profile may show one compact private growth hint when taste/profile data is still weak. Render it as a footer at the very bottom with one blank line above it. Prioritize one actionable next step, such as adding Interests, starting a section Top 10, adding a bio, or completing a small number of profile fields. Never show this hint on public, saved-profile, discovery, member-list, or invitation profile views.
- Saved profiles should feel like private bookmarks, not friendship. Saving/removing a profile should not notify the other user and should not imply private chat. People discovery should stay taste-first and should not imply dating, friendship, private chat, online status, or compatibility scoring.
- When viewing another user's profile from discussions, check that the viewer has at least a display name. If missing, show a profile completion gate with inline edit buttons for missing fields.
- The profile viewing gate requires only display name; age is optional and not enforced.
- When a user completes their profile through the gate, redirect them to the intended profile they were trying to view, not their own profile. The intended profile code is stored in `pendingProfileViewCode` and cleared after redirect.
- A Star balance is visible only on the authenticated user's own profile. Never include it in public profile cards, shareable text, member-list views, saved-profile views, discovery results, or invitation profile views.

## Guide Referral Card

Place `🎁 Invite someone to Muze` / `🎁 دعوت به میوز` in Guide beside Stars and Rules, not in the main menu, Discussions, People, or Saved Profiles. It edits the Guide card into one focused bilingual card containing live startup-loaded reward/qualification values, a native share URL, a copyable opaque-link fallback, and Back to guide. The native share message uses the inviter's current interface language and briefly explains favorites, taste-based people discovery, and live discussions. Do not expose the internal `TopTen` name or the retired “Top 10” product wording in referral copy. Back edits in place; navigating elsewhere retires the stale card through normal navigation-card cleanup. Shared-discussion onboarding ends with an explicit preview action and must never imply an automatic join.

Discussion invitations and Favorites share cards use the same localized Share convention. Discussion Copy contains a concise localized explanation, the discussion title, the fact that the link opens a preview, and the attributable discussion link. Its final action is `Close` / `بستن`, because the user is already in the active room; it quietly deletes the temporary card without a confirmation message. Favorites sends the clean formatted list as its own plain-text message, followed by a separate compact Share/Back control card. The list ends only with `Made with Muze` / `ساخته‌شده با میوز` and the public bot link. There is no copy button because complete messages exceed the platform copy-text limit; concise guidance says the text can be copied or shared, and the obvious action label is simply `Share` / `اشتراک`. Favorites sharing is not referral-attributed.
