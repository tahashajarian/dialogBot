const Discussion = require("../models/discussion");
const User = require("../models/user");
const { normalizeAiListItem, getAiListItemsFromUser, getAiTasteFromUser } = require("./users");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");

const DISCUSSION_MEMBER_CAP = 20;
const USER_DISCUSSION_MEMBERSHIP_CAP = 10;
const DISCUSSION_RECENT_MESSAGES_CAP = 10;
const SAVED_PROFILE_CAP = 50;
const DISCUSSION_CREATE_DAILY_LIMIT = 3;
const DISCUSSION_MESSAGE_LIMIT = 30;
const DISCUSSION_MESSAGE_WINDOW_MS = 10 * 60 * 1000;

function normalizePublicProfileCode(value) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  if (!/^u_/i.test(raw)) return "";
  return `u_${raw.slice(2).replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
}

function normalizeDiscussionText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeTitle(value) {
  return normalizeDiscussionText(value, 80);
}

function normalizeDescription(value) {
  return normalizeDiscussionText(value, 300);
}

function hasLink(value) {
  return /https?:\/\/|www\.|t\.me\/|telegram\.me\/|bale\.ai\//i.test(String(value || ""));
}

async function ensurePublicProfileCode(userId) {
  const user = await User.findOne({ userId });
  if (!user) return { ok: false, reason: "missing_user" };

  const current = normalizePublicProfileCode(user.publicProfileCode);
  if (current) return { ok: true, code: current, user };

  let code = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    code = `u_${suffix}`;
    const exists = await User.exists({ publicProfileCode: code });
    if (!exists) break;
    code = "";
  }

  if (!code) return { ok: false, reason: "code_generation_failed" };

  const updated = await User.findOneAndUpdate(
    { userId },
    { $set: { publicProfileCode: code } },
    { returnDocument: "after" },
  );

  return { ok: true, code, user: updated };
}

function validateJoinRulePayload(joinRule = {}) {
  const type = String(joinRule.type || "open");
  if (!["open", "top_ten_completed", "taste_label", "top_ten_item"].includes(type)) {
    return { ok: false, reason: "invalid_join_rule" };
  }

  if (type === "open") return { ok: true, joinRule: { type: "open" } };

  const section = String(joinRule.section || "");
  if (!["movies", "music", "books", "random"].includes(section)) {
    return { ok: false, reason: "invalid_section" };
  }

  if (type === "top_ten_completed") {
    return { ok: true, joinRule: { type, section } };
  }

  if (type === "taste_label") {
    const tasteLabelKey = String(joinRule.tasteLabelKey || "").trim();
    if (!tasteLabelKey) return { ok: false, reason: "missing_taste_label" };
    return { ok: true, joinRule: { type, section, tasteLabelKey } };
  }

  const itemTitle = normalizeAiListItem(joinRule.itemTitle || "");
  if (!itemTitle) return { ok: false, reason: "missing_item" };
  return { ok: true, joinRule: { type, section, itemTitle } };
}

async function validateJoinRules({ user, joinRule }) {
  if (!user) return { ok: false, reason: "missing_user" };
  const type = joinRule?.type || "open";

  if (type === "open") {
    return { ok: true };
  }

  const section = joinRule.section;
  if (type === "top_ten_completed") {
    const topTen = getAiListItemsFromUser(user, section, "topTen");
    if (topTen.length >= 10) return { ok: true };
    return { ok: false, reason: "requires_top_ten_completed", section };
  }

  if (type === "taste_label") {
    const taste = getAiTasteFromUser(user, section);
    if (taste?.labelKey && taste.labelKey === joinRule.tasteLabelKey) {
      return { ok: true };
    }
    return { ok: false, reason: "requires_taste_label", section, tasteLabelKey: joinRule.tasteLabelKey };
  }

  if (type === "top_ten_item") {
    const topTen = getAiListItemsFromUser(user, section, "topTen");
    const match = getAiListDuplicateMatch(joinRule.itemTitle, topTen);
    const hasItem = Boolean(match);
    if (hasItem) return { ok: true };
    return { ok: false, reason: "requires_top_ten_item", section, itemTitle: joinRule.itemTitle };
  }

  return { ok: false, reason: "invalid_join_rule" };
}

async function createDiscussion({ creatorUserId, title, description, joinRule }) {
  const user = await User.findOne({ userId: creatorUserId });
  if (!user) return { ok: false, reason: "missing_user" };

  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return { ok: false, reason: "invalid_title" };
  if (hasLink(normalizedTitle)) return { ok: false, reason: "invalid_title_link" };

  const normalizedDescription = normalizeDescription(description);
  const parsedRule = validateJoinRulePayload(joinRule);
  if (!parsedRule.ok) return parsedRule;

  if (parsedRule.joinRule.type === "open" && !normalizedDescription) {
    return { ok: false, reason: "open_requires_description" };
  }

  const memberships = Array.isArray(user.discussionMembershipIds) ? user.discussionMembershipIds : [];
  if (memberships.length >= USER_DISCUSSION_MEMBERSHIP_CAP) {
    return { ok: false, reason: "membership_limit" };
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const createdToday = await Discussion.countDocuments({
    creatorUserId,
    createdAt: { $gte: dayAgo },
  });
  if (createdToday >= DISCUSSION_CREATE_DAILY_LIMIT) {
    return { ok: false, reason: "create_rate_limit", cap: DISCUSSION_CREATE_DAILY_LIMIT };
  }

  const eligibility = await validateJoinRules({ user, joinRule: parsedRule.joinRule });
  if (!eligibility.ok) return eligibility;

  const discussion = await Discussion.create({
    title: normalizedTitle,
    description: normalizedDescription,
    creatorUserId,
    joinRule: parsedRule.joinRule,
    status: "open",
    memberUserIds: [creatorUserId],
    maxMembers: DISCUSSION_MEMBER_CAP,
    recentMessages: [],
    replyCount: 0,
    lastActivityAt: new Date(),
  });

  const membershipIds = [...memberships, discussion._id];
  await User.findOneAndUpdate(
    { userId: creatorUserId },
    {
      $set: { activeDiscussionId: discussion._id },
      $addToSet: { discussionMembershipIds: discussion._id },
    },
  );

  return { ok: true, discussion, membershipIds };
}

async function listActiveDiscussions({ limit = 50 } = {}) {
  const discussions = await Discussion.find({ status: "open" })
    .sort({ lastActivityAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(limit);
  return { ok: true, discussions };
}

async function listMyDiscussions(userId, { limit = 50 } = {}) {
  const user = await User.findOne({ userId });
  if (!user) return { ok: false, reason: "missing_user" };

  const ids = Array.isArray(user.discussionMembershipIds) ? user.discussionMembershipIds : [];
  const discussions = await Discussion.find({ _id: { $in: ids }, status: "open" })
    .sort({ lastActivityAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(limit);

  return { ok: true, discussions, activeDiscussionId: user.activeDiscussionId || null };
}

async function joinOrSwitchActiveDiscussion(userId, discussionId) {
  const [user, discussion] = await Promise.all([
    User.findOne({ userId }),
    Discussion.findById(discussionId),
  ]);

  if (!user) return { ok: false, reason: "missing_user" };
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed" };

  const isMember = discussion.memberUserIds.includes(userId);
  const memberships = Array.isArray(user.discussionMembershipIds) ? user.discussionMembershipIds : [];

  if (!isMember) {
    if (discussion.memberUserIds.length >= DISCUSSION_MEMBER_CAP) {
      return { ok: false, reason: "discussion_full", cap: DISCUSSION_MEMBER_CAP };
    }

    if (memberships.length >= USER_DISCUSSION_MEMBERSHIP_CAP) {
      return { ok: false, reason: "membership_limit", cap: USER_DISCUSSION_MEMBERSHIP_CAP };
    }

    const eligibility = await validateJoinRules({ user, joinRule: discussion.joinRule });
    if (!eligibility.ok) return eligibility;

    discussion.memberUserIds.push(userId);
    discussion.updatedAt = new Date();
    await discussion.save();

    await User.findOneAndUpdate(
      { userId },
      {
        $set: { activeDiscussionId: discussion._id },
        $addToSet: { discussionMembershipIds: discussion._id },
      },
    );

    return { ok: true, discussion, joined: true, switched: true };
  }

  await User.findOneAndUpdate(
    { userId },
    { $set: { activeDiscussionId: discussion._id } },
  );

  return { ok: true, discussion, joined: false, switched: true };
}

async function leaveDiscussionAsMember(userId, discussionId) {
  const [user, discussion] = await Promise.all([
    User.findOne({ userId }),
    Discussion.findById(discussionId),
  ]);

  if (!user) return { ok: false, reason: "missing_user" };
  if (!discussion) return { ok: false, reason: "missing_discussion" };

  if (discussion.creatorUserId === userId && discussion.status === "open") {
    return { ok: false, reason: "owner_cannot_leave_open" };
  }

  const wasMember = discussion.memberUserIds.includes(userId);
  if (!wasMember) return { ok: false, reason: "not_member" };

  discussion.memberUserIds = discussion.memberUserIds.filter((id) => id !== userId);
  discussion.updatedAt = new Date();
  await discussion.save();

  const updates = {
    $pull: { discussionMembershipIds: discussion._id },
  };

  if (String(user.activeDiscussionId || "") === String(discussion._id)) {
    updates.$set = { activeDiscussionId: null };
  }

  await User.findOneAndUpdate({ userId }, updates);
  return {
    ok: true,
    discussionId: discussion._id,
    discussionTitle: discussion.title,
    creatorUserId: discussion.creatorUserId,
  };
}

async function closeDiscussionAsOwner(ownerUserId, discussionId) {
  const discussion = await Discussion.findById(discussionId);
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.creatorUserId !== ownerUserId) return { ok: false, reason: "not_owner" };
  if (discussion.status === "closed") return { ok: false, reason: "already_closed" };

  const memberIds = [...discussion.memberUserIds];

  discussion.status = "closed";
  discussion.closedAt = new Date();
  discussion.updatedAt = new Date();
  await discussion.save();

  await User.updateMany(
    {
      $or: [
        { userId: { $in: memberIds } },
        { discussionMembershipIds: discussion._id },
      ],
    },
    {
      $pull: { discussionMembershipIds: discussion._id },
    },
  );

  await User.updateMany(
    { activeDiscussionId: discussion._id },
    { $set: { activeDiscussionId: null } },
  );

  return { ok: true, discussion, affectedMemberIds: memberIds };
}

async function removeMemberAsOwner(ownerUserId, discussionId, memberUserId) {
  const discussion = await Discussion.findById(discussionId);
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.creatorUserId !== ownerUserId) return { ok: false, reason: "not_owner" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed" };
  if (memberUserId === ownerUserId) return { ok: false, reason: "owner_cannot_remove_self" };

  const wasMember = discussion.memberUserIds.includes(memberUserId);
  if (!wasMember) return { ok: false, reason: "not_member" };

  discussion.memberUserIds = discussion.memberUserIds.filter((id) => id !== memberUserId);
  discussion.updatedAt = new Date();
  await discussion.save();

  await User.findOneAndUpdate(
    { userId: memberUserId },
    { $pull: { discussionMembershipIds: discussion._id } },
  );

  await User.findOneAndUpdate(
    { userId: memberUserId, activeDiscussionId: discussion._id },
    { $set: { activeDiscussionId: null } },
  );

  return {
    ok: true,
    discussionId: discussion._id,
    discussionTitle: discussion.title,
    memberUserId,
  };
}

function getRecentDiscussionMessageUsageFromUser(user, now = new Date(), windowMs = DISCUSSION_MESSAGE_WINDOW_MS) {
  const cutoff = now.getTime() - windowMs;
  return (user?.discussionMessageUsage || [])
    .map((entry) => new Date(entry))
    .filter((entry) => Number.isFinite(entry.getTime()) && entry.getTime() > cutoff);
}

async function consumeDiscussionMessageQuota(userId) {
  const user = await User.findOne({ userId });
  if (!user) return { ok: false, reason: "missing_user" };

  const now = new Date();
  const recentUsage = getRecentDiscussionMessageUsageFromUser(user, now);
  if (recentUsage.length >= DISCUSSION_MESSAGE_LIMIT) {
    return { ok: false, reason: "message_rate_limit", cap: DISCUSSION_MESSAGE_LIMIT };
  }

  const updatedUsage = [...recentUsage, now];
  await User.findOneAndUpdate(
    { userId },
    { $set: { discussionMessageUsage: updatedUsage } },
  );
  return { ok: true, count: updatedUsage.length };
}

async function addRecentMessage({ discussionId, senderUserId, senderDisplayName, text }) {
  const discussion = await Discussion.findById(discussionId);
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed" };
  if (!discussion.memberUserIds.includes(senderUserId)) return { ok: false, reason: "not_member" };

  const cleanText = normalizeDiscussionText(text, 500);
  const cleanName = normalizeDiscussionText(senderDisplayName, 80);
  if (!cleanText) return { ok: false, reason: "empty_message" };

  const quota = await consumeDiscussionMessageQuota(senderUserId);
  if (!quota.ok) return { ...quota, discussion };

  const nextMessages = [
    ...discussion.recentMessages,
    {
      senderUserId,
      senderDisplayName: cleanName || "کاربر",
      text: cleanText,
      sentAt: new Date(),
    },
  ].slice(-DISCUSSION_RECENT_MESSAGES_CAP);

  discussion.recentMessages = nextMessages;
  discussion.replyCount = Number(discussion.replyCount || 0) + 1;
  discussion.lastActivityAt = new Date();
  discussion.updatedAt = new Date();
  await discussion.save();

  return {
    ok: true,
    discussion,
    recentMessages: nextMessages,
    recipients: discussion.memberUserIds.filter((id) => id !== senderUserId),
  };
}

async function addSavedProfileCode(userId, profileCode) {
  const cleanCode = normalizePublicProfileCode(profileCode);
  if (!cleanCode) return { ok: false, reason: "empty_code" };

  const user = await User.findOne({ userId });
  if (!user) return { ok: false, reason: "missing_user" };

  const current = Array.isArray(user.savedProfileCodes) ? user.savedProfileCodes : [];
  if (current.some((entry) => String(entry).toLowerCase() === cleanCode.toLowerCase())) {
    return { ok: false, reason: "exists", items: current };
  }

  if (current.length >= SAVED_PROFILE_CAP) {
    return { ok: false, reason: "saved_profiles_limit", cap: SAVED_PROFILE_CAP };
  }

  const updated = [...current, cleanCode];
  await User.findOneAndUpdate({ userId }, { $set: { savedProfileCodes: updated } });
  return { ok: true, items: updated };
}

async function removeSavedProfileCode(userId, profileCode) {
  const cleanCode = normalizePublicProfileCode(profileCode);
  if (!cleanCode) return { ok: false, reason: "empty_code" };

  const user = await User.findOne({ userId });
  if (!user) return { ok: false, reason: "missing_user" };

  const current = Array.isArray(user.savedProfileCodes) ? user.savedProfileCodes : [];
  const updated = current.filter((entry) => String(entry).toLowerCase() !== cleanCode.toLowerCase());
  if (updated.length === current.length) return { ok: false, reason: "not_found", items: current };

  await User.findOneAndUpdate({ userId }, { $set: { savedProfileCodes: updated } });
  return { ok: true, items: updated };
}

module.exports = {
  DISCUSSION_MEMBER_CAP,
  USER_DISCUSSION_MEMBERSHIP_CAP,
  DISCUSSION_RECENT_MESSAGES_CAP,
  SAVED_PROFILE_CAP,
  DISCUSSION_CREATE_DAILY_LIMIT,
  DISCUSSION_MESSAGE_LIMIT,
  DISCUSSION_MESSAGE_WINDOW_MS,
  normalizeTitle,
  normalizeDescription,
  normalizePublicProfileCode,
  hasLink,
  ensurePublicProfileCode,
  validateJoinRulePayload,
  validateJoinRules,
  createDiscussion,
  listActiveDiscussions,
  listMyDiscussions,
  joinOrSwitchActiveDiscussion,
  leaveDiscussionAsMember,
  closeDiscussionAsOwner,
  removeMemberAsOwner,
  addRecentMessage,
  addSavedProfileCode,
  removeSavedProfileCode,
};
