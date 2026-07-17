require("dotenv").config();

const mongoose = require("mongoose");

const User = require("../src/models/user");
const UserTasteIndex = require("../src/models/user-taste-index");
const { findPeopleBySharedTaste } = require("../src/services/people-discovery");
const { invalidateTasteIndexReadinessCache } = require("../src/services/user-taste-index");

const BENCHMARK_USER_ID_START = -700000000;
const SECTIONS = ["movies", "music", "books", "random"];
const CATALOG_SIZE = 250;

function numberArg(argv, name, fallback) {
  const prefix = `--${name}=`;
  const value = Number(argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    p50: Number(percentile(sorted, 0.5).toFixed(1)),
    p95: Number(percentile(sorted, 0.95).toFixed(1)),
    p99: Number(percentile(sorted, 0.99).toFixed(1)),
    max: Number((sorted.at(-1) || 0).toFixed(1)),
  };
}

function sectionItems(section, cluster, offset) {
  return [
    `${section}-${cluster}-shared-1`,
    `${section}-${cluster}-shared-2`,
    `${section}-${cluster}-shared-3`,
    ...Array.from({ length: 3 }, (_, index) => (
      `${section}-${cluster}-${(offset + index) % CATALOG_SIZE}`
    )),
  ];
}

function asAiItems(items) {
  return items.map((title) => ({ title, comment: "", watched: false }));
}

function buildBenchmarkUser(index) {
  const userId = BENCHMARK_USER_ID_START - index;
  const cluster = index % 20;
  const sections = Object.fromEntries(SECTIONS.map((section, sectionIndex) => [
    section,
    sectionItems(section, cluster, (index * 3) + sectionIndex),
  ]));
  return {
    user: {
      userId,
      firstName: `Benchmark ${index}`,
      profileName: `Benchmark ${index}`,
      publicProfileCode: `u_BENCH${String(index).padStart(7, "0")}`,
      bannedAt: null,
      aiLists: Object.fromEntries(SECTIONS.map((section) => [
        section,
        { topTen: asAiItems(sections[section]), watchlist: [] },
      ])),
    },
    indexes: SECTIONS.map((section) => ({
      userId,
      section,
      items: sections[section],
      matchKeys: sections[section],
      itemCount: sections[section].length,
      updatedAt: new Date(),
    })),
  };
}

function benchmarkUserQuery() {
  return {
    userId: { $lte: BENCHMARK_USER_ID_START },
    publicProfileCode: /^u_bench\d+$/i,
  };
}

async function cleanup() {
  const ids = await User.find(benchmarkUserQuery()).distinct("userId");
  await Promise.all([
    User.deleteMany(benchmarkUserQuery()),
    ids.length ? UserTasteIndex.deleteMany({ userId: { $in: ids } }) : null,
  ]);
  invalidateTasteIndexReadinessCache();
}

async function seed(count) {
  const batchSize = 1000;
  for (let start = 0; start < count; start += batchSize) {
    const entries = Array.from(
      { length: Math.min(batchSize, count - start) },
      (_, offset) => buildBenchmarkUser(start + offset),
    );
    await Promise.all([
      User.bulkWrite(entries.map(({ user }) => ({
        updateOne: {
          filter: { userId: user.userId },
          update: { $set: user },
          upsert: true,
        },
      })), { ordered: false }),
      UserTasteIndex.bulkWrite(entries.flatMap(({ indexes }) => indexes.map((entry) => ({
        updateOne: {
          filter: { userId: entry.userId, section: entry.section },
          update: { $set: entry },
          upsert: true,
        },
      }))), { ordered: false }),
    ]);
  }
  invalidateTasteIndexReadinessCache();
}

async function runQueries(viewers, { actions, concurrency, limit }) {
  const latencies = [];
  let nextAction = 0;
  let errors = 0;
  let emptyResults = 0;
  let resultCount = 0;

  async function worker() {
    while (true) {
      const action = nextAction;
      nextAction += 1;
      if (action >= actions) return;
      const startedAt = process.hrtime.bigint();
      try {
        const result = await findPeopleBySharedTaste(viewers[action % viewers.length], { limit });
        resultCount += result.items?.length || 0;
        if (!result.items?.length) emptyResults += 1;
      } catch (_) {
        errors += 1;
      }
      latencies.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
    }
  }

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, actions) }, worker));
  const durationMs = Date.now() - startedAt;
  return {
    actions,
    concurrency,
    throughputPerSecond: Number((actions / Math.max(0.001, durationMs / 1000)).toFixed(1)),
    latencyMs: summarize(latencies),
    errors,
    emptyResults,
    averageResults: Number((resultCount / actions).toFixed(1)),
  };
}

async function main(argv = process.argv.slice(2)) {
  const uri = process.env.LOAD_TEST_MONGO_URI;
  const dbName = process.env.LOAD_TEST_DB_NAME || "muze_loadtest";
  const users = numberArg(argv, "users", 10000);
  const actions = numberArg(argv, "actions", 200);
  const concurrency = numberArg(argv, "concurrency", 20);
  const limit = numberArg(argv, "limit", 200);

  if (!uri) throw new Error("Set LOAD_TEST_MONGO_URI to an isolated MongoDB instance.");
  if (!/load[-_]?test/i.test(dbName)) {
    throw new Error("LOAD_TEST_DB_NAME must contain 'loadtest' or 'load-test'.");
  }

  await mongoose.connect(uri, { dbName, maxPoolSize: Math.max(10, concurrency) });
  try {
    await cleanup();
    await Promise.all([User.createIndexes(), UserTasteIndex.createIndexes()]);
    const seedStartedAt = Date.now();
    await seed(users);
    const viewerEntries = Array.from({ length: Math.min(20, users) }, (_, index) => buildBenchmarkUser(index));
    const viewers = viewerEntries.map(({ user }) => user);

    await runQueries(viewers, { actions: Math.min(20, actions), concurrency: 1, limit });
    const result = await runQueries(viewers, { actions, concurrency, limit });
    const output = {
      dbName,
      users,
      indexRows: await UserTasteIndex.countDocuments({ userId: { $lte: BENCHMARK_USER_ID_START } }),
      seedSeconds: Number(((Date.now() - seedStartedAt) / 1000).toFixed(2)),
      limit,
      ...result,
      thresholds: { p95Ms: 500, maxErrorRatePercent: 1 },
    };
    console.log(JSON.stringify(output, null, 2));

    const errorRate = actions ? (result.errors / actions) * 100 : 0;
    if (result.latencyMs.p95 >= 500 || errorRate >= 1 || result.emptyResults > 0) {
      process.exitCode = 1;
      console.error("FAIL: People discovery missed its initial performance or correctness threshold.");
    } else {
      console.log("PASS: indexed People discovery stayed within the initial thresholds.");
    }
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error?.message || error);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { buildBenchmarkUser, numberArg, percentile, summarize };
