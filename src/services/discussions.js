const Discussion = require("../models/discussion");
const User = require("../models/user");
const { recordRecentJoinedDiscussion } = require("./users");
const { normalizeDiscussionLanguage, normalizeDiscussionLanguageFilter } = require("./discussion-language");
const { isUserMutedBy } = require("./discussion-invitation-mutes");
const {
  validateJoinRulePayload,
  validateJoinRules,
} = require("./discussion-join-rules");
const {
  DISCUSSION_MESSAGE_BURST_WINDOW_MS,
  DISCUSSION_MESSAGE_LIMIT,
  DISCUSSION_MESSAGE_WINDOW_MS,
  DISCUSSION_RECENT_MESSAGES_CAP,
  addRecentMessage,
} = require("./discussion-messages");
const {
  ensurePublicDiscussionCode,
  ensurePublicDiscussionCodes,
  ensurePublicProfileCode,
  ensurePublicProfileCodes,
  findDiscussionByPublicCode,
  getDiscussionInvitePreviewByCode,
  normalizePublicDiscussionCode,
  normalizePublicProfileCode,
} = require("./public-codes");
const {
  hasLink,
  normalizeDiscussionText,
} = require("./discussion-text");
const { isCommandLikeText } = require("./command-like-text");
const {
  SAVED_PROFILE_CAP,
  addSavedProfileCode,
  removeSavedProfileCode,
} = require("./saved-profiles");
const {
  BOT_STARTER_DISCUSSION_MEMBER_CAP,
  BOT_STARTER_DISCUSSIONS,
  isBotStarterDiscussion,
  seedBotDiscussions,
  sortBotStarterDiscussionsFirst,
} = require("./discussion-starters");
const { formatUserDisplayName } = require("./profile");
const {
  createActiveDiscussionNotifier,
  notifyDiscussionMembers,
} = require("./discussion-notifications");
const { getModerationConfig } = require("../config");
const { EVENT_NAMES, trackEvent, trackThrottledEvent } = require("./analytics-events");
const { operationalLimits } = require("./operational-limits");
const {
  getConfiguredDiscussionCapacities,
  isPaidDiscussionCapacity,
} = require("./discussion-capacities");
const {
  awardFirstDiscussionCreated,
  awardFirstDiscussionJoined,
} = require("./star-milestones");
const { decorateActiveBoosts, endBoostForDiscussion } = require("./discussion-boosts");
const { DISCUSSION_OWNED_HARD_LIMIT } = require("../constants/limits");
const { hasSensitiveName } = require("./sensitive-name-moderation");

const DISCUSSION_MEMBER_CAP = 20;
const DISCUSSION_ALLOWED_MEMBER_CAPS = [2, 3, 4, 5, 10, 15, 20];
const DISCUSSION_ACTIVE_OWNED_LIMIT = 3;

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function normalizeTitle(value) {
  return normalizeDiscussionText(value, 80);
}

function normalizeDescription(value) {
  return normalizeDiscussionText(value, 300);
}

function normalizeMaxMembers(value) {
  const maximum = operationalLimits.discussionMaxMembers;
  const capacity = Number(value) || maximum;
  const allowed = new Set([
    ...getConfiguredDiscussionCapacities().filter((entry) => entry <= maximum || entry > 20),
  ]);
  return allowed.has(capacity) ? capacity : maximum;
}

function resolveDiscussionMaxMembers(discussion = {}) {
  if (
    isBotStarterDiscussion(discussion) &&
    Number(discussion.maxMembers) === BOT_STARTER_DISCUSSION_MEMBER_CAP
  ) {
    return BOT_STARTER_DISCUSSION_MEMBER_CAP;
  }
  return normalizeMaxMembers(discussion.maxMembers);
}

const { isLowQualityAiListItem, validateMinimumLength } = require("./ai-input-quality");

function containsEmoji(value = "") {
  return /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u.test(String(value || ""));
}

/**
 * Validate discussion title for quality and meaningfulness.
 * Checks minimum length (3+ letters) and rejects nonsense patterns.
 * Returns { valid: boolean, reason?: string }
 */
