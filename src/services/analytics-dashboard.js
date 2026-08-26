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
const { getModerationAdminSnapshot } = require("./moderation-admin");
const {
  EVENT_NAMES,
  countEventsByName,
  countEventsBySection,
  countUniqueUsersForEvents,
} = require("./analytics-events");
const { reconcileStarBalances } = require("./stars");
const { getTasteIndexHealth } = require("./user-taste-index");
const { getSimilarPeopleReengagementPreview } = require("./similar-people-reengagement");

const SECTIONS = ["movies", "series", "music", "books", "random"];
const SECTION_LABELS = {
  movies: "Movies",
  music: "Music",
  books: "Books",
  random: "Interests",
};
const DASHBOARD_QUERY_TIMEOUT_MS = 10_000;
const DASHBOARD_SNAPSHOT_CACHE_TTL_MS = 30_000;

function arraySize(path) {
  return {
    $cond: [
      { $isArray: path },
      { $size: path },
      0,
    ],
  };
}

function preferredListSize(section, listType) {
  const suffix = section === "random"
    ? "Random"
    : section.charAt(0).toUpperCase() + section.slice(1);
  const legacyPrefix = listType === "topTen" ? "aiTopTen" : "aiWatchlist";
  const structured = arraySize(`$aiLists.${section}.${listType}`);
  return {
    $let: {
      vars: { structured },
      in: {
        $cond: [
          { $gt: ["$$structured", 0] },
          "$$structured",
          arraySize(`$${legacyPrefix}${suffix}`),
        ],
      },
    },
  };
}

function buildUserDashboardAggregation({ since24h, since7d, fullListSize }) {
  const countFields = Object.fromEntries(SECTIONS.flatMap((section) => [
    [`${section}TopTen`, preferredListSize(section, "topTen")],
    [`${section}Watchlist`, preferredListSize(section, "watchlist")],
  ]));
  const listGroup = { _id: null };
  for (const section of SECTIONS) {
    const topTen = `$${section}TopTen`;
    const watchlist = `$${section}Watchlist`;
    listGroup[`${section}TopTenItems`] = { $sum: topTen };
    listGroup[`${section}WatchlistItems`] = { $sum: watchlist };
    listGroup[`${section}UsersWithTopTenItem`] = { $sum: { $cond: [{ $gt: [topTen, 0] }, 1, 0] } };
    listGroup[`${section}UsersWithThreeTopTen`] = { $sum: { $cond: [{ $gte: [topTen, 3] }, 1, 0] } };
    listGroup[`${section}UsersWithFullTopTen`] = {
      $sum: { $cond: [{ $gte: [topTen, fullListSize] }, 1, 0] },
    };
    listGroup[`${section}UsersWithTasteLabel`] = section === "random"
      ? { $sum: 0 }
      : {
        $sum: {
          $cond: [
            {
              $and: [
                { $eq: [{ $type: `$aiTaste.${section}.labelKey` }, "string"] },
                { $gt: [`$aiTaste.${section}.labelKey`, ""] },
                { $gt: [{ $convert: { input: `$aiTaste.${section}.sampleCount`, to: "double", onError: 0, onNull: 0 } }, 0] },
              ],
            },
            1,
            0,
          ],
        },
      };
  }

  return [
    { $project: { createdAt: 1, lastActiveAt: 1, onboardingCompletedAt: 1, onboardingSkippedAt: 1, profileName: 1, bannedAt: 1, activeDiscussionId: 1, savedProfileCodes: 1, starBalance: 1, aiTaste: 1, ...countFields } },
    {
      $facet: {
        summary: [{
          $group: {
            _id: null,
            total: { $sum: 1 },
            new24h: { $sum: { $cond: [{ $gte: ["$createdAt", since24h] }, 1, 0] } },
            new7d: { $sum: { $cond: [{ $gte: ["$createdAt", since7d] }, 1, 0] } },
            d1Eligible: { $sum: { $cond: [{ $lte: ["$createdAt", since24h] }, 1, 0] } },
            d1Retained: {
              $sum: {
                $cond: [{ $and: [
                  { $lte: ["$createdAt", since24h] },
                  { $gte: ["$lastActiveAt", { $add: ["$createdAt", 24 * 60 * 60 * 1000] }] },
                ] }, 1, 0],
              },
            },
            d7Eligible: { $sum: { $cond: [{ $lte: ["$createdAt", since7d] }, 1, 0] } },
            d7Retained: {
              $sum: {
                $cond: [{ $and: [
                  { $lte: ["$createdAt", since7d] },
                  { $gte: ["$lastActiveAt", { $add: ["$createdAt", 7 * 24 * 60 * 60 * 1000] }] },
                ] }, 1, 0],
              },
            },
            onboardingCompleted: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$onboardingCompletedAt", null] }, null] }, 1, 0] } },
            onboardingSkipped: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$onboardingSkippedAt", null] }, null] }, 1, 0] } },
            namedProfiles: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: [{ $type: "$profileName" }, "string"] }, { $gt: ["$profileName", ""] }] },
                  1,
                  0,
                ],
              },
            },
            banned: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$bannedAt", null] }, null] }, 1, 0] } },
            activeDiscussionUsers: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$activeDiscussionId", null] }, null] }, 1, 0] } },
            savedProfileUsers: {
              $sum: { $cond: [{ $gt: [arraySize("$savedProfileCodes"), 0] }, 1, 0] },
            },
            outstandingStars: {
              $sum: { $convert: { input: "$starBalance", to: "double", onError: 0, onNull: 0 } },
            },
          },
        }],
        lists: [{ $group: listGroup }],
      },
    },
  ];
}

