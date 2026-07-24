const messages = require("../messages");
const { helpInlineKeyboard } = require("../keyboards");
const { formatInlineListCaptureGuide } = require("../services/inline-list-capture-ui");

function buildGuideText(ctx, lang) {
  const inlineCaptureGuide = formatInlineListCaptureGuide(ctx, lang);
  return messages[lang].helpText.replace(
    "\n\n{inlineCaptureGuide}",
    inlineCaptureGuide ? `\n\n${inlineCaptureGuide}` : "",
  );
}

async function sendGuideHub(ctx, lang) {
  const text = buildGuideText(ctx, lang);
  const keyboard = helpInlineKeyboard(lang);
  return ctx.reply(text, keyboard);
}

async function restoreGuideHubCard(ctx, lang) {
  const text = buildGuideText(ctx, lang);
  const keyboard = helpInlineKeyboard(lang);
  const messageId = Number(ctx.callbackMessageId);
  if (Number.isInteger(messageId) && messageId > 0 && ctx.editMessageText) {
    const edited = await ctx.editMessageText(messageId, text, keyboard);
    if (edited) return edited;
  }
  return ctx.reply(text, keyboard);
}

module.exports = {
  buildGuideText,
  restoreGuideHubCard,
  sendGuideHub,
};
