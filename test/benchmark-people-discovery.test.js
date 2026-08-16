const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildBenchmarkUser,
  numberArg,
  percentile,
  summarize,
} = require("../scripts/benchmark-people-discovery");

test("People benchmark parses positive numeric arguments", () => {
  assert.equal(numberArg(["--users=2500"], "users", 100), 2500);
  assert.equal(numberArg(["--users=0"], "users", 100), 100);
  assert.equal(numberArg([], "users", 100), 100);
});

test("People benchmark reports deterministic percentiles", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5);
  assert.deepEqual(summarize([1, 2, 3, 4]), { p50: 2, p95: 4, p99: 4, max: 4 });
});

test("People benchmark users have indexed discoverable taste data", () => {
  const entry = buildBenchmarkUser(3);
  assert.equal(entry.indexes.length, 5);
  assert.equal(entry.user.aiLists.movies.topTen.length, 6);
  assert.equal(entry.indexes.every((index) => index.itemCount >= 3), true);
});
