const crypto = require("node:crypto");
const User = require("../models/user");
const { callBacks } = require("../constants");
const { findPeopleBySharedTaste } = require("./people-discovery");
const { operationalLimits } = require("./operational-limits");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_INACTIVITY_DAYS = 3;
const DEFAULT_COOLDOWN_DAYS = 3;
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 60 * 1000;
const CLAIM_STALE_MS = 30 * 60 * 1000;
const SCAN_LIMIT = 25;
const CANDIDATE_SCAN_LIMIT = 250;
const PREVIEW_CACHE_MS = 5 * 60 * 1000;
let previewCache = null;

function notificationKeyboard(messages, lang) {
  return {
    reply_markup: {
      inline_keyboard: [[{
        text: messages[lang].similarPeopleNotificationOpen,
        callback_data: callBacks.peopleSimilarReengagementOpen,
      }]],
    },
  };
}

function getMatchCutoff(user) {
  const activityAt = new Date(user?.lastActiveAt || 0);
  const notifiedAt = new Date(user?.similarPeopleLastNotifiedAt || 0);
  return activityAt > notifiedAt ? activityAt : notifiedAt;
}

function getInactiveDays() {
  return Math.max(
    1,
    Number(operationalLimits.similarPeopleInactiveDays) || DEFAULT_INACTIVITY_DAYS,
  );
}

function getCooldownDays() {
  return Math.max(
    1,
    Number(operationalLimits.similarPeopleNotificationCooldownDays) || DEFAULT_COOLDOWN_DAYS,
  );
}

function getRolloutPercent() {
  return Math.min(
    100,
    Math.max(1, Number(operationalLimits.similarPeopleReengagementRolloutPercent) || 10),
  );
}

