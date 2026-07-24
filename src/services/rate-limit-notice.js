const NOTICE_COOLDOWN_MS = 3000;
const noticeTimes = new Map();

function claimRateLimitNotice(userId, now = Date.now()) {
  const key = String(userId || "unknown");
  const previous = noticeTimes.get(key);
  if (previous !== undefined && now - previous < NOTICE_COOLDOWN_MS) return false;
  noticeTimes.set(key, now);
  if (noticeTimes.size > 10_000) {
    for (const [entryKey, timestamp] of noticeTimes) {
      if (now - timestamp >= NOTICE_COOLDOWN_MS) noticeTimes.delete(entryKey);
    }
  }
  return true;
}

function resolveLanguage(ctx) {
  const code = String(
    ctx?.from?.language_code
    || ctx?.from?.languageCode
    || ctx?.message?.from?.language_code
    || ctx?.callbackQuery?.from?.language_code
    || "",
  ).toLowerCase();
  return code.startsWith("en") ? "en" : "fa";
}

async function sendRateLimitNotice(ctx, {
  userId,
  messages,
  formatText = (value) => value,
  claim = claimRateLimitNotice,
} = {}) {
  if (!claim(userId)) return false;
  const lang = resolveLanguage(ctx);
  const text = formatText(messages[lang].tooManyRequests, lang);
  if (ctx?.callbackQuery && typeof ctx.answerCbQuery === "function") {
    try {
      await ctx.answerCbQuery(text, { show_alert: true });
      return true;
    } catch {
      // Fall through to one plain message without reply markup.
    }
  }
  if (typeof ctx?.reply !== "function") return false;
  await ctx.reply(text);
  return true;
}

module.exports = {
  NOTICE_COOLDOWN_MS,
  claimRateLimitNotice,
  resolveLanguage,
  sendRateLimitNotice,
};
