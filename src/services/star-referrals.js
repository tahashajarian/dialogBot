const crypto = require("crypto");
const mongoose = require("mongoose");
const StarReferralLink = require("../models/star-referral-link");
const StarReferralClaim = require("../models/star-referral-claim");
const User = require("../models/user");
const { earnStars } = require("./stars");
const { starEconomy } = require("./star-settings");
const { logger } = require("./logger");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");

function normalizeReferralCode(value = "") {
  const normalized = String(value || "").trim().replace(/^ref_/i, "").toUpperCase();
  return /^[A-F0-9]{12}$/.test(normalized) ? normalized : "";
}

function generateReferralCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

async function createReferralLink({
  inviterUserId,
  discussionId = null,
  discussionPublicCode = "",
  source = "general",
  now = new Date(),
} = {}) {
  const normalizedInviter = Number(inviterUserId);
  if (!Number.isInteger(normalizedInviter) || normalizedInviter <= 0) {
    return { ok: false, reason: "invalid_inviter" };
  }
  const expiryDays = Number(starEconomy.externalReferralLinkExpiryDays) || 30;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const link = await StarReferralLink.create({
        publicCode: generateReferralCode(),
        inviterUserId: normalizedInviter,
        discussionId,
        discussionPublicCode: String(discussionPublicCode || ""),
        source: source === "discussion_share" ? "discussion_share" : "general",
        expiresAt: new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000),
      });
      return { ok: true, link };
    } catch (error) {
      if (Number(error?.code) !== 11000 || attempt === 4) throw error;
    }
  }
  return { ok: false, reason: "code_generation_failed" };
}

async function resolveReferralLink(code, { now = new Date() } = {}) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return { ok: false, reason: "invalid_referral" };
  const link = await StarReferralLink.findOne({ publicCode: normalized });
  if (!link) return { ok: false, reason: "missing_referral" };
  if (link.expiresAt && new Date(link.expiresAt) <= now) {
    return { ok: false, reason: "expired_referral", link };
  }
  return { ok: true, link };
}

async function claimReferral({ code, inviteeUserId, wasUserCreated, now = new Date() } = {}) {
  const inviteeId = Number(inviteeUserId);
  const resolved = await resolveReferralLink(code, { now });
  if (!resolved.ok) return resolved;
  if (!wasUserCreated) return { ok: false, reason: "existing_user", link: resolved.link };
  if (Number(resolved.link.inviterUserId) === inviteeId) {
    return { ok: false, reason: "self_referral", link: resolved.link };
  }
  try {
    const claim = await StarReferralClaim.create({
      referralLinkId: resolved.link._id,
      inviterUserId: resolved.link.inviterUserId,
      inviteeUserId: inviteeId,
      status: "pending",
    });
    void trackEvent({
      name: EVENT_NAMES.externalReferralClaimed,
      userId: inviteeId,
      source: resolved.link.source,
    });
    return { ok: true, claimed: true, claim, link: resolved.link };
  } catch (error) {
    if (Number(error?.code) !== 11000) throw error;
    const claim = await StarReferralClaim.findOne({ inviteeUserId: inviteeId });
    return {
      ok: Boolean(claim),
      claimed: false,
      reason: claim ? "already_claimed" : "claim_conflict",
      claim,
      link: resolved.link,
    };
  }
}

async function qualifyReferralForUser(inviteeUserId, { now = new Date() } = {}) {
  if (mongoose.connection.readyState !== 1) return { ok: false, reason: "storage_unavailable" };
  const inviteeId = Number(inviteeUserId);
  const claim = await StarReferralClaim.findOne({ inviteeUserId: inviteeId, status: "pending" });
  if (!claim) return { ok: false, reason: "no_pending_referral" };
  const amount = Number(starEconomy.rewardExternalReferral) || 0;
  if (amount <= 0) return { ok: false, reason: "reward_disabled" };
  try {
    const reward = await earnStars({
      userId: claim.inviterUserId,
      amount,
      reason: "external_referral_reward",
      idempotencyKey: `referral:new-user-qualified:${inviteeId}`,
      relatedUserId: inviteeId,
      settingsSnapshot: { rewardExternalReferral: amount },
      metadata: { source: "outside_referral", milestone: "external_referral_reward" },
    });
    if (!reward.ok) return reward;
    await StarReferralClaim.findOneAndUpdate(
      { _id: claim._id, status: "pending" },
      {
        $set: {
          status: "qualified",
          qualifiedAt: now,
          rewardTransactionId: reward.transaction?._id || claim.rewardTransactionId || null,
        },
      },
    );
    if (reward.applied) {
      void trackEvent({
        name: EVENT_NAMES.externalReferralQualified,
        userId: claim.inviterUserId,
        source: "outside_referral",
        metadata: { amount, status: "qualified" },
      });
    }
    const inviter = await User.findOne({ userId: claim.inviterUserId }).select("lang").lean();
    return {
      ok: true,
      applied: reward.applied,
      inviterUserId: claim.inviterUserId,
      inviterLang: inviter?.lang || "fa",
      amount: Math.abs(Number(reward.transaction?.amount) || amount),
      balance: reward.balance,
      claim,
    };
  } catch (error) {
    logger.error("Failed to qualify outside referral", { inviteeUserId, error });
    return { ok: false, reason: "reward_unavailable" };
  }
}

module.exports = {
  claimReferral,
  createReferralLink,
  generateReferralCode,
  normalizeReferralCode,
  qualifyReferralForUser,
  resolveReferralLink,
};
