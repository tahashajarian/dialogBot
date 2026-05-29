const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { getDiscussionErrorMessage, buildDiscussionPreviewText } = require("../src/services/discussion-ui");

test("discussion callback error mapping returns specific copy", () => {
  assert.equal(
    getDiscussionErrorMessage(messages, "en", "discussion_full"),
    messages.en.discussionErrFull,
  );
  assert.equal(
    getDiscussionErrorMessage(messages, "fa", "requires_top_ten_completed"),
    messages.fa.discussionErrNeedTopTen,
  );
  assert.equal(
    getDiscussionErrorMessage(messages, "en", "not_owner"),
    messages.en.discussionErrNotOwner,
  );
});

test("discussion preview text reflects draft edits", () => {
  const user = {
    discussionDraftTitle: "Best riffs",
    discussionDraftDescription: "Metal only",
    discussionDraftJoinRule: { type: "top_ten_completed", section: "music" },
  };
  const preview = buildDiscussionPreviewText(messages, "en", user);
  assert.match(preview, /Best riffs/);
  assert.match(preview, /Metal only/);
  assert.match(preview, /Completed Top 10 \(music\)/);
});
