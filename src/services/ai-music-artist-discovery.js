const { getAiConfig } = require("../config");
const { getClient, requestSuggestionText } = require("./ai-client");
const { logger } = require("./logger");

const ARTIST_DISCOVERY_TIMEOUT_MS = 5500;

function parseArtistDiscovery(value, limit = 8) {
  const clean = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(clean);
    const values = Array.isArray(parsed) ? parsed : parsed?.artists;
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
  } catch {
    return [];
  }
}

async function discoverAdjacentMusicArtists({
  userId,
  favorites = [],
  requestText = "",
  recentCreators = [],
  savedCreators = [],
}, {
  config = getAiConfig(),
  requestText: requestTextImpl = requestSuggestionText,
  client,
} = {}) {
  const openai = client || getClient(config);
  if (!openai || !favorites.length) return [];
  const discoveryConfig = {
    ...config,
    timeoutMs: Math.min(ARTIST_DISCOVERY_TIMEOUT_MS, Math.max(1000, Number(config?.timeoutMs) || ARTIST_DISCOVERY_TIMEOUT_MS)),
  };
  try {
    const response = await requestTextImpl(openai, {
      userId,
      config: discoveryConfig,
      operation: "music_adjacent_artist_discovery",
      maxOutputTokens: 100,
      instructions: [
        "Infer the dominant musical cluster from the Favorite track titles and return exactly eight established adjacent performing artists or bands for discovery.",
        "Return each artist in the spelling most likely to be indexed by international music catalogues such as Apple Music and Deezer. For Persian/Iranian artists, normally use their established Latin catalogue spelling rather than Persian script.",
        "Do not return an artist represented by a Favorite, a recent creator, or a saturated saved creator.",
        "Stay close in genre, heaviness, mood, era, instrumentation, and audience; avoid distant novelty, classical, soundtrack, tribute, and karaoke choices.",
        "Honor an explicitly named artist in the current request.",
        "Return only a JSON array of artist-name strings. Never return tracks, explanations, invented artists, or markdown.",
      ].join(" "),
      input: [
        `Request: ${requestText || "None"}`,
        `Favorite tracks: ${favorites.join(" | ")}`,
        `Recent creators: ${recentCreators.join(" | ") || "None"}`,
        `Saturated saved creators: ${savedCreators.join(" | ") || "None"}`,
      ].join("\n"),
    });
    return parseArtistDiscovery(response.text);
  } catch (error) {
    logger.warn("Adjacent music artist discovery failed", { name: error?.name || "Error" });
    return [];
  }
}

module.exports = { discoverAdjacentMusicArtists, parseArtistDiscovery };
