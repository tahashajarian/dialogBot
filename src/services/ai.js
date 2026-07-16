const { getAiConfig } = require("../config");
const { logger } = require("./logger");
const {
  DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS,
  extractAiResponseText,
  getClient,
  requestSuggestionText,
} = require("./ai-client");
const {
  DEFAULT_INTEREST_SUGGESTION_FALLBACK,
  INTEREST_SUGGESTION_FALLBACKS,
} = require("./ai-suggestion-data");
const {
  createSuggestionHelpers,
  getSingleSuggestionDetailInstruction,
  isSuggestionUncertainResponse,
} = require("./ai-suggestion-quality");
const {
  limitWords,
  normalizeSuggestionText,
  tokenizeSuggestionSignals,
} = require("./ai-suggestion-utils");

const aiConfig = getAiConfig();
const MAX_INPUT_CHARS = 180;
function normalizeInput(text) {
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, MAX_INPUT_CHARS);
}

function getModeInstruction(mode, lang) {
  const language = lang === "fa" ? "Persian" : "English";

  if (mode === "movies") {
    return `Subject is movies. Reply in ${language}. Keep it short and useful.`;
  }

  if (mode === "music") {
    return `Subject is music. Reply in ${language}. Keep it short and useful.`;
  }

  if (mode === "books") {
    return `Subject is books. Reply in ${language}. Keep it short and useful.`;
  }

  return `Subject is other interests such as games, chess, travel, food, sports, hobbies, and lifestyle. Reply in ${language}. Keep it short and useful.`;
}

const {
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  getSuggestionRealityIssue,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
} = createSuggestionHelpers({
  limitWords: (text, maxWords) => limitWords(text, maxWords || 12),
  normalizeCacheItem: normalizeSuggestionText,
  tokenizeSignalWords: tokenizeSuggestionSignals,
});

function buildUserContext({
  personalized,
  topTenItems = [],
  watchlistItems = [],
  recentSuggestionItems = [],
  rejectedSuggestionItems = [],
}) {
  if (!personalized) {
    return "";
  }

  const compactList = (items) => items.length ? items.join(" | ") : "None";
  return [
    `Favorites: ${compactList(topTenItems)}`,
    `Saved for later: ${compactList(watchlistItems)}`,
    `Recent suggestions: ${compactList(recentSuggestionItems)}`,
    `Rejected suggestions: ${compactList(rejectedSuggestionItems)}`,
  ].join("\n");
}

function buildTasteStyleInstruction(tasteStyleHint, lang) {
  const cleanHint = String(tasteStyleHint || "").trim();
  if (!cleanHint) {
    return "";
  }

  if (lang === "fa") {
    return `لحن پاسخ را نزدیک به این سلیقه نگه دار: ${cleanHint}.`;
  }

  return `Match tone and references to this taste style: ${cleanHint}.`;
}

function buildInterestSuggestionFallback({ lang, topTenItems = [] }) {
  const normalized = topTenItems.map((item) => normalizeSuggestionText(item));
  const matched = INTEREST_SUGGESTION_FALLBACKS.find((entry) => (
    entry.keywords.some((keyword) => normalized.some((item) => item.includes(normalizeSuggestionText(keyword))))
  ));
  const fallback = matched || DEFAULT_INTEREST_SUGGESTION_FALLBACK;
  const [title, reason] = lang === "fa" ? fallback.fa : fallback.en;
  return { ok: true, title, reason, text: `${title}\n${reason}`, fallback: true };
}

async function getAiSingleSuggestion({
  mode,
  lang,
  userText,
  topTenItems = [],
  watchlistItems = [],
  recentSuggestionItems = [],
  rejectedSuggestionItems = [],
  personalized = false,
  tasteStyleHint = "",
}) {
  const input = normalizeInput(userText);
  if (!input) {
    return { ok: false, reason: "empty_input" };
  }

  const openai = getClient(aiConfig);
  if (!openai) {
    return { ok: false, reason: "missing_key" };
  }

  try {
    const instructions = [
      "Recommend exactly one real, established, widely known item.",
      "Use exactly 2 short plain-text lines: requested item name and metadata; then a reason of at most 12 words.",
      "Be factually certain: never invent, approximate, translate, or complete titles, creators, years, tools, channels, or resources.",
      "Prefer certainty over novelty or a perfect taste match. If unsure, reply exactly UNSURE.",
      "Make the reason friendly, natural, specific, and conversational—not funny, poetic, exaggerated, or canned.",
      "Address the user informally; in Persian use تو/سلیقه‌ات, never شما/سلیقه‌تان.",
      getSingleSuggestionDetailInstruction(mode),
      "No numbering, no markdown, no emojis.",
      personalized
        ? "Base the recommendation on specific overlaps with the user's top 10. Avoid repeating top 10, watchlist, recently suggested items, or rejected/not-for-me suggestions."
        : "",
      buildTasteStyleInstruction(tasteStyleHint, lang),
      getModeInstruction(mode, lang),
    ].join(" ");
    const request = await requestSuggestionText(openai, {
      config: aiConfig,
      maxOutputTokens: DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS,
      instructions,
      input: `Request: ${input}\n${buildUserContext({
        personalized,
        topTenItems,
        watchlistItems,
        recentSuggestionItems,
        rejectedSuggestionItems,
      })}`,
    });
    const rawText = request.text;
    if (!rawText) {
      if (mode === "random" && topTenItems.length) {
        return buildInterestSuggestionFallback({ lang, topTenItems });
      }
      logger.warn("AI suggestion providers returned no text", {
        errors: request.errors || [],
        model: aiConfig.model,
        provider: aiConfig.suggestionProvider,
        timeoutMs: aiConfig.timeoutMs,
      });
      return { ok: false, reason: "empty_output" };
    }

    if (isSuggestionUncertainResponse(rawText)) {
      return { ok: false, reason: "uncertain_suggestion" };
    }

    const parsed = parseSingleSuggestionResponse(rawText, lang);
    if (!parsed.title) {
      if (mode === "random" && topTenItems.length) {
        return buildInterestSuggestionFallback({ lang, topTenItems });
      }
      return { ok: false, reason: "invalid_output" };
    }
    const realityIssue = getSuggestionRealityIssue({
      mode,
      title: parsed.title,
      reason: parsed.reason,
    });
    if (realityIssue) {
      return { ok: false, reason: "unverified_suggestion", qualityIssue: realityIssue };
    }
    if (mode === "random") {
      const qualityIssue = getInterestSuggestionQualityIssue({
        title: parsed.title,
        reason: parsed.reason,
        topTenItems,
        recentSuggestionItems,
      });
      if (qualityIssue) {
        return { ok: false, reason: "low_quality_interest", qualityIssue };
      }
    }

    return {
      ok: true,
      title: parsed.title,
      reason: parsed.reason,
      text: `${parsed.title}\n${parsed.reason}`.trim(),
    };
  } catch (error) {
    logger.warn("AI single suggestion failed", error);
    if (mode === "random" && topTenItems.length) {
      return buildInterestSuggestionFallback({ lang, topTenItems });
    }
    return { ok: false, reason: "api_error" };
  }
}

module.exports = {
  getAiSingleSuggestion,
  buildInterestSuggestionFallback,
  extractAiResponseText,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  getSuggestionRealityIssue,
  isSuggestionUncertainResponse,
};
