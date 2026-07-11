require("dotenv").config();

const mongoose = require("mongoose");

function numberArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function main() {
  const uri = process.env.LOAD_TEST_MONGO_URI;
  const dbName = process.env.LOAD_TEST_DB_NAME || "muze_loadtest";
  const users = numberArg("users", 1000);
  const concurrency = numberArg("concurrency", 100);
  const actions = numberArg("actions", users * 5);

  if (!uri) throw new Error("Set LOAD_TEST_MONGO_URI to an isolated MongoDB instance.");
  if (!/load[-_]?test/i.test(dbName)) {
    throw new Error("LOAD_TEST_DB_NAME must contain 'loadtest' or 'load-test'.");
  }

  await mongoose.connect(uri, { dbName, maxPoolSize: Math.max(10, concurrency) });
  const collection = mongoose.connection.collection("load_test_users");
  await collection.deleteMany({ loadTestRun: true });
  await collection.createIndex({ userId: 1 }, { unique: true });

  const latencies = [];
  let nextAction = 0;
  let errors = 0;
  const started = Date.now();
  const cpuStarted = process.cpuUsage();

  async function worker() {
    while (true) {
      const action = nextAction++;
      if (action >= actions) return;
      const actionStarted = process.hrtime.bigint();
      try {
        await collection.findOneAndUpdate(
          { userId: (action % users) + 1 },
          {
            $setOnInsert: { loadTestRun: true, createdAt: new Date() },
            $set: { lastActiveAt: new Date(), state: "idle" },
            $inc: { updateCount: 1 },
          },
          { upsert: true },
        );
      } catch {
        errors += 1;
      }
      latencies.push(Number(process.hrtime.bigint() - actionStarted) / 1e6);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, actions) }, worker));
  const durationMs = Date.now() - started;
  const cpu = process.cpuUsage(cpuStarted);
  latencies.sort((a, b) => a - b);
  const errorRate = actions ? (errors / actions) * 100 : 0;
  const result = {
    users,
    actions,
    concurrency,
    durationSeconds: Number((durationMs / 1000).toFixed(2)),
    throughputPerSecond: Number((actions / (durationMs / 1000)).toFixed(1)),
    latencyMs: {
      p50: Number(percentile(latencies, 0.5).toFixed(1)),
      p95: Number(percentile(latencies, 0.95).toFixed(1)),
      p99: Number(percentile(latencies, 0.99).toFixed(1)),
    },
    errors,
    errorRatePercent: Number(errorRate.toFixed(2)),
    cpuSeconds: Number(((cpu.user + cpu.system) / 1e6).toFixed(2)),
    memoryMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
  };

  await collection.deleteMany({ loadTestRun: true });
  await mongoose.disconnect();
  console.log(JSON.stringify(result, null, 2));

  if (errorRate >= 1 || result.latencyMs.p95 >= 500) {
    process.exitCode = 1;
    console.error("FAIL: expected error rate <1% and database p95 <500ms.");
  } else {
    console.log("PASS: database workload stayed within the initial thresholds.");
  }
}

main().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
