const crypto = require("crypto");
const AccountDeletion = require("../models/account-deletion");
const User = require("../models/user");
const Discussion = require("../models/discussion");
const DiscussionInvitation = require("../models/discussion-invitation");
const DiscussionInvitationMute = require("../models/discussion-invitation-mute");
const DiscussionBoost = require("../models/discussion-boost");
const DiscussionBoostDelivery = require("../models/discussion-boost-delivery");
const AiPaidSuggestion = require("../models/ai-paid-suggestion");
const PeopleTasteUnlock = require("../models/people-taste-unlock");
const UserTasteIndex = require("../models/user-taste-index");
const AnalyticsEvent = require("../models/analytics-event");
const StarTransaction = require("../models/star-transaction");
const StarReferralLink = require("../models/star-referral-link");
const StarReferralClaim = require("../models/star-referral-claim");

function identityFingerprint(userId) {
  const secret = process.env.ACCOUNT_DELETION_SECRET || process.env.BOT_TOKEN;
  if (!secret) throw Object.assign(new Error("ACCOUNT_DELETION_SECRET is required"), { code: "missing_secret" });
  return crypto.createHmac("sha256", secret).update(String(Number(userId))).digest("hex");
}

async function prepareDeletion(userId) {
  const fingerprint = identityFingerprint(userId);
  const existing = await AccountDeletion.findOne({ identityFingerprint: fingerprint });
  if (existing?.status === "complete" && existing.restartedAt) {
    return AccountDeletion.findOneAndUpdate(
      { _id: existing._id, status: "complete", restartedAt: { $ne: null } },
      { $set: { status: "pending", step: "prepared", startedAt: null, completedAt: null, restartedAt: null, lastErrorCode: "" } },
      { returnDocument: "after" },
    );
  }
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tombstoneUserId = -crypto.randomInt(1, 2147483647);
    try { return await AccountDeletion.create({ identityFingerprint: fingerprint, tombstoneUserId }); } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  throw new Error("Could not allocate deletion tombstone");
}

async function deleteAccount({ userId, notifyOwnedDiscussionMembers } = {}) {
  const normalized = Number(userId);
  const operation = await prepareDeletion(normalized);
  if (operation.status === "complete") return { ok: true, alreadyComplete: true, tombstoneUserId: operation.tombstoneUserId };
  const claimed = await AccountDeletion.findOneAndUpdate(
    { _id: operation._id, status: { $in: ["pending", "failed"] } },
    { $set: { status: "running", startedAt: operation.startedAt || new Date(), lastErrorCode: "" } },
    { returnDocument: "after" },
  );
  if (!claimed && operation.status === "running") return { ok: false, reason: "in_progress" };
  const tombstone = operation.tombstoneUserId;
  try {
    const user = await User.findOne({ userId: normalized }).lean();
    if (!user) {
      await AccountDeletion.updateOne({ _id: operation._id }, { $set: { status: "complete", step: "complete", completedAt: new Date() } });
      return { ok: true, alreadyComplete: true, tombstoneUserId: tombstone };
    }
    const owned = await Discussion.find({ creatorUserId: normalized, status: "open" }).lean();
    for (const discussion of owned) {
      await Discussion.updateOne({ _id: discussion._id }, { $set: { status: "closed", closedAt: new Date(), memberUserIds: [] } });
      await DiscussionBoost.updateMany({ discussionId: discussion._id, status: { $in: ["pending", "active"] } }, { $set: { status: "cancelled", endsAt: new Date() } });
      await notifyOwnedDiscussionMembers?.(discussion, discussion.memberUserIds.filter((id) => Number(id) !== normalized));
    }
    await AccountDeletion.updateOne({ _id: operation._id }, { $set: { step: "discussions" } });
    await Discussion.updateMany({}, {
      $pull: { memberUserIds: normalized, removedUserIds: normalized, recentMessages: { senderUserId: normalized }, reports: { $or: [{ reporterUserId: normalized }, { targetUserId: normalized }] } },
    });
    await Discussion.updateMany({ creatorUserId: normalized }, { $set: { creatorUserId: tombstone, title: "Deleted discussion", description: "", joinRule: { type: "open" } } });
    await User.updateMany({ savedProfileCodes: user.publicProfileCode }, { $pull: { savedProfileCodes: user.publicProfileCode } });
    await Promise.all([
      DiscussionInvitation.deleteMany({ $or: [{ inviterUserId: normalized }, { inviteeUserId: normalized }] }),
      DiscussionInvitationMute.deleteMany({ $or: [{ muterUserId: normalized }, { mutedUserId: normalized }] }),
      DiscussionBoostDelivery.deleteMany({ recipientUserId: normalized }),
      AiPaidSuggestion.deleteMany({ userId: normalized }), PeopleTasteUnlock.deleteMany({ userId: normalized }),
      UserTasteIndex.deleteMany({ userId: normalized }),
      AnalyticsEvent.updateMany({ userId: normalized }, { $set: { userId: null }, $unset: { metadata: 1 } }),
    ]);
    await AccountDeletion.updateOne({ _id: operation._id }, { $set: { step: "audit" } });
    await StarTransaction.updateMany({ userId: normalized }, { $set: { userId: tombstone, balanceAfter: null }, $unset: { metadata: 1, constraints: 1, settingsSnapshot: 1, paymentId: 1 } });
    await StarTransaction.updateMany({ relatedUserId: normalized }, { $set: { relatedUserId: tombstone } });
    await StarReferralLink.updateMany(
      { inviterUserId: normalized },
      { $set: { inviterUserId: tombstone, expiresAt: new Date() } },
    );
    await StarReferralClaim.updateMany({ inviterUserId: normalized }, { $set: { inviterUserId: tombstone } });
    await StarReferralClaim.updateMany({ inviteeUserId: normalized }, { $set: { inviteeUserId: tombstone } });
    await DiscussionBoost.updateMany({ creatorUserId: normalized }, { $set: { creatorUserId: tombstone } });
    await User.deleteOne({ userId: normalized });
    await AccountDeletion.updateOne({ _id: operation._id }, { $set: { status: "complete", step: "complete", completedAt: new Date() } });
    return { ok: true, tombstoneUserId: tombstone };
  } catch (error) {
    await AccountDeletion.updateOne({ _id: operation._id }, { $set: { status: "failed", lastErrorCode: error.code || "cleanup_failed" } });
    return { ok: false, reason: "cleanup_failed", resumable: true };
  }
}

module.exports = { deleteAccount, identityFingerprint, prepareDeletion };
