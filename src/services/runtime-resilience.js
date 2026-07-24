const mongoose = require("mongoose");

const OUTAGE_NOTICE_COOLDOWN_MS = 30_000;
const outageNoticeTimes = new Map();

function isDatabaseReady(connection = mongoose.connection) {
  return connection?.readyState === 1;
}

function isTransientDatabaseError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "").toLowerCase();
  return [
    "MongoNetworkError",
    "MongoServerSelectionError",
    "MongooseServerSelectionError",
    "MongoNotConnectedError",
    "MongoPoolClearedError",
  ].includes(name) || [
    "server selection",
    "not connected",
    "connection pool",
    "topology was destroyed",
    "connection timed out",
  ].some((part) => message.includes(part));
}

function createOutageNoticeGuard({
  cooldownMs = OUTAGE_NOTICE_COOLDOWN_MS,
  now = () => Date.now(),
} = {}) {
  const times = new Map();
  return {
    claim(userId) {
      const key = String(userId || "unknown");
      const timestamp = now();
      const previous = times.get(key);
      if (previous !== undefined && timestamp - previous < cooldownMs) return false;
      times.set(key, timestamp);
      return true;
    },
    clear(userId) {
      times.delete(String(userId || "unknown"));
    },
  };
}

function claimGlobalOutageNotice(userId, now = Date.now()) {
  const key = String(userId || "unknown");
  const previous = outageNoticeTimes.get(key);
  if (previous !== undefined && now - previous < OUTAGE_NOTICE_COOLDOWN_MS) return false;
  outageNoticeTimes.set(key, now);
  if (outageNoticeTimes.size > 10_000) {
    for (const [entryKey, timestamp] of outageNoticeTimes) {
      if (now - timestamp >= OUTAGE_NOTICE_COOLDOWN_MS) outageNoticeTimes.delete(entryKey);
    }
  }
  return true;
}

function resolveOutageLanguage(ctx, user) {
  if (user?.lang === "en" || user?.lang === "fa") return user.lang;
  const platformLanguage = String(
    ctx?.from?.language_code ||
    ctx?.from?.languageCode ||
    ctx?.message?.from?.language_code ||
    "",
  ).toLowerCase();
  return platformLanguage.startsWith("en") ? "en" : "fa";
}

async function sendTemporaryUnavailableNotice(ctx, {
  user = null,
  messages,
  formatText = (value) => value,
  claim = claimGlobalOutageNotice,
} = {}) {
  const userId = user?.userId || ctx?.from?.id || ctx?.message?.from?.id || ctx?.callbackQuery?.from?.id;
  if (!claim(userId)) return false;
  const lang = resolveOutageLanguage(ctx, user);
  const text = formatText(messages[lang].serviceTemporarilyUnavailable, lang);
  if (ctx?.callbackQuery && typeof ctx.answerCbQuery === "function") {
    try {
      await ctx.answerCbQuery(text, { show_alert: true });
      return true;
    } catch {
      // Fall through to one ordinary, non-destructive message.
    }
  }
  if (typeof ctx?.reply !== "function") return false;
  await ctx.reply(text);
  return true;
}

function withTimeout(promise, timeoutMs, label = "operation") {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => clearTimeout(timeoutId));
}

async function retryWithJitter(fn, {
  attempts = 4,
  delayMs = 1500,
  jitterMs = 500,
  random = Math.random,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onRetry = () => {},
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const nextDelayMs = (delayMs * attempt) + Math.floor(random() * Math.max(0, jitterMs));
      onRetry(error, attempt, attempts, nextDelayMs);
      await wait(nextDelayMs);
    }
  }
  throw lastError;
}

module.exports = {
  OUTAGE_NOTICE_COOLDOWN_MS,
  claimGlobalOutageNotice,
  createOutageNoticeGuard,
  isDatabaseReady,
  isTransientDatabaseError,
  retryWithJitter,
  resolveOutageLanguage,
  sendTemporaryUnavailableNotice,
  withTimeout,
};
