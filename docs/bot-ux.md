# Bot UX Rules

## Low-Noise Conversation

- Prefer one clear hub message per menu instead of sending repeated "back" or "returned" messages.
- Bot-authored guidance, empty states, and safe error messages should start with `🤖` so they feel clearly from the bot. Short success confirmations can keep their action/status emoji.
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
- When leaving an AI section/manage flow via Back, remove temporary reply keyboards (for example Top 10/Suggestion bottom buttons) before showing the higher-level menu.
- Context titles/cards should exist only while their section is active; remove tracked title cards when user leaves that section.
- Entering a section/list should show the relevant section/list title immediately, not only after returning from submenus.

## Input Collection

- When collecting typed input, hide bottom keyboards and provide one inline cancel button.
- Cancel/back copy should match the action: "back" should not sound like an operation was canceled unless an input flow was actually canceled.
- Text inputs should be length-limited and normalized before saving.
- Profile name/city are short fields; bio can be longer.

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

## Callback Notifications

- AI section entry uses Bale callback notifications (`answerCallbackQuery`) as a temporary top notification with the section name.
- Callback notifications are not persistent like a pin.
- Use callback notifications for lightweight context changes when the platform supports them.
- If a repeated button press keeps the visible message effectively unchanged, use a short callback notification so the user can tell the tap was handled without adding chat noise.
- If a callback belongs to an old/stale flow state, ignore it safely (or remove that stale card) instead of applying state changes from outdated buttons.
- When a command-link action fails from a list, remove or refresh the stale list and show the relevant list again after the bot explanation when practical.
- For command-link action lines, make the pointer face the command link. English uses `Join 👉 /d_CODE`; Persian uses `ورود 👈 /d_CODE`, which displays with the command on the left in RTL chat.
- Discussion lists should separate each discussion block with a simple line divider when multiple items are shown.
- Member lists inside a discussion use plain text command links, not inline buttons. Use the same pointer-link convention for profile, report, and owner-only remove actions, and separate member blocks with simple line dividers.
- Temporary keyboard-cleanup messages, such as leaving an active discussion and showing the discussions menu, should be removed when the user leaves the discussion menu.
- Active-discussion visibility status rows are self-only. Other users viewing a profile should not see that setting.
- Profile edit prompt cards, including Cancel buttons and validation retry prompts, should be deleted or have buttons removed after the edit is saved or canceled.
- Saved-profile lists use text command links for item actions. Do not show inline view/remove buttons per saved profile; keep inline controls limited to list navigation (pagination + Back) and profile-return navigation.
- Discussion invites should be one ready-to-share bot message/card. The invite must open a preview/join step and must not auto-join recipients or bypass normal join checks. Old invite previews should be revalidated on tap and edited/removed when stale where possible.

## Pinning

- Pin/unpin flows must use the active chat id and must not swallow API errors silently.
- Only persist a pinned message id after the pin request succeeds.
- If Bale pinning fails, log the chat id, message id, and error so the cause is visible.

## Profile UX

- Profile actions should always fail safely and fall back to text if photo rendering fails.
- When a user has no profile photo, show the local default avatar from `assets/default_profile.png`.
- Age selection should use a two-step flow: 10-year ranges first, then exact ages inside the chosen range.
- Keep high-frequency profile edits on the main profile card: name, photo, city, age, and bio. Put lower-frequency details/settings such as gender, pet preference, location, and active-discussion visibility behind the profile settings card.
- Keep shared profile rendering/location helpers in `src/services/profile.js` and reuse them from `src/bot.js` and `src/callbacks.js`.
- Profile should show existing section taste labels under a separate label heading, with spacing from the rest of the profile.
- Profiles are public inside bot social surfaces; do not show a public/private profile setting for now.
- Showing a user's active discussion on their profile is a separate opt-in setting. It should be visible as a profile setting even before discussions are fully implemented, but the active room itself must not be exposed unless enabled.
- The active-discussion visibility row on the user's own profile should include a short self-only explanation command link, such as `(یعنی چی؟ /ad_help)`. Keep it compact so the profile row stays readable; the explanation card should have one acknowledgement button that removes the help card and returns to the user's own profile.
- Saved profiles should feel like private bookmarks, not friendship. Saving/removing a profile should not notify the other user and should not imply private chat.
