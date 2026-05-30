const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePublicProfileCode,
  normalizePublicDiscussionCode,
  validateJoinRulePayload,
  validateJoinRules,
  hasLink,
  DISCUSSION_MEMBER_CAP,
  USER_DISCUSSION_MEMBERSHIP_CAP,
  DISCUSSION_RECENT_MESSAGES_CAP,
} = require("../src/services/discussions");
const Discussion = require("../src/models/discussion");

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

test("normalizePublicDiscussionCode normalizes and validates discussion commands", () => {
  assert.equal(normalizePublicDiscussionCode("d_ab12"), "d_AB12");
  assert.equal(normalizePublicDiscussionCode("/d_ab12"), "d_AB12");
  assert.equal(normalizePublicDiscussionCode("u_ab12"), "");
  assert.equal(normalizePublicDiscussionCode(""), "");
});

test("validateJoinRulePayload accepts open rule", () => {
  const result = validateJoinRulePayload({ type: "open" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.joinRule, { type: "open" });
});

test("discussion schema accepts open join rule without section", () => {
  const discussion = new Discussion({
    title: "Open room",
    description: "A public topic",
    publicDiscussionCode: "d_TEST1",
    creatorUserId: 1,
    joinRule: { type: "open" },
  });

  assert.equal(discussion.validateSync(), undefined);
  assert.equal(discussion.replyCount, 0);
  assert.ok(discussion.lastActivityAt instanceof Date);
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

test("discussion title link detector catches common links", () => {
  assert.equal(hasLink("watch this https://example.com"), true);
  assert.equal(hasLink("join t.me/example"), true);
  assert.equal(hasLink("Best riffs ever"), false);
});

test("top ten item join rule tolerates near-duplicate spelling", async () => {
  const user = {
    aiLists: {
      books: {
        topTen: [
          { title: "The Lord of the Rings", comment: "", watched: false },
        ],
      },
    },
  };
  const result = await validateJoinRules({
    user,
    joinRule: { type: "top_ten_item", section: "books", itemTitle: "Lord of Rings" },
  });
  assert.equal(result.ok, true);
});