function normalizeUserDashboardMetrics(rows = []) {
  const result = rows[0] || {};
  const summary = result.summary?.[0] || {};
  const lists = result.lists?.[0] || {};
  return {
    users: {
      total: Number(summary.total) || 0,
      new24h: Number(summary.new24h) || 0,
      new7d: Number(summary.new7d) || 0,
      d1Eligible: Number(summary.d1Eligible) || 0,
      d1Retained: Number(summary.d1Retained) || 0,
      d7Eligible: Number(summary.d7Eligible) || 0,
      d7Retained: Number(summary.d7Retained) || 0,
      onboardingCompleted: Number(summary.onboardingCompleted) || 0,
      onboardingSkipped: Number(summary.onboardingSkipped) || 0,
      namedProfiles: Number(summary.namedProfiles) || 0,
      banned: Number(summary.banned) || 0,
      activeDiscussionUsers: Number(summary.activeDiscussionUsers) || 0,
      savedProfileUsers: Number(summary.savedProfileUsers) || 0,
    },
    outstandingStars: Number(summary.outstandingStars) || 0,
    lists: SECTIONS.map((section) => ({
      section,
      label: SECTION_LABELS[section],
      topTenItems: Number(lists[`${section}TopTenItems`]) || 0,
      watchlistItems: Number(lists[`${section}WatchlistItems`]) || 0,
      usersWithTopTenItem: Number(lists[`${section}UsersWithTopTenItem`]) || 0,
      usersWithThreeTopTen: Number(lists[`${section}UsersWithThreeTopTen`]) || 0,
      usersWithFullTopTen: Number(lists[`${section}UsersWithFullTopTen`]) || 0,
      usersWithTasteLabel: Number(lists[`${section}UsersWithTasteLabel`]) || 0,
    })),
  };
}

async function getUserDashboardMetrics({ since24h, since7d, fullListSize }) {
  const rows = await User.aggregate(buildUserDashboardAggregation({
    since24h,
    since7d,
    fullListSize,
  })).option({ maxTimeMS: DASHBOARD_QUERY_TIMEOUT_MS });
  return normalizeUserDashboardMetrics(rows);
}

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
      key: "capacity_rejections",
      label: "Overload protection",
      ok: (health.capacity?.rejectedLast24h || 0) === 0,
      detail: `${health.capacity?.rejectedLast24h || 0} bounded-work rejections in the last 24 hours`,
    },
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
  ]).option({ maxTimeMS: DASHBOARD_QUERY_TIMEOUT_MS });
  return rows.map((row) => ({
    key: row._id || "unknown",
    count: row.count,
  }));
}

async function getDiscussionDashboardMetrics({ since24h, since7d }) {
  const rows = await Discussion.aggregate([{
    $group: {
      _id: null,
      total: { $sum: 1 },
      open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
      closed: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] } },
      botCreated: { $sum: { $cond: [{ $eq: ["$isBotCreated", true] }, 1, 0] } },
      created24h: { $sum: { $cond: [{ $gte: ["$createdAt", since24h] }, 1, 0] } },
      created7d: { $sum: { $cond: [{ $gte: ["$createdAt", since7d] }, 1, 0] } },
      active7d: { $sum: { $cond: [{ $gte: ["$lastActivityAt", since7d] }, 1, 0] } },
      totalMembers: { $sum: arraySize("$memberUserIds") },
      totalMessages: { $sum: { $convert: { input: "$replyCount", to: "double", onError: 0, onNull: 0 } } },
      totalReports: { $sum: arraySize("$reports") },
    },
  }]).option({ maxTimeMS: DASHBOARD_QUERY_TIMEOUT_MS });
  const result = rows[0] || {};
  return Object.fromEntries([
    "total",
    "open",
    "closed",
    "botCreated",
    "created24h",
    "created7d",
    "active7d",
    "totalMembers",
    "totalMessages",
    "totalReports",
  ].map((key) => [key, Number(result[key]) || 0]));
}

