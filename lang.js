const { getUser, saveUser } = require("./storage");

const SUPPORTED_LANGS = ["fa", "en"];

function normalizeLang(code) {
  if (!code) return null;
  const lower = String(code).toLowerCase();

  if (lower.startsWith("fa")) return "fa";
  if (lower.startsWith("en")) return "en";

  return null;
}

function detectLanguage(ctx) {
  const stored = getUser(ctx.userId);
  if (stored?.lang && SUPPORTED_LANGS.includes(stored.lang)) {
    return stored.lang;
  }

  const detected = normalizeLang(ctx.languageCode);
  if (detected) return detected;

  return "fa";
}

function setLanguage(userId, lang) {
  const normalized = normalizeLang(lang);
  if (!normalized) return false;

  saveUser(userId, { lang: normalized });
  return true;
}

module.exports = {
  detectLanguage,
  setLanguage,
  normalizeLang,
  SUPPORTED_LANGS,
};
