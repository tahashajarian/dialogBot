const test = require("node:test");
const assert = require("node:assert/strict");

const { isDiscussionCreateTextState } = require("../src/flows/discussions-create-text");

test("discussion create text flow recognizes typed create states", () => {
  assert.equal(isDiscussionCreateTextState("discussion_create_title"), true);
  assert.equal(isDiscussionCreateTextState("discussion_create_title_edit"), true);
  assert.equal(isDiscussionCreateTextState("discussion_create_description"), true);
  assert.equal(isDiscussionCreateTextState("discussion_create_description_edit"), true);
  assert.equal(isDiscussionCreateTextState("discussion_create_join_rule"), true);
  assert.equal(isDiscussionCreateTextState("discussion_create_join_rule_edit"), true);
});

test("discussion create text flow ignores non-create states", () => {
  assert.equal(isDiscussionCreateTextState("discussion_close_confirm:abc"), false);
  assert.equal(isDiscussionCreateTextState("ai_chat_movies"), false);
  assert.equal(isDiscussionCreateTextState("idle"), false);
});
