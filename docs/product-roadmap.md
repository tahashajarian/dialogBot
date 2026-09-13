# Product Roadmap

> Repository boundary: this roadmap applies only to the Telegram bot. The
> standalone mobile product is planned and shipped from `Muze-App`; its users,
> database, discussions, and releases are independent.

Muze is deployed on Telegram with an active private beta. Analytics,
D1/D7 retention, private nearby discovery, Stars, boosts, Advanced Search
interest tracking, reporting, and an audited operator unban flow are implemented.
Feature-specific documents remain the source of truth for shipped behavior.

## Current Priorities

### Operator setup

- [ ] Confirm production uses a Telegram-only database rather than a database
  shared with an older platform whose numeric user IDs could collide.
- [ ] Complete and publish `docs/privacy-policy.md`: operator name, privacy/support
  contact, providers, retention periods, and minimum-age position.
- [ ] Fill `docs/moderation-runbook.md`: safety owner, backup, contacts, response
  targets, incident retention, and authorized appeal reviewers.
- [ ] Run `npm run create:indexes` after deploying the moderation update.

These require operator information or production access; they are not coding
tasks an agent should guess.

### Production review

- [ ] Review onboarding completion, D1/D7 retention, Top 10 activity, discussion
  joins, AI failures, and slow routes in the dashboard; fix the clearest measured
  UX or performance problem.
- [ ] Review Stars distribution, farming signals, completion lift, and whether
  users understand earning and spending.
- [ ] Validate discussion boosts and Advanced Search interest with production
  usage, then tune rewards, costs, durations, and caps only when the evidence
  supports a change.
- [ ] Sample real reports and automatic bans to confirm moderation works under
  real usage and coordinated false reports are not a recurring problem.

### Deferred product decision

- [ ] Decide whether real-money Stars should exist. Do not implement payments
  until earned/spent Stars demonstrate healthy use and balance integrity.

If payments are approved later, select a supported provider and jurisdiction,
review platform/legal/refund/minor requirements, distinguish earned/purchased/
promotional ledger funds, define spending and refund order, add verified
idempotent callbacks and reconciliation, and use a separate rollout flag.

User transfers, cash-out, creator revenue sharing, and Star trading remain out
of scope.

## Evidence-Gated Ideas

These are not active tasks. Promote one to Current Priorities only when metrics
or user feedback demonstrate the need:

- shared catalogue-verification caching for measurable repeated lookup cost;
- a second Book candidate batch for excessive verified-suggestion failures;
- Movie reranking for demonstrated relevance problems;
- improved international Music display for recognition/search problems; and
- first-time taste-label badge artwork after core beta UX is validated.
