const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");

const { mapWithConcurrency } = require("../src/services/bounded-concurrency");

test("mapWithConcurrency preserves order and respects its worker limit", async () => {
  let active = 0;
  let maxActive = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(1);
    active -= 1;
    return value * 2;
  });

  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(maxActive, 2);
});

test("mapWithConcurrency stops scheduling new work after a mapper failure", async () => {
  const started = [];
  await assert.rejects(
    mapWithConcurrency([1, 2, 3, 4], 1, async (value) => {
      started.push(value);
      if (value === 2) throw new Error("failed");
      return value;
    }),
    /failed/,
  );
  assert.deepEqual(started, [1, 2]);
});
