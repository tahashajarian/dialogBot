const { earnStars, hasStarTransaction } = require("./stars");
const { starEconomy } = require("./star-settings");
const { logger } = require("./logger");

function savedInvitePairKey(inviterUserId, inviteeUserId) {
  return `invite-pair:first-accepted:${Number(inviterUserId)}:${Number(inviteeUserId)}`;
}

async function isSavedInvitePairRewardClaimed(inviterUserId, inviteeUserId) {
  try {
    return await hasStarTransaction(savedInvitePairKey(inviterUserId, inviteeUserId));
  } catch {
    return false;
  }
}

async function awardSavedInvitePair({
  inviterUserId,
  inviteeUserId,
  invitationId,
  source,
} = {}) {
  if (["bot_onboarding", "onboarding_match"].includes(source)) return { ok: false, reason: "excluded_source" };
  if (Number(inviterUserId) === Number(inviteeUserId)) return { ok: false, reason: "self_invite" };
  const amount = Number(starEconomy.rewardSavedInvitePair) || 0;
  if (amount <= 0) return { ok: false, reason: "reward_disabled" };
  try {
    return await earnStars({
      userId: inviterUserId,
      amount,
      reason: "invite_pair_reward",
      idempotencyKey: savedInvitePairKey(inviterUserId, inviteeUserId),
      relatedUserId: inviteeUserId,
      invitationId,
      settingsSnapshot: {
        rewardSavedInvitePair: amount,
      },
      metadata: { source, milestone: "invite_pair_reward" },
    });
  } catch (error) {
    logger.error("Failed to award stored invitation Stars", {
      inviterUserId,
      inviteeUserId,
      invitationId,
      error,
    });
    return { ok: false, reason: "reward_unavailable" };
  }
}

module.exports = {
  awardSavedInvitePair,
  isSavedInvitePairRewardClaimed,
  savedInvitePairKey,
};
