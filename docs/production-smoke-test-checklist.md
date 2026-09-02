# Production Smoke-Test Checklist

Use this before launch, after deploys, and after changes that touch onboarding, lists, profiles, discussions, invitations, Stars, or navigation copy.

## Setup

- Use a clean test account for Persian and a clean test account for English.
- Use a second existing account for discussion invites, saved-profile invites, and public profile views.
- Keep Stars earning enabled if validating rewards. Keep spending, boosts, and Advanced Search switches in the same state planned for launch.
- Do not clear production user data as part of smoke testing.

## Onboarding

- Fresh user opens `/start`, chooses Persian, sees the localized welcome card, and can start quick interests.
- Fresh user opens `/start`, chooses English, sees the localized welcome card, and can start quick interests.
- User selects Interest chips, selected built-in chips stay in place with `✓` markers, and Continue appears only after the configured minimum.
- After each selection, current Interests appear as plain `- item` lines immediately before the progress count.
- User types one custom Interest; the old picker is consumed and the fresh progress/result appears below the user's text.
- Completing onboarding stores choices in Interests Top 10 and does not create duplicate rewards on repeated callbacks.
- A matching Interest room is preferred for the one prepared invitation; otherwise the correct-language Free Discussion is used. Completion copy distinguishes these cases, says opening is only a preview, and never auto-joins.
- If both candidates are full or unavailable, completion stays neutral and shows no invitation-ready claim or button.
- Restarting before opening the prepared invitation preserves exactly one invitation and the same destination.
- Repeated `/start` sends a returning user from any flow to one banner-backed Home card without repeating the product introduction.

## Invite-First Onboarding

- Fresh user opens a public discussion invite link and chooses language if needed.
- The invite preview appears before full onboarding.
- Joining from the invite succeeds only when join rules allow it.
- Dismissing the invite can offer optional quick taste setup without marking onboarding complete.
- Reopening the same invite link previews or refocuses the room without double-awarding Stars.
- Persian and English invite-first copy feels natural and clearly from Muze.

## Lists And Suggestions

- Add one item to the Movies Movie Library; confirmation uses Movie Library/watched wording.
- Add one item to the Music Music Library; confirmation uses Music Library/listened wording.
- Add one item to the Books Book Library; confirmation uses Book Library/read wording.
- Add one profile Interest; confirmation uses interests wording and the flow remains under Profile, not the Lists hub.
- Add Top 10 items in each section and confirm post-save continuation prompts carry the Muze marker.
- Star progress hints use section-aware names and never say "regular list" or "normal list".
- Duplicate list and Top 10 inputs do not create extra rewards or confusing progress.
- AI suggestions require at least 3 Top 10 items, save to the correct list, and avoid duplicate suggestions.
- Advanced Search preview cannot charge Stars.

## Profiles And People

- Own profile shows Star balance.
- Own profile may show only one private growth hint when taste/profile data is weak.
- Public, saved-profile, People discovery, member-list, invitation, and shareable profile views never show Star balance or private growth hints.
- Profile edit cards clean up after save/cancel.
- With `profilePetPreferenceEnabled` and `profileLocationEnabled` off (their defaults), the Profile reply keyboard contains only Name/City, Bio/photo controls, and Back; the profile card has inline Age, Gender, Interests, Profile emoji, and a full-width Privacy & Safety action. Enabling Pet adds only its inline action and profile row; enabling Location pairs its reply action with Bio when a photo exists and adds only its profile row. Both visibility controls, invitation restrictions, and Delete account remain only in Privacy & Safety.
- The separate owner-profile editing guidance remains and installs the Profile reply keyboard. The owner card has a different `💡` tip pointing to Privacy & Safety for its settings; it never repeats the editing guidance and never appears on public/other-user profiles. The profile card keeps its inline quick controls.
- Turning off `Appear in See People` removes that account from newly queried results without making its profile private or preventing it from browsing People; turning it on restores eligibility.
- Location save/cancel returns to Profile. Age, Gender, Interests, Pet, and Profile emoji pickers edit and restore the same profile card; pressing the persistent Profile Back button while any picker is open restores that card once and does not redraw the picker. Privacy & Safety edits the existing profile text/caption in place and uses inline visibility, restriction, Delete account, and Back controls while preserving the Profile reply keyboard underneath. Privacy Back restores that same profile card without a guidance or duplicate profile message. Visibility changes refresh that same complete card, retain its title and explanation, and add one compact confirmation footer. Invitation Restrictions and its pages replace that same text/caption; its Back button restores Privacy & Safety on the same card without deleting or sending a message. The empty state says the restriction option is on an inviter's profile. Delete-account cancel edits the same warning card back to Privacy & Safety, preserves the reply keyboard, and deletes no data.
- Saved profiles behave as private bookmarks: save/remove does not notify the saved user.
- Saved-profile list/profile Back navigation returns to the saved-profile list.
- People browse profile Back navigation returns to the same People mode.
- The first People hub visit naturally explains discovery through shared choices and private bookmarks; it must not sound like an internal product disclaimer. The second visit, result pages, Saved Profiles, Back navigation, restart, and another device do not repeat it.
- Public profile cards offer useful save/remove actions, show discussions only when the viewed user has visible/open discussions, and do not leave the user stuck after saving or opening discussions.

