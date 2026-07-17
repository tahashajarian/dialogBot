const test = require("node:test");
const assert = require("node:assert/strict");

const { parseArgs } = require("../scripts/repair-taste-index");

test("taste-index repair defaults to bounded dry-run mode", () => {
  assert.deepEqual(parseArgs([]), {
    apply: false,
    maxUsers: 1000,
    batchSize: 200,
    concurrency: 5,
    staleHours: 24,
  });
});

test("taste-index repair requires apply and normalizes numeric limits", () => {
  assert.deepEqual(parseArgs([
    "--apply",
    "--max-users=50",
    "--batch-size=10",
    "--concurrency=2",
    "--stale-hours=48",
  ]), {
    apply: true,
    maxUsers: 50,
    batchSize: 10,
    concurrency: 2,
    staleHours: 48,
  });
});
