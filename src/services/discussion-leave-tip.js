const messages = require("../messages");
const {
  hasSectionTipBeenShown,
  markSectionTipShownForContext,
} = require("./users");

const DISCUSSION_LEAVE_RECENT_TIP_KEY = "discussionLeaveRecent";

function buildDiscussionLeaveText(ctx, lang, text) {
  const showTip = !hasSectionTipBeenShown(ctx?.user, DISCUSSION_LEAVE_RECENT_TIP_KEY);
  return {
    showTip,
    text: showTip
      ? `${text}\n\n${messages[lang].discussionLeftRecentTip}`
      : text,
  };
}

async function markDiscussionLeaveTipShown(ctx, showTip) {
  if (!showTip) return null;
  return markSectionTipShownForContext(ctx, DISCUSSION_LEAVE_RECENT_TIP_KEY, new Date());
}

module.exports = {
  DISCUSSION_LEAVE_RECENT_TIP_KEY,
  buildDiscussionLeaveText,
  markDiscussionLeaveTipShown,
};
