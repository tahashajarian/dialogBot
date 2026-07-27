const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const {
  rememberDiscussionListReturnMode,
  restoreDiscussionListReturnMode,
} = require("../src/services/discussion-list-return");

test("invitation return mode preserves the opening section and is not overwritten by invitation paging", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});
  const ctx = {
    userId: 9,
    persistNavigationMode: true,
    user: { navigationMode: "global", discussionListReturnNavigationMode: "" },
  };

  try {
    await rememberDiscussionListReturnMode(ctx);
    assert.equal(ctx.user.discussionListReturnNavigationMode, "global");

    ctx.user.navigationMode = "discussion_invitations:1:3";
    await rememberDiscussionListReturnMode(ctx);
    assert.equal(ctx.user.discussionListReturnNavigationMode, "global");

    await restoreDiscussionListReturnMode(ctx);
    assert.equal(ctx.user.navigationMode, "global");
    assert.equal(ctx.user.discussionListReturnNavigationMode, "");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
