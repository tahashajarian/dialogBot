const { getAiConfig } = require("../config");
const { getClient, requestSuggestionText } = require("./ai-client");
const { logger } = require("./logger");
const { extractSuggestionCreator } = require("./ai-suggestion-quality");

function parseChosenIndex(value, candidateCount) {
  const clean = String(value || "").trim().toUpperCase();
  if (clean === "NONE") return -1;
  const match = clean.match(/^(?:CANDIDATE\s*)?(\d+)$/);
  if (!match) return -1;
  const index = Number(match[1]) - 1;
  return Number.isInteger(index) && index >= 0 && index < candidateCount ? index : -1;
}

async function chooseMostCertainRealMusicCandidate({ userId, candidates = [] }, {
  config = getAiConfig(),
  requestText = requestSuggestionText,
  client,
} = {}) {
  const usable = candidates.slice(0, 6).map((candidate) => ({
    title: String(candidate?.title || "").trim(),
    artist: extractSuggestionCreator(candidate?.metadata || ""),
  })).filter((candidate) => candidate.title && candidate.artist);

  if (!usable.length) return { ok: false, reason: "no_candidates" };

  const openai = client || getClient(config);
  if (!openai) return { ok: false, reason: "chooser_unavailable" };

  try {
    const input = usable
      .map((candidate, index) => `${index + 1}. ${candidate.title} — ${candidate.artist}`)
      .join("\n");
    const result = await requestText(openai, {
      userId,
      config,
      operation: "music_candidate_final_check",
      maxOutputTokens: 8,
      instructions: [
        "Review all candidate song-title and artist pairs together.",
        "Choose exactly one only when you confidently recognize that exact released song by that exact artist as real.",
        "Do not choose a pair merely because the title sounds plausible for the artist.",
        "Do not correct, translate, replace, or invent any title or artist.",
        `Reply with only a number from 1 to ${usable.length}, or NONE when none is confidently real.`,
      ].join(" "),
      input,
    });
    const index = parseChosenIndex(result.text, usable.length);
    return index >= 0
      ? { ok: true, index }
      : { ok: false, reason: "none_confident" };
  } catch (error) {
    logger.warn("Final music candidate comparison failed", {
      error: error?.message || String(error),
    });
    return { ok: false, reason: "chooser_unavailable" };
  }
}

module.exports = {
  chooseMostCertainRealMusicCandidate,
  parseChosenIndex,
};
