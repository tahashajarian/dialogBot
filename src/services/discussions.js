const crypto = require("crypto");
const Discussion = require("../models/discussion");
const User = require("../models/user");
const { normalizeAiListItem, getAiListItemsFromUser, getAiTasteFromUser } = require("./users");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");

const DISCUSSION_MEMBER_CAP = 20;
const DISCUSSION_ALLOWED_MEMBER_CAPS = [2, 3, 4, 5, 10, 15, 20];
const DISCUSSION_RECENT_MESSAGES_CAP = 10;
const SAVED_PROFILE_CAP = 50;
const DISCUSSION_CREATE_DAILY_LIMIT = 3;
const DISCUSSION_MESSAGE_LIMIT = 30;
const DISCUSSION_MESSAGE_WINDOW_MS = 10 * 60 * 1000;
const DISCUSSION_MESSAGE_BURST_WINDOW_MS = 1000;
const PUBLIC_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const BOT_STARTER_DISCUSSIONS = [
  {
    botSeedKey: "free-discussion",
    title: "Free Discussion",
    description: "Talk freely about anything on your mind.",
  },
  {
    botSeedKey: "whats-up",
    title: "What's Up?",
    description: "Drop in, say hi, and share what is going on.",
  },
  {
    botSeedKey: "lets-talk",
    title: "Let's Talk",
    description: "A casual place to meet people and start a conversation.",
  },
];

