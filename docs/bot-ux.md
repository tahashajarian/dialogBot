# Bot UX Rules

## Low-Noise Conversation

- Prefer one clear hub message per menu instead of sending repeated "back" or "returned" messages.
- Bot-authored guidance, empty states, and safe error messages should start with the configured Muze marker emoji so they feel clearly from the bot. The default marker is `👩‍🦳`, and admins can change it from the dashboard. Short success confirmations can keep their action/status emoji.
- Bot-authored messages sent before normal app-context routing, such as allowlist and banned-user blocks, should still apply the configured Muze marker emoji.
- Edit an existing bot message when navigating menus if possible.
- Delete stale inline picker messages after the user chooses an item.
- When an inline card is consumed and the next step sends a fresh card/message, delete the old inline card first instead of leaving dead buttons in the chat.
- After a create/edit flow is confirmed or canceled, remove leftover step cards so dead inline actions are not left in chat.
- If a flow naturally moves from one picker to another, editing the same message in place is preferred.
- Do not delete user messages.
- Only delete bot messages that are temporary, stale, or invalid after the next action.
- If an inline message contains item indexes, remove or edit it after a mutating action so old buttons cannot act on shifted indexes.
- When deleting list items, delete the previous bot-sent list display if it is tracked, then confirm the removed item by name before showing the manage buttons again.
- Pressing "back" in non-cancel flows should not send cancel copy (for example "operation canceled").
- Back button labels should use `🔙` as the visible back emoji.
- Numeric inline button rows should be ordered so the visible numbers start from the left in both Persian and English clients.
- When leaving an AI section/manage flow via Back, remove temporary reply keyboards (for example Top 10/Suggestion bottom buttons) before showing the higher-level menu.
- When clearing a temporary reply keyboard before an inline menu, avoid blank/placeholder bubbles. Send the actual destination menu text with `remove_keyboard`, then attach inline buttons to that same visible message when the platform allows it. If the edit fallback must send a fresh inline menu, delete the keyboard-removal copy first so the same text does not remain twice.
- Context titles/cards should exist only while their section is active; remove tracked title cards when user leaves that section.
- Entering a section/list should show the relevant section/list title immediately, not only after returning from submenus.

## Input Collection

- When collecting typed input, provide one inline cancel button. Prefer hiding temporary bottom keyboards, but do not leave two visible prompt messages if the platform cannot combine keyboard removal and inline buttons reliably.
- Cancel/back copy should match the action: "back" should not sound like an operation was canceled unless an input flow was actually canceled.
- Text inputs should be length-limited and normalized before saving.
- Profile name/city are short fields; bio can be longer.

## First-Session Onboarding

