const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGuidedJourneyFunnel,
  buildOperationalAlerts,
  buildUserListMetrics,
} = require("../src/services/analytics-dashboard");
const { EVENT_NAMES } = require("../src/services/analytics-events");

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
    },
    tasteIndex: { ok: true, healthy: false, checkedUsers: 100, missingRows: 2, mismatchedRows: 1 },
    stars: { reconciliationChecked: 100, reconciliationMismatches: 1 },
  });

  assert.deepEqual(alerts.map((alert) => [alert.key, alert.ok]), [
    ["slow_routes", false],
    ["taste_index", false],
    ["ai_timeouts", false],
    ["star_reconciliation", false],
  ]);
  assert.equal(alerts[0].detail.includes("callback:people:list"), true);
  assert.equal(alerts[1].detail.includes("2 missing"), true);
});
