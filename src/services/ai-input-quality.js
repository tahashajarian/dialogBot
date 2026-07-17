/**
 * AI Input Quality Validator
 * 
 * Detects low-quality user input including:
 * - Placeholders (test, asdf, تست, هیچی)
 * - Keyboard mashing (qwerty, سشبیل)
 * - Repeated characters (aaaa)
 * - Consonant-heavy gibberish
 * - Long single-token Persian text
 * 
 * Used for:
 * - Discussion titles and descriptions
 * - TopTen list items
 * - AI section free-form input
 * 
 * Supports both English and Persian text.
 */

const PLACEHOLDER_INPUTS = new Set([
  "test",
  "testing",
  "example",
  "sample",
  "placeholder",
  "none",
  "nothing",
  "unknown",
  "blah",
  "blah blah",
  "asdf",
  "qwerty",
  "zxcv",
  "lorem",
  "lorem ipsum",
  "تست",
  "آزمایش",
  "نمونه",
  "هیچ",
  "هیچی",
  "نامشخص",
]);

// Persian/Arabic keyboard layout patterns (common mash sequences)
const PERSIAN_KEYBOARD_PATTERNS = [
  /شسیب/,     // shin-seen-ye-be
  /سشبیل/,    // seen-shin-be-ye-lam
  /یبلس/,     // ye-be-lam-seen
  /لایب/,     // lam-alef-ye-be
  /بیشس/,     // be-ye-shin-seen
  /نتام/,     // noon-te-alef-meem
  /متان/,     // meem-te-alef-noon
  /ضثصف/,     // za-se-sad-fe
  /فصثض/,     // fe-sad-se-za
  /شسیتن/,    // shin-seen-ye-te-noon
  /بلاتن/,    // be-lam-alef-te-noon
  /یتبش/,     // ye-te-be-shin
];

function normalizeQualityInput(value) {
  // Remove zero-width and invisible characters that could bypass validation
  const cleaned = String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2060-\u2069]/g, "");

  return cleaned
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAsciiLetters(value) {
  return normalizeQualityInput(value).replace(/[^a-z]/g, "");
}

function getRtlLetterTokens(value) {
  return normalizeQualityInput(value)
    .split(" ")
    .filter((token) => /^[\u0600-\u06FF]+$/.test(token));
}

function hasLongRepeatedRun(value) {
  return /(.)\1{3,}/.test(value);
}

function hasKeyboardSequence(value) {
  return /(asdf|qwer|zxcv|hjkl|dfgh|jkl;?)/i.test(value);
}

function hasPersianKeyboardSequence(value) {
  return PERSIAN_KEYBOARD_PATTERNS.some(pattern => pattern.test(value));
}

function hasLongConsonantRun(value) {
  return /[bcdfghjklmnpqrstvwxz]{6,}/i.test(value);
}

function hasLowVowelRatio(value) {
  const letters = getAsciiLetters(value);
  if (letters.length < 8) return false;
  const vowels = letters.match(/[aeiouy]/g) || [];
  return vowels.length / letters.length < 0.18;
}

function hasSuspiciousAsciiToken(value) {
  const tokens = normalizeQualityInput(value).split(" ").filter(Boolean);
  return tokens.some((token) => {
    if (!/^[a-z0-9]+$/i.test(token)) return false;
    if (token.length >= 6 && !/[aeiouy]/i.test(token)) return true;
    if (token.length >= 8 && hasLowVowelRatio(token)) return true;
    return false;
  });
}

function hasSuspiciousRtlToken(value) {
  return getRtlLetterTokens(value).some((token) => token.length >= 12);
}

function hasSuspiciousRepeatedRtlToken(value) {
  return getRtlLetterTokens(value).some((token) => {
    if (token.length < 12) return false;
    return new Set(token).size / token.length < 0.4;
  });
}

function hasMixedScriptPlaceholder(value) {
  const normalized = normalizeQualityInput(value);
  const tokens = normalized.split(" ").filter(Boolean);
  
  // Check if multiple tokens are placeholders (blocks "test تست")
  const placeholderCount = tokens.filter(token => PLACEHOLDER_INPUTS.has(token)).length;
  return placeholderCount >= 2;
}

function isLowQualityAiListItem(value) {
  const normalized = normalizeQualityInput(value);
  if (!normalized) return true;
  if (PLACEHOLDER_INPUTS.has(normalized)) return true;

  const asciiLetters = getAsciiLetters(normalized);
  if (asciiLetters.length >= 4 && hasLongRepeatedRun(asciiLetters)) return true;
  if (asciiLetters.length >= 5 && hasKeyboardSequence(asciiLetters)) return true;
  if (asciiLetters.length >= 8 && hasLongConsonantRun(asciiLetters)) return true;
  if (hasPersianKeyboardSequence(normalized)) return true;
  if (hasSuspiciousAsciiToken(normalized)) return true;
  if (hasSuspiciousRtlToken(normalized)) return true;
  if (hasMixedScriptPlaceholder(normalized)) return true;

  return false;
}

function isLowQualityProfileName(value) {
  const normalized = normalizeQualityInput(value);
  if (!normalized) return true;
  if (PLACEHOLDER_INPUTS.has(normalized)) return true;

  const asciiLetters = getAsciiLetters(normalized);
  if (asciiLetters.length >= 4 && hasLongRepeatedRun(asciiLetters)) return true;
  if (asciiLetters.length >= 5 && hasKeyboardSequence(asciiLetters)) return true;
  if (asciiLetters.length >= 8 && hasLongConsonantRun(asciiLetters)) return true;
  if (hasPersianKeyboardSequence(normalized)) return true;
  if (hasSuspiciousAsciiToken(normalized)) return true;
  if (hasSuspiciousRepeatedRtlToken(normalized)) return true;
  if (hasMixedScriptPlaceholder(normalized)) return true;

  return false;
}

/**
 * Validate that input meets minimum meaningful length (3+ letters).
 * Used for discussion titles and TopTen items to reject too-short nonsense.
 * Returns { valid: boolean, reason?: string }
 */
function validateMinimumLength(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return { valid: false, reason: "empty" };
  }

  const letters = normalized.match(/\p{L}/gu) || [];
  if (letters.length < 3) {
    return { valid: false, reason: "too_short" };
  }

  return { valid: true };
}

module.exports = {
  normalizeQualityInput,
  isLowQualityAiListItem,
  isLowQualityProfileName,
  validateMinimumLength,
};