function validateDiscussionTitle(title) {
  if (containsEmoji(title)) {
    return { valid: false, reason: "emoji" };
  }

  if (isCommandLikeText(title)) {
    return { valid: false, reason: "command_like" };
  }

  if (hasSensitiveName(title)) {
    return { valid: false, reason: "sensitive_content" };
  }

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
  if (containsEmoji(description)) {
    return { valid: false, reason: "emoji" };
  }

  if (isCommandLikeText(description)) {
    return { valid: false, reason: "command_like" };
  }

  const lengthCheck = validateMinimumLength(description);
  if (!lengthCheck.valid) {
    return lengthCheck;
  }

  const isLowQuality = isLowQualityAiListItem(description);
  return { valid: !isLowQuality };
}

async function checkActiveOwnedDiscussionsLimit(creatorUserId) {
  const activeOwnedIds = await reconcileOwnedOpenDiscussionIds(creatorUserId);
  const activeOwned = activeOwnedIds.length || await Discussion.countDocuments({
    creatorUserId,
    status: "open",
  });

  const freeCap = Math.min(operationalLimits.activeOwnedDiscussions, DISCUSSION_OWNED_HARD_LIMIT);
  if (activeOwned >= freeCap) {
    return { ok: false, reason: "active_owned_limit", cap: freeCap, count: activeOwned };
  }

  return { ok: true, count: activeOwned, cap: freeCap };
}

async function reconcileOwnedOpenDiscussionIds(userId) {
  const discussions = await Discussion.find({
    creatorUserId: userId,
    status: "open",
  }).select("_id").lean();
  const ids = discussions.map((discussion) => discussion._id);

  const updated = await User.findOneAndUpdate(
    { userId },
    { $addToSet: { ownedOpenDiscussionIds: { $each: ids } } },
    { returnDocument: "after" },
  ).select("ownedOpenDiscussionIds").lean();

  return Array.isArray(updated?.ownedOpenDiscussionIds) ? updated.ownedOpenDiscussionIds : ids;
}

async function reserveOwnedDiscussionSlot(userId, discussionId, paidOwnedSlotCap = 0) {
  await reconcileOwnedOpenDiscussionIds(userId);

  const reservationCap = Math.min(
    DISCUSSION_OWNED_HARD_LIMIT,
    Math.max(
      operationalLimits.activeOwnedDiscussions,
      Number(paidOwnedSlotCap) || 0,
    ),
  );

  const reservedUser = await User.findOneAndUpdate(
    {
      userId,
      $expr: {
        $lt: [
          { $size: { $ifNull: ["$ownedOpenDiscussionIds", []] } },
          reservationCap,
        ],
      },
    },
    {
      $addToSet: {
        ownedOpenDiscussionIds: discussionId,
        discussionMembershipIds: discussionId,
      },
      $set: { activeDiscussionId: discussionId },
    },
    { returnDocument: "after" },
  );
  return {
    user: reservedUser,
    paidOwnedSlotUsed: Boolean(
      reservedUser
      && (reservedUser.ownedOpenDiscussionIds || []).length > operationalLimits.activeOwnedDiscussions
    ),
  };
}

async function rollbackOwnedDiscussionReservation(userId, discussionId, previousActiveDiscussionId = null) {
  await User.findOneAndUpdate(
    { userId },
    {
      $pull: {
        ownedOpenDiscussionIds: discussionId,
        discussionMembershipIds: discussionId,
      },
      $set: { activeDiscussionId: previousActiveDiscussionId || null },
    },
  );
}

