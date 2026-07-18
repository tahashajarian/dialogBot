const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const LATIN_DIGITS = "0123456789";
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

// These tokens must retain Latin digits because changing them can break links,
// Telegram commands, public codes, or addresses.
const MACHINE_TOKEN_PATTERN = /https?:\/\/[^\s<]+|\b(?:t\.me|telegram\.me|bale\.ai)\/[^\s<]+|\/[a-z][a-z0-9_@-]*|\b(?:u_|d_|ref_)[a-z0-9]+\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|<[^>]+>/giu;

function normalizeDigit(character, lang) {
  const latinIndex = LATIN_DIGITS.indexOf(character);
  const persianIndex = PERSIAN_DIGITS.indexOf(character);
  const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(character);
  const index = Math.max(latinIndex, persianIndex, arabicIndex);
  if (index < 0) return character;
  return lang === "fa" ? PERSIAN_DIGITS[index] : LATIN_DIGITS[index];
}

function localizeDigitSegment(value, lang) {
  return String(value).replace(/[0-9۰-۹٠-٩]/g, (digit) => normalizeDigit(digit, lang));
}

function localizeVisibleDigits(value, lang = "en") {
  if (typeof value !== "string" || !value) return value;
  const normalizedLang = lang === "fa" ? "fa" : "en";
  let result = "";
  let cursor = 0;

  for (const match of value.matchAll(MACHINE_TOKEN_PATTERN)) {
    const index = Number(match.index) || 0;
    result += localizeDigitSegment(value.slice(cursor, index), normalizedLang);
    result += match[0];
    cursor = index + match[0].length;
  }

  return result + localizeDigitSegment(value.slice(cursor), normalizedLang);
}

function localizeButton(button, lang) {
  if (!button || typeof button !== "object") return button;
  const localized = { ...button };
  if (typeof localized.text === "string") {
    localized.text = localizeVisibleDigits(localized.text, lang);
  }
  if (localized.copy_text && typeof localized.copy_text === "object") {
    localized.copy_text = {
      ...localized.copy_text,
      text: localizeVisibleDigits(localized.copy_text.text, lang),
    };
  }
  return localized;
}

function localizeOutgoingExtra(extra, lang) {
  if (!extra || typeof extra !== "object") return extra;
  const localized = { ...extra };
  if (typeof localized.caption === "string") {
    localized.caption = localizeVisibleDigits(localized.caption, lang);
  }
  if (localized.reply_markup && typeof localized.reply_markup === "object") {
    const replyMarkup = { ...localized.reply_markup };
    if (Array.isArray(replyMarkup.keyboard)) {
      replyMarkup.keyboard = replyMarkup.keyboard.map((row) => row.map((button) => localizeButton(button, lang)));
    }
    if (Array.isArray(replyMarkup.inline_keyboard)) {
      replyMarkup.inline_keyboard = replyMarkup.inline_keyboard.map((row) => row.map((button) => localizeButton(button, lang)));
    }
    localized.reply_markup = replyMarkup;
  }
  return localized;
}

module.exports = {
  localizeOutgoingExtra,
  localizeVisibleDigits,
};
