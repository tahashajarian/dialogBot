const DiscussionInvitation = require("../models/discussion-invitation");
const DiscussionInvitationMute = require("../models/discussion-invitation-mute");

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

async function isUserMutedBy({ userId, possibleMuterUserId }) {
  return hasInvitationMute({
    muterUserId: possibleMuterUserId,
    mutedUserId: userId,
  });
}

module.exports = {
  hasInvitationMute,
  muteInviterForUser,
  isUserMutedBy,
};
