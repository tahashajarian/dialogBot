const crypto = require("crypto");
const DiscussionInvitation = require("../models/discussion-invitation");
const Discussion = require("../models/discussion");
const User = require("../models/user");
const { getUserLimits } = require("../constants/limits");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");
const { hasInvitationMute } = require("./discussion-invitation-mutes");
const {
  ensurePublicDiscussionCode,
  ensurePublicProfileCode,
  ensurePublicProfileCodes,
  normalizePublicProfileCode,
  normalizeMaxMembers,
  validateJoinRules,
} = require("./discussions");

const INVITATION_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generatePublicCodeSuffix(length) {
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    suffix += INVITATION_CODE_ALPHABET[crypto.randomInt(INVITATION_CODE_ALPHABET.length)];
  }
  return suffix;
}

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function normalizePublicInvitationCode(value) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  if (/^i_/i.test(raw)) return `i_${raw.slice(2).replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
  return `i_${raw.replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
}

async function ensurePublicInvitationCode(invitation) {
  const current = normalizePublicInvitationCode(invitation?.publicInvitationCode);
  if (current && current !== "i_") return { ok: true, code: current, invitation };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    invitation.publicInvitationCode = `i_${generatePublicCodeSuffix(7)}`;
    try {
      await invitation.save();
      return { ok: true, code: invitation.publicInvitationCode, invitation };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      invitation.publicInvitationCode = "";
    }
  }

  return { ok: false, reason: "code_generation_failed" };
}

function isProfileCodeSaved(user, profileCode) {
  const needle = normalizePublicProfileCode(profileCode).toLowerCase();
  if (!needle) return false;
  return (user?.savedProfileCodes || []).some(
    (entry) => normalizePublicProfileCode(entry).toLowerCase() === needle,
  );
}

async function countUnseenPendingReceivedInvitations(userId) {
  return countDistinctInvitationGroups({
    inviteeUserId: Number(userId),
    status: "pending",
    seenAt: null,
  });
}

async function countPendingReceivedInvitations(userId) {
  return countAllPendingReceivedInvitations(userId);
}

async function countAllPendingReceivedInvitations(userId) {
  return countDistinctInvitationGroups({
    inviteeUserId: Number(userId),
    status: "pending",
  });
}

async function countAllVisibleReceivedInvitations(userId) {
  return countDistinctInvitationGroups({
    inviteeUserId: Number(userId),
    status: { $in: ["pending", "accepted"] },
  });
}

async function countDistinctInvitationGroups(match = {}) {
  const [result] = await DiscussionInvitation.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          inviterUserId: "$inviterUserId",
          discussionId: "$discussionId",
        },
      },
    },
    { $count: "count" },
  ]);
  return Number(result?.count) || 0;
}

async function countCreatedInvitationsWithinWindow(inviterUserId, since) {
  return DiscussionInvitation.countDocuments({
    inviterUserId: Number(inviterUserId),
    createdAt: { $gte: since },
  });
}

async function listEligibleDiscussionsForInvite(inviterUserId, inviteeUserId) {
  const discussions = await Discussion.find({
    status: "open",
    memberUserIds: Number(inviterUserId),
  }).sort({ lastActivityAt: -1, updatedAt: -1, createdAt: -1 });

  return discussions.filter((discussion) => {
    const members = discussion.memberUserIds || [];
    const removed = discussion.removedUserIds || [];
    return !members.includes(Number(inviteeUserId)) && !removed.includes(Number(inviteeUserId));
  });
}

