const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeMetadata } = require("../src/services/analytics-events");

test("analytics metadata keeps only small safe fields", () => {
  assert.deepEqual(
    sanitizeMetadata({
      section: "music",
      count: 4,
      joinRuleType: "taste_label",
      userText: "do not store this",
      title: "do not store item titles",
      reason: "ok",
    }),
    {
      count: 4,
      joinRuleType: "taste_label",
      reason: "ok",
    },
  );
});
