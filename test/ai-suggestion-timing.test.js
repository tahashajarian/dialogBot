const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_SUGGESTION_MAX_WAIT_MS,
  AI_SUGGESTION_PROGRESS_INTERVAL_MS,
  AI_SUGGESTION_STEP_DELAYS_MS,
  getAiSuggestionTimeoutMs,
} = require("../src/services/ai-suggestion-timing");

test("suggestion progress dots advance every three seconds", () => {
  assert.equal(AI_SUGGESTION_PROGRESS_INTERVAL_MS, 3000);
  assert.deepEqual(AI_SUGGESTION_STEP_DELAYS_MS, [3000, 6000]);
});

test("suggestion workflows never keep the user waiting beyond 25 seconds", () => {
  assert.equal(AI_SUGGESTION_MAX_WAIT_MS, 25000);
  assert.equal(getAiSuggestionTimeoutMs("books", { timeoutMs: 20000 }), 23000);
  assert.equal(getAiSuggestionTimeoutMs("movies", { timeoutMs: 20000 }), 25000);
  assert.equal(getAiSuggestionTimeoutMs("music", { timeoutMs: 20000 }), 25000);
  assert.equal(getAiSuggestionTimeoutMs("books", { timeoutMs: 60000 }), 25000);
});
