const crypto = require("crypto");
const Discussion = require("../models/discussion");
const DiscussionBoost = require("../models/discussion-boost");
const DiscussionBoostDelivery = require("../models/discussion-boost-delivery");
const User = require("../models/user");
const { spendStars, refundStars } = require("./stars");
const { starEconomy } = require("./star-settings");
const { validateJoinRules } = require("./discussion-join-rules");
const {
  buildUserDiscoveryIndex,
  getSharedSections,
} = require("./people-discovery");
const { hasInvitationMute } = require("./discussion-invitation-mutes");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");

const BOOST_QUOTE_TTL_MS = 10 * 60 * 1000;

function generateBoostCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

async function expireFinishedBoosts(now = new Date()) {
  await DiscussionBoost.updateMany(
    { status: "active", endsAt: { $lte: now } },
    { $set: { status: "expired" } },
  );
}

async function getBoostEligibility(userId, discussionId, { now = new Date() } = {}) {
  if (!starEconomy.economyEnabled || !starEconomy.spendingEnabled || !starEconomy.boostEnabled) {
    return { ok: false, reason: "boost_disabled" };
  }
  await expireFinishedBoosts(now);
  const discussion = await Discussion.findById(discussionId);
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed" };
  if (Number(discussion.creatorUserId) !== Number(userId)) {
    return { ok: false, reason: "not_owner", discussion };
  }
  const active = await DiscussionBoost.findOne({
    status: "active",
    $or: [{ discussionId: discussion._id }, { creatorUserId: Number(userId) }],
  });
  if (active) return { ok: false, reason: "boost_already_active", discussion, boost: active };
  const latest = await DiscussionBoost.findOne({
    $or: [{ discussionId: discussion._id }, { creatorUserId: Number(userId) }],
    cooldownUntil: { $gt: now },
  }).sort({ cooldownUntil: -1 });
  if (latest) return { ok: false, reason: "boost_cooldown", discussion, boost: latest };
  return { ok: true, discussion };
}

async function createBoostQuote(userId, discussionId, { now = new Date() } = {}) {
  const eligibility = await getBoostEligibility(userId, discussionId, { now });
  if (!eligibility.ok) return eligibility;
  const settingsSnapshot = {
    discussionBoostCost: starEconomy.discussionBoostCost,
    discussionBoostDurationHours: starEconomy.discussionBoostDurationHours,
    discussionBoostCooldownHours: starEconomy.discussionBoostCooldownHours,
    discussionBoostRecipientCap: starEconomy.discussionBoostRecipientCap,
    discussionBoostedSlotsPerPage: starEconomy.discussionBoostedSlotsPerPage,
  };
  const quote = await DiscussionBoost.create({
    publicCode: generateBoostCode(),
    discussionId: eligibility.discussion._id,
    creatorUserId: Number(userId),
    status: "pending",
    quotedCost: starEconomy.discussionBoostCost,
    quoteExpiresAt: new Date(now.getTime() + BOOST_QUOTE_TTL_MS),
    settingsSnapshot,
  });
  void trackEvent({
    name: EVENT_NAMES.discussionBoostViewed,
    userId,
    source: "discussion_room",
    metadata: { cost: quote.quotedCost, durationHours: starEconomy.discussionBoostDurationHours },
  });
  return { ok: true, discussion: eligibility.discussion, quote };
}