async function createDiscussionInvitation({
  inviterUserId,
  inviteePublicProfileCode,
  discussionId,
  source = "room",
  now = new Date(),
}) {
  const normalizedProfileCode = normalizePublicProfileCode(inviteePublicProfileCode);
  if (!normalizedProfileCode) return { ok: false, reason: "missing_invitee" };

  const [inviter, invitee, discussion] = await Promise.all([
    User.findOne({ userId: Number(inviterUserId) }),
    User.findOne({ publicProfileCode: normalizedProfileCode }),
    Discussion.findById(discussionId),
  ]);

  if (!inviter) return { ok: false, reason: "missing_user" };
  if (!invitee) return { ok: false, reason: "missing_invitee" };
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (!isProfileCodeSaved(inviter, normalizedProfileCode)) return { ok: false, reason: "not_saved" };
  if (Number(inviter.userId) === Number(invitee.userId)) return { ok: false, reason: "self_invite" };
  const muted = await hasInvitationMute({
    muterUserId: invitee.userId,
    mutedUserId: inviter.userId,
  });
  if (muted) return { ok: false, reason: "inviter_muted", discussion, invitee };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed", discussion };
  if (!(discussion.memberUserIds || []).includes(Number(inviter.userId))) {
    return { ok: false, reason: "not_member", discussion };
  }
  if ((discussion.memberUserIds || []).includes(Number(invitee.userId))) {
    return { ok: false, reason: "already_member", discussion, invitee };
  }
  if ((discussion.removedUserIds || []).includes(Number(invitee.userId))) {
    return { ok: false, reason: "removed_by_owner", discussion, invitee };
  }

  const existing = await DiscussionInvitation.findOne({
    inviteeUserId: invitee.userId,
    discussionId: discussion._id,
    status: "pending",
  });
  if (existing) {
    return { ok: false, reason: "duplicate", invitation: existing, discussion, invitee };
  }

  const limits = getUserLimits(inviter);
  const cap = Number(limits.discussionInvitationsPer24h) || 3;
  const cutoff = new Date(now.getTime() - limits.discussionInvitationWindowHours * 60 * 60 * 1000);
  const used = await countCreatedInvitationsWithinWindow(inviter.userId, cutoff);
  if (used >= cap) {
    return {
      ok: false,
      reason: "daily_limit",
      cap,
      used,
      windowHours: limits.discussionInvitationWindowHours,
      discussion,
      invitee,
    };
  }

  const discussionCode = await ensurePublicDiscussionCode(discussion);
  if (!discussionCode.ok) return discussionCode;
  await ensurePublicProfileCode(invitee.userId);
  const refreshedInvitee = await User.findOne({ userId: invitee.userId });

  const invitation = new DiscussionInvitation({
    discussionId: discussion._id,
    discussionPublicCode: discussionCode.code,
    inviterUserId: inviter.userId,
    inviteeUserId: invitee.userId,
    inviteePublicProfileCode: refreshedInvitee?.publicProfileCode || normalizedProfileCode,
    status: "pending",
    source: source === "saved_profile" ? "saved_profile" : "room",
    createdAt: now,
  });

  try {
    const codeResult = await ensurePublicInvitationCode(invitation);
    if (!codeResult.ok) return codeResult;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const duplicate = await DiscussionInvitation.findOne({
      inviteeUserId: invitee.userId,
      discussionId: discussion._id,
      status: "pending",
    });
    if (duplicate) return { ok: false, reason: "duplicate", invitation: duplicate, discussion, invitee };
    throw error;
  }

  void trackEvent({
    name: EVENT_NAMES.inviteSent,
    userId: inviter.userId,
    source: invitation.source,
  });

  return { ok: true, invitation, discussion, invitee };
}

async function createBotOnboardingInvitation({ user, discussion, now }) {
  const inviteeUserId = Number(user?.userId);
  if (!discussion || (discussion.memberUserIds || []).includes(inviteeUserId)) return false;
  if ((discussion.removedUserIds || []).includes(inviteeUserId)) return false;

  const existing = await DiscussionInvitation.findOne({
    inviteeUserId,
    discussionId: discussion._id,
    status: "pending",
  });
  if (existing) return existing.source === "bot_onboarding";

  const discussionCode = await ensurePublicDiscussionCode(discussion);
  if (!discussionCode.ok) return false;

  const invitation = new DiscussionInvitation({
    discussionId: discussion._id,
    discussionPublicCode: discussionCode.code,
    inviterUserId: Number(discussion.creatorUserId),
    inviteeUserId,
    inviteePublicProfileCode: user.publicProfileCode || "",
    status: "pending",
    source: "bot_onboarding",
    createdAt: now,
  });

  try {
    const codeResult = await ensurePublicInvitationCode(invitation);
    return Boolean(codeResult.ok);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    return true;
  }
}

