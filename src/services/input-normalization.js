const FILLER_PHRASES = [
  "what do you think about",
  "give me feedback about",
  "give feedback about",
  "what is your opinion about",
  "what's your opinion about",
  "tell me about",
  "review of",
  "review",
  "rate",
  "feedback about",
  "thoughts on",
  "opinion on",
];

const FILLER_WORDS = new Set([
  "the",
  "a",
  "an",
  "band",
  "movie",
  "film",
  "song",
  "track",
  "artist",
  "album",
  "music",
  "game",
  "book",
  "please",
  "pls",
]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSeparators(text) {
  return String(text || "")
    .replace(/[‐‑‒–—―]+/g, " ")
    .replace(/[:|/\\]+/g, " ")
    .replace(/\b(by|from)\b/gi, " ");
}

function normalizeAiInput(value) {
  let normalized = normalizeSeparators(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, " ")
    .trim();

  for (const phrase of FILLER_PHRASES) {
    normalized = normalized.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi"), " ");
  }

  normalized = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !FILLER_WORDS.has(token));

  return tokens.join(" ").replace(/\s+/g, " ").trim();
}

function tokenizeNormalizedInput(value) {
  return normalizeAiInput(value).split(" ").filter(Boolean);
}

function isMeaningfulNormalizedInput(value) {
  const tokens = tokenizeNormalizedInput(value);
  if (!tokens.length) return false;
  return tokens.some((token) => token.length >= 3 || /[^\x00-\x7F]/.test(token));
}

module.exports = {
  normalizeAiInput,
  tokenizeNormalizedInput,
  isMeaningfulNormalizedInput,
};
