const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createRuntimeMetricsMonitor,
  createStageTimings,
} = require("../src/services/performance-metrics");

test("stage timings accumulate durations without changing operation results", async () => {
  const times = [100, 115, 200, 207];
  const timings = createStageTimings(() => times.shift());

  assert.equal(await timings.measure("database", async () => "ok"), "ok");
  await assert.rejects(timings.measure("database", async () => {
    throw new Error("failed");
  }), /failed/);

  assert.deepEqual(timings.snapshot(), { database: 22 });
});

test("runtime monitor reports event-loop lag and memory in megabytes", () => {
  const times = [1000, 1612];
  const monitor = createRuntimeMetricsMonitor({
    now: () => times.shift(),
    intervalMs: 500,
    memoryUsage: () => ({
      rss: 80 * 1024 * 1024,
      heapUsed: 25 * 1024 * 1024,
      heapTotal: 40 * 1024 * 1024,
    }),
  });

  monitor.sample(500);

  assert.deepEqual(monitor.snapshot(), {
    eventLoopLagMs: 112,
    rssMb: 80,
    heapUsedMb: 25,
    heapTotalMb: 40,
  });
});
