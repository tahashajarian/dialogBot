const messages = require("../messages");
const { resolveBotUsername } = require("./invite-links");

function formatInlineListCaptureText(ctx, lang, key) {
  const username = resolveBotUsername(ctx);
  if (!username) return "";
  return messages[lang][key].replace("{botUsername}", `@${username}`);
}

function formatInlineListCaptureGuide(ctx, lang) {
  const body = formatInlineListCaptureText(ctx, lang, "inlineCaptureGuideText");
  if (!body) return "";
  return `${messages[lang].inlineCaptureGuideTitle}\n${body}`;
}

function formatInlineListCaptureTip(ctx, lang) {
  return formatInlineListCaptureText(ctx, lang, "inlineCaptureListTip");
}

module.exports = {
  formatInlineListCaptureGuide,
  formatInlineListCaptureTip,
};
