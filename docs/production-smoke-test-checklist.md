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
- User selects Interest chips, selected chips remain visible with remove markers, and Continue appears only after the configured minimum.
- User types one custom Interest; the old picker is consumed and the fresh progress/result appears below the user's text.
- Completing onboarding stores choices in Interests Top 10 and does not create duplicate rewards on repeated callbacks.
- Repeated `/start` sends a returning user with meaningful activity to the main menu.

## Invite-First Onboarding

- Fresh user opens a public discussion invite link and chooses language if needed.
- The invite preview appears before full onboarding.
- Joining from the invite succeeds only when join rules allow it.
- Dismissing the invite can offer optional quick taste setup without marking onboarding complete.
- Reopening the same invite link previews or refocuses the room without double-awarding Stars.
- Persian and English invite-first copy feels natural and clearly from Muze.

## Lists And Suggestions

- Add one item to Movies watchlist; confirmation uses watchlist wording.
- Add one item to Music playlist; confirmation uses playlist/listened wording.
- Add one item to Books reading list; confirmation uses reading/read wording.
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
- Saved profiles behave as private bookmarks: save/remove does not notify the saved user.
- Saved-profile list/profile Back navigation returns to the saved-profile list.
- People browse profile Back navigation returns to the same People mode.

## Discussions

- Create a basic discussion and verify first-create reward appears once.
- Join a discussion and verify first-join reward appears once.
- Leave, rejoin, close, and remove member basics work without stale inline cards.
- Discussion message relay keeps sender formatting compact.
- Native replies resolve when the runtime delivery map has the target.
- Member/profile command links use the expected pointer direction in Persian and English.
- Active-discussion visibility stays self-only unless the user explicitly enables profile exposure.

## Invitations And Referrals

- Stored saved-profile invitation can be sent and accepted.
- First directed invite pair rewards only once.
- Repeated stored invitations between the same pair do not mention or award Stars again.
- Public discussion share links work for existing users.
- Attributable outside referral links preserve first valid referrer for genuinely new users.
- Self-referrals and existing-user starts do not qualify.

## Stars Spending Switches

- If discussion spending is disabled, boost actions are unavailable or clearly blocked without charging.
- If spending and boosts are enabled, boost quote shows cost, balance, duration/scope, Confirm, and Cancel.
- Insufficient boost balance shows a dismissible card with current cost and balance.
- Canceling a boost from active room keeps the user in the room flow.
- Canceling a boost from My discussions returns to a fresh My discussions list.
- Paid extra suggestion confirmation charges only after explicit confirmation and refunds on failed generation.

## Operations

- Translation validation passes after any copy change.
- Unit tests pass for changed services/flows.
- Integration tests pass when database mutations or Stars ledger behavior changed.
- Dashboard shows no ledger reconciliation mismatch.
- Operational metrics have no unexpected spike in duplicate idempotency, pending transactions, refund failures, boost delivery failures, or suspicious invitation/referral concentration.
