const TITLE_STOPWORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with",
  "از", "با", "به", "برای", "تا", "در", "را", "و",
]);

function normalizeSuggestionText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function tokenizeSuggestionSignals(text) {
  return normalizeSuggestionText(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => (/^[a-z0-9]+$/i.test(token) ? token.length >= 3 : token.length >= 2))
    .filter((token) => !TITLE_STOPWORDS.has(token));
}

function limitWords(text, maxWords) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}

module.exports = {
  limitWords,
  normalizeSuggestionText,
  tokenizeSuggestionSignals,
};
