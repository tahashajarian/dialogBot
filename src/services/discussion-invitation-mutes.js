const DiscussionInvitation = require("../models/discussion-invitation");
const DiscussionInvitationMute = require("../models/discussion-invitation-mute");
const User = require("../models/user");

async function hasInvitationMute({ muterUserId, mutedUserId }) {
  if (!Number.isInteger(Number(muterUserId)) || !Number.isInteger(Number(mutedUserId))) {
    return false;
  }
  const mute = await DiscussionInvitationMute.findOne({
    muterUserId: Number(muterUserId),
    mutedUserId: Number(mutedUserId),
  }).lean();
  return Boolean(mute);
}

async function muteInviterForUser({ muterUserId, mutedUserId, sourceInvitationId = null }) {
  const muter = Number(muterUserId);
  const muted = Number(mutedUserId);
  if (!Number.isInteger(muter) || !Number.isInteger(muted) || muter <= 0 || muted <= 0) {
    return { ok: false, reason: "missing_user" };
  }
  if (muter === muted) return { ok: false, reason: "self_mute" };

  const mute = await DiscussionInvitationMute.findOneAndUpdate(
    { muterUserId: muter, mutedUserId: muted },
    {
      $setOnInsert: {
        muterUserId: muter,
        mutedUserId: muted,
        sourceInvitationId,
        createdAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  await DiscussionInvitation.updateMany(
    {
      inviteeUserId: muter,
      inviterUserId: muted,
      status: "pending",
    },
    {
      $set: {
        status: "removed",
        removedAt: new Date(),
      },
    },
  );

  return { ok: true, mute };
}

async function countInvitationRestrictions(muterUserId) {
  const muter = Number(muterUserId);
  if (!Number.isInteger(muter) || muter <= 0) return 0;
  return DiscussionInvitationMute.countDocuments({ muterUserId: muter });
}

async function listInvitationRestrictions(muterUserId, { limit = 5, skip = 0 } = {}) {
  const muter = Number(muterUserId);
  if (!Number.isInteger(muter) || muter <= 0) {
    return { ok: false, reason: "missing_user", restrictions: [] };
  }
  const normalizedLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const normalizedSkip = Math.max(0, Number(skip) || 0);
  const restrictions = await DiscussionInvitationMute.find({ muterUserId: muter })
    .sort({ createdAt: -1, _id: -1 })
    .skip(normalizedSkip)
    .limit(normalizedLimit)
    .lean();
  const mutedUserIds = restrictions.map((entry) => Number(entry.mutedUserId)).filter(Number.isInteger);
  const users = mutedUserIds.length
    ? await User.find({ userId: { $in: mutedUserIds } })
      .select("userId profileName firstName profileEmoji publicProfileCode")
      .lean()
    : [];
  const usersById = new Map(users.map((user) => [Number(user.userId), user]));
  return {
    ok: true,
    restrictions: restrictions.map((restriction) => ({
      restriction,
      user: usersById.get(Number(restriction.mutedUserId)) || null,
    })),
  };
}

async function unmuteInviterForUser({ muterUserId, mutedUserId }) {
  const muter = Number(muterUserId);
  const muted = Number(mutedUserId);
  if (!Number.isInteger(muter) || !Number.isInteger(muted) || muter <= 0 || muted <= 0) {
    return { ok: false, reason: "missing_user" };
  }
  if (muter === muted) return { ok: false, reason: "self_mute" };
  const result = await DiscussionInvitationMute.deleteOne({
    muterUserId: muter,
    mutedUserId: muted,
  });
  return { ok: true, removed: Number(result.deletedCount) > 0 };
}

async function unmuteInvitationRestrictionById({ muterUserId, restrictionId }) {
  const muter = Number(muterUserId);
  const normalizedId = String(restrictionId || "").trim();
  if (!Number.isInteger(muter) || muter <= 0 || !/^[a-f0-9]{24}$/i.test(normalizedId)) {
    return { ok: false, reason: "invalid_restriction" };
  }
  const result = await DiscussionInvitationMute.deleteOne({
    _id: normalizedId,
    muterUserId: muter,
  });
  return { ok: true, removed: Number(result.deletedCount) > 0 };
}

async function unmuteInvitationRestrictionByProfileCode({ muterUserId, publicProfileCode }) {
  const rawCode = String(publicProfileCode || "").trim().replace(/^u_/i, "").toUpperCase();
  if (!/^[A-Z0-9]+$/.test(rawCode)) return { ok: false, reason: "invalid_profile" };
  const code = `u_${rawCode}`;
  const target = await User.findOne({ publicProfileCode: code }).select("userId").lean();
  if (!target) return { ok: false, reason: "missing_profile" };
  return unmuteInviterForUser({
    muterUserId,
    mutedUserId: target.userId,
  });
}

async function canRestrictInviterForUser({ muterUserId, mutedUserId }) {
  const muter = Number(muterUserId);
  const muted = Number(mutedUserId);
  if (!Number.isInteger(muter) || !Number.isInteger(muted) || muter <= 0 || muted <= 0 || muter === muted) {
    return false;
  }
  const invitation = await DiscussionInvitation.exists({
    inviteeUserId: muter,
    inviterUserId: muted,
    status: { $in: ["pending", "accepted"] },
  });
  return Boolean(invitation);
}

async function isUserMutedBy({ userId, possibleMuterUserId }) {
  return hasInvitationMute({
    muterUserId: possibleMuterUserId,
    mutedUserId: userId,
  });
}

module.exports = {
  canRestrictInviterForUser,
  countInvitationRestrictions,
  hasInvitationMute,
  listInvitationRestrictions,
  muteInviterForUser,
  unmuteInvitationRestrictionById,
  unmuteInvitationRestrictionByProfileCode,
  unmuteInviterForUser,
  isUserMutedBy,
};
