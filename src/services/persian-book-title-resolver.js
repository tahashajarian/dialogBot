const { getAiConfig } = require("../config");
const {
  getClient,
  requestSuggestionText,
} = require("./ai-client");
const { normalizeCatalogueTitle } = require("./catalogue-normalization");
const { extractSuggestionCreator } = require("./ai-suggestion-quality");
const { logger } = require("./logger");

const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map();

function normalizeResolvedPersianTitle(value) {
  const title = String(value || "")
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^["'«»“”]+|["'«»“”]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  if (
    !title
    || /^UNSURE[.!]?$/i.test(title)
    || !/[\u0600-\u06ff]/u.test(title)
    || /[a-z]/i.test(title)
  ) return "";
  return title;
}

function getCacheKey(title, author) {
  return `${normalizeCatalogueTitle(title)}:${normalizeCatalogueTitle(author)}`;
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.title;
}

function writeCache(key, title) {
  cache.delete(key);
  cache.set(key, {
    title,
    expiresAt: Date.now() + (title ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

async function resolvePersianBookTitle({
  userId,
  title,
  metadata = "",
}, {
  config = getAiConfig(),
  requestText = requestSuggestionText,
  client,
} = {}) {
  const originalTitle = String(title || "").trim();
  const author = extractSuggestionCreator(metadata);
  if (!originalTitle || !author) return "";
  const key = getCacheKey(originalTitle, author);
  const cached = readCache(key);
  if (cached !== undefined) return cached;

  const openai = client === undefined ? getClient(config) : client;
  if (!openai) return "";
  try {
    const response = await requestText(openai, {
      userId,
      config,
      maxOutputTokens: 40,
      instructions: [
        "Identify the established Persian publication title of this real book.",
        "Return only that Persian title in Persian script, with no author, explanation, quotes, parentheses, transliteration, or punctuation around it.",
        "Use the title known in Persian publishing, not a new literal translation.",
        "If you are not highly confident that an established Persian title exists, reply exactly UNSURE.",
      ].join(" "),
      input: `Original title: ${originalTitle}\nAuthor: ${author}`,
    });
    const resolved = normalizeResolvedPersianTitle(response?.text);
    writeCache(key, resolved);
    return resolved;
  } catch (error) {
    logger.warn("Persian book title resolution failed", {
      name: error?.name || "Error",
    });
    return "";
  }
}

function clearPersianBookTitleCache() {
  cache.clear();
}

module.exports = {
  clearPersianBookTitleCache,
  normalizeResolvedPersianTitle,
  resolvePersianBookTitle,
};
