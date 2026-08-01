const { getAiConfig } = require("../config");
const { getClient, requestSuggestionText } = require("./ai-client");
const { hasPersianScript } = require("./music-display");

const cache = new Map();
const MAX_CACHE_ENTRIES = 500;

function cleanPersian(value, maxLength) {
  const text = String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return text && hasPersianScript(text) && !/[A-Za-z]/.test(text) ? text : "";
}

function parsePersianMusicDisplay(value) {
  try {
    const parsed = JSON.parse(String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    return {
      localizedTitle: cleanPersian(parsed?.localizedTitle, 100),
      localizedArtist: cleanPersian(parsed?.localizedArtist, 100),
    };
  } catch {
    return { localizedTitle: "", localizedArtist: "" };
  }
}

async function resolvePersianMusicDisplay({ userId, title, artist }, {
  config = getAiConfig(),
  client,
  requestText = requestSuggestionText,
} = {}) {
  const key = `${String(title).toLowerCase()}::${String(artist).toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  const requestConfig = { ...config, timeoutMs: Math.min(3000, Math.max(1000, Number(config?.timeoutMs) || 3000)) };
  const openai = client || getClient(requestConfig);
  if (!openai) return { localizedTitle: "", localizedArtist: "" };
  try {
    const response = await requestText(openai, {
      userId,
      config: requestConfig,
      operation: "persian_music_display_resolution",
      maxOutputTokens: 45,
      instructions: [
        "Resolve the established Persian-script display title and artist spelling for this already catalogue-verified Iranian song.",
        "The supplied Latin title may be a romanization. Transliterate it only when the identity is clear; never translate its meaning or choose another song.",
        "Return only JSON with string fields localizedTitle and localizedArtist. Use empty strings when uncertain.",
      ].join(" "),
      input: `Catalogue title: ${title}\nCatalogue artist: ${artist}`,
    });
    const resolved = parsePersianMusicDisplay(response.text);
    cache.set(key, resolved);
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return resolved;
  } catch {
    return { localizedTitle: "", localizedArtist: "" };
  }
}

module.exports = { parsePersianMusicDisplay, resolvePersianMusicDisplay };
