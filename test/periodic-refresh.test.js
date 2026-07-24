const test = require("node:test");
const assert = require("node:assert/strict");

const { createPeriodicRefresh } = require("../src/services/periodic-refresh");

test("periodic refresh starts once, unrefs its timer, and stops cleanly", () => {
  let scheduled = null;
  let cleared = null;
  let unrefCalls = 0;
  const timer = { unref: () => { unrefCalls += 1; } };
  const loop = createPeriodicRefresh({
    name: "test settings",
    refresh: async () => {},
    intervalMs: 1234,
    setIntervalFn: (callback, intervalMs) => {
      scheduled = { callback, intervalMs };
      return timer;
    },
    clearIntervalFn: (value) => { cleared = value; },
  });

  loop.start();
  loop.start();
  assert.equal(scheduled.intervalMs, 1234);
  assert.equal(unrefCalls, 1);
  assert.deepEqual(loop.getState(), { running: false, started: true, stopped: false });
  loop.stop();
  assert.equal(cleared, timer);
  assert.deepEqual(loop.getState(), { running: false, started: false, stopped: true });
});

test("periodic refresh prevents overlapping database refreshes", async () => {
  let release;
  let calls = 0;
  const loop = createPeriodicRefresh({
    name: "test settings",
    refresh: async () => {
      calls += 1;
      await new Promise((resolve) => { release = resolve; });
    },
  });

  const first = loop.run();
  const overlapping = await loop.run();
  assert.equal(overlapping, false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
});

test("periodic refresh keeps cached values when a refresh fails", async () => {
  const loop = createPeriodicRefresh({
    name: "test settings",
    refresh: async () => { throw new Error("database unavailable"); },
  });

  assert.equal(await loop.run(), false);
  assert.deepEqual(loop.getState(), { running: false, started: false, stopped: false });
});
