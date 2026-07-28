const messages = require("../messages");

function shouldGuideToBottomButtons(ctx, text, state) {
  if (!text || text.startsWith("/") || state !== "idle" || ctx.user?.activeDiscussionId) return false;
  const mode = String(ctx.user?.navigationMode || "");
  return Boolean(mode);
}

async function handleUnrecognizedSectionText(ctx, lang, text, state) {
  if (!shouldGuideToBottomButtons(ctx, text, state)) return false;
  await ctx.reply(messages[lang].sectionTextUseBottomButtons);
  return true;
}

module.exports = { handleUnrecognizedSectionText, shouldGuideToBottomButtons };
