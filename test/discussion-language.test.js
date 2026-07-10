const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDiscussionLanguage,
  normalizeDiscussionLanguageFilter,
  getEffectiveDiscussionLanguageFilter,
} = require("../src/services/discussion-language");

test("discussion language normalization is deterministic", () => {
  assert.equal(normalizeDiscussionLanguage("EN"), "en");
  assert.equal(normalizeDiscussionLanguage("invalid"), "fa");
  assert.equal(normalizeDiscussionLanguageFilter("all"), "all");
  assert.equal(normalizeDiscussionLanguageFilter("invalid"), "");
});

test("effective discussion filter follows interface language until explicit", () => {
  assert.equal(getEffectiveDiscussionLanguageFilter({ lang: "en", discussionLanguageFilter: "" }), "en");
  assert.equal(getEffectiveDiscussionLanguageFilter({ lang: "en", discussionLanguageFilter: "fa" }), "fa");
  assert.equal(getEffectiveDiscussionLanguageFilter({ lang: "fa", discussionLanguageFilter: "all" }), "all");
});