async function createOnboardingStarterInvitationsForUser(userId, { now = new Date() } = {}) {
  const inviteeUserId = Number(userId);
  if (!Number.isInteger(inviteeUserId) || inviteeUserId <= 0) {
    return { ok: false, reason: "missing_user", count: 0 };
  }

  const user = await User.findOne({ userId: inviteeUserId });
  if (!user) return { ok: false, reason: "missing_user", count: 0 };
  if (user.onboardingStarterInvitationsAt) {
    const existingCount = await DiscussionInvitation.countDocuments({
      inviteeUserId,
      source: "bot_onboarding",
      status: "pending",
    });
    return { ok: true, count: existingCount, skipped: true };
  }

  const freeDiscussion = await Discussion.findOne({
    isBotCreated: true,
    botSeedKey: `free-discussion:${require("./discussion-language").getEffectiveDiscussionLanguageFilter(user) === "en" ? "en" : "fa"}`,
    status: "open",
  });
  const starters = [];
  if (freeDiscussion) {
    starters.push(freeDiscussion);
  }

  let count = 0;
  const seenDiscussionIds = new Set();
  for (const discussion of starters) {
    const discussionId = String(discussion?._id || "");
    if (!discussionId || seenDiscussionIds.has(discussionId)) continue;
    seenDiscussionIds.add(discussionId);
    if (await createBotOnboardingInvitation({ user, discussion, now })) count += 1;
  }

  if (count > 0) {
    user.onboardingStarterInvitationsAt = now;
    await user.save();
  }

  return { ok: true, count };
}

async function hydrateInvitations(invitations = []) {
  const discussionIds = invitations.map((entry) => entry.discussionId);
  const inviterIds = invitations.map((entry) => entry.inviterUserId);
  const [discussions, inviters] = await Promise.all([
    Discussion.find({ _id: { $in: discussionIds } }).lean(),
    User.find({ userId: { $in: inviterIds } }).select("userId profileName firstName publicProfileCode").lean(),
  ]);
  const preparedInviters = await ensurePublicProfileCodes(inviters);

  const discussionsById = new Map(discussions.map((entry) => [String(entry._id), entry]));
  const invitersById = new Map(preparedInviters.map((entry) => [Number(entry.userId), entry]));

  return invitations.map((invitation) => ({
    invitation,
    discussion: discussionsById.get(String(invitation.discussionId)) || null,
    inviter: invitersById.get(Number(invitation.inviterUserId)) || null,
  }));
}

