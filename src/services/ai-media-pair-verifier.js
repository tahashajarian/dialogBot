const { getAiConfig } = require("../config");
const { getClient, requestSuggestionText } = require("./ai-client");
const { logger } = require("./logger");
const { extractSuggestionCreator } = require("./ai-suggestion-quality");

function normalizeVerdict(value) {
  const verdict = String(value || "").trim().toUpperCase();
  if (verdict === "VALID") return "valid";
  if (verdict === "INVALID") return "invalid";
  return "uncertain";
}

async function verifyAiMediaPair({
  userId,
  section,
  title,
  metadata,
  requireCertain = false,
  timeoutMs = null,
}, {
  config = getAiConfig(),
  requestText = requestSuggestionText,
  client,
} = {}) {
  if (!new Set(["movies", "music"]).has(section)) {
    return { ok: true, verdict: "not_needed" };
  }

  const creator = extractSuggestionCreator(metadata);
  if (!String(title || "").trim() || !creator) {
    return { ok: false, verdict: "invalid", reason: "missing_title_creator" };
  }

  const requestedTimeoutMs = Number(timeoutMs);
  const hasRequestedTimeout = timeoutMs !== null
    && timeoutMs !== undefined
    && Number.isFinite(requestedTimeoutMs)
    && requestedTimeoutMs > 0;
  const effectiveConfig = hasRequestedTimeout
    ? {
        ...config,
        timeoutMs: Math.max(1000, Math.min(Number(config?.timeoutMs) || requestedTimeoutMs, requestedTimeoutMs)),
      }
    : config;
  const openai = client || getClient(effectiveConfig);
  if (!openai) return { ok: true, verdict: "unavailable" };

  try {
    const kind = section === "movies" ? "movie or series" : "released song";
    const result = await requestText(openai, {
      userId,
      config: effectiveConfig,
      operation: "suggestion_pair_check",
      maxOutputTokens: 6,
      instructions: [
        `Check only whether this exact ${kind} title and creator are a real matching pair.`,
        section === "music" ? "Treat a title used by a different artist as INVALID. Do not infer a likely song from similar words or from the artist style." : "",
        "Reply with exactly VALID only when you confidently know this exact pair exists; otherwise reply INVALID or UNSURE.",
        "Do not add, correct, translate, or invent any metadata.",
      ].join(" "),
      input: `Title: ${String(title).trim()}\nCreator: ${creator}`,
    });
    const verdict = normalizeVerdict(result.text);
    if (verdict === "invalid" || (requireCertain && verdict !== "valid")) {
      return { ok: false, verdict, reason: verdict === "invalid" ? "invalid_title_creator_pair" : "uncertain_title_creator_pair" };
    }
    return { ok: true, verdict };
  } catch (error) {
    logger.warn("AI media pair check failed open", {
      section,
      error: error?.message || String(error),
    });
    return requireCertain
      ? { ok: false, verdict: "unavailable", reason: "pair_check_unavailable" }
      : { ok: true, verdict: "unavailable" };
  }
}

module.exports = {
  normalizeVerdict,
  verifyAiMediaPair,
};
