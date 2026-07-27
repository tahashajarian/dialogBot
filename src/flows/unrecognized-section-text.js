const messages = require("../messages");
const { MODES } = require("../services/reply-keyboard-navigation");

function shouldGuideToBottomButtons(ctx, text, state) {
  if (!text || text.startsWith("/") || state !== "idle" || ctx.user?.activeDiscussionId) return false;
  const mode = String(ctx.user?.navigationMode || "");
  return Boolean(mode && mode !== MODES.GLOBAL);
}

async function handleUnrecognizedSectionText(ctx, lang, text, state) {
  if (!shouldGuideToBottomButtons(ctx, text, state)) return false;
  await ctx.reply(messages[lang].sectionTextUseBottomButtons);
  return true;
}

module.exports = { handleUnrecognizedSectionText, shouldGuideToBottomButtons };