function dedupeInvitationsByInviterAndDiscussion(invitations = []) {
  const seen = new Set();
  const deduped = [];
  for (const invitation of invitations) {
    const inviterUserId = Number(invitation?.inviterUserId) || 0;
    const discussionId = String(invitation?.discussionId || "");
    if (!inviterUserId || !discussionId) {
      deduped.push(invitation);
      continue;
    }
    const key = `${inviterUserId}:${discussionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(invitation);
  }
  return deduped;
}

async function listReceivedInvitations(userId, { limit = 20, skip = 0, statuses = ["pending"] } = {}) {
  const statusList = (Array.isArray(statuses) ? statuses : [statuses])
    .map((status) => String(status || "").trim())
    .filter((status) => ["pending", "accepted"].includes(status));
  const invitations = await DiscussionInvitation.find({
    inviteeUserId: Number(userId),
    status: { $in: statusList.length ? statusList : ["pending"] },
  }).sort({ createdAt: -1 }).lean();
  const deduped = dedupeInvitationsByInviterAndDiscussion(invitations);
  const paged = deduped.slice(
    Math.max(0, Number(skip) || 0),
    Math.max(0, Number(skip) || 0) + Math.max(1, Number(limit) || 20),
  );

  return {
    ok: true,
    invitations: await hydrateInvitations(paged),
  };
}

async function markInvitationsSeen(invitationIds = [], seenAt = new Date()) {
  const ids = (invitationIds || []).filter(Boolean);
  if (!ids.length) return { ok: true, modifiedCount: 0 };
  const result = await DiscussionInvitation.updateMany(
    {
      _id: { $in: ids },
      status: "pending",
      seenAt: null,
    },
    { $set: { seenAt } },
  );
  return { ok: true, modifiedCount: result.modifiedCount || 0 };
}

async function getInvitationForUser(code, userId, { statuses = ["pending"] } = {}) {
  const publicInvitationCode = normalizePublicInvitationCode(code);
  if (!publicInvitationCode || publicInvitationCode === "i_") return { ok: false, reason: "missing_invitation" };
  const statusList = (Array.isArray(statuses) ? statuses : [statuses])
    .map((status) => String(status || "").trim())
    .filter((status) => ["pending", "accepted"].includes(status));

  const invitation = await DiscussionInvitation.findOne({
    publicInvitationCode,
    inviteeUserId: Number(userId),
  });
  if (!invitation) return { ok: false, reason: "missing_invitation" };
  if (!(statusList.length ? statusList : ["pending"]).includes(invitation.status)) {
    return { ok: false, reason: "invitation_unavailable", invitation };
  }

  invitation.lastOpenedAt = new Date();
  await invitation.save();

  const discussion = await Discussion.findById(invitation.discussionId);
  return { ok: true, invitation, discussion };
}

async function removeInvitationForUser(code, userId) {
  const found = await getInvitationForUser(code, userId, { statuses: ["pending", "accepted"] });
  if (!found.ok) return found;
  found.invitation.status = "removed";
  found.invitation.removedAt = new Date();
  await found.invitation.save();
  return { ok: true, invitation: found.invitation };
}

async function markInvitationAccepted(invitation) {
  if (!invitation) return { ok: false, reason: "missing_invitation" };
  invitation.status = "accepted";
  invitation.acceptedAt = new Date();
  await invitation.save();
  return { ok: true, invitation };
}

async function expireInvitation(invitation) {
  if (!invitation) return { ok: false, reason: "missing_invitation" };
  invitation.status = "expired";
  invitation.expiredAt = new Date();
  await invitation.save();
  return { ok: true, invitation };
}

async function getInvitationDisplayState(user, discussion) {
  if (!discussion) return { state: "unavailable", reason: "missing_discussion" };
  if (discussion.status !== "open") return { state: "unavailable", reason: "discussion_closed" };
  const userId = Number(user?.userId);
  if ((discussion.memberUserIds || []).includes(userId)) return { state: "already_member" };
  if ((discussion.removedUserIds || []).includes(userId)) return { state: "blocked", reason: "removed_by_owner" };
  const maxMembers = normalizeMaxMembers(discussion.maxMembers);
  if ((discussion.memberUserIds || []).length >= maxMembers) return { state: "full", reason: "discussion_full" };
  const eligibility = await validateJoinRules({ user, joinRule: discussion.joinRule });
  if (!eligibility.ok) return { state: "locked", reason: eligibility.reason };
  return { state: "joinable" };
}

module.exports = {
  normalizePublicInvitationCode,
  countPendingReceivedInvitations,
  countUnseenPendingReceivedInvitations,
  countAllPendingReceivedInvitations,
  countAllVisibleReceivedInvitations,
  createDiscussionInvitation,
  createOnboardingStarterInvitationsForUser,
  dedupeInvitationsByInviterAndDiscussion,
  listEligibleDiscussionsForInvite,
  listReceivedInvitations,
  markInvitationsSeen,
  getInvitationForUser,
  removeInvitationForUser,
  markInvitationAccepted,
  expireInvitation,
  getInvitationDisplayState,
};
