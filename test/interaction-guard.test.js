const test = require("node:test");
const assert = require("node:assert/strict");
const { beginInteraction, buildInteractionKey } = require("../src/services/interaction-guard");

test("reply-keyboard duplicate keys survive flow-state transitions", () => {
  const before = buildInteractionKey({ userId: 41, text: "  🔙  Back to list ", state: "ai_manage_movies_top_ten_add_input" });
  const after = buildInteractionKey({ userId: 41, text: "🔙 Back to list", state: "ai_manage_movies_top_ten" });
  assert.equal(before, after);
});

test("rapid duplicate reply-keyboard taps execute once", () => {
  const input = { userId: 424242, text: "🔙 Back to list", state: "first" };
  const first = beginInteraction(input, { cooldownMs: 5000 });
  const inFlight = beginInteraction({ ...input, state: "second" }, { cooldownMs: 5000 });
  assert.equal(first.allowed, true);
  assert.equal(inFlight.allowed, false);
  first.finish();
  const coolingDown = beginInteraction({ ...input, state: "third" }, { cooldownMs: 5000 });
  assert.equal(coolingDown.allowed, false);
});

test("different reply-keyboard actions remain independent", () => {
  const first = beginInteraction({ userId: 434343, text: "Movies", state: "idle" }, { cooldownMs: 5000 });
  const second = beginInteraction({ userId: 434343, text: "Books", state: "idle" }, { cooldownMs: 5000 });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  first.finish();
  second.finish();
});
