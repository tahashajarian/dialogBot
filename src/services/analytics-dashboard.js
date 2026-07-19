const User = require("../models/user");
const Discussion = require("../models/discussion");
const DiscussionInvitation = require("../models/discussion-invitation");
const StarTransaction = require("../models/star-transaction");
const DiscussionBoost = require("../models/discussion-boost");
const StarReferralClaim = require("../models/star-referral-claim");
const { getOperationalHealthSnapshot } = require("./operational-health");
const {
  operationalLimits,
  refreshOperationalLimits,
  getOperationalLimitsState,
} = require("./operational-limits");
const {
  refreshStarSettings,
  getStarSettingsState,
} = require("./star-settings");
const {
  refreshBotAppearance,
  getBotAppearanceState,
} = require("./bot-appearance");
const {
  EVENT_NAMES,
  countEventsByName,
  countEventsBySection,
  countUniqueUsersForEvents,
} = require("./analytics-events");
const { reconcileStarBalances } = require("./stars");
const { getTasteIndexHealth } = require("./user-taste-index");

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

function metricsByKey(rows = []) {
  return Object.fromEntries(rows.map((row) => [row.key, row]));
}

function buildOperationalAlerts({ health = {}, tasteIndex = {}, stars = {} } = {}) {
  const slowestRoute = (health.performance?.routes || [])[0];
  const timeoutRate = Number(health.aiApi?.lastHour?.timeoutRate) || 0;
  const reconciliationMismatches = stars.reconciliationMismatches;
  return [
    {
      key: "slow_routes",
      label: "Application routes",
      ok: !slowestRoute || Number(slowestRoute.p95DurationMs) < 3000,
      detail: slowestRoute
        ? `Slowest sampled route: ${slowestRoute.route} p95 ${slowestRoute.p95DurationMs}ms`
        : "No slow update samples in the last 24 hours",
    },
    {
      key: "taste_index",
      label: "Taste index",
      ok: tasteIndex.ok !== false && tasteIndex.healthy !== false,
      detail: tasteIndex.ok === false
        ? `Health check unavailable: ${tasteIndex.reason || "unknown"}`
        : `${tasteIndex.missingRows || 0} missing and ${tasteIndex.mismatchedRows || 0} mismatched rows across ${tasteIndex.checkedUsers || 0} checked users`,
    },
    {
      key: "ai_timeouts",
      label: "AI timeouts",
      ok: timeoutRate < 0.1,
      detail: `${health.aiApi?.lastHour?.timeouts || 0} timeouts across ${health.aiApi?.lastHour?.total || 0} calls in the last hour`,
    },
    {
      key: "star_reconciliation",
      label: "Star reconciliation",
      ok: reconciliationMismatches === 0,
      detail: reconciliationMismatches === null || reconciliationMismatches === undefined
        ? "Reconciliation unavailable"
        : `${reconciliationMismatches} mismatches across ${stars.reconciliationChecked || 0} checked wallets`,
    },
  ];
}

