const test = require("node:test");
const assert = require("node:assert/strict");
const { callBacks } = require("../src/constants");
const {
  TELEGRAM_CALLBACK_DATA_MAX_BYTES,
  getAiSuggestionCallbackSection,
  normalizeCallbackRouteLabel,
  parseCallbackData,
  parseDiscussionClosePayload,
} = require("../src/services/callback-contracts");

test("callback contracts expose recognized domains and Telegram byte limits", () => {
  const parsed = parseCallbackData(`${callBacks.discussionOpen}d_AB12`);
  assert.equal(parsed.domain, "discussion");
  assert.equal(parsed.recognizedDomain, true);
  assert.equal(parsed.withinTelegramLimit, true);
  assert.equal(parseCallbackData("").withinTelegramLimit, false);
  assert.equal(parseCallbackData("x".repeat(TELEGRAM_CALLBACK_DATA_MAX_BYTES + 1)).withinTelegramLimit, false);
});

test("callback route labels preserve operational metric grouping", () => {
  assert.equal(normalizeCallbackRouteLabel(""), "callback:unknown");
  assert.equal(normalizeCallbackRouteLabel("lang:set:fa"), "callback:lang:set");
  assert.equal(
    normalizeCallbackRouteLabel("discussion:create:set:capacity:20"),
    "callback:discussion:create:set:capacity",
  );
  assert.equal(
    normalizeCallbackRouteLabel("ai:section:suggest:menu:music"),
    "callback:ai:section:suggest:menu",
  );
});

test("discussion close payload accepts only supported return destinations", () => {
  assert.deepEqual(parseDiscussionClosePayload("room-id:mine"), { discussionId: "room-id", source: "mine" });
  assert.deepEqual(parseDiscussionClosePayload("room-id:active"), { discussionId: "room-id", source: "active" });
  assert.deepEqual(parseDiscussionClosePayload("room-id:unsafe"), { discussionId: "room-id", source: "room" });
});

test("AI suggestion callback sections are allowlisted", () => {
  assert.equal(getAiSuggestionCallbackSection(`${callBacks.aiSectionSuggestMenu}music`), "music");
  assert.equal(getAiSuggestionCallbackSection(`${callBacks.aiSectionSuggestMenu}unknown`), "");
  assert.equal(getAiSuggestionCallbackSection("profile:edit:name"), "");
});