async function createDiscussion({
  creatorUserId,
  title,
  description,
  joinRule,
  maxMembers = operationalLimits.discussionMaxMembers,
  paidCapacityAuthorized = false,
  language,
}) {
  const user = await User.findOne({ userId: creatorUserId });
  if (!user) return { ok: false, reason: "missing_user" };
  if (language !== undefined && !["fa", "en"].includes(String(language).trim().toLowerCase())) {
    return { ok: false, reason: "invalid_language" };
  }
  const normalizedLanguage = normalizeDiscussionLanguage(language, user.lang);

  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return { ok: false, reason: "invalid_title" };
  if (hasLink(normalizedTitle)) return { ok: false, reason: "invalid_title_link" };
  if (!validateDiscussionTitle(normalizedTitle).valid) return { ok: false, reason: "invalid_title" };

  const normalizedDescription = normalizeDescription(description);
  if (normalizedDescription && !validateDiscussionDescription(normalizedDescription).valid) {
    return { ok: false, reason: "invalid_description" };
  }
  const normalizedMaxMembers = normalizeMaxMembers(maxMembers);
  if (isPaidDiscussionCapacity(normalizedMaxMembers) && !paidCapacityAuthorized) {
    return { ok: false, reason: "paid_capacity_required" };
  }
  const parsedRule = validateJoinRulePayload(joinRule);
  if (!parsedRule.ok) return parsedRule;

  if (parsedRule.joinRule.type === "open" && !normalizedDescription) {
    return { ok: false, reason: "open_requires_description" };
  }

  const eligibility = await validateJoinRules({ user, joinRule: parsedRule.joinRule });
  if (!eligibility.ok) return eligibility;

  const discussion = new Discussion({
    title: normalizedTitle,
    description: normalizedDescription,
    creatorUserId,
    language: normalizedLanguage,
    joinRule: parsedRule.joinRule,
    status: "open",
    memberUserIds: [creatorUserId],
    maxMembers: normalizedMaxMembers,
    recentMessages: [],
    replyCount: 0,
    lastActivityAt: new Date(),
  });

  const paidOwnedSlotCap = user.discussionDraftPaidOwnedSlotAuthorized
    ? Number(user.discussionDraftPaidOwnedSlotCap) || 0
    : 0;
  const reservation = await reserveOwnedDiscussionSlot(creatorUserId, discussion._id, paidOwnedSlotCap);
  const reservedUser = reservation.user;
  if (!reservedUser) {
    const activeOwned = await checkActiveOwnedDiscussionsLimit(creatorUserId);
    return activeOwned.ok
      ? { ok: false, reason: "active_owned_limit", cap: operationalLimits.activeOwnedDiscussions }
      : activeOwned;
  }

  try {
    await discussion.save();
    const codeResult = await ensurePublicDiscussionCode(discussion);
    if (!codeResult.ok) throw new Error(codeResult.reason || "code_generation_failed");
  } catch (error) {
    await rollbackOwnedDiscussionReservation(creatorUserId, discussion._id, user.activeDiscussionId || null);
    await Discussion.deleteOne({ _id: discussion._id });
    if (isDuplicateKeyError(error)) return { ok: false, reason: "duplicate_discussion" };
    throw error;
  }

  void trackEvent({
    name: EVENT_NAMES.discussionCreated,
    userId: creatorUserId,
    metadata: {
      joinRuleType: parsedRule.joinRule.type,
      maxMembers: normalizedMaxMembers,
      language: normalizedLanguage,
    },
  });

  const starRewards = [
    ...(await awardFirstDiscussionCreated(creatorUserId, discussion._id)),
    ...(await awardFirstDiscussionJoined(creatorUserId, discussion._id)),
  ];

  return {
    ok: true,
    discussion,
    membershipIds: reservedUser.discussionMembershipIds || [],
    paidOwnedSlotUsed: reservation.paidOwnedSlotUsed,
    starRewards,
  };
}

