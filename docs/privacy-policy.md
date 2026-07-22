# Muze Privacy Policy

> Launch template: before publishing this policy, replace every bracketed field,
> choose a minimum-age position, list the production service providers, add the
> backup-retention period, and have the final text reviewed for the countries in
> which Muze will operate. This repository document is a product-accurate
> template, not legal advice.

**Effective date:** [YYYY-MM-DD]

**Service operator:** [LEGAL NAME OR INDIVIDUAL OPERATOR]

**Privacy contact:** [PRIVACY EMAIL OR SUPPORT HANDLE]

This policy explains how the Muze Telegram bot ("Muze", "we", "us") handles
information when you create taste lists, use a profile, discover people, join
discussions, save profiles, receive AI suggestions, or use Stars.

## Information Muze Handles

Muze may receive or store:

- Telegram account information: numeric Telegram user ID, username, first name,
  language, and Telegram file identifiers needed to display profile or voice
  media. Muze does not receive your Telegram password.
- Profile information you choose to provide: Muze profile name, profile emoji,
  photo, bio, city, age, gender, pet preference, and profile visibility choices.
- Optional location information: latitude, longitude, accuracy, derived city,
  and sharing time when you explicitly send a location and that feature is
  enabled. Do not share precise location if you do not want Muze to store it.
- Taste information: Movies, Music, Books, Interests, Top 10 items, later lists,
  comments, completion status, taste labels, rejected/recent AI suggestions,
  and optional suggestion context or mood.
- Social information: public profile and discussion codes, saved-profile codes,
  discussion memberships, invitations, invitation restrictions, reports, and
  recent joined discussions.
- Discussion information: room title, description, join rule, membership, and
  the latest 10 accepted text or voice messages retained as room context. A
  voice entry stores a Telegram file identifier and duration.
- Stars information: balance, rewards, spending, refunds, referral attribution,
  boosts, and idempotent transaction records used to keep the wallet correct.
- Product and operational events: actions such as onboarding completion,
  suggestion requests, discussion joins, and Stars events, plus bounded health
  information such as request duration and provider failure category. Product
  analytics intentionally use small allowlisted metadata rather than message
  text. Operational health events expire automatically after seven days.
- Technical state needed to make the bot work: current flow/navigation state,
  callback-card message IDs, quotas, timestamps, feature preferences, and
  anti-abuse state.

## How Muze Uses Information

We use this information to:

- provide profiles, taste lists, suggestions, People discovery, discussions,
  invitations, bookmarks, and Stars;
- enforce eligibility, capacity, rate limits, duplicate protection, refunds,
  reports, bans, and invitation restrictions;
- preserve navigation and prevent old Telegram buttons from changing newer
  data;
- improve onboarding and understand aggregate product usage;
- diagnose availability, latency, Telegram delivery, MongoDB, and AI-provider
  failures;
- prevent fraud, reward farming, duplicate spending, and deletion/recreation
  abuse; and
- comply with applicable obligations and protect users and the service.

## What Other Users Can See

Muze is a social bot. Profiles are public inside Muze's social surfaces unless
a particular surface is described below as private.

Other Muze users may see your public profile code and the profile fields you
provide, including your taste lists and labels where the relevant profile view
supports them. `Show Favorites on profile` controls whether other users can see
your media Favorites and taste labels on your profile. Turning it off does not
delete those lists, and Muze may still use them for your suggestions, matching,
and discussion eligibility. `Appear in See People` controls only whether you
appear in new People discovery results; it does not make your profile private
and does not hide you from saved profiles, discussions, invitations, or direct
profile links.

`Show active discussions on profile` controls whether eligible open discussions
appear on your profile. Discussion members can see room content and member
identity. Content delivered into another person's Telegram chat can remain
there even after it is removed from Muze's database.

Saved profiles are private one-way bookmarks. Saving or removing a profile does
not notify that person. Invitation restrictions are also private and affect
future invitations and eligible joins as described in the bot.

Your Stars balance, private growth hints, and wallet details are shown only to
you. Muze does not expose them on public profiles.

## AI Processing

When you request an AI suggestion, embedding, or taste classification, Muze may
send the minimum relevant list titles, taste labels, blocked/rejected titles,
and optional context you supplied to the configured AI provider. Muze does not
send discussion history to the AI suggestion service as part of the current
product behavior.

The production AI provider is: [AI PROVIDER AND PRIVACY-POLICY LINK]. Its
handling of submitted data is governed by the operator's agreement and the
provider's policy. Do not submit sensitive personal information in list titles,
comments, or suggestion context.

## Service Providers And Disclosures

Muze relies on service providers to operate:

- Telegram for bot messages, media delivery, and platform account identifiers;
- [MONGODB HOST] for production database storage and backups;
- [SERVER/HOSTING PROVIDER] for application hosting and logs; and
- [AI PROVIDER] for configured AI and embedding requests.

We may disclose the minimum necessary information to these processors, to
protect users or the service, in a business transfer, or when required by
applicable law. Muze does not sell saved-profile relationships or expose them to
the profiles being saved.

## Retention

Active-account information is kept while needed to provide Muze, maintain
security and wallet integrity, meet the retention periods below, or resolve an
incident.

- Discussions retain only the latest 10 accepted messages as live room context;
  older context is displaced as new messages are accepted.
- Operational health events expire after seven days.
- Product analytics currently have no automatic time-based deletion and should
  be assigned an operator retention period before public launch:
  [ANALYTICS RETENTION PERIOD].
- Production backups are retained for: [BACKUP RETENTION PERIOD]. Deletions may
  remain in encrypted backups until those backups expire.
- Stars ledger, qualified referral, boost audit, and minimal deletion records
  may be retained after account deletion for reconciliation and anti-abuse, but
  the numeric Telegram user ID is replaced with a random negative tombstone or
  keyed fingerprint as applicable.

## Account Deletion

You can request deletion from **Profile → Privacy & Safety → Delete account**.
Muze removes the User record, memberships, invitations, invitation restrictions,
saved-profile references, taste index, paid AI drafts, personal analytics
metadata, and report references. Open discussions you created are closed or
anonymized as described by the current deletion flow.

Financial and anti-abuse records described above are anonymized rather than
deleted. Already-delivered Telegram messages and provider-side records outside
Muze's database may remain subject to Telegram's or the relevant provider's
controls. A later `/start` creates a fresh Muze account and does not restore the
deleted profile.

For access, correction, deletion problems, or privacy questions, contact
[PRIVACY EMAIL OR SUPPORT HANDLE]. We may need enough information to verify that
the request concerns the correct Telegram account.

## Security

We use restricted production credentials, least-privilege database access,
private administration access, idempotent wallet operations, automated backups,
and monitoring. No system is completely secure; contact
[SECURITY CONTACT] if you believe Muze or your account data has been exposed.

## Age And Safety

Muze's minimum permitted age is: [OWNER DECISION REQUIRED]. Until an age and
minor-safety review is complete, age-based discovery filters and real-money
purchases must remain unavailable. If you believe a minor is at risk, contact
[SAFETY CONTACT] and use Telegram's own reporting controls where appropriate.

## Changes

We may update this policy when Muze's features, providers, or legal obligations
change. Material changes will be communicated through [NOTICE METHOD]. The
effective date above identifies the current version.