- Ask fresh users to choose Persian or English before showing the product overview.
- After language selection, replace the language card with the localized welcome card and onboarding start action.
- The welcome message should state the product promise: build taste, get personal suggestions, and find related discussions.
- Offer recent, empty accounts a quick start that asks for some broad interests.
- Show a small rotating set of interests instead of one oversized picker; let users request more options.
- Let users type a custom interest through a dedicated input state with admin-managed length validation and a clear return action.
- After a user types a custom interest, consume the old picker and send the updated progress or result as a fresh message below the user's text; do not edit a card above the user's message.
- Save onboarding choices into the existing Interests TopTen; do not create a separate preference store.
- Show progress after each choice. Selected chips should remain visible with a remove marker, and tapping them removes the interest.
- Show the Continue action after the admin-configured onboarding minimum. Auto-complete onboarding at the admin-configured onboarding maximum.
- Keep Interest chip rows to three item buttons per row; onboarding should show four chip rows before the More/Custom controls. Do not render partial one- or two-chip rows.
- Completion should show a clearly labeled preliminary vibe and explain that adding more profile Interests and building `🎬🎵📚 Lists` helps Muze understand the user's taste and show more relevant discussions.
- End with clear next actions. When a starter invitation was prepared, make `📨 Invitations` the primary action; otherwise use active discussions as the primary discussion action. Offer the profile or main menu as follow-up for users who want to fill out more Interests, and `🎬🎵📚 Lists` for media lists. Keep main menu and help as secondary exits.
- Keep a reusable Muze guide in the main menu and expose the same guide from onboarding completion.
- The About/guide should summarize Lists, suggestions, Stars, discussions, profiles, people discovery, and private saved profiles, with direct actions to the Stars overview, Lists, and active discussions.
- Rules should reflect enforced privacy and product limits; do not describe planned moderation or discovery behavior as if it already exists.
- If onboarding offers a direct active-discussions action, it should open the active discussion list directly, not the intermediate discussions menu.
- Show the product overview first with one clear "choose interests" inline action; replace that card with the interest picker after the user taps it.
- Do not send a new user from onboarding into a generic section hub as the primary continuation.
- After normal onboarding completion, Muze may prepare one starter invitation to the open/free discussion and make `📨 Invitations` the primary next action. The starter invitation note should point users to the Invitations section, while the completion hint can cover profile Interests and media Lists. Do not send locked starter-room invitations during onboarding. These are Muze recommendations, not personal invites, and should not show Muze profile/mute controls. The active-discussions action can stay available as a secondary path for users who want to browse instead.
- Onboarding must not interrupt discussion invite entry. A fresh invite recipient may choose language first, but the pending invite must be preserved and continue directly to the localized invite preview without showing the interests onboarding action.
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
- Discussion message replies should use platform-native replies when the runtime delivery map can resolve the target message. Do not add visible "replying to..." text, persist reply metadata, or create thread cards/extra acknowledgements for simple replies.
- Temporary keyboard-cleanup messages, such as leaving an active discussion and showing the discussions menu, should be removed when the user leaves the discussion menu.
- Active-discussion visibility status rows are self-only. Other users viewing a profile should not see that setting.
- Profile edit prompt cards, including Cancel buttons and validation retry prompts, should be deleted or have buttons removed after the edit is saved or canceled.
- Profile display names must be emoji-free. Profile emoji is a separate paid cosmetic chosen from a paged curated picker, appears after the display name, and users may also type exactly one allowed emoji. Reserved system emojis, including the current bot marker, are not available there. Users should get a clear retry prompt if they submit emoji in their typed name.
- People and saved-profile lists use text command links for item actions. Do not show inline view/remove buttons per row; keep inline controls limited to list navigation (pagination + Back) and profile-return navigation. Their list Back buttons should use the generic Back label and return to the `👥 People` hub.
- Opening a profile from the saved-profile list should clear the old list card when possible, then show the profile with a Back button to the saved-profile list. The Back button must not depend on whether deleting the old list card succeeded.
- If saved-profile and invitation return state both appear possible, the currently visible saved-profile list takes priority. Do not show invitation-only controls, such as invite mute, when the profile was opened from saved profiles.
- Saved-profile discussion views should behave as their own return destination. If a join from that view fails, the "Got it" acknowledgment should return to the same saved user's discussions.
- Profiles opened from either People list should return to the same People list mode, free browse or `✨ آدم‌های احتمالاً شبیه تو`, not the saved-profile list.
- Free People browse has a simple no-profiles empty state. The Stars-gated similar-people lens distinguishes insufficient list data from no current matches; only insufficient data asks the user to add their first 3 items in one section.
- Shareable discussion invites should be one ready-to-share bot message/card. Stored saved-profile invitations should stay in the invitation inbox, show unseen state through the count/marker, and use Back-only navigation from the list/profile views. Both invite types must open a preview/join step and must not auto-join recipients or bypass normal join checks. Old invite previews should be revalidated on tap and edited/removed when stale where possible.

## Pinning

- Pin/unpin flows must use the active chat id and must not swallow API errors silently.
- Only persist a pinned message id after the pin request succeeds.
- If Telegram pinning fails, log the chat id, message id, and error so the cause is visible.

## Profile UX

- Profile actions should always fail safely and fall back to text if photo rendering fails.
- When a user has no profile photo, show the local default avatar from `assets/default_profile.png`.
- Age selection should use a two-step flow: age ranges first, then exact ages inside the chosen range. Start at 13, use compact buckets such as `13-17`, `18-24`, then decade-like adult ranges, and keep numeric inline rows ordered left to right in both languages.
- Keep high-frequency profile edits on the main profile card: name, age, photo, city, and gender. Put longer/lower-frequency details/settings such as bio, pet preference, location, and active-discussion visibility behind the profile settings card.
- Keep shared profile rendering/location helpers in `src/services/profile.js` and reuse them from `src/bot.js` and `src/callbacks.js`.
- Profile should show existing section taste labels under a separate label heading, with spacing from the rest of the profile.
- Profiles are public inside bot social surfaces; do not show a public/private profile setting for now.
- Showing a user's active discussion on their profile is a separate opt-in setting. The active room must not be exposed unless the setting is enabled.
- The active-discussion visibility row on the user's own profile should include a short self-only explanation command link, such as `(یعنی چی؟ /ad_help)`, only until the user opens that explanation and taps the acknowledgement button. Keep it compact so the profile row stays readable; the explanation card should have one acknowledgement button that removes the help card and returns to the user's own profile.
- Saved profiles should feel like private bookmarks, not friendship. Saving/removing a profile should not notify the other user and should not imply private chat. People discovery should stay taste-first and should not imply dating, friendship, private chat, or online status. The paid 3-common-items lens should use uncertain language such as `آدم‌های احتمالاً شبیه تو`, not compatibility or matching claims.
- When viewing another user's profile from discussions, check that the viewer has at least a display name. If missing, show a profile completion gate with inline edit buttons for missing fields.
- The profile viewing gate requires only display name; age is optional and not enforced.
- When a user completes their profile through the gate, redirect them to the intended profile they were trying to view, not their own profile. The intended profile code is stored in `pendingProfileViewCode` and cleared after redirect.
- A Star balance is visible only on the authenticated user's own profile. Never include it in public profile cards, shareable text, member-list views, saved-profile views, discovery results, or invitation profile views.