async function listActiveDiscussions({ userId, limit = 50, languageFilter = "all" } = {}) {
  const normalizedFilter = normalizeDiscussionLanguageFilter(languageFilter) || "all";
  const query = { status: "open" };
  query.$nor = [{ isBotCreated: true, botSeedKey: { $in: BOT_STARTER_DISCUSSIONS.map((entry) => entry.botSeedKey) } }];
  if (normalizedFilter !== "all") query.language = normalizedFilter;
  let discussions = await Discussion.find(query)
    .sort({ lastActivityAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(limit);
  discussions = await decorateActiveBoosts(discussions);

  // Smart pinning: show bot discussions at top for new/less-engaged users
  if (userId) {
    const user = await User.findOne({ userId }).select("discussionMembershipIds").lean();
    const membershipCount = Array.isArray(user?.discussionMembershipIds) 
      ? user.discussionMembershipIds.length 
      : 0;
    
    // Pin bot discussions at top if user has < 2 memberships
    if (membershipCount < 2) {
      const botDiscussions = sortBotStarterDiscussionsFirst(discussions.filter((d) => d.isBotCreated));
      const userDiscussions = discussions.filter((d) => !d.isBotCreated);
      discussions = [...botDiscussions, ...userDiscussions];
    }
  }

  void trackThrottledEvent({
    name: EVENT_NAMES.discussionListOpened,
    userId,
    source: "active",
    throttleKey: `discussion_list:active:${userId || "anon"}:${normalizedFilter}`,
    metadata: {
      resultCount: discussions.length,
      language: normalizedFilter,
    },
  });

  return { ok: true, discussions };
}

async function listMyDiscussions(userId, { limit = 50 } = {}) {
  const user = await User.findOne({ userId }).select("activeDiscussionId").lean();
  if (!user) return { ok: false, reason: "missing_user" };

  let discussions = await Discussion.find({
    status: "open",
    creatorUserId: userId,
  })
    .sort({ lastActivityAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(limit);
  discussions = await decorateActiveBoosts(discussions);

  void trackThrottledEvent({
    name: EVENT_NAMES.discussionListOpened,
    userId,
    source: "mine",
    throttleKey: `discussion_list:mine:${userId || "anon"}`,
    metadata: {
      resultCount: discussions.length,
    },
  });

  return { ok: true, discussions, activeDiscussionId: user.activeDiscussionId || null };
}

async function listRecentJoinedDiscussions(userId, { limit = 3 } = {}) {
  const user = await User.findOne({ userId }).select("recentJoinedDiscussionIds").lean();
  if (!user) return { ok: false, reason: "missing_user", discussions: [] };

  const recentIds = (user.recentJoinedDiscussionIds || []).slice(0, Math.max(0, Number(limit) || 3));
  if (!recentIds.length) return { ok: true, discussions: [] };

  const discussions = await Discussion.find({
    _id: { $in: recentIds },
    status: "open",
    creatorUserId: { $ne: userId },
    removedUserIds: { $ne: userId },
  });
  const byId = new Map(discussions.map((discussion) => [String(discussion._id), discussion]));
  return {
    ok: true,
    discussions: recentIds.map((id) => byId.get(String(id))).filter(Boolean),
  };
}

function findDiscussionById(discussionId) {
  if (!discussionId) return null;
  return Discussion.findById(discussionId);
}

function findDiscussionByIdLean(discussionId) {
  if (!discussionId) return null;
  return Discussion.findById(discussionId).lean();
}

async function joinOrOpenDiscussion(userId, discussionId, {
  allowActiveSwitch = false,
  allowOwnerReentry = false,
} = {}) {
  const [user, discussion] = await Promise.all([
    User.findOne({ userId }),
    Discussion.findById(discussionId),
  ]);

  if (!user) return { ok: false, reason: "missing_user" };
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed" };
  const previousActiveDiscussionId = (
    user.activeDiscussionId &&
    String(user.activeDiscussionId) !== String(discussion._id)
  ) ? user.activeDiscussionId : null;

  if (previousActiveDiscussionId && !allowActiveSwitch) {
    return { ok: false, reason: "leave_current_first" };
  }

  const isMember = discussion.memberUserIds.includes(userId);
  const isOwner = Number(discussion.creatorUserId) === Number(userId);

  if (!isMember) {
    if (!isOwner) {
      const mutedByCreator = await isUserMutedBy({
        userId,
        possibleMuterUserId: discussion.creatorUserId,
      });
      if (mutedByCreator) {
        return { ok: false, reason: "discussion_unavailable" };
      }
    }
    if (!isOwner) {
      const wasRemoved = Array.isArray(discussion.removedUserIds) && discussion.removedUserIds.includes(userId);
      if (wasRemoved && !allowOwnerReentry) {
        return { ok: false, reason: "removed_by_owner" };
      }

      const maxMembers = resolveDiscussionMaxMembers(discussion);
      if (discussion.memberUserIds.length >= maxMembers) {
        return { ok: false, reason: "discussion_full", cap: maxMembers };
      }

      const eligibility = await validateJoinRules({ user, joinRule: discussion.joinRule });
      if (!eligibility.ok) return eligibility;
    }

    const maxMembers = resolveDiscussionMaxMembers(discussion);
    const joinedDiscussion = await Discussion.findOneAndUpdate(
      {
        _id: discussion._id,
        status: "open",
        memberUserIds: { $ne: userId },
        ...(isOwner || allowOwnerReentry ? {} : { removedUserIds: { $ne: userId } }),
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
        ...(allowOwnerReentry ? { $pull: { removedUserIds: userId } } : {}),
        $set: { updatedAt: new Date(), maxMembers },
      },
      { returnDocument: "after" },
    );

    if (!joinedDiscussion) {
      const latest = await Discussion.findById(discussion._id).lean();
      if (!latest) return { ok: false, reason: "missing_discussion" };
      if (latest.status !== "open") return { ok: false, reason: "discussion_closed" };
      if (!isOwner && !allowOwnerReentry && Array.isArray(latest.removedUserIds) && latest.removedUserIds.includes(userId)) {
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

    if (!isOwner) {
      await recordRecentJoinedDiscussion(userId, joinedDiscussion._id);
    }

    await User.findOneAndUpdate(
      { userId },
      {
        $set: { activeDiscussionId: joinedDiscussion._id },
        $addToSet: { discussionMembershipIds: joinedDiscussion._id },
      },
    );

    const joinerName = formatUserDisplayName(user);
    const otherMemberIds = joinedDiscussion.memberUserIds.filter((id) => id !== userId);
    const starRewards = await awardFirstDiscussionJoined(userId, joinedDiscussion._id);

    return {
      ok: true,
      discussion: joinedDiscussion,
      joined: true,
      joinerName,
      otherMemberIds,
      starRewards,
      previousActiveDiscussionId,
    };
  }

  await User.findOneAndUpdate(
    { userId },
    { $set: { activeDiscussionId: discussion._id } },
  );

  return { ok: true, discussion, joined: false, previousActiveDiscussionId };
}

async function getActiveDiscussionInviteForUser(userId, discussionId) {
  if (!Discussion.db.base.isValidObjectId(discussionId)) {
    return { ok: false, reason: "missing_discussion" };
  }
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
  
  const leaverName = formatUserDisplayName(user);
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

  await User.findOneAndUpdate(
    { userId: ownerUserId },
    { $pull: { ownedOpenDiscussionIds: discussion._id } },
  );

  await User.updateMany(
    { activeDiscussionId: discussion._id },
    { $set: { activeDiscussionId: null } },
  );

  await endBoostForDiscussion(discussion._id);

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
    User.findOne({ userId: memberUserId }).select("activeDiscussionId lang profileName firstName profileEmoji").lean(),
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

  const removedMemberName = formatUserDisplayName(memberUser);
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
  const reportBanThreshold = getModerationConfig().reportBanThreshold;
  const [discussion, reporter, target] = await Promise.all([
    Discussion.findById(discussionId),
    User.findOne({ userId: reporterUserId }).select("bannedAt").lean(),
    User.findOne({ userId: targetUserId })
      .select("userId lang profileName firstName profileEmoji reportReporterUserIds bannedAt")
      .lean(),
  ]);

  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed" };
  if (!discussion.memberUserIds.includes(reporterUserId)) return { ok: false, reason: "not_member" };
  if (!discussion.memberUserIds.includes(targetUserId)) return { ok: false, reason: "not_member" };
  if (Number(reporterUserId) === Number(targetUserId)) return { ok: false, reason: "invalid_report_target" };
  if (!reporter || reporter.bannedAt) return { ok: false, reason: "invalid_report_target" };
  if (!target || target.bannedAt) return { ok: false, reason: "invalid_report_target" };
  if ((target.reportReporterUserIds || []).some((id) => Number(id) === Number(reporterUserId))) {
    return { ok: false, reason: "duplicate_report" };
  }

  discussion.reports.push({
    reporterUserId,
    targetUserId,
    status: "open",
    createdAt: new Date(),
  });
  discussion.updatedAt = new Date();
  await discussion.save();

  const updatedTarget = await User.findOneAndUpdate(
    {
      userId: targetUserId,
      bannedAt: null,
      reportReporterUserIds: { $ne: reporterUserId },
    },
    {
      $addToSet: { reportReporterUserIds: reporterUserId },
    },
    { returnDocument: "after" },
  ).select("userId lang profileName firstName reportReporterUserIds bannedAt");

  if (!updatedTarget) return { ok: false, reason: "duplicate_report" };

  const reportCount = (updatedTarget.reportReporterUserIds || []).length;
  const reportsLeft = Math.max(reportBanThreshold - reportCount, 0);
  const targetName = formatUserDisplayName(updatedTarget);
  const banned = reportCount >= reportBanThreshold;
  let affectedDiscussionIds = [];

  if (banned) {
    const affectedDiscussions = await Discussion.find({
      status: "open",
      memberUserIds: targetUserId,
    }).select("_id").lean();
    affectedDiscussionIds = affectedDiscussions.map((entry) => entry._id);

    await User.findOneAndUpdate(
      { userId: targetUserId },
      {
        $set: {
          bannedAt: new Date(),
          banReason: "report_threshold",
          banSource: "auto_reports",
          activeDiscussionId: null,
          state: "idle",
        },
        $pull: { discussionMembershipIds: { $in: affectedDiscussionIds } },
      },
    );

    await Discussion.updateMany(
      { _id: { $in: affectedDiscussionIds } },
      {
        $pull: { memberUserIds: targetUserId },
        $set: { updatedAt: new Date() },
      },
    );
  }

  return {
    ok: true,
    discussionId: discussion._id,
    targetUserId,
    targetLang: updatedTarget.lang || "fa",
    targetName,
    reportCount,
    reportBanThreshold,
    reportsLeft,
    banned,
    affectedDiscussionIds,
  };
}

const notifyActiveMembersInDiscussion = createActiveDiscussionNotifier(getActiveMembersInDiscussion);

module.exports = {
  DISCUSSION_MEMBER_CAP,
  DISCUSSION_ALLOWED_MEMBER_CAPS,
  DISCUSSION_RECENT_MESSAGES_CAP,
  SAVED_PROFILE_CAP,
  DISCUSSION_ACTIVE_OWNED_LIMIT,
  DISCUSSION_MESSAGE_LIMIT,
  DISCUSSION_MESSAGE_WINDOW_MS,
  DISCUSSION_MESSAGE_BURST_WINDOW_MS,
  BOT_STARTER_DISCUSSIONS,
  sortBotStarterDiscussionsFirst,
  normalizeTitle,
  normalizeDescription,
  normalizeMaxMembers,
  resolveDiscussionMaxMembers,
  normalizePublicProfileCode,
  normalizePublicDiscussionCode,
  hasLink,
  validateDiscussionTitle,
  validateDiscussionDescription,
  ensurePublicProfileCode,
  ensurePublicProfileCodes,
  ensurePublicDiscussionCode,
  ensurePublicDiscussionCodes,
  findDiscussionByPublicCode,
  getDiscussionInvitePreviewByCode,
  validateJoinRulePayload,
  validateJoinRules,
  checkActiveOwnedDiscussionsLimit,
  createDiscussion,
  seedBotDiscussions,
  listActiveDiscussions,
  listMyDiscussions,
  listRecentJoinedDiscussions,
  findDiscussionById,
  findDiscussionByIdLean,
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
