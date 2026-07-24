require("dotenv").config();

const mongoose = require("mongoose");

const User = require("../src/models/user");
const {
  buildUserDashboardAggregation,
  buildUserListMetrics,
  normalizeUserDashboardMetrics,
} = require("../src/services/analytics-dashboard");

function numberArg(argv, name, fallback) {
  const prefix = `--${name}=`;
  const value = Number(argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function item(title) {
  return { title, comment: "", watched: false };
}

function benchmarkUser(index, now) {
  const topTen = Array.from({ length: 10 }, (_, itemIndex) => item(`Movie ${index}-${itemIndex}`));
  const watchlist = Array.from({ length: 10 }, (_, itemIndex) => item(`Later ${index}-${itemIndex}`));
  return {
    userId: -800000000 - index,
    profileName: `Dashboard Benchmark ${index}`,
    createdAt: new Date(now.getTime() - ((index % 10) * 24 * 60 * 60 * 1000)),
    starBalance: index % 50,
    savedProfileCodes: index % 3 === 0 ? [`u_BENCH${index}`] : [],
    aiLists: {
      movies: { topTen, watchlist },
      music: { topTen, watchlist },
      books: { topTen, watchlist },
      random: { topTen, watchlist },
    },
    aiTaste: {
      movies: { labelKey: "cinephile", sampleCount: 10 },
      music: { labelKey: "metalhead", sampleCount: 10 },
      books: { labelKey: "bookworm", sampleCount: 10 },
    },
  };
}

async function timed(load) {
  const startedAt = process.hrtime.bigint();
  const value = await load();
  return {
    value,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
  };
}

async function main(argv = process.argv.slice(2)) {
  const uri = process.env.LOAD_TEST_MONGO_URI;
  const dbName = process.env.LOAD_TEST_DB_NAME || "muze_dashboard_loadtest";
  const users = numberArg(argv, "users", 10000);
  if (!uri) throw new Error("Set LOAD_TEST_MONGO_URI to an isolated MongoDB instance.");
  if (!/load[-_]?test/i.test(dbName)) throw new Error("LOAD_TEST_DB_NAME must contain 'loadtest' or 'load-test'.");

  await mongoose.connect(uri, { dbName });
  try {
    await mongoose.connection.dropDatabase();
    const now = new Date();
    for (let start = 0; start < users; start += 500) {
      const batch = Array.from({ length: Math.min(500, users - start) }, (_, offset) => (
        benchmarkUser(start + offset, now)
      ));
      await User.insertMany(batch, { ordered: false });
    }

    const legacy = await timed(async () => {
      const documents = await User.find({}).select("aiLists aiTaste").lean();
      return {
        metrics: buildUserListMetrics(documents),
        payloadBytes: Buffer.byteLength(JSON.stringify(documents)),
      };
    });
    const aggregate = await timed(async () => {
      const rows = await User.aggregate(buildUserDashboardAggregation({
        since24h: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        since7d: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        fullListSize: 10,
      }));
      return {
        metrics: normalizeUserDashboardMetrics(rows),
        payloadBytes: Buffer.byteLength(JSON.stringify(rows)),
      };
    });
    const output = {
      users,
      legacy: {
        durationMs: Number(legacy.durationMs.toFixed(1)),
        payloadMb: Number((legacy.value.payloadBytes / 1024 / 1024).toFixed(1)),
      },
      aggregate: {
        durationMs: Number(aggregate.durationMs.toFixed(1)),
        payloadKb: Number((aggregate.value.payloadBytes / 1024).toFixed(1)),
      },
      listMetricsEquivalent: JSON.stringify(legacy.value.metrics) === JSON.stringify(aggregate.value.metrics.lists),
    };
    console.log(JSON.stringify(output, null, 2));
    if (!output.listMetricsEquivalent) throw new Error("Aggregation results differ from legacy metrics.");
  } finally {
    await mongoose.connection.dropDatabase();
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

module.exports = { benchmarkUser, numberArg };
