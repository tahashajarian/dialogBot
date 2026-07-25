const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildUserDashboardAggregation,
  buildGuidedJourneyFunnel,
  buildOperationalAlerts,
  buildUserListMetrics,
  createAnalyticsSnapshotCache,
  normalizeUserDashboardMetrics,
} = require("../src/services/analytics-dashboard");
const { EVENT_NAMES } = require("../src/services/analytics-events");
const { renderDashboard } = require("../scripts/analytics-dashboard");

function section(rows, name) {
  return rows.find((row) => row.section === name);
}

test("analytics list metrics count structured and legacy AI lists", () => {
  const rows = buildUserListMetrics([
    {
      aiLists: {
        movies: {
          topTen: Array.from({ length: 10 }, (_, index) => ({ title: `Movie ${index}` })),
          watchlist: [{ title: "Later" }],
        },
      },
      aiTaste: {
        movies: { labelKey: "cinephile", sampleCount: 10 },
      },
    },
    {
      aiTopTenMusic: ["Metallica", "Slayer", "Megadeth"],
      aiWatchlistMusic: ["Tool", "Pantera"],
      aiTaste: {
        music: { labelKey: "metalhead", sampleCount: 3 },
      },
    },
    {
      aiLists: {
        random: {
          topTen: [{ title: "Chess" }],
          watchlist: [],
        },
      },
      aiTaste: {
        random: { labelKey: "curious", sampleCount: 0 },
      },
    },
  ]);

  assert.deepEqual(section(rows, "movies"), {
    section: "movies",
    label: "Movies",
    topTenItems: 10,
    watchlistItems: 1,
    usersWithTopTenItem: 1,
    usersWithThreeTopTen: 1,
    usersWithFullTopTen: 1,
    usersWithTasteLabel: 1,
  });

  assert.deepEqual(section(rows, "music"), {
    section: "music",
    label: "Music",
    topTenItems: 3,
    watchlistItems: 2,
    usersWithTopTenItem: 1,
    usersWithThreeTopTen: 1,
    usersWithFullTopTen: 0,
    usersWithTasteLabel: 1,
  });

  assert.equal(section(rows, "random").usersWithTasteLabel, 0);
});

test("guided journey funnel combines event, destination, and first-tip counts", () => {
  const funnel = buildGuidedJourneyFunnel({
    [EVENT_NAMES.userStarted]: { count: 13, users: 11 },
    [EVENT_NAMES.onboardingStarted]: { count: 12, users: 10 },
    [EVENT_NAMES.onboardingCompleted]: { count: 9, users: 9 },
    [EVENT_NAMES.starterInvitationPrepared]: { count: 7, users: 7 },
    [EVENT_NAMES.starterInvitationOpened]: { count: 5, users: 5 },
    [EVENT_NAMES.discussionListOpened]: { count: 8, users: 6 },
    [EVENT_NAMES.discussionJoined]: { count: 4, users: 4 },
    [EVENT_NAMES.profileSaved]: { count: 2, users: 2 },
  }, [
    { key: "active_discussions", count: 3, users: 3 },
    { key: "favorites", count: 2, users: 2 },
  ], [
    { key: "favorites", count: 6, users: 6 },
    { key: "people", count: 4, users: 4 },
  ]);

  const byKey = Object.fromEntries(funnel.map((row) => [row.key, row]));
  assert.equal(byKey.Started.users, 11);
  assert.equal(byKey["Onboarding started"].users, 10);
  assert.equal(byKey["Starter invitation opened"].users, 5);
  assert.equal(byKey["Chose Active Discussions"].users, 3);
  assert.equal(byKey["First Favorites visit"].users, 6);
  assert.equal(byKey["First People visit"].users, 4);
  assert.equal(byKey["Saved profile"].count, 2);
  assert.ok(byKey["Added Top 10 item"]);
});

test("operational alerts identify actionable backend health failures", () => {
  const alerts = buildOperationalAlerts({
    health: {
      aiApi: { lastHour: { total: 20, timeouts: 3, timeoutRate: 0.15 } },
      performance: { routes: [{ route: "callback:people:list", p95DurationMs: 3200 }] },
      capacity: { rejectedLast24h: 4 },
    },
    tasteIndex: { ok: true, healthy: false, checkedUsers: 100, missingRows: 2, mismatchedRows: 1 },
    stars: { reconciliationChecked: 100, reconciliationMismatches: 1 },
  });

  assert.deepEqual(alerts.map((alert) => [alert.key, alert.ok]), [
    ["capacity_rejections", false],
    ["slow_routes", false],
    ["taste_index", false],
    ["ai_timeouts", false],
    ["star_reconciliation", false],
  ]);
  assert.equal(alerts[0].detail.includes("4 bounded-work rejections"), true);
  assert.equal(alerts[1].detail.includes("callback:people:list"), true);
  assert.equal(alerts[2].detail.includes("2 missing"), true);
});

test("dashboard user aggregation returns only compact facets", () => {
  const pipeline = buildUserDashboardAggregation({
    since24h: new Date("2026-01-02T00:00:00Z"),
    since7d: new Date("2025-12-27T00:00:00Z"),
    fullListSize: 10,
  });

  assert.deepEqual(Object.keys(pipeline[1].$facet), ["summary", "lists"]);
  assert.equal(JSON.stringify(pipeline).includes("$aiLists.movies.topTen"), true);
  assert.equal(JSON.stringify(pipeline).includes("$aiTopTenMovies"), true);
});

