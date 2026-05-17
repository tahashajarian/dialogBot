const { setUserLang } = require("./services/users");

const SUPPORTED_LANGS = ["fa", "en"];

function normalizeLang(code) {
  if (!code) return null;

  const lower = String(code).toLowerCase();

  if (lower.startsWith("fa")) return "fa";
  if (lower.startsWith("en")) return "en";

  return null;
}

function detectLanguage(ctx) {
  // 1. زبان ذخیره شده
  if (ctx.user?.lang && SUPPORTED_LANGS.includes(ctx.user.lang)) {
    return ctx.user.lang;
  }

  // 2. زبان پلتفرم (تلگرام)
  const detected = normalizeLang(ctx.languageCode);

  if (detected) return detected;

  // 3. fallback
  return "fa";
}

async function setLanguage(userId, lang) {
  const normalized = normalizeLang(lang);

  if (!normalized) return false;

  await setUserLang(userId, normalized);

  return true;
}

module.exports = {
  detectLanguage,
  setLanguage,
  normalizeLang,
  SUPPORTED_LANGS
};