async function confirmBoost(userId, publicCode, { now = new Date() } = {}) {
  const quote = await DiscussionBoost.findOne({ publicCode: String(publicCode || "").toUpperCase() });
  if (!quote || Number(quote.creatorUserId) !== Number(userId)) return { ok: false, reason: "missing_quote" };
  if (quote.status === "active") {
    const user = await User.findOne({ userId: Number(userId) }).select("starBalance").lean();
    return {
      ok: true,
      applied: false,
      boost: quote,
      duplicate: true,
      spend: { balance: Number(user?.starBalance) || 0, transaction: { _id: quote.spendTransactionId } },
    };
  }
  if (quote.status !== "pending" || quote.quoteExpiresAt <= now) {
    if (quote.status === "pending") {
      quote.status = "cancelled";
      await quote.save();
    }
    return { ok: false, reason: "quote_expired" };
  }
  if (Number(quote.quotedCost) !== Number(starEconomy.discussionBoostCost)) {
    quote.status = "cancelled";
    await quote.save();
    return { ok: false, reason: "stale_price", currentCost: starEconomy.discussionBoostCost };
  }
  const eligibility = await getBoostEligibility(userId, quote.discussionId, { now });
  if (!eligibility.ok) return eligibility;
  const spend = Number(quote.quotedCost) === 0
    ? {
      ok: true,
      applied: true,
      balance: Number((await User.findOne({ userId: Number(userId) }).select("starBalance").lean())?.starBalance) || 0,
      transaction: { _id: null },
    }
    : await spendStars({
      userId,
      amount: quote.quotedCost,
      reason: "discussion_boost",
      idempotencyKey: `boost:spend:${quote._id}`,
      discussionId: quote.discussionId,
      boostId: quote._id,
      settingsSnapshot: quote.settingsSnapshot,
      metadata: { source: "discussion_room" },
    });
  if (!spend.ok) return spend;

  const durationMs = Number(starEconomy.discussionBoostDurationHours) * 60 * 60 * 1000;
  const cooldownMs = Number(starEconomy.discussionBoostCooldownHours) * 60 * 60 * 1000;
  try {
    const boost = await DiscussionBoost.findOneAndUpdate(
      { _id: quote._id, status: "pending" },
      {
        $set: {
          status: "active",
          startsAt: now,
          endsAt: new Date(now.getTime() + durationMs),
          cooldownUntil: new Date(now.getTime() + durationMs + cooldownMs),
          spendTransactionId: spend.transaction?._id || null,
        },
      },
      { returnDocument: "after" },
    );
    if (!boost) throw new Error("boost_activation_conflict");
    void trackEvent({
      name: EVENT_NAMES.discussionBoostActivated,
      userId,
      source: "discussion_room",
      metadata: { cost: quote.quotedCost, durationHours: starEconomy.discussionBoostDurationHours },
    });
    return { ok: true, applied: true, boost, discussion: eligibility.discussion, spend };
  } catch (error) {
    const refund = spend.transaction?._id
      ? await refundStars({
        transactionId: spend.transaction._id,
        idempotencyKey: `boost:refund:${quote._id}`,
        reason: "boost_activation_failed",
        metadata: { status: "activation_failed" },
      })
      : { ok: true, transaction: null };
    await DiscussionBoost.findByIdAndUpdate(quote._id, {
      $set: {
        status: refund.ok ? "refunded" : "cancelled",
        refundTransactionId: refund.transaction?._id || null,
      },
    });
    return { ok: false, reason: "activation_failed", refunded: Boolean(refund.ok), error };
  }
}

async function decorateActiveBoosts(discussions = [], { now = new Date() } = {}) {
  await expireFinishedBoosts(now);
  const ids = discussions.map((discussion) => discussion._id).filter(Boolean);
  if (!ids.length) return discussions;
  const boosts = await DiscussionBoost.find({
    discussionId: { $in: ids },
    status: "active",
    endsAt: { $gt: now },
  }).select("discussionId endsAt").lean();
  const byDiscussion = new Map(boosts.map((boost) => [String(boost.discussionId), boost]));
  for (const discussion of discussions) {
    const boost = byDiscussion.get(String(discussion._id));
    if (boost) {
      discussion.isBoosted = true;
      discussion.boostEndsAt = boost.endsAt;
    }
  }
  return discussions;
}

