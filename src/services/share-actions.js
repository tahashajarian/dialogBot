const COPY_TEXT_LIMIT = 256;

function buildNativeShareUrl({ url = "", text = "" } = {}) {
  const normalizedUrl = String(url || "").trim();
  const normalizedText = String(text || "").trim();
  if (!normalizedUrl) return "";
  return `https://t.me/share/url?url=${encodeURIComponent(normalizedUrl)}&text=${encodeURIComponent(normalizedText)}`;
}

function buildShareActionsKeyboard({
  shareLabel,
  shareUrl,
  copyLabel,
  copyText,
  backLabel,
  backCallback,
} = {}) {
  const rows = [];
  if (shareLabel && shareUrl) rows.push([{ text: shareLabel, url: shareUrl }]);
  const normalizedCopyText = String(copyText || "");
  if (copyLabel && normalizedCopyText && Array.from(normalizedCopyText).length <= COPY_TEXT_LIMIT) {
    rows.push([{ text: copyLabel, copy_text: { text: normalizedCopyText } }]);
  }
  if (backLabel && backCallback) rows.push([{ text: backLabel, callback_data: backCallback }]);
  return { reply_markup: { inline_keyboard: rows } };
}

module.exports = { COPY_TEXT_LIMIT, buildNativeShareUrl, buildShareActionsKeyboard };