test("dashboard user aggregation normalization preserves metric shape", () => {
  const result = normalizeUserDashboardMetrics([{
    summary: [{ total: 2, namedProfiles: 1, outstandingStars: 7 }],
    lists: [{
      moviesTopTenItems: 10,
      moviesWatchlistItems: 2,
      moviesUsersWithTopTenItem: 1,
      moviesUsersWithThreeTopTen: 1,
      moviesUsersWithFullTopTen: 1,
      moviesUsersWithTasteLabel: 1,
    }],
  }]);

  assert.equal(result.users.total, 2);
  assert.equal(result.users.namedProfiles, 1);
  assert.equal(result.outstandingStars, 7);
  assert.deepEqual(section(result.lists, "movies"), {
    section: "movies",
    label: "Movies",
    topTenItems: 10,
    watchlistItems: 2,
    usersWithTopTenItem: 1,
    usersWithThreeTopTen: 1,
    usersWithFullTopTen: 1,
    usersWithTasteLabel: 1,
  });
  assert.equal(section(result.lists, "music").topTenItems, 0);
});

test("dashboard snapshot cache shares concurrent builds and expires predictably", async () => {
  let now = 1000;
  let builds = 0;
  let release;
  const cache = createAnalyticsSnapshotCache({
    ttlMs: 100,
    clock: () => now,
    load: async () => {
      builds += 1;
      await new Promise((resolve) => { release = resolve; });
      return { generatedAt: `build-${builds}` };
    },
  });

  const first = cache.get();
  const concurrent = cache.get();
  assert.equal(builds, 0);
  await Promise.resolve();
  assert.equal(builds, 1);
  release();
  assert.equal(await first, await concurrent);
  assert.equal((await cache.get()).generatedAt, "build-1");
  assert.equal(builds, 1);

  now += 101;
  const expired = cache.get();
  await Promise.resolve();
  release();
  assert.equal((await expired).generatedAt, "build-2");
  assert.equal(builds, 2);
});

test("dashboard snapshot cache invalidation forces a fresh build", async () => {
  let builds = 0;
  const cache = createAnalyticsSnapshotCache({
    load: async () => ({ build: ++builds }),
  });

  assert.equal((await cache.get()).build, 1);
  cache.invalidate();
  assert.equal((await cache.get()).build, 2);
});

test("dashboard renders accessible visual summaries alongside exact tables", () => {
  const html = renderDashboard({
    generatedAt: "2026-07-24T12:00:00.000Z",
    users: {
      total: 10,
      new24h: 1,
      new7d: 3,
      onboardingCompleted: 7,
      onboardingSkipped: 1,
      namedProfiles: 6,
      activeDiscussionUsers: 2,
      savedProfileUsers: 4,
      banned: 0,
    },
    discussions: {
      total: 4,
      open: 3,
      closed: 1,
      botCreated: 1,
      created24h: 1,
      created7d: 2,
      active7d: 2,
      totalMembers: 8,
      totalMessages: 20,
      totalReports: 0,
    },
    lists: [{
      label: "Movies <script>",
      topTenItems: 12,
      watchlistItems: 3,
      usersWithTopTenItem: 4,
      usersWithThreeTopTen: 3,
      usersWithFullTopTen: 1,
      usersWithTasteLabel: 1,
    }],
    invitations: [],
    events: {
      funnel7d: [{ key: "Started", count: 8, users: 6 }],
      last24h: [],
      last7d: [],
      topTenBySection7d: [],
      suggestionsBySection7d: [],
    },
    stars: { transactions: [] },
    health: {
      bot: { recentlySeen: true },
      aiApi: {
        lastHour: { total: 2, failures: 0, failureRate: 0 },
        last24h: { total: 10, failures: 2, failureRate: 0.2 },
      },
      performance: {
        routes: [{
          route: "text:fallback",
          count: 5,
          p50DurationMs: 500,
          p95DurationMs: 1800,
          p95TelegramMs: 1500,
          p95UserDocumentBytes: 12000,
        }],
      },
      alerts: [],
    },
    systemHealth: {
      hostname: "muze-vps<script>",
      platform: "Linux 6.8.0",
      uptimeSeconds: 90061,
      cpuCount: 2,
      loadAverage: [0.5, 0.4, 0.3],
      loadRatio1m: 0.25,
      memory: {
        totalBytes: 4 * 1024 ** 3,
        usedBytes: 1024 ** 3,
        availableBytes: 3 * 1024 ** 3,
        usedRatio: 0.25,
      },
      disk: {
        totalBytes: 60 * 1024 ** 3,
        usedBytes: 6 * 1024 ** 3,
        availableBytes: 54 * 1024 ** 3,
        usedRatio: 0.1,
        mountPoint: "/",
      },
      services: {
        bot: { active: true, available: true, state: "active" },
        dashboard: { active: true, available: true, state: "active" },
      },
      partial: false,
    },
    limits: {},
    starSettings: {},
    botAppearance: {},
  });

  assert.match(html, /class="bar-chart" role="img"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /Product Journey/);
  assert.match(html, /Route p95 latency comparison/);
  assert.match(html, /VPS Health/);
  assert.match(html, /Memory utilization/);
  assert.match(html, /Disk utilization/);
  assert.match(html, /muze-vps&lt;script&gt;/);
  assert.doesNotMatch(html, /muze-vps<script>/);
  assert.match(html, /Movies &lt;script&gt;/);
  assert.doesNotMatch(html, /Movies <script>/);
  assert.match(html, /<table>/);
});
