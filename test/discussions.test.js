const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePublicProfileCode,
  validateJoinRulePayload,
  DISCUSSION_MEMBER_CAP,
  USER_DISCUSSION_MEMBERSHIP_CAP,
  DISCUSSION_RECENT_MESSAGES_CAP,
} = require("../src/services/discussions");

test("discussion caps match MVP defaults", () => {
  assert.equal(DISCUSSION_MEMBER_CAP, 20);
  assert.equal(USER_DISCUSSION_MEMBERSHIP_CAP, 10);
  assert.equal(DISCUSSION_RECENT_MESSAGES_CAP, 10);
});

test("normalizePublicProfileCode normalizes and validates codes", () => {
  assert.equal(normalizePublicProfileCode("u_ab12"), "u_AB12");
  assert.equal(normalizePublicProfileCode("/u_ab12"), "u_AB12");
  assert.equal(normalizePublicProfileCode("  /u_A-1_2  "), "u_A12");
  assert.equal(normalizePublicProfileCode("abc"), "");
  assert.equal(normalizePublicProfileCode(""), "");
});

test("validateJoinRulePayload accepts open rule", () => {
  const result = validateJoinRulePayload({ type: "open" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.joinRule, { type: "open" });
});

test("validateJoinRulePayload validates restricted rules", () => {
  const topTen = validateJoinRulePayload({ type: "top_ten_completed", section: "movies" });
  assert.equal(topTen.ok, true);
  assert.equal(topTen.joinRule.type, "top_ten_completed");

  const taste = validateJoinRulePayload({ type: "taste_label", section: "music", tasteLabelKey: "metalhead" });
  assert.equal(taste.ok, true);
  assert.equal(taste.joinRule.tasteLabelKey, "metalhead");

  const item = validateJoinRulePayload({ type: "top_ten_item", section: "books", itemTitle: "  Dune " });
  assert.equal(item.ok, true);
  assert.equal(item.joinRule.itemTitle, "Dune");
});

test("validateJoinRulePayload rejects invalid payloads", () => {
  assert.equal(validateJoinRulePayload({ type: "weird" }).ok, false);
  assert.equal(validateJoinRulePayload({ type: "top_ten_completed", section: "games" }).ok, false);
  assert.equal(validateJoinRulePayload({ type: "taste_label", section: "music" }).ok, false);
  assert.equal(validateJoinRulePayload({ type: "top_ten_item", section: "books", itemTitle: "   " }).ok, false);
});
