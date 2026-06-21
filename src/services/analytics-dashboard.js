const User = require("../models/user");
const Discussion = require("../models/discussion");
const DiscussionInvitation = require("../models/discussion-invitation");
const AiResponseCache = require("../models/ai-response-cache");
const { getOperationalHealthSnapshot } = require("./operational-health");

const SECTIONS = ["movies", "music", "books", "random"];
const SECTION_LABELS = {
  movies: "Movies",
  music: "Music",
  books: "Books",
  random: "Interests",
};

function countStructuredItems(user, section, listType) {
  return Array.isArray(user?.aiLists?.[section]?.[listType])
    ? user.aiLists[section][listType].length
    : 0;
}

function countLegacyItems(user, section, listType) {
  const prefix = listType === "topTen" ? "aiTopTen" : "aiWatchlist";
  const suffix = section === "random"
    ? "Random"
    : section.charAt(0).toUpperCase() + section.slice(1);
  return Array.isArray(user?.[`${prefix}${suffix}`])
    ? user[`${prefix}${suffix}`].length
    : 0;
}

function countAiItems(user, section, listType) {
  const structured = countStructuredItems(user, section, listType);
  return structured || countLegacyItems(user, section, listType);
}

function buildUserListMetrics(users = []) {
  const perSection = Object.fromEntries(SECTIONS.map((section) => [section, {
    section,
    label: SECTION_LABELS[section],
    topTenItems: 0,
    watchlistItems: 0,
    usersWithTopTenItem: 0,
    usersWithThreeTopTen: 0,
    usersWithFullTopTen: 0,
    usersWithTasteLabel: 0,
  }]));

  for (const user of users) {
    for (const section of SECTIONS) {
      const topTenCount = countAiItems(user, section, "topTen");
      const watchlistCount = countAiItems(user, section, "watchlist");
      const taste = user?.aiTaste?.[section] || {};
      perSection[section].topTenItems += topTenCount;
      perSection[section].watchlistItems += watchlistCount;
      if (topTenCount > 0) perSection[section].usersWithTopTenItem += 1;
      if (topTenCount >= 3) perSection[section].usersWithThreeTopTen += 1;
      if (topTenCount >= 10) perSection[section].usersWithFullTopTen += 1;
      if (taste.labelKey && Number(taste.sampleCount) > 0) {
        perSection[section].usersWithTasteLabel += 1;
      }
    }
  }

  return SECTIONS.map((section) => perSection[section]);
}

async function countByField(Model, field) {
  const rows = await Model.aggregate([
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({
    key: row._id || "unknown",
    count: row.count,
  }));
}

async function getAnalyticsSnapshot({ now = new Date() } = {}) {
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    users,
    totalUsers,
    newUsers24h,
    newUsers7d,
    onboardingCompleted,
    onboardingSkipped,
    namedProfiles,
    bannedUsers,
    activeDiscussionUsers,
    savedProfileUsers,
    totalDiscussions,
    openDiscussions,
    closedDiscussions,
    botDiscussions,
    discussionsCreated24h,
    discussionsCreated7d,
    activeDiscussions7d,
    invitationStatusCounts,
    cacheTotals,
    health,
  ] = await Promise.all([
    User.find({})
      .select("createdAt onboardingCompletedAt onboardingSkippedAt profileName bannedAt activeDiscussionId savedProfileCodes aiLists aiTaste aiWatchlistMovies aiTopTenMovies aiWatchlistMusic aiTopTenMusic aiWatchlistBooks aiTopTenBooks aiWatchlistRandom aiTopTenRandom")
      .lean(),
    User.countDocuments({}),
    User.countDocuments({ createdAt: { $gte: since24h } }),
    User.countDocuments({ createdAt: { $gte: since7d } }),
    User.countDocuments({ onboardingCompletedAt: { $ne: null } }),
    User.countDocuments({ onboardingSkippedAt: { $ne: null } }),
    User.countDocuments({ profileName: { $type: "string", $gt: "" } }),
    User.countDocuments({ bannedAt: { $ne: null } }),
    User.countDocuments({ activeDiscussionId: { $ne: null } }),
    User.countDocuments({ savedProfileCodes: { $exists: true, $not: { $size: 0 } } }),
    Discussion.countDocuments({}),
    Discussion.countDocuments({ status: "open" }),
    Discussion.countDocuments({ status: "closed" }),
    Discussion.countDocuments({ isBotCreated: true }),
    Discussion.countDocuments({ createdAt: { $gte: since24h } }),
    Discussion.countDocuments({ createdAt: { $gte: since7d } }),
    Discussion.countDocuments({ lastActivityAt: { $gte: since7d } }),
    countByField(DiscussionInvitation, "status"),
    AiResponseCache.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          totalHits: { $sum: "$hitCount" },
          usedEntries: { $sum: { $cond: [{ $gt: ["$hitCount", 0] }, 1, 0] } },
        },
      },
    ]),
    getOperationalHealthSnapshot({ now }),
  ]);

  const discussionAgg = await Discussion.aggregate([
    {
      $group: {
        _id: null,
        totalMembers: { $sum: { $size: { $ifNull: ["$memberUserIds", []] } } },
        totalMessages: { $sum: "$replyCount" },
        totalReports: { $sum: { $size: { $ifNull: ["$reports", []] } } },
      },
    },
  ]);

  const cache = cacheTotals[0] || { total: 0, totalHits: 0, usedEntries: 0 };
  const discussionTotals = discussionAgg[0] || { totalMembers: 0, totalMessages: 0, totalReports: 0 };

  return {
    generatedAt: now.toISOString(),
    users: {
      total: totalUsers,
      new24h: newUsers24h,
      new7d: newUsers7d,
      onboardingCompleted,
      onboardingSkipped,
      namedProfiles,
      banned: bannedUsers,
      activeDiscussionUsers,
      savedProfileUsers,
    },
    lists: buildUserListMetrics(users),
    discussions: {
      total: totalDiscussions,
      open: openDiscussions,
      closed: closedDiscussions,
      botCreated: botDiscussions,
      created24h: discussionsCreated24h,
      created7d: discussionsCreated7d,
      active7d: activeDiscussions7d,
      totalMembers: discussionTotals.totalMembers,
      totalMessages: discussionTotals.totalMessages,
      totalReports: discussionTotals.totalReports,
    },
    invitations: invitationStatusCounts,
    aiCache: {
      total: cache.total || 0,
      usedEntries: cache.usedEntries || 0,
      totalHits: cache.totalHits || 0,
    },
    health,
  };
}

module.exports = {
  getAnalyticsSnapshot,
  buildUserListMetrics,
};
