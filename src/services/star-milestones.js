const { earnStars, hasStarTransaction } = require("./stars");
const { starEconomy } = require("./star-settings");
const { logger } = require("./logger");

const AI_SECTIONS = new Set(["movies", "music", "books", "random"]);

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function getProfileStarCompletionStatus(user = {}) {
  const optionalFields = [
    hasText(user.city),
    Number.isFinite(Number(user.age)) && Number(user.age) > 0,
    ["female", "male", "other"].includes(user.gender),
    starEconomy.profilePetPreferenceEnabled && hasText(user.petPreference),
    hasText(user.photoFileId),
  ];
  const optionalCompleted = optionalFields.filter(Boolean).length;
  const hasName = hasText(user.profileName || user.firstName);
  const hasBio = hasText(user.bio);
  return {
    complete: hasName && hasBio && optionalCompleted >= 2,
    hasName,
    hasBio,
    optionalCompleted,
    optionalNeeded: Math.max(0, 2 - optionalCompleted),
  };
}

function snapshotSettings(keys) {
  return Object.fromEntries(keys.map((key) => [key, starEconomy[key]]));
}

async function safelyEarn(options) {
  if (!(Number(options.amount) > 0)) return { ok: false, reason: "reward_disabled" };
  try {
    return await earnStars(options);
  } catch (error) {
    logger.error("Failed to award Star milestone", {
      userId: options.userId,
      reason: options.reason,
      idempotencyKey: options.idempotencyKey,
      error,
    });
    return { ok: false, reason: "reward_unavailable" };
  }
}

async function safelyHasReward(idempotencyKey) {
  try {
    return await hasStarTransaction(idempotencyKey);
  } catch {
    return false;
  }
}

function appliedRewards(results = []) {
  return results
    .filter((result) => result?.ok && result.applied)
    .map((result) => ({
      milestone: result.transaction.reason,
      amount: Number(result.transaction.amount) || 0,
      balance: Number(result.balance) || 0,
      transactionId: result.transaction._id,
      section: result.transaction.metadata?.section || "",
      listType: result.transaction.metadata?.listType || "",
    }));
}

async function awardListMilestones({ userId, section, listType, count }) {
  if (!AI_SECTIONS.has(section) || !["watchlist", "topTen"].includes(listType)) {
    return { rewards: [], progress: null };
  }
  if (listType === "watchlist") {
    return { rewards: [], progress: null };
  }
  const normalizedCount = Math.max(0, Math.round(Number(count) || 0));
  const results = [];
  let progress = null;

  const firstGoal = starEconomy.firstTopTenMilestoneItems;
  const fullGoal = starEconomy.topTenCompletionItems;
  const firstIdempotencyKey = `milestone:topten-first:${userId}:${section}`;
  const fullIdempotencyKey = `milestone:topten-full:${userId}:${section}`;
  if (normalizedCount >= firstGoal) {
    results.push(await safelyEarn({
      userId,
      amount: starEconomy.rewardFirstThreePerSection,
      reason: "topten_first_milestone",
      idempotencyKey: firstIdempotencyKey,
      settingsSnapshot: snapshotSettings(["firstTopTenMilestoneItems", "rewardFirstThreePerSection"]),
      metadata: { section, listType, count: normalizedCount, goal: firstGoal, milestone: "topten_first" },
    }));
  }
  if (normalizedCount >= fullGoal) {
    results.push(await safelyEarn({
      userId,
      amount: starEconomy.rewardFullTopTenPerSection,
      reason: "topten_completed",
      idempotencyKey: fullIdempotencyKey,
      settingsSnapshot: snapshotSettings(["topTenCompletionItems", "rewardFullTopTenPerSection"]),
      metadata: { section, listType, count: normalizedCount, goal: fullGoal, milestone: "topten_full" },
    }));
  }
  const [firstClaimed, fullClaimed] = await Promise.all([
    safelyHasReward(firstIdempotencyKey),
    safelyHasReward(fullIdempotencyKey),
  ]);
  if (normalizedCount < firstGoal && !firstClaimed) {
    progress = {
      milestone: "topten_first_milestone",
      section,
      listType,
      remaining: firstGoal - normalizedCount,
      reward: starEconomy.rewardFirstThreePerSection,
    };
  } else if (normalizedCount < fullGoal && !fullClaimed) {
    progress = {
      milestone: "topten_completed",
      section,
      listType,
      remaining: fullGoal - normalizedCount,
      reward: starEconomy.rewardFullTopTenPerSection,
    };
  }

  return { rewards: appliedRewards(results), progress };
}

async function awardProfileCompletionMilestone(userId, user) {
  const status = getProfileStarCompletionStatus(user);
  if (!status.complete) return { rewards: [], profileProgress: status };
  const result = await safelyEarn({
    userId,
    amount: starEconomy.rewardProfileCompletion,
    reason: "profile_completed",
    idempotencyKey: `milestone:profile:${userId}`,
    settingsSnapshot: snapshotSettings(["rewardProfileCompletion"]),
    metadata: { milestone: "profile_completed" },
  });
  return { rewards: appliedRewards([result]), profileProgress: status };
}

async function awardOnboardingCompletionMilestone(userId) {
  const result = await safelyEarn({
    userId,
    amount: starEconomy.rewardOnboardingCompletion,
    reason: "onboarding_completed",
    // This shared key makes onboarding replace, rather than stack with, the
    // normal first-three Interests reward.
    idempotencyKey: `milestone:topten-first:${userId}:random`,
    settingsSnapshot: snapshotSettings(["rewardOnboardingCompletion"]),
    metadata: { section: "random", listType: "topTen", milestone: "onboarding_completed" },
  });
  return appliedRewards([result]);
}

async function awardFirstDiscussionCreated(userId, discussionId) {
  const result = await safelyEarn({
    userId,
    amount: starEconomy.rewardFirstDiscussion,
    reason: "first_discussion_created",
    idempotencyKey: `milestone:discussion-created:${userId}`,
    discussionId,
    settingsSnapshot: snapshotSettings(["rewardFirstDiscussion"]),
    metadata: { milestone: "first_discussion_created" },
  });
  return appliedRewards([result]);
}

async function awardFirstDiscussionJoined(userId, discussionId) {
  const result = await safelyEarn({
    userId,
    amount: starEconomy.rewardFirstDiscussionJoin,
    reason: "first_discussion_joined",
    idempotencyKey: `milestone:discussion-joined:${userId}`,
    discussionId,
    settingsSnapshot: snapshotSettings(["rewardFirstDiscussionJoin"]),
    metadata: { milestone: "first_discussion_joined" },
  });
  return appliedRewards([result]);
}

async function claimExistingProfileAndListMilestones(user = {}) {
  const userId = Number(user.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return [];
  const rewards = [];
  for (const section of AI_SECTIONS) {
    const lists = user.aiLists?.[section] || {};
    const count = Array.isArray(lists.topTen) ? lists.topTen.length : 0;
    const result = await awardListMilestones({ userId, section, listType: "topTen", count });
    rewards.push(...result.rewards);
  }
  const profile = await awardProfileCompletionMilestone(userId, user);
  rewards.push(...profile.rewards);
  return rewards;
}

module.exports = {
  awardFirstDiscussionCreated,
  awardFirstDiscussionJoined,
  awardListMilestones,
  awardOnboardingCompletionMilestone,
  awardProfileCompletionMilestone,
  claimExistingProfileAndListMilestones,
  getProfileStarCompletionStatus,
};
