const { getAiConfig } = require("../config");
const { getClient, requestSuggestionText } = require("./ai-client");
const { normalizeCatalogueTitle } = require("./catalogue-normalization");
const { logger } = require("./logger");

const cache = new Map();
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizePersianValue(value, maxLength = 100) {
  const clean = String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean && /[\u0600-\u06ff]/u.test(clean) && !/[A-Za-z]/.test(clean) ? clean : "";
}

function parsePersianMovieDisplay(value) {
  try {
    const parsed = JSON.parse(String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    return {
      localizedTitle: normalizePersianValue(parsed?.localizedTitle || parsed?.title, 80),
      localizedCreator: normalizePersianValue(parsed?.localizedCreator || parsed?.creator || parsed?.director, 100),
    };
  } catch {
    return { localizedTitle: "", localizedCreator: "" };
  }
}

async function resolvePersianMovieDisplay({
  userId,
  title,
  creator,
  requestTimeoutMs = 3000,
}, {
  config = getAiConfig(),
  requestText = requestSuggestionText,
  client,
} = {}) {
  const key = `${normalizeCatalogueTitle(title)}:${normalizeCatalogueTitle(creator)}`;
  const cached = cache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const requestConfig = { ...config, timeoutMs: Math.max(1000, Number(requestTimeoutMs) || 3000) };
  const openai = client === undefined ? getClient(requestConfig) : client;
  if (!openai || !key) return { localizedTitle: "", localizedCreator: "" };
  try {
    const response = await requestText(openai, {
      userId,
      config: requestConfig,
      operation: "persian_movie_display_resolution",
      maxOutputTokens: 40,
      instructions: [
        "Give the established Persian release title and conventional Persian-script creator name for this already Wikidata-verified movie or series.",
        "Return only JSON with string fields localizedTitle and localizedCreator.",
        "Use the title commonly known in Persian, never a new literal translation. Leave uncertain fields empty. Never guess.",
      ].join(" "),
      input: `Original title: ${title}\nCreator: ${creator}`,
    });
    const value = parsePersianMovieDisplay(response.text);
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    logger.warn("Persian movie display resolution failed", { name: error?.name || "Error" });
    return { localizedTitle: "", localizedCreator: "" };
  }
}

module.exports = { parsePersianMovieDisplay, resolvePersianMovieDisplay };
