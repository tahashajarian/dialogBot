const User = require("../models/user");
const ModerationAction = require("../models/moderation-action");

const MAX_REASON_LENGTH = 500;

function normalizeUserId(value) {
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

function normalizeReason(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, MAX_REASON_LENGTH);
}

async function unbanUser({ targetUserId, reason, actor = "analytics-dashboard", now = new Date() }) {
  const userId = normalizeUserId(targetUserId);
  const cleanReason = normalizeReason(reason);
  if (!userId) return { ok: false, reason: "invalid_user_id" };
  if (cleanReason.length < 10) return { ok: false, reason: "reason_too_short" };

  const user = await User.findOne({ userId }).select("userId bannedAt banReason banSource").lean();
  if (!user) return { ok: false, reason: "missing_user" };
  if (!user.bannedAt) return { ok: false, reason: "not_banned" };

  const audit = await ModerationAction.create({
    action: "unban",
    targetUserId: userId,
    actor,
    reason: cleanReason,
    status: "pending",
    previousBan: {
      bannedAt: user.bannedAt,
      reason: user.banReason || "",
      source: user.banSource || "",
    },
  });

  let updated;
  try {
    updated = await User.findOneAndUpdate(
      { userId, bannedAt: user.bannedAt },
      { $set: { bannedAt: null, banReason: "", banSource: "" } },
      { returnDocument: "after" },
    ).select("userId bannedAt").lean();
  } catch (error) {
    await ModerationAction.updateOne(
      { _id: audit._id },
      { $set: { status: "failed", completedAt: now, failureCode: String(error?.code || error?.name || "update_failed").slice(0, 100) } },
    ).catch(() => {});
    throw error;
  }
  const status = updated ? "applied" : "not_banned";
  const auditUpdated = await ModerationAction.updateOne(
    { _id: audit._id },
    { $set: { status, completedAt: now } },
  ).then(() => true, () => false);
  return updated
    ? { ok: true, actionId: String(audit._id), auditPending: !auditUpdated }
    : { ok: false, reason: "ban_changed", actionId: String(audit._id), auditPending: !auditUpdated };
}

async function getModerationAdminSnapshot({ limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const [bannedUsers, recentActions] = await Promise.all([
    User.find({ bannedAt: { $ne: null } })
      .select("userId publicProfileCode profileName firstName bannedAt banReason banSource reportReporterUserIds")
      .sort({ bannedAt: -1 })
      .limit(safeLimit)
      .lean(),
    ModerationAction.find({})
      .select("action targetUserId actor reason status previousBan completedAt createdAt failureCode")
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean(),
  ]);
  return {
    bannedUsers: bannedUsers.map((user) => ({
      userId: user.userId,
      publicProfileCode: user.publicProfileCode || "",
      displayName: user.profileName || user.firstName || "",
      bannedAt: user.bannedAt,
      banReason: user.banReason || "",
      banSource: user.banSource || "",
      uniqueReports: Array.isArray(user.reportReporterUserIds) ? user.reportReporterUserIds.length : 0,
    })),
    recentActions,
  };
}

module.exports = {
  getModerationAdminSnapshot,
  normalizeReason,
  normalizeUserId,
  unbanUser,
};
