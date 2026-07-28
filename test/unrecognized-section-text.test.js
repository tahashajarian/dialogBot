const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  shouldGuideToBottomButtons,
  handleUnrecognizedSectionText,
} = require("../src/flows/unrecognized-section-text");

function user(overrides = {}) {
  return {
    state: "idle",
    navigationMode: "global",
    activeDiscussionId: null,
    ...overrides,
  };
}

test("idle menu sections share concise button guidance", async () => {
  for (const navigationMode of ["global", "profile", "people", "discussions"]) {
    const replies = [];
    const ctx = {
      user: user({ navigationMode }),
      reply: async (message) => replies.push(message),
    };
    assert.equal(await handleUnrecognizedSectionText(ctx, "fa", "چه خبر؟", "idle"), true);
    assert.deepEqual(replies, [messages.fa.sectionTextUseBottomButtons]);
  }
});

test("button guidance does not intercept commands, input flows, or active discussions", () => {
  assert.equal(shouldGuideToBottomButtons({ user: user() }, "/start", "idle"), false);
  assert.equal(
    shouldGuideToBottomButtons({ user: user({ state: "editing_bio" }) }, "متن", "editing_bio"),
    false
  );
  assert.equal(
    shouldGuideToBottomButtons({ user: user({ navigationMode: "discussions", activeDiscussionId: "d1" }) }, "سلام", "idle"),
    false
  );
});