async function selectBoostRecipients(boost, discussion, { now = new Date() } = {}) {
  if (!starEconomy.boostRecommendationsEnabled) return [];
  await DiscussionBoostDelivery.deleteMany({
    deliveredAt: null,
    reservedAt: { $lt: new Date(now.getTime() - BOOST_QUOTE_TTL_MS) },
  });
  const creator = await User.findOne({ userId: boost.creatorUserId }).lean();
  if (!creator) return [];
  const creatorIndex = buildUserDiscoveryIndex(creator);
  const cap = Number(starEconomy.discussionBoostRecipientCap) || 0;
  if (cap <= 0) return [];
  const candidates = await User.find({
    userId: { $nin: discussion.memberUserIds || [] },
    bannedAt: null,
    activeDiscussionId: null,
    receiveBoostRecommendations: { $ne: false },
  }).limit(Math.max(cap * 20, 100)).lean();
  const cutoff = new Date(now.getTime() - Number(starEconomy.boostRecipientWindowHours) * 60 * 60 * 1000);
  const recipients = [];
  for (const candidate of candidates) {
    if (recipients.length >= cap) break;
    const shared = getSharedSections(creatorIndex, buildUserDiscoveryIndex(candidate));
    if (!shared.length) continue;
    const [candidateMutedCreator, creatorMutedCandidate] = await Promise.all([
      hasInvitationMute({ muterUserId: candidate.userId, mutedUserId: boost.creatorUserId }),
      hasInvitationMute({ muterUserId: boost.creatorUserId, mutedUserId: candidate.userId }),
    ]);
    if (candidateMutedCreator || creatorMutedCandidate) continue;
    const join = await validateJoinRules({ user: candidate, joinRule: discussion.joinRule });
    if (!join.ok) continue;
    const recentCount = await DiscussionBoostDelivery.countDocuments({
      recipientUserId: candidate.userId,
      deliveredAt: { $gte: cutoff },
    });
    if (recentCount >= Number(starEconomy.boostRecommendationsPerRecipientWindow)) continue;
    const sameDiscussion = await DiscussionBoostDelivery.exists({
      discussionId: discussion._id,
      recipientUserId: candidate.userId,
    });
    if (sameDiscussion) continue;
    recipients.push({ user: candidate, sharedSections: shared });
  }
  return recipients;
}

async function recordBoostDelivery(boost, discussion, recipientUserId, { now = new Date() } = {}) {
  try {
    const delivery = await DiscussionBoostDelivery.create({
      boostId: boost._id,
      discussionId: discussion._id,
      recipientUserId,
      reservedAt: now,
    });
    return delivery;
  } catch (error) {
    if (Number(error?.code) === 11000) return null;
    throw error;
  }
}

async function markBoostDeliverySent(deliveryId, recipientUserId, { now = new Date() } = {}) {
  const delivery = await DiscussionBoostDelivery.findOneAndUpdate(
    { _id: deliveryId, recipientUserId: Number(recipientUserId), deliveredAt: null },
    { $set: { deliveredAt: now } },
    { returnDocument: "after" },
  );
  if (delivery) {
    void trackEvent({
      name: EVENT_NAMES.boostRecommendationSent,
      userId: recipientUserId,
      source: "discussion_boost",
    });
  }
  return delivery;
}

async function releaseBoostDelivery(deliveryId, recipientUserId) {
  return DiscussionBoostDelivery.deleteOne({
    _id: deliveryId,
    recipientUserId: Number(recipientUserId),
    deliveredAt: null,
  });
}

async function markBoostNotInterested(publicCode, recipientUserId, { now = new Date() } = {}) {
  const boost = await DiscussionBoost.findOne({ publicCode: String(publicCode || "").toUpperCase() }).lean();
  if (!boost) return { ok: false, reason: "missing_boost" };
  await DiscussionBoostDelivery.findOneAndUpdate(
    { boostId: boost._id, recipientUserId: Number(recipientUserId) },
    { $set: { notInterestedAt: now } },
  );
  void trackEvent({
    name: EVENT_NAMES.boostRecommendationNotInterested,
    userId: recipientUserId,
    source: "discussion_boost",
  });
  return { ok: true };
}

async function endBoostForDiscussion(discussionId, { now = new Date() } = {}) {
  return DiscussionBoost.findOneAndUpdate(
    { discussionId, status: "active" },
    { $set: { status: "cancelled", endsAt: now } },
    { returnDocument: "after" },
  );
}

module.exports = {
  confirmBoost,
  createBoostQuote,
  decorateActiveBoosts,
  endBoostForDiscussion,
  expireFinishedBoosts,
  generateBoostCode,
  getBoostEligibility,
  markBoostDeliverySent,
  markBoostNotInterested,
  recordBoostDelivery,
  releaseBoostDelivery,
  selectBoostRecipients,
};
