const { MODES, setNavigationMode } = require("./reply-keyboard-navigation");
const { updateProfileField } = require("./users");

function canPersist(ctx) {
  return Boolean(ctx?.user?._id || ctx?.persistNavigationMode);
}

async function rememberDiscussionListReturnMode(ctx, mode = "") {
  const currentMode = String(mode || ctx?.user?.navigationMode || MODES.DISCUSSIONS);
  if (/^discussion_(?:invitations|list|language|join_error):/.test(currentMode)) {
    return String(ctx?.user?.discussionListReturnNavigationMode || "");
  }
  if (ctx?.user) ctx.user.discussionListReturnNavigationMode = currentMode;
  if (canPersist(ctx)) {
    await updateProfileField(ctx.userId, "discussionListReturnNavigationMode", currentMode);
  }
  return currentMode;
}

async function restoreDiscussionListReturnMode(ctx, fallback = MODES.DISCUSSIONS) {
  const returnMode = String(ctx?.user?.discussionListReturnNavigationMode || fallback);
  if (ctx?.user) ctx.user.discussionListReturnNavigationMode = "";
  if (canPersist(ctx)) {
    await updateProfileField(ctx.userId, "discussionListReturnNavigationMode", "");
  }
  await setNavigationMode(ctx, returnMode);
  return returnMode;
}

module.exports = {
  rememberDiscussionListReturnMode,
  restoreDiscussionListReturnMode,
};