function isUserInRollout(userId, rolloutPercent = getRolloutPercent()) {
  const normalized = Math.abs(Number(userId) || 0);
  let hash = 2166136261;
  for (const character of String(normalized)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < Math.max(0, Math.min(100, Number(rolloutPercent) || 0));
}

async function touchUserActivity(user, now = new Date(), deps = {}) {
  const previous = new Date(user?.lastActiveAt || 0);
  if (now.getTime() - previous.getTime() < ACTIVITY_WRITE_INTERVAL_MS) return false;
  if (user) user.lastActiveAt = now;
  const UserModel = deps.User || User;
  await UserModel.updateOne(
    {
      userId: Number(user?.userId),
      $or: [
        { lastActiveAt: null },
        { lastActiveAt: { $lte: new Date(now.getTime() - ACTIVITY_WRITE_INTERVAL_MS) } },
      ],
    },
    { $set: { lastActiveAt: now } },
  );
  return true;
}

async function findNewSimilarPeople(user, deps = {}) {
  const findPeople = deps.findPeopleBySharedTaste || findPeopleBySharedTaste;
  const result = await findPeople(user, {
    limit: 200,
    candidateCreatedAfter: getMatchCutoff(user),
    track: false,
  });
  if (!result?.ok) return [];
  return (result.items || []).filter((entry) => !entry.isSaved);
}

function inactiveCandidateQuery(
  now,
  inactiveDays = getInactiveDays(),
  cooldownDays = getCooldownDays(),
) {
  const inactiveBefore = new Date(now.getTime() - Math.max(1, Number(inactiveDays)) * MILLISECONDS_PER_DAY);
  const cooldownBefore = new Date(now.getTime() - Math.max(1, Number(cooldownDays)) * MILLISECONDS_PER_DAY);
  const staleClaimBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  return {
    bannedAt: null,
    similarPeopleNotificationsEnabled: { $ne: false },
    lastActiveAt: { $type: "date", $lte: inactiveBefore },
    $and: [
      { $or: [
        { onboardingCompletedAt: { $ne: null } },
        { onboardingSkippedAt: { $ne: null } },
      ] },
      { $or: [
        { similarPeopleLastNotifiedAt: null },
        { similarPeopleLastNotifiedAt: { $lte: cooldownBefore } },
      ] },
      { $or: [
        { similarPeopleNotificationClaimToken: "" },
        { similarPeopleNotificationClaimedAt: null },
        { similarPeopleNotificationClaimedAt: { $lte: staleClaimBefore } },
      ] },
    ],
  };
}

async function claimCandidate(user, now, UserModel) {
  const claimToken = crypto.randomUUID();
  const claimed = await UserModel.findOneAndUpdate(
    {
      userId: Number(user.userId),
      lastActiveAt: user.lastActiveAt,
      ...inactiveCandidateQuery(now),
    },
    {
      $set: {
        similarPeopleNotificationClaimToken: claimToken,
        similarPeopleNotificationClaimedAt: now,
      },
    },
    { returnDocument: "after" },
  ).lean();
  return claimed ? { claimed, claimToken } : null;
}

async function completeClaim(userId, claimToken, sentAt, UserModel) {
  return UserModel.updateOne(
    { userId: Number(userId), similarPeopleNotificationClaimToken: claimToken },
    {
      $set: {
        similarPeopleLastNotifiedAt: sentAt,
        similarPeopleNotificationClaimToken: "",
        similarPeopleNotificationClaimedAt: null,
      },
    },
  );
}

async function restoreClaim(userId, claimToken, UserModel) {
  return UserModel.updateOne(
    { userId: Number(userId), similarPeopleNotificationClaimToken: claimToken },
    {
      $set: {
        similarPeopleNotificationClaimToken: "",
        similarPeopleNotificationClaimedAt: null,
      },
    },
  );
}

async function flushSimilarPeopleReengagement({
  sendToUser,
  messages,
  now = new Date(),
  deps = {},
} = {}) {
  if (typeof sendToUser !== "function" || !messages) return { scanned: 0, sent: 0 };
  if (!operationalLimits.similarPeopleReengagementEnabled) return { scanned: 0, sent: 0 };
  const UserModel = deps.User || User;
  const inactiveDays = getInactiveDays();
  const users = await UserModel.find(inactiveCandidateQuery(now, inactiveDays))
    .select("userId lang lastActiveAt similarPeopleLastNotifiedAt savedProfileCodes peopleLanguageFilter aiLists aiTaste aiWatchlistMovies aiTopTenMovies aiWatchlistSeries aiTopTenSeries aiWatchlistMusic aiTopTenMusic aiWatchlistBooks aiTopTenBooks aiWatchlistRandom aiTopTenRandom")
    .sort({ lastActiveAt: 1 })
    .limit(CANDIDATE_SCAN_LIMIT)
    .lean();
  const rolloutUsers = (users || [])
    .filter((user) => isUserInRollout(user.userId))
    .slice(0, SCAN_LIMIT);

  let sent = 0;
  for (const user of rolloutUsers) {
    let claim = null;
    try {
      const matches = await findNewSimilarPeople(user, deps);
      if (!matches.length) continue;
      claim = await claimCandidate(user, now, UserModel);
      if (!claim) continue;
      const lang = messages[user.lang] ? user.lang : "fa";
      const delivered = await sendToUser(
        user.userId,
        messages[lang].similarPeopleNotification,
        notificationKeyboard(messages, lang),
        lang,
      );
      if (!delivered) {
        await restoreClaim(user.userId, claim.claimToken, UserModel);
        continue;
      }
      await completeClaim(user.userId, claim.claimToken, now, UserModel);
      sent += 1;
      void (deps.trackEvent || trackEvent)({
        name: EVENT_NAMES.similarPeopleReengagementSent,
        userId: user.userId,
        source: "similar_people_reengagement",
        metadata: { resultCount: matches.length },
      });
    } catch {
      if (claim) await restoreClaim(user.userId, claim.claimToken, UserModel).catch(() => null);
    }
  }
  return { scanned: rolloutUsers.length, sent };
}

async function getSimilarPeopleReengagementPreview({
  now = new Date(),
  force = false,
  deps = {},
} = {}) {
  if (!force && previewCache && previewCache.expiresAt > Date.now()) return previewCache.value;
  const UserModel = deps.User || User;
  const query = inactiveCandidateQuery(now);
  const [inactiveCount, users] = await Promise.all([
    UserModel.countDocuments(query),
    UserModel.find(query)
      .select("userId lang lastActiveAt similarPeopleLastNotifiedAt savedProfileCodes peopleLanguageFilter aiLists aiTaste aiWatchlistMovies aiTopTenMovies aiWatchlistSeries aiTopTenSeries aiWatchlistMusic aiTopTenMusic aiWatchlistBooks aiTopTenBooks aiWatchlistRandom aiTopTenRandom")
      .sort({ lastActiveAt: 1 })
      .limit(CANDIDATE_SCAN_LIMIT)
      .lean(),
  ]);
  const rolloutPercent = getRolloutPercent();
  const rolloutUsers = (users || [])
    .filter((user) => isUserInRollout(user.userId, rolloutPercent))
    .slice(0, SCAN_LIMIT);
  let matchingUsers = 0;
  for (const user of rolloutUsers) {
    try {
      if ((await findNewSimilarPeople(user, deps)).length) matchingUsers += 1;
    } catch {}
  }
  const value = {
    enabled: Boolean(operationalLimits.similarPeopleReengagementEnabled),
    inactivityDays: getInactiveDays(),
    cooldownDays: getCooldownDays(),
    minimumSharedItems: Number(operationalLimits.peopleDiscoveryMinSharedItems) || 2,
    rolloutPercent,
    inactiveUsers: Number(inactiveCount) || 0,
    nextBatchUsers: rolloutUsers.length,
    nextBatchMatchingUsers: matchingUsers,
  };
  previewCache = { value, expiresAt: Date.now() + PREVIEW_CACHE_MS };
  return value;
}

module.exports = {
  ACTIVITY_WRITE_INTERVAL_MS,
  CLAIM_STALE_MS,
  DEFAULT_COOLDOWN_DAYS,
  DEFAULT_INACTIVITY_DAYS,
  MILLISECONDS_PER_DAY,
  CANDIDATE_SCAN_LIMIT,
  SCAN_LIMIT,
  findNewSimilarPeople,
  flushSimilarPeopleReengagement,
  getMatchCutoff,
  getInactiveDays,
  getCooldownDays,
  getRolloutPercent,
  getSimilarPeopleReengagementPreview,
  inactiveCandidateQuery,
  isUserInRollout,
  notificationKeyboard,
  touchUserActivity,
};