function buildGuidedJourneyFunnel(eventMetrics = {}, destinationRows = [], tipRows = []) {
  const destinations = metricsByKey(destinationRows);
  const tips = metricsByKey(tipRows);
  const metric = (collection, key) => collection[key] || { count: 0, users: 0 };
  return [
    { key: "Started", event: EVENT_NAMES.userStarted, ...metric(eventMetrics, EVENT_NAMES.userStarted) },
    { key: "Onboarding started", event: EVENT_NAMES.onboardingStarted, ...metric(eventMetrics, EVENT_NAMES.onboardingStarted) },
    { key: "Onboarding completed", event: EVENT_NAMES.onboardingCompleted, ...metric(eventMetrics, EVENT_NAMES.onboardingCompleted) },
    { key: "Starter invitation prepared", event: EVENT_NAMES.starterInvitationPrepared, ...metric(eventMetrics, EVENT_NAMES.starterInvitationPrepared) },
    { key: "Starter invitation opened", event: EVENT_NAMES.starterInvitationOpened, ...metric(eventMetrics, EVENT_NAMES.starterInvitationOpened) },
    { ...metric(destinations, "active_discussions"), key: "Chose Active Discussions", event: EVENT_NAMES.onboardingDestinationChosen },
    { key: "Opened discussion list", event: EVENT_NAMES.discussionListOpened, ...metric(eventMetrics, EVENT_NAMES.discussionListOpened) },
    { key: "Joined discussion", event: EVENT_NAMES.discussionJoined, ...metric(eventMetrics, EVENT_NAMES.discussionJoined) },
    { ...metric(destinations, "favorites"), key: "Chose Favorites", event: EVENT_NAMES.onboardingDestinationChosen },
    { ...metric(tips, "favorites"), key: "First Favorites visit", event: EVENT_NAMES.sectionTipExposed },
    { ...metric(tips, "people"), key: "First People visit", event: EVENT_NAMES.sectionTipExposed },
    { key: "Added Top 10 item", event: EVENT_NAMES.topTenItemAdded, ...metric(eventMetrics, EVENT_NAMES.topTenItemAdded) },
    { key: "Unlocked taste label", event: EVENT_NAMES.tasteLabelUnlocked, ...metric(eventMetrics, EVENT_NAMES.tasteLabelUnlocked) },
    { key: "Created discussion", event: EVENT_NAMES.discussionCreated, ...metric(eventMetrics, EVENT_NAMES.discussionCreated) },
    { key: "Sent invite", event: EVENT_NAMES.inviteSent, ...metric(eventMetrics, EVENT_NAMES.inviteSent) },
    { key: "Saved profile", event: EVENT_NAMES.profileSaved, ...metric(eventMetrics, EVENT_NAMES.profileSaved) },
  ];
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
      if (topTenCount >= operationalLimits.aiTopTenItems) perSection[section].usersWithFullTopTen += 1;
      if (section !== "random" && taste.labelKey && Number(taste.sampleCount) > 0) {
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
  const limits = { ...(await refreshOperationalLimits()) };
  const limitsState = getOperationalLimitsState();
  const starSettings = { ...(await refreshStarSettings()) };
  const starSettingsState = getStarSettingsState();
  const botAppearance = { ...(await refreshBotAppearance()) };
  const botAppearanceState = getBotAppearanceState();
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
    health,
    tasteIndexHealth,
    events24h,
    events7d,
    topTenBySection7d,
    suggestionsBySection7d,
    funnel7d,
    onboardingDestinations7d,
    sectionTips7d,
    starTransactionTotals,
    starEarners,
    starSpenders,
    activeBoosts,
    qualifiedReferrals,
    outstandingStars,
    starReconciliation,
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
    getOperationalHealthSnapshot({ now }),
    getTasteIndexHealth({ maxUsers: 1000 }).catch(() => ({ ok: false, reason: "query_failed" })),
    countEventsByName({ since: since24h }),
    countEventsByName({ since: since7d }),
    countEventsBySection({ name: EVENT_NAMES.topTenItemAdded, since: since7d }),
    countEventsBySection({ name: EVENT_NAMES.suggestionRequested, since: since7d }),
    countUniqueUsersForEvents({
      since: since7d,
      names: [
        EVENT_NAMES.userStarted,
        EVENT_NAMES.onboardingStarted,
        EVENT_NAMES.onboardingCompleted,
        EVENT_NAMES.starterInvitationPrepared,
        EVENT_NAMES.starterInvitationOpened,
        EVENT_NAMES.topTenItemAdded,
        EVENT_NAMES.tasteLabelUnlocked,
        EVENT_NAMES.discussionListOpened,
        EVENT_NAMES.discussionJoined,
        EVENT_NAMES.discussionCreated,
        EVENT_NAMES.inviteSent,
        EVENT_NAMES.profileSaved,
      ],
    }),
    countEventsBySection({ name: EVENT_NAMES.onboardingDestinationChosen, since: since7d }),
    countEventsBySection({ name: EVENT_NAMES.sectionTipExposed, since: since7d }),
    StarTransaction.aggregate([
      { $match: { status: "applied" } },
      {
        $group: {
          _id: "$type",
          transactions: { $sum: 1 },
          amount: { $sum: "$amount" },
        },
      },
    ]),
    StarTransaction.distinct("userId", {
      status: "applied",
      type: { $in: ["earn", "grant", "purchase"] },
    }),
    StarTransaction.distinct("userId", { status: "applied", type: "spend" }),
    DiscussionBoost.countDocuments({ status: "active", endsAt: { $gt: now } }),
    StarReferralClaim.countDocuments({ status: "qualified" }),
    User.aggregate([{ $group: { _id: null, total: { $sum: "$starBalance" } } }]),
    reconcileStarBalances({ limit: 1000 }).catch(() => ({ checked: 0, mismatchCount: null, mismatches: [] })),
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

  const discussionTotals = discussionAgg[0] || { totalMembers: 0, totalMessages: 0, totalReports: 0 };

  return {
    generatedAt: now.toISOString(),
    limits,
    limitsUpdatedAt: limitsState.updatedAt,
    starSettings,
    starSettingsUpdatedAt: starSettingsState.updatedAt,
    starSettingsActivationRequiresRestart: starSettingsState.activationRequiresRestart,
    botAppearance,
    botAppearanceUpdatedAt: botAppearanceState.updatedAt,
    botAppearanceCacheTtlSeconds: botAppearanceState.cacheTtlSeconds,
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
    stars: {
      outstanding: Number(outstandingStars[0]?.total) || 0,
      earners: starEarners.length,
      spenders: starSpenders.length,
      activeBoosts,
      qualifiedReferrals,
      reconciliationChecked: starReconciliation.checked,
      reconciliationMismatches: starReconciliation.mismatchCount,
      transactions: starTransactionTotals.map((row) => ({
        key: row._id || "unknown",
        count: row.transactions,
        amount: row.amount,
      })),
    },
    health: {
      ...health,
      tasteIndex: tasteIndexHealth,
      alerts: buildOperationalAlerts({
        health,
        tasteIndex: tasteIndexHealth,
        stars: {
          reconciliationChecked: starReconciliation.checked,
          reconciliationMismatches: starReconciliation.mismatchCount,
        },
      }),
    },
    events: {
      last24h: events24h,
      last7d: events7d,
      topTenBySection7d,
      suggestionsBySection7d,
      onboardingDestinations7d,
      sectionTips7d,
      funnel7d: buildGuidedJourneyFunnel(funnel7d, onboardingDestinations7d, sectionTips7d),
    },
  };
}

module.exports = {
  getAnalyticsSnapshot,
  buildUserListMetrics,
  buildGuidedJourneyFunnel,
  buildOperationalAlerts,
};
