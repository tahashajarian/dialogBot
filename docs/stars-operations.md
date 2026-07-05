# Stars Operations Checklist

Use this as the daily operational habit while Stars are enabled. The goal is to notice ledger, refund, boost, and referral problems early without manually editing balances.

## Daily Check

- Open the analytics dashboard and confirm the Star Economy section loads normally.
- Check ledger totals: earned, spent, refunded, granted, and outstanding balance should move in plausible directions for the current traffic.
- Check wallet reconciliation mismatch count. Any nonzero mismatch should be investigated before enabling new spending switches.
- Check pending Star transactions. A small transient count can exist during live writes; stale pending rows should be recovered or investigated.
- Check refund failures and failed effects. Prioritize any failed boost, paid-capacity, people-lens, profile-emoji, or paid-suggestion effect that charged before failing.
- Check duplicate/idempotency rates. A rise can mean users are double-tapping, callbacks are being retried, or a flow is leaving stale buttons visible.
- Check boost delivery failures and recommendation opt-outs if boost recommendations are enabled.
- Check suspicious invitation/referral concentration, especially many rewards from the same inviter, invitee cluster, or new-user source.

## Weekly Check

- Run or review `reconcileStarBalances` with a bounded limit and record the mismatch count.
- Review reward distribution by milestone. Very high invite/referral rewards compared with list/profile milestones may indicate farming.
- Review spending conversion only after spending switches are intentionally enabled.
- Confirm Star settings in the dashboard match the launch plan, then restart bot processes after setting changes so cached settings are refreshed.
- Confirm Advanced Search remains an uncharged preview until its separate product/privacy review is complete.

## Response Rules

- Never directly overwrite `starBalance` to fix a user-visible issue. Use ledger-backed grant, refund, reversal, or a focused migration.
- Do not delete Star transactions as a cleanup action.
- If a mismatch appears, first identify whether pending transactions need recovery, then compare the ledger sum with cached user balance.
- If refunds fail repeatedly, disable the affected spending switch before broader rollout.
- If invitation/referral farming appears, disable or reduce the relevant reward setting before adding new product restrictions.
- If boost delivery failures rise, disable boost recommendation delivery while leaving already-paid boost placement/refund rules intact.

## Useful Sources

- Dashboard Star Economy metrics: aggregate totals, outstanding balance, active boosts, referral/boost funnels, and reconciliation mismatches.
- `src/services/stars.js`: `recoverPendingStarTransactions` and `reconcileStarBalances`.
- `docs/stars.md`: product rules for earning, spending, refunds, privacy, and deferred payments.
- `docs/analytics-dashboard.md`: dashboard access and refresh behavior.