## Discussions

- All eight language-specific Muze starter rooms have capacity 100 after restart; user-created capacity defaults and choices remain unchanged.
- The first Active Discussions visit includes compact relevance and join-condition guidance. Every populated visit, filter, and pagination page retains only the shorter direct-entry line; it must not call the `/d_CODE` list command a preview. The richer first-visit explanation does not repeat after restart or on another device.
- Invitation guidance and Active Discussions browsing guidance each appear once because they explain different actions; existing users without the new Active Discussions marker receive its tip on their next visit.
- Create a basic discussion and verify first-create reward appears once.
- Join a discussion and verify first-join reward appears once.
- Leave, rejoin, close, and remove member basics work without stale inline cards.
- Discussion message relay keeps sender formatting compact.
- Native replies resolve when the runtime delivery map has the target.
- Member/profile command links use the expected pointer direction in Persian and English.
- Active-discussion visibility stays self-only unless the user explicitly enables profile exposure.

## Invitations And Referrals

- The prepared onboarding invitation appears in the normal inbox, opens a preview without joining, and explains a missing join requirement when applicable.
- Stored saved-profile invitation can be sent and accepted.
- Restricting an inviter requires confirmation, removes their pending invites, blocks future invites and new joins to the restricting user's rooms, but leaves saved profiles and existing memberships unchanged.
- Privacy & Safety lists the restricted inviter after restart; allowing invitations again restores future invites/eligible joins without restoring removed invitations or notifying the other user.
- First directed invite pair rewards only once.
- Repeated stored invitations between the same pair do not mention or award Stars again.
- Public discussion share links work for existing users.
- Attributable outside referral links preserve first valid referrer for genuinely new users.
- Self-referrals and existing-user starts do not qualify.

## Favorites First Visit

- The first My Lists hub response distinguishes Favorites from media Libraries, retains the three-item suggestion and ten-item taste-label guidance, and mentions People/discussion relevance.
- The second visit, internal Back navigation, restart, and another device do not repeat the first-visit tip; normal manager controls remain immediately usable.

## Stars Spending Switches

- If discussion spending is disabled, boost actions are unavailable or clearly blocked without charging.
- If spending and boosts are enabled, boost quote shows cost, balance, duration/scope, Confirm, and Cancel.
- Insufficient boost balance shows a dismissible card with current cost and balance.
- Canceling a boost from active room keeps the user in the room flow.
- Canceling a boost from My discussions returns to a fresh My discussions list.
- Paid extra suggestion confirmation charges only after explicit confirmation and refunds on failed generation.

## Operations

- The published privacy-policy URL and support contact are reachable from the bot's public launch information.
- The moderation owner can identify a new report/auto-ban, document a case without exposing reporter identity, and follow the approved appeal path.
- Translation validation passes after any copy change.
- Unit tests pass for changed services/flows.
- Integration tests pass when database mutations or Stars ledger behavior changed.
- Dashboard shows no ledger reconciliation mismatch.
- Operational metrics have no unexpected spike in duplicate idempotency, pending transactions, refund failures, boost delivery failures, or suspicious invitation/referral concentration.
