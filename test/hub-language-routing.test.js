const test = require("node:test");
const assert = require("node:assert/strict");
const { callBacks } = require("../src/constants");
const { isHubCallback } = require("../src/flows/hub-callbacks");
const { isLanguageCallback } = require("../src/flows/language-callbacks");

test("hub routing recognizes only hub entry and guide actions", () => {
  assert.equal(isHubCallback(callBacks.menuMain), true);
  assert.equal(isHubCallback(callBacks.helpReferral), true);
  assert.equal(isHubCallback(callBacks.aiAssistant), true);
  assert.equal(isHubCallback(callBacks.discussionOpen), false);
});

test("language routing owns picker, close, and validated set attempts", () => {
  assert.equal(isLanguageCallback(callBacks.language), true);
  assert.equal(isLanguageCallback(callBacks.languageClose), true);
  assert.equal(isLanguageCallback(`${callBacks.langSet}fa`), true);
  assert.equal(isLanguageCallback(callBacks.profile), false);
});
