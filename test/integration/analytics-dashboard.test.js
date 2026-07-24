const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../../src/models/user");
const {
  buildUserDashboardAggregation,
  buildUserListMetrics,
  normalizeUserDashboardMetrics,
} = require("../../src/services/analytics-dashboard");

const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017";
const MONGODB_TEST_DB = `muze_dashboard_integration_${process.pid}_${Date.now()}`;

test.before(async () => {
  await mongoose.connect(MONGODB_TEST_URI, { dbName: MONGODB_TEST_DB });
  await User.init();
}, { timeout: 120000 });

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("dashboard aggregation matches legacy list calculation without hydrating users", async () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const users = [
    {
      userId: 1,
      createdAt: new Date("2026-06-10T10:00:00Z"),
      profileName: "One",
      onboardingCompletedAt: now,
      savedProfileCodes: ["u_TWO"],
      starBalance: 5,
      aiLists: {
        movies: {
          topTen: Array.from({ length: 10 }, (_, index) => ({ title: `Movie ${index}` })),
          watchlist: [{ title: "Later" }],
        },
      },
      aiTaste: { movies: { labelKey: "cinephile", sampleCount: 10 } },
    },
    {
      userId: 2,
      createdAt: new Date("2026-06-01T10:00:00Z"),
      bannedAt: now,
      activeDiscussionId: new mongoose.Types.ObjectId(),
      onboardingSkippedAt: now,
      starBalance: 2,
      aiTopTenMusic: ["Metallica", "Slayer", "Megadeth"],
      aiWatchlistMusic: ["Tool", "Pantera"],
      aiTaste: { music: { labelKey: "metalhead", sampleCount: 3 } },
    },
    {
      userId: 3,
      createdAt: new Date("2026-06-05T10:00:00Z"),
      aiLists: { books: { topTen: [], watchlist: [] } },
      aiTopTenBooks: ["Legacy Book"],
    },
  ];
  await User.insertMany(users);

  const rawUsers = await User.find({}).lean();
  const rows = await User.aggregate(buildUserDashboardAggregation({
    since24h: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    since7d: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    fullListSize: 10,
  }));
  const result = normalizeUserDashboardMetrics(rows);

  assert.deepEqual(result.lists, buildUserListMetrics(rawUsers));
  assert.deepEqual(result.users, {
    total: 3,
    new24h: 1,
    new7d: 2,
    onboardingCompleted: 1,
    onboardingSkipped: 1,
    namedProfiles: 1,
    banned: 1,
    activeDiscussionUsers: 1,
    savedProfileUsers: 1,
  });
  assert.equal(result.outstandingStars, 7);
});
