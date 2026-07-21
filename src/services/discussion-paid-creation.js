const User = require("../models/user");
const { spendStars, refundStars } = require("./stars");
const { starEconomy } = require("./star-settings");
const { operationalLimits } = require("./operational-limits");

function isPaidExtraDiscussionAvailable(settings = starEconomy) {
  return Boolean(
    settings.economyEnabled
    && settings.spendingEnabled
    && settings.paidExtraDiscussionsEnabled,
  );
}

async function authorizePaidExtraDiscussion({
  userId,
  activeOwnedCount,
  quotedCost,
  idempotencyKey,
} = {}) {
  if (!isPaidExtraDiscussionAvailable()) return { ok: false, reason: "unavailable" };

  const cost = Number(starEconomy.paidExtraDiscussionCost) || 0;
  if (Number(quotedCost) !== cost) return { ok: false, reason: "stale_price", cost };

  const paidOwnedSlotCap = Math.min(
    operationalLimits.ownedDiscussionHardLimit,
    Math.max(1, Number(activeOwnedCount) + 1),
  );
  const spend = cost > 0
    ? await spendStars({
      userId,
      amount: cost,
      reason: "discussion_extra_active_slot",
      idempotencyKey,
      settingsSnapshot: { paidExtraDiscussionCost: cost },
      metadata: { activeOwnedCount: Number(activeOwnedCount) || 0, paidOwnedSlotCap },
    })
    : { ok: true, balance: undefined, transaction: null };
  if (!spend.ok) return spend;

  let updated = null;
  try {
    updated = await User.findOneAndUpdate(
      { userId },
      {
        $set: {
          discussionDraftPaidOwnedSlotTransactionId: spend.transaction?._id || null,
          discussionDraftPaidOwnedSlotAuthorized: true,
          discussionDraftPaidOwnedSlotCap: paidOwnedSlotCap,
          discussionDraftPaidOwnedSlotCost: cost,
        },
      },
      { returnDocument: "after" },
    );
  } catch (error) {
    if (spend.transaction?._id) {
      await refundStars({
        transactionId: spend.transaction._id,
        idempotencyKey: `discussion-extra-slot-refund:${spend.transaction._id}`,
        reason: "discussion_extra_slot_authorization_failed",
      });
    }
    throw error;
  }
  if (updated) return { ok: true, balance: spend.balance, transaction: spend.transaction, paidOwnedSlotCap };

  if (spend.transaction?._id) {
    await refundStars({
      transactionId: spend.transaction._id,
      idempotencyKey: `discussion-extra-slot-refund:${spend.transaction._id}`,
      reason: "discussion_extra_slot_authorization_failed",
    });
  }
  return { ok: false, reason: "missing_user" };
}

async function refundPaidExtraDiscussionAuthorization(userId, {
  transactionId = null,
  reason = "discussion_extra_slot_cancelled",
} = {}) {
  const user = transactionId
    ? null
    : await User.findOne({ userId }).select("discussionDraftPaidOwnedSlotTransactionId").lean();
  const paidTransactionId = transactionId || user?.discussionDraftPaidOwnedSlotTransactionId;
  if (!paidTransactionId) return { ok: true, refunded: false };

  const refund = await refundStars({
    transactionId: paidTransactionId,
    idempotencyKey: `discussion-extra-slot-refund:${paidTransactionId}`,
    reason,
  });
  if (!refund.ok) return refund;

  await User.updateOne(
    { userId, discussionDraftPaidOwnedSlotTransactionId: paidTransactionId },
    {
      $set: {
        discussionDraftPaidOwnedSlotTransactionId: null,
        discussionDraftPaidOwnedSlotAuthorized: false,
        discussionDraftPaidOwnedSlotCap: 0,
        discussionDraftPaidOwnedSlotCost: 0,
      },
    },
  );
  return { ...refund, refunded: true };
}

module.exports = {
  isPaidExtraDiscussionAvailable,
  authorizePaidExtraDiscussion,
  refundPaidExtraDiscussionAuthorization,
};
