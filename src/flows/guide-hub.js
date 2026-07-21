const messages = require("../messages");
const { helpInlineKeyboard } = require("../keyboards");

async function sendGuideHub(ctx, lang) {
  const text = messages[lang].helpText;
  const keyboard = helpInlineKeyboard(lang);
  return ctx.reply(text, keyboard);
}

async function restoreGuideHubCard(ctx, lang) {
  const text = messages[lang].helpText;
  const keyboard = helpInlineKeyboard(lang);
  const messageId = Number(ctx.callbackMessageId);
  if (Number.isInteger(messageId) && messageId > 0 && ctx.editMessageText) {
    const edited = await ctx.editMessageText(messageId, text, keyboard);
    if (edited) return edited;
  }
  return ctx.reply(text, keyboard);
}

module.exports = {
  restoreGuideHubCard,
  sendGuideHub,
};
