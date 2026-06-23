const AppSetting = require("../models/app-setting");
const AppSettingAudit = require("../models/app-setting-audit");

const SETTINGS_KEY = "bot-appearance";
const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_BOT_EMOJI = "👩‍🦳";
const FALLBACK_BOT_EMOJI = DEFAULT_BOT_EMOJI;
const FIXED_RESERVED_EMOJIS = Object.freeze(["⭐", "🔖", "🎙️", "🔙"]);

const botAppearance = {
  botEmoji: DEFAULT_BOT_EMOJI,
};

let cacheExpiresAt = 0;
let refreshPromise = null;
let settingsUpdatedAt = null;

function isLikelyEmoji(value) {
  return /\p{Extended_Pictographic}/u.test(value);
}

function getGraphemes(value) {
  if (typeof Intl?.Segmenter === "function") {
    return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)]
      .map((segment) => segment.segment);
  }
  return Array.from(value);
}

function normalizeBotEmoji(value) {
  const normalized = String(value || "").trim();
  const graphemes = getGraphemes(normalized);
  if (!normalized || normalized.length > 16 || graphemes.length !== 1 || !isLikelyEmoji(normalized)) {
    return FALLBACK_BOT_EMOJI;
  }
  return normalized;
}

function normalizeBotAppearance(values = {}) {
  return {
    botEmoji: normalizeBotEmoji(values.botEmoji),
  };
}

function applyBotAppearance(values) {
  Object.assign(botAppearance, normalizeBotAppearance(values));
  return botAppearance;
}

function getReservedProfileEmojis() {
  return new Set([...FIXED_RESERVED_EMOJIS, botAppearance.botEmoji].filter(Boolean));
}

function formatBotText(text) {
  if (typeof text !== "string" || botAppearance.botEmoji === DEFAULT_BOT_EMOJI) return text;
  return text.replaceAll(DEFAULT_BOT_EMOJI, botAppearance.botEmoji);
}

function formatBotExtra(extra) {
  if (!extra || typeof extra !== "object" || typeof extra.caption !== "string") return extra;
  return { ...extra, caption: formatBotText(extra.caption) };
}

async function refreshBotAppearance({ force = false } = {}) {
  if (!force && Date.now() < cacheExpiresAt) return botAppearance;
  if (refreshPromise) return refreshPromise;
  refreshPromise = AppSetting.findOne({ key: SETTINGS_KEY }).lean()
    .then((setting) => {
      applyBotAppearance(setting?.values || {});
      settingsUpdatedAt = setting?.updatedAt || null;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return botAppearance;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

async function updateBotAppearance(values, { actor = "dashboard" } = {}) {
  const normalized = normalizeBotAppearance(values);
  const existing = await AppSetting.findOne({ key: SETTINGS_KEY }).lean();
  const previousValues = normalizeBotAppearance(existing?.values || {});
  const updatedAt = new Date();
  await AppSetting.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { values: normalized, updatedAt } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  await AppSettingAudit.create({
    key: SETTINGS_KEY,
    actor: String(actor || "dashboard").slice(0, 120),
    previousValues,
    nextValues: normalized,
  });
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  settingsUpdatedAt = updatedAt;
  return { ...applyBotAppearance(normalized) };
}

function getBotAppearanceState() {
  return {
    values: { ...botAppearance },
    updatedAt: settingsUpdatedAt ? new Date(settingsUpdatedAt).toISOString() : null,
    cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
  };
}

module.exports = {
  SETTINGS_KEY,
  DEFAULT_BOT_EMOJI,
  FIXED_RESERVED_EMOJIS,
  botAppearance,
  normalizeBotAppearance,
  getReservedProfileEmojis,
  formatBotText,
  formatBotExtra,
  refreshBotAppearance,
  updateBotAppearance,
  getBotAppearanceState,
};