async function getEventDashboardMetrics({ since24h, since7d }) {
  const [
    last24h,
    last7d,
    topTenBySection7d,
    suggestionsBySection7d,
    funnel7d,
    onboardingDestinations7d,
    sectionTips7d,
  ] = await Promise.all([
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
  ]);
  return {
    last24h,
    last7d,
    topTenBySection7d,
    suggestionsBySection7d,
    onboardingDestinations7d,
    sectionTips7d,
    funnel7d: buildGuidedJourneyFunnel(funnel7d, onboardingDestinations7d, sectionTips7d),
  };
}

async function getStarDashboardMetrics({ now }) {
  const [
    transactionTotals,
    participantRows,
    activeBoosts,
    qualifiedReferrals,
    reconciliation,
  ] = await Promise.all([
    StarTransaction.aggregate([
      { $match: { status: "applied" } },
      { $group: { _id: "$type", transactions: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]).option({ maxTimeMS: DASHBOARD_QUERY_TIMEOUT_MS }),
    StarTransaction.aggregate([
      { $match: { status: "applied", type: { $in: ["earn", "grant", "purchase", "spend"] } } },
      {
        $group: {
          _id: "$userId",
          earned: { $max: { $cond: [{ $in: ["$type", ["earn", "grant", "purchase"]] }, 1, 0] } },
          spent: { $max: { $cond: [{ $eq: ["$type", "spend"] }, 1, 0] } },
        },
      },
      { $group: { _id: null, earners: { $sum: "$earned" }, spenders: { $sum: "$spent" } } },
    ]).option({ maxTimeMS: DASHBOARD_QUERY_TIMEOUT_MS }),
    DiscussionBoost.countDocuments({ status: "active", endsAt: { $gt: now } }).maxTimeMS(DASHBOARD_QUERY_TIMEOUT_MS),
    StarReferralClaim.countDocuments({ status: "qualified" }).maxTimeMS(DASHBOARD_QUERY_TIMEOUT_MS),
    reconcileStarBalances({ limit: 1000 }),
  ]);
  return {
    earners: Number(participantRows[0]?.earners) || 0,
    spenders: Number(participantRows[0]?.spenders) || 0,
    activeBoosts,
    qualifiedReferrals,
    reconciliationChecked: reconciliation.checked,
    reconciliationMismatches: reconciliation.mismatchCount,
    transactions: transactionTotals.map((row) => ({
      key: row._id || "unknown",
      count: row.transactions,
      amount: row.amount,
    })),
  };
}

async function runMetricGroup(name, load, fallback, diagnostics) {
  const startedAt = Date.now();
  try {
    return await load();
  } catch (error) {
    diagnostics.warnings.push({
      section: name,
      reason: error?.code === 50 ? "query_timeout" : "query_failed",
    });
    return fallback;
  } finally {
    diagnostics.queryDurationsMs[name] = Date.now() - startedAt;
  }
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

  const diagnostics = { warnings: [], queryDurationsMs: {} };
  const emptyUsers = {
    users: {
      total: 0,
      new24h: 0,
      new7d: 0,
      d1Eligible: 0,
      d1Retained: 0,
      d7Eligible: 0,
      d7Retained: 0,
      onboardingCompleted: 0,
      onboardingSkipped: 0,
      namedProfiles: 0,
      banned: 0,
      activeDiscussionUsers: 0,
      savedProfileUsers: 0,
    },
    outstandingStars: 0,
    lists: normalizeUserDashboardMetrics([]).lists,
  };
  const emptyDiscussions = {
    total: 0,
    open: 0,
    closed: 0,
    botCreated: 0,
    created24h: 0,
    created7d: 0,
    active7d: 0,
    totalMembers: 0,
    totalMessages: 0,
    totalReports: 0,
  };
  const emptyEvents = {
    last24h: [],
    last7d: [],
    topTenBySection7d: [],
    suggestionsBySection7d: [],
    onboardingDestinations7d: [],
    sectionTips7d: [],
    funnel7d: buildGuidedJourneyFunnel(),
  };
  const emptyStars = {
    earners: 0,
    spenders: 0,
    activeBoosts: 0,
    qualifiedReferrals: 0,
    reconciliationChecked: 0,
    reconciliationMismatches: null,
    transactions: [],
  };
  const emptyModeration = { bannedUsers: [], recentActions: [] };
  const [
    userMetrics,
    discussions,
    invitationStatusCounts,
    health,
    tasteIndexHealth,
    events,
    starMetrics,
    similarPeopleReengagement,
    moderation,
  ] = await Promise.all([
    runMetricGroup("users", () => getUserDashboardMetrics({
      since24h,
      since7d,
      fullListSize: limits.aiTopTenItems,
    }), emptyUsers, diagnostics),
    runMetricGroup("discussions", () => getDiscussionDashboardMetrics({ since24h, since7d }), emptyDiscussions, diagnostics),
    runMetricGroup("invitations", () => countByField(DiscussionInvitation, "status"), [], diagnostics),
    runMetricGroup("health", () => getOperationalHealthSnapshot({ now }), {}, diagnostics),
    runMetricGroup("tasteIndex", () => getTasteIndexHealth({ maxUsers: 1000 }), { ok: false, reason: "query_failed" }, diagnostics),
    runMetricGroup("events", () => getEventDashboardMetrics({ since24h, since7d }), emptyEvents, diagnostics),
    runMetricGroup("stars", () => getStarDashboardMetrics({ now }), emptyStars, diagnostics),
    runMetricGroup("similarPeopleReengagement", () => (
      getSimilarPeopleReengagementPreview({ now })
    ), {
      enabled: false,
      inactivityDays: limits.similarPeopleInactiveDays,
      cooldownDays: limits.similarPeopleNotificationCooldownDays,
      minimumSharedItems: limits.peopleDiscoveryMinSharedItems,
      rolloutPercent: limits.similarPeopleReengagementRolloutPercent,
      inactiveUsers: 0,
      nextBatchUsers: 0,
      nextBatchMatchingUsers: 0,
    }, diagnostics),
    runMetricGroup("moderation", () => getModerationAdminSnapshot(), emptyModeration, diagnostics),
  ]);

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
    users: userMetrics.users,
    lists: userMetrics.lists,
    discussions,
    similarPeopleReengagement,
    invitations: invitationStatusCounts,
    moderation,
    stars: {
      outstanding: userMetrics.outstandingStars,
      earners: starMetrics.earners,
      spenders: starMetrics.spenders,
      activeBoosts: starMetrics.activeBoosts,
      qualifiedReferrals: starMetrics.qualifiedReferrals,
      reconciliationChecked: starMetrics.reconciliationChecked,
      reconciliationMismatches: starMetrics.reconciliationMismatches,
      transactions: starMetrics.transactions,
    },
    health: {
      ...health,
      tasteIndex: tasteIndexHealth,
      alerts: buildOperationalAlerts({
        health,
        tasteIndex: tasteIndexHealth,
        stars: {
          reconciliationChecked: starMetrics.reconciliationChecked,
          reconciliationMismatches: starMetrics.reconciliationMismatches,
        },
      }),
    },
    events,
    dashboardSnapshot: {
      partial: diagnostics.warnings.length > 0,
      warnings: diagnostics.warnings,
      queryDurationsMs: diagnostics.queryDurationsMs,
      queryTimeoutMs: DASHBOARD_QUERY_TIMEOUT_MS,
    },
  };
}

function createAnalyticsSnapshotCache({
  load = () => getAnalyticsSnapshot(),
  ttlMs = DASHBOARD_SNAPSHOT_CACHE_TTL_MS,
  clock = () => Date.now(),
} = {}) {
  let cached = null;
  let expiresAt = 0;
  let inFlight = null;
  return {
    async get({ force = false } = {}) {
      const timestamp = clock();
      if (!force && cached && timestamp < expiresAt) return cached;
      if (inFlight) return inFlight;
      const startedAt = timestamp;
      inFlight = Promise.resolve()
        .then(load)
        .then((snapshot) => {
          const completedAt = clock();
          cached = {
            ...snapshot,
            dashboardSnapshot: {
              ...(snapshot.dashboardSnapshot || {}),
              buildDurationMs: Math.max(0, completedAt - startedAt),
              cacheTtlMs: ttlMs,
            },
          };
          expiresAt = completedAt + ttlMs;
          return cached;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    invalidate() {
      cached = null;
      expiresAt = 0;
    },
  };
}

const analyticsSnapshotCache = createAnalyticsSnapshotCache();

function getCachedAnalyticsSnapshot(options) {
  return analyticsSnapshotCache.get(options);
}

function invalidateAnalyticsSnapshotCache() {
  analyticsSnapshotCache.invalidate();
}

module.exports = {
  buildUserDashboardAggregation,
  createAnalyticsSnapshotCache,
  getAnalyticsSnapshot,
  getCachedAnalyticsSnapshot,
  invalidateAnalyticsSnapshotCache,
  normalizeUserDashboardMetrics,
  buildUserListMetrics,
  buildGuidedJourneyFunnel,
  buildOperationalAlerts,
};
