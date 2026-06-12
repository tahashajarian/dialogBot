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

function normalizeQualityInput(value) {
  return String(value || "")
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

function isLowQualityAiListItem(value) {
  const normalized = normalizeQualityInput(value);
  if (!normalized) return true;
  if (PLACEHOLDER_INPUTS.has(normalized)) return true;

  const asciiLetters = getAsciiLetters(normalized);
  if (asciiLetters.length >= 4 && hasLongRepeatedRun(asciiLetters)) return true;
  if (asciiLetters.length >= 5 && hasKeyboardSequence(asciiLetters)) return true;
  if (asciiLetters.length >= 8 && hasLongConsonantRun(asciiLetters)) return true;
  if (hasSuspiciousAsciiToken(normalized)) return true;
  if (hasSuspiciousRtlToken(normalized)) return true;

  return false;
}

module.exports = {
  normalizeQualityInput,
  isLowQualityAiListItem,
};
