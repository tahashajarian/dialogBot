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

function normalizePersianDisplayValue(value, maxLength = 80) {
  const normalized = String(value || "")
    .trim()
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^["'«»“”]+|["'«»“”]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
  if (
    !normalized
    || /^UNSURE[.!]?$/i.test(normalized)
    || !/[\u0600-\u06ff]/u.test(normalized)
    || /[a-z]/i.test(normalized)
  ) return "";
  return normalized;
}

function normalizeResolvedPersianTitle(value) {
  return normalizePersianDisplayValue(value, 80);
}

function normalizeResolvedPersianCreator(value) {
  return normalizePersianDisplayValue(value, 100);
}

function parseResolvedPersianDisplay(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(text);
    return {
      localizedTitle: normalizeResolvedPersianTitle(parsed?.localizedTitle || parsed?.title),
      localizedCreator: normalizeResolvedPersianCreator(parsed?.localizedCreator || parsed?.creator || parsed?.author),
    };
  } catch {
    // Backward-compatible parsing for older/plain-title test responses.
    return {
      localizedTitle: normalizeResolvedPersianTitle(text),
      localizedCreator: "",
    };
  }
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
  return entry.value;
}

function writeCache(key, value) {
  const hasValue = Boolean(value?.localizedTitle || value?.localizedCreator);
  cache.delete(key);
  cache.set(key, {
    value,
    expiresAt: Date.now() + (hasValue ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

async function resolvePersianBookDisplay({
  userId,
  title,
  metadata = "",
  requestTimeoutMs = null,
}, {
  config = getAiConfig(),
  requestText = requestSuggestionText,
  client,
} = {}) {
  const originalTitle = String(title || "").trim();
  const author = extractSuggestionCreator(metadata);
  if (!originalTitle || !author) return { localizedTitle: "", localizedCreator: "" };
  const key = getCacheKey(originalTitle, author);
  const cached = readCache(key);
  if (cached !== undefined) return cached;

  const requestConfig = Number.isFinite(Number(requestTimeoutMs)) && Number(requestTimeoutMs) > 0
    ? { ...config, timeoutMs: Math.max(1000, Number(requestTimeoutMs)) }
    : config;
  const openai = client === undefined ? getClient(requestConfig) : client;
  if (!openai) return { localizedTitle: "", localizedCreator: "" };
  try {
    const response = await requestText(openai, {
      userId,
      config: requestConfig,
      maxOutputTokens: 40,
      instructions: [
        "Identify the established Persian publication title and the standard Persian-script author name of this already verified real book.",
        "Return only valid compact JSON with string fields localizedTitle and localizedCreator.",
        "Use the title known in Persian publishing, not a new literal translation.",
        "Use the conventional Persian spelling of the author's name, not Latin transliteration.",
        "If either value is not highly confident, use an empty string for that field. Never guess.",
      ].join(" "),
      input: `Original title: ${originalTitle}\nAuthor: ${author}`,
    });
    const resolved = parseResolvedPersianDisplay(response?.text);
    writeCache(key, resolved);
    return resolved;
  } catch (error) {
    logger.warn("Persian book display resolution failed", {
      name: error?.name || "Error",
    });
    return { localizedTitle: "", localizedCreator: "" };
  }
}

async function resolvePersianBookTitle(args, dependencies) {
  const resolved = await resolvePersianBookDisplay(args, dependencies);
  return resolved.localizedTitle;
}

function clearPersianBookTitleCache() {
  cache.clear();
}

module.exports = {
  clearPersianBookTitleCache,
  normalizeResolvedPersianCreator,
  normalizeResolvedPersianTitle,
  parseResolvedPersianDisplay,
  resolvePersianBookDisplay,
  resolvePersianBookTitle,
};