function generatePublicCodeSuffix(length) {
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    suffix += PUBLIC_CODE_ALPHABET[crypto.randomInt(PUBLIC_CODE_ALPHABET.length)];
  }
  return suffix;
}

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function normalizePublicProfileCode(value) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  if (!/^u_/i.test(raw)) return "";
  return `u_${raw.slice(2).replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
}

function normalizePublicDiscussionCode(value) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  if (!/^d_/i.test(raw)) return "";
  return `d_${raw.slice(2).replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
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

function normalizeMaxMembers(value) {
  const capacity = Number(value) || DISCUSSION_MEMBER_CAP;
  return DISCUSSION_ALLOWED_MEMBER_CAPS.includes(capacity) ? capacity : DISCUSSION_MEMBER_CAP;
}

function hasLink(value) {
  return /https?:\/\/|www\.|t\.me\/|telegram\.me\/|bale\.ai\//i.test(String(value || ""));
}

const { isLowQualityAiListItem, validateMinimumLength } = require("./ai-input-quality");

/**
 * Validate discussion title for quality and meaningfulness.
 * Checks minimum length (3+ letters) and rejects nonsense patterns.
 * Returns { valid: boolean, reason?: string }
 */
function validateDiscussionTitle(title) {
  const lengthCheck = validateMinimumLength(title);
  if (!lengthCheck.valid) {
    return lengthCheck;
  }

  const isLowQuality = isLowQualityAiListItem(title);
  return { valid: !isLowQuality };
}

/**
 * Validate discussion description for quality and meaningfulness.
 * Uses same validation as title (minimum length + nonsense detection).
 * Returns { valid: boolean, reason?: string }
 */
function validateDiscussionDescription(description) {
  const lengthCheck = validateMinimumLength(description);
  if (!lengthCheck.valid) {
    return lengthCheck;
  }

  const isLowQuality = isLowQualityAiListItem(description);
  return { valid: !isLowQuality };
}

async function ensurePublicProfileCode(userId) {
  const user = await User.findOne({ userId });
  if (!user) return { ok: false, reason: "missing_user" };

  const current = normalizePublicProfileCode(user.publicProfileCode);
  if (current) return { ok: true, code: current, user };

  let code = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = generatePublicCodeSuffix(4);
    code = `u_${suffix}`;
    try {
      const updated = await User.findOneAndUpdate(
        {
          userId,
          $or: [
            { publicProfileCode: "" },
            { publicProfileCode: null },
            { publicProfileCode: { $exists: false } },
          ],
        },
        { $set: { publicProfileCode: code } },
        { returnDocument: "after" },
      );

      if (updated) return { ok: true, code, user: updated };

      const refreshed = await User.findOne({ userId });
      const refreshedCode = normalizePublicProfileCode(refreshed?.publicProfileCode);
      if (refreshedCode) return { ok: true, code: refreshedCode, user: refreshed };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  return { ok: false, reason: "code_generation_failed" };
}

async function ensurePublicDiscussionCode(discussion) {
  const discussionId = discussion?._id || discussion;
  const current = normalizePublicDiscussionCode(discussion?.publicDiscussionCode);
  if (current) return { ok: true, code: current, discussion };

  const found = discussion?.title ? discussion : await Discussion.findById(discussionId);
  if (!found) return { ok: false, reason: "missing_discussion" };

  const existing = normalizePublicDiscussionCode(found.publicDiscussionCode);
  if (existing) return { ok: true, code: existing, discussion: found };

  let code = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = generatePublicCodeSuffix(6);
    code = `d_${suffix}`;
    try {
      found.publicDiscussionCode = code;
      await found.save();
      return { ok: true, code, discussion: found };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      found.publicDiscussionCode = "";
    }
  }

  return { ok: false, reason: "code_generation_failed" };
}

async function ensurePublicDiscussionCodes(discussions = []) {
  await Promise.all((discussions || []).map((discussion) => ensurePublicDiscussionCode(discussion)));
  return discussions;
}

async function findDiscussionByPublicCode(code) {
  const cleanCode = normalizePublicDiscussionCode(code);
  if (!cleanCode) return null;
  return Discussion.findOne({ publicDiscussionCode: cleanCode });
}

async function getDiscussionInvitePreviewByCode(code) {
  const cleanCode = normalizePublicDiscussionCode(code);
  if (!cleanCode) return { ok: false, reason: "missing_discussion" };

  const discussion = await Discussion.findOne({ publicDiscussionCode: cleanCode });
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed", discussion };

  return { ok: true, discussion, code: cleanCode };
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

async function checkDiscussionCreateQuota(creatorUserId, now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const createdToday = await Discussion.countDocuments({
    creatorUserId,
    createdAt: { $gte: dayAgo },
  });

  if (createdToday >= DISCUSSION_CREATE_DAILY_LIMIT) {
    return { ok: false, reason: "create_rate_limit", cap: DISCUSSION_CREATE_DAILY_LIMIT };
  }

  return { ok: true, count: createdToday, cap: DISCUSSION_CREATE_DAILY_LIMIT };
}

async function createDiscussion({ creatorUserId, title, description, joinRule, maxMembers = DISCUSSION_MEMBER_CAP, skipCreateQuota = false }) {
  const user = await User.findOne({ userId: creatorUserId });
  if (!user) return { ok: false, reason: "missing_user" };

  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return { ok: false, reason: "invalid_title" };
  if (hasLink(normalizedTitle)) return { ok: false, reason: "invalid_title_link" };

  const normalizedDescription = normalizeDescription(description);
  const normalizedMaxMembers = normalizeMaxMembers(maxMembers);
  const parsedRule = validateJoinRulePayload(joinRule);
  if (!parsedRule.ok) return parsedRule;

  if (parsedRule.joinRule.type === "open" && !normalizedDescription) {
    return { ok: false, reason: "open_requires_description" };
  }

  const memberships = Array.isArray(user.discussionMembershipIds) ? user.discussionMembershipIds : [];

  if (!skipCreateQuota) {
    const quota = await checkDiscussionCreateQuota(creatorUserId);
    if (!quota.ok) return quota;
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
    maxMembers: normalizedMaxMembers,
    recentMessages: [],
    replyCount: 0,
    lastActivityAt: new Date(),
  });
  await ensurePublicDiscussionCode(discussion);

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

async function seedBotDiscussions(botUserId) {
  const creatorUserId = Number(botUserId);
  if (!Number.isInteger(creatorUserId) || creatorUserId <= 0) {
    return { ok: false, reason: "invalid_bot_user_id" };
  }

  const discussions = [];
  for (const starter of BOT_STARTER_DISCUSSIONS) {
    const now = new Date();
    const discussion = await Discussion.findOneAndUpdate(
      { botSeedKey: starter.botSeedKey },
      {
        $set: {
          title: starter.title,
          description: starter.description,
          creatorUserId,
          isBotCreated: true,
          joinRule: { type: "open" },
          maxMembers: DISCUSSION_MEMBER_CAP,
        },
        $setOnInsert: {
          botSeedKey: starter.botSeedKey,
          status: "open",
          memberUserIds: [],
          removedUserIds: [],
          recentMessages: [],
          reports: [],
          replyCount: 0,
          lastActivityAt: now,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    await ensurePublicDiscussionCode(discussion);
    discussions.push(discussion);
  }

  return { ok: true, discussions };
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
  const discussions = await Discussion.find({
    status: "open",
    $or: [
      { creatorUserId: userId },
      { _id: { $in: ids } },
      { memberUserIds: userId },
    ],
  })
    .sort({ lastActivityAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(limit);

  return { ok: true, discussions, activeDiscussionId: user.activeDiscussionId || null };
}

async function joinOrOpenDiscussion(userId, discussionId) {
  const [user, discussion] = await Promise.all([
    User.findOne({ userId }),
    Discussion.findById(discussionId),
  ]);

  if (!user) return { ok: false, reason: "missing_user" };
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed" };
  if (
    user.activeDiscussionId &&
    String(user.activeDiscussionId) !== String(discussion._id)
  ) {
    return { ok: false, reason: "leave_current_first" };
  }

  const isMember = discussion.memberUserIds.includes(userId);
  const isOwner = Number(discussion.creatorUserId) === Number(userId);

  if (!isMember) {
    if (!isOwner) {
      const wasRemoved = Array.isArray(discussion.removedUserIds) && discussion.removedUserIds.includes(userId);
      if (wasRemoved) {
        return { ok: false, reason: "removed_by_owner" };
      }

      const maxMembers = normalizeMaxMembers(discussion.maxMembers);
      if (discussion.memberUserIds.length >= maxMembers) {
        return { ok: false, reason: "discussion_full", cap: maxMembers };
      }

      const eligibility = await validateJoinRules({ user, joinRule: discussion.joinRule });
      if (!eligibility.ok) return eligibility;
    }

    const maxMembers = normalizeMaxMembers(discussion.maxMembers);
    const joinedDiscussion = await Discussion.findOneAndUpdate(
      {
        _id: discussion._id,
        status: "open",
        memberUserIds: { $ne: userId },
        ...(isOwner ? {} : { removedUserIds: { $ne: userId } }),
        ...(isOwner
          ? {}
          : {
            $expr: {
              $lt: [
                { $size: "$memberUserIds" },
                maxMembers,
              ],
            },
          }),
      },
      {
        $addToSet: { memberUserIds: userId },
        $set: { updatedAt: new Date(), maxMembers },
      },
      { returnDocument: "after" },
    );

    if (!joinedDiscussion) {
      const latest = await Discussion.findById(discussion._id).lean();
      if (!latest) return { ok: false, reason: "missing_discussion" };
      if (latest.status !== "open") return { ok: false, reason: "discussion_closed" };
      if (!isOwner && Array.isArray(latest.removedUserIds) && latest.removedUserIds.includes(userId)) {
        return { ok: false, reason: "removed_by_owner" };
      }
      if (latest.memberUserIds?.includes(userId)) {
        await User.findOneAndUpdate(
          { userId },
          { $set: { activeDiscussionId: latest._id } },
        );
        return { ok: true, discussion: latest, joined: false };
      }
      return { ok: false, reason: "discussion_full", cap: maxMembers };
    }

    await User.findOneAndUpdate(
      { userId },
      {
        $set: { activeDiscussionId: joinedDiscussion._id },
        $addToSet: { discussionMembershipIds: joinedDiscussion._id },
      },
    );

    const joinerName = String(user.profileName || user.firstName || "کاربر").trim();
    const otherMemberIds = joinedDiscussion.memberUserIds.filter((id) => id !== userId);
    
    return { ok: true, discussion: joinedDiscussion, joined: true, joinerName, otherMemberIds };
  }

  await User.findOneAndUpdate(
    { userId },
    { $set: { activeDiscussionId: discussion._id } },
  );

  return { ok: true, discussion, joined: false };
}

async function getActiveDiscussionInviteForUser(userId, discussionId) {
  const [user, discussion] = await Promise.all([
    User.findOne({ userId }),
    Discussion.findById(discussionId),
  ]);

  if (!user) return { ok: false, reason: "missing_user" };
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed", discussion };
  if (!discussion.memberUserIds.includes(userId)) return { ok: false, reason: "not_member", discussion };

  const codeResult = await ensurePublicDiscussionCode(discussion);
  if (!codeResult.ok) return codeResult;

  return { ok: true, discussion, code: codeResult.code };
}

async function leaveDiscussionAsMember(userId, discussionId) {
  const [user, discussion] = await Promise.all([
    User.findOne({ userId }),
    Discussion.findOneAndUpdate(
      {
        _id: discussionId,
        memberUserIds: userId,
      },
      {
        $pull: { memberUserIds: userId },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: "before" },
    ),
  ]);

  if (!user) return { ok: false, reason: "missing_user" };
  if (!discussion) {
    const latest = await Discussion.findById(discussionId).select("_id").lean();
    return latest ? { ok: false, reason: "not_member" } : { ok: false, reason: "missing_discussion" };
  }

  const updates = {
    $pull: { discussionMembershipIds: discussion._id },
  };

  if (String(user.activeDiscussionId || "") === String(discussion._id)) {
    updates.$set = { activeDiscussionId: null };
  }

  await User.findOneAndUpdate({ userId }, updates);
  
  const leaverName = String(user.profileName || user.firstName || "کاربر").trim();
  const activeMemberIds = discussion.memberUserIds.filter((id) => id !== userId);
  
  return {
    ok: true,
    discussion,
    discussionId: discussion._id,
    discussionTitle: discussion.title,
    creatorUserId: discussion.creatorUserId,
    leaverName,
    activeMemberIds,
  };
}

async function closeDiscussionAsOwner(ownerUserId, discussionId) {
  const discussion = await Discussion.findOneAndUpdate(
    {
      _id: discussionId,
      creatorUserId: ownerUserId,
      status: "open",
    },
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "before" },
  );
  if (!discussion) {
    const latest = await Discussion.findById(discussionId).select("creatorUserId status").lean();
    if (!latest) return { ok: false, reason: "missing_discussion" };
    if (latest.creatorUserId !== ownerUserId) return { ok: false, reason: "not_owner" };
    if (latest.status === "closed") return { ok: false, reason: "already_closed" };
    return { ok: false, reason: "missing_discussion" };
  }

  const memberIds = [...discussion.memberUserIds];

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

  return { ok: true, discussion, affectedMemberIds: memberIds, discussionTitle: discussion.title };
}

async function removeMemberAsOwner(ownerUserId, discussionId, memberUserId) {
  if (memberUserId === ownerUserId) return { ok: false, reason: "owner_cannot_remove_self" };

  const [discussion, memberUser] = await Promise.all([
    Discussion.findOneAndUpdate(
      {
        _id: discussionId,
        creatorUserId: ownerUserId,
        status: "open",
        memberUserIds: memberUserId,
      },
      {
        $pull: { memberUserIds: memberUserId },
        $addToSet: { removedUserIds: memberUserId },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: "before" },
    ),
    User.findOne({ userId: memberUserId }).select("activeDiscussionId lang profileName firstName").lean(),
  ]);

  if (!discussion) {
    const latest = await Discussion.findById(discussionId).select("creatorUserId status memberUserIds").lean();
    if (!latest) return { ok: false, reason: "missing_discussion" };
    if (latest.creatorUserId !== ownerUserId) return { ok: false, reason: "not_owner" };
    if (latest.status !== "open") return { ok: false, reason: "discussion_closed" };
    return { ok: false, reason: "not_member" };
  }
  const wasActive = String(memberUser?.activeDiscussionId || "") === String(discussion._id);

  await User.findOneAndUpdate(
    { userId: memberUserId },
    { $pull: { discussionMembershipIds: discussion._id } },
  );

  await User.findOneAndUpdate(
    { userId: memberUserId, activeDiscussionId: discussion._id },
    { $set: { activeDiscussionId: null } },
  );

  const removedMemberName = String(memberUser?.profileName || memberUser?.firstName || "کاربر").trim();
  const otherMemberIds = discussion.memberUserIds.filter((id) => id !== memberUserId && id !== ownerUserId);
  
  return {
    ok: true,
    discussion,
    discussionId: discussion._id,
    discussionTitle: discussion.title,
    memberUserId,
    memberLang: memberUser?.lang || "fa",
    wasActive,
    removedMemberName,
    otherMemberIds,
  };
}

async function getActiveMembersInDiscussion(discussionId, excludeUserIds = []) {
  const exclude = Array.isArray(excludeUserIds) ? excludeUserIds : [excludeUserIds];
  const discussion = await Discussion.findById(discussionId).select("memberUserIds").lean();
  if (!discussion) return [];
  const excluded = new Set(exclude.map((id) => Number(id)));

  const members = await User.find({
    userId: { $in: (discussion.memberUserIds || []).filter((id) => !excluded.has(Number(id))) },
  })
    .select("userId lang")
    .lean();

  return members;
}

async function reportDiscussionMember(reporterUserId, discussionId, targetUserId) {
  const discussion = await Discussion.findById(discussionId);
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed" };
  if (!discussion.memberUserIds.includes(reporterUserId)) return { ok: false, reason: "not_member" };
  if (!discussion.memberUserIds.includes(targetUserId)) return { ok: false, reason: "not_member" };
  if (Number(reporterUserId) === Number(targetUserId)) return { ok: false, reason: "invalid_report_target" };

  discussion.reports.push({
    reporterUserId,
    targetUserId,
    status: "open",
    createdAt: new Date(),
  });
  discussion.updatedAt = new Date();
  await discussion.save();

  return { ok: true, discussionId: discussion._id, targetUserId };
}

function getRecentDiscussionMessageUsageFromUser(user, now = new Date(), windowMs = DISCUSSION_MESSAGE_WINDOW_MS) {
  const cutoff = now.getTime() - windowMs;
  return (user?.discussionMessageUsage || [])
    .map((entry) => new Date(entry))
    .filter((entry) => Number.isFinite(entry.getTime()) && entry.getTime() > cutoff);
}

async function consumeDiscussionMessageQuota(userId) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - DISCUSSION_MESSAGE_WINDOW_MS);
  const burstCutoff = new Date(now.getTime() - DISCUSSION_MESSAGE_BURST_WINDOW_MS);
  const updated = await User.findOneAndUpdate(
    {
      userId,
      $expr: {
        $and: [
          {
            $lt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$discussionMessageUsage", []] },
                    as: "usedAt",
                    cond: { $gt: ["$$usedAt", cutoff] },
                  },
                },
              },
              DISCUSSION_MESSAGE_LIMIT,
            ],
          },
          {
            $eq: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$discussionMessageUsage", []] },
                    as: "usedAt",
                    cond: { $gt: ["$$usedAt", burstCutoff] },
                  },
                },
              },
              0,
            ],
          },
        ],
      },
    },
    [
      {
        $set: {
          discussionMessageUsage: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ["$discussionMessageUsage", []] },
                  as: "usedAt",
                  cond: { $gt: ["$$usedAt", cutoff] },
                },
              },
              [now],
            ],
          },
        },
      },
    ],
    { returnDocument: "after", updatePipeline: true },
  );

  if (!updated) {
    const user = await User.findOne({ userId }).select("discussionMessageUsage").lean();
    if (!user) return { ok: false, reason: "missing_user" };
    const recentUsage = getRecentDiscussionMessageUsageFromUser(user, now);
    const hasRecentBurst = recentUsage.some(
      (usedAt) => usedAt.getTime() > burstCutoff.getTime(),
    );
    if (hasRecentBurst) {
      return {
        ok: false,
        reason: "message_burst_limit",
        retryAfterMs: DISCUSSION_MESSAGE_BURST_WINDOW_MS,
      };
    }
    return { ok: false, reason: "message_rate_limit", cap: DISCUSSION_MESSAGE_LIMIT };
  }

  return {
    ok: true,
    count: getRecentDiscussionMessageUsageFromUser(updated, now).length,
  };
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

  const now = new Date();
  const message = {
    senderUserId,
    senderDisplayName: cleanName || "کاربر",
    text: cleanText,
    sentAt: now,
  };
  const updatedDiscussion = await Discussion.findOneAndUpdate(
    {
      _id: discussionId,
      status: "open",
      memberUserIds: senderUserId,
    },
    {
      $push: {
        recentMessages: {
          $each: [message],
          $slice: -DISCUSSION_RECENT_MESSAGES_CAP,
        },
      },
      $inc: { replyCount: 1 },
      $set: {
        lastActivityAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );

  if (!updatedDiscussion) {
    const latest = await Discussion.findById(discussionId).lean();
    if (!latest) return { ok: false, reason: "missing_discussion" };
    if (latest.status !== "open") return { ok: false, reason: "discussion_closed" };
    return { ok: false, reason: "not_member" };
  }

  return {
    ok: true,
    discussion: updatedDiscussion,
    recentMessages: updatedDiscussion.recentMessages || [],
    recipients: (await User.find({
      userId: { $in: updatedDiscussion.memberUserIds.filter((id) => id !== senderUserId) },
    }).select("userId").lean()).map((entry) => entry.userId),
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

function normalizeNotificationPayloads(payload) {
  const payloads = Array.isArray(payload) ? payload : [payload];
  return payloads
    .map((entry) => {
      if (typeof entry === "string") return { text: entry, extra: {} };
      if (!entry || typeof entry !== "object") return null;
      return {
        text: String(entry.text || ""),
        extra: entry.extra && typeof entry.extra === "object" ? entry.extra : {},
      };
    })
    .filter((entry) => entry?.text);
}

async function notifyDiscussionMembers(ctx, messages, members = [], getPayloads) {
  for (const member of members || []) {
    const memberLang = messages[member.lang] ? member.lang : "fa";
    try {
      const payloads = normalizeNotificationPayloads(getPayloads(messages, memberLang));
      for (const payload of payloads) {
        await ctx.sendToUser?.(member.userId, payload.text, payload.extra);
      }
    } catch {
      // Individual notification failures should not block the acting user.
    }
  }
}

async function notifyActiveMembersInDiscussion(ctx, messages, discussionId, excludeUserIds, getPayloads) {
  const activeMembers = await getActiveMembersInDiscussion(discussionId, excludeUserIds);
  await notifyDiscussionMembers(ctx, messages, activeMembers, getPayloads);
}

module.exports = {
  DISCUSSION_MEMBER_CAP,
  DISCUSSION_ALLOWED_MEMBER_CAPS,
  DISCUSSION_RECENT_MESSAGES_CAP,
  SAVED_PROFILE_CAP,
  DISCUSSION_CREATE_DAILY_LIMIT,
  DISCUSSION_MESSAGE_LIMIT,
  DISCUSSION_MESSAGE_WINDOW_MS,
  DISCUSSION_MESSAGE_BURST_WINDOW_MS,
  BOT_STARTER_DISCUSSIONS,
  normalizeTitle,
  normalizeDescription,
  normalizeMaxMembers,
  normalizePublicProfileCode,
  normalizePublicDiscussionCode,
  hasLink,
  validateDiscussionTitle,
  validateDiscussionDescription,
  ensurePublicProfileCode,
  ensurePublicDiscussionCode,
  ensurePublicDiscussionCodes,
  findDiscussionByPublicCode,
  getDiscussionInvitePreviewByCode,
  validateJoinRulePayload,
  validateJoinRules,
  checkDiscussionCreateQuota,
  createDiscussion,
  seedBotDiscussions,
  listActiveDiscussions,
  listMyDiscussions,
  joinOrOpenDiscussion,
  getActiveDiscussionInviteForUser,
  leaveDiscussionAsMember,
  closeDiscussionAsOwner,
  removeMemberAsOwner,
  reportDiscussionMember,
  addRecentMessage,
  addSavedProfileCode,
  removeSavedProfileCode,
  getActiveMembersInDiscussion,
  notifyDiscussionMembers,
  notifyActiveMembersInDiscussion,
};
