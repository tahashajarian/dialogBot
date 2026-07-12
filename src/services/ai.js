const {
  createAiResponseCache,
  getAiResponseCacheStats,
  normalizeCategory,
} = require("./ai-response-cache");
const { getAiConfig } = require("../config");
const { isLowQualityAiListItem } = require("./ai-input-quality");
const { logger } = require("./logger");
const { recordAiApiEvent } = require("./operational-health");
const {
  DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS,
  extractAiResponseText,
  getClient,
  getEmbedding,
  requestSuggestionText,
  withAiTimeout,
} = require("./ai-client");
const {
  DEFAULT_INTEREST_SUGGESTION_FALLBACK,
  INTEREST_SUGGESTION_FALLBACKS,
  PREDEFINED_TASTE_FEEDBACK,
} = require("./ai-feedback-data");
const {
  createSuggestionHelpers,
  getSingleSuggestionDetailInstruction,
} = require("./ai-suggestion-quality");
const {
  buildTasteFeedbackFallbackWithItem,
  buildUnknownItemFeedback,
  createFeedbackQualityHelpers,
  limitWords,
  normalizeCacheItem,
  sanitizeTasteFeedback,
} = require("./ai-feedback-quality");

const aiConfig = getAiConfig();
const MAX_INPUT_CHARS = 180;
const FEEDBACK_MAX_OUTPUT_TOKENS = 48;
const FEEDBACK_MAX_WORDS = 12;
const FEEDBACK_CACHE_PURPOSE = "taste_item_feedback_v6";

let aiFeedbackResponseCache = null;

function normalizeInput(text) {
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, MAX_INPUT_CHARS);
}

function getAiFeedbackResponseCache() {
  if (!aiFeedbackResponseCache) {
    aiFeedbackResponseCache = createAiResponseCache();
  }
  return aiFeedbackResponseCache;
}

function getPredefinedTasteFeedback({ section, item, lang }) {
  const sectionFeedback = PREDEFINED_TASTE_FEEDBACK[section];
  if (!sectionFeedback) return "";

  const normalizedItem = normalizeCacheItem(item);
  const response = sectionFeedback[normalizedItem];
  if (!response) return "";

  return response[lang] || response.fa || response.en || "";
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
  isEncyclopedicTasteFeedback,
  isFeedbackRelevantToItem,
  isGenericTasteFeedback,
  tokenizeSignalWords,
} = createFeedbackQualityHelpers({
  maxWords: FEEDBACK_MAX_WORDS,
});
const {
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  getSuggestionRealityIssue,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
} = createSuggestionHelpers({
  limitWords: (text, maxWords) => limitWords(text, maxWords || FEEDBACK_MAX_WORDS),
  normalizeCacheItem,
  tokenizeSignalWords,
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

  const topTen = topTenItems.length
    ? topTenItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "None";
  const watchlist = watchlistItems.length
    ? watchlistItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "None";
  const recentSuggestions = recentSuggestionItems.length
    ? recentSuggestionItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "None";
  const rejectedSuggestions = rejectedSuggestionItems.length
    ? rejectedSuggestionItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "None";

  return `\nUser top 10:\n${topTen}\n\nUser watchlist:\n${watchlist}\n\nRecently suggested:\n${recentSuggestions}\n\nUser rejected / not-for-me suggestions:\n${rejectedSuggestions}`;
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
  const normalized = topTenItems.map((item) => normalizeCacheItem(item));
  const matched = INTEREST_SUGGESTION_FALLBACKS.find((entry) => (
    entry.keywords.some((keyword) => normalized.some((item) => item.includes(normalizeCacheItem(keyword))))
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
      "You are a Bale chat assistant.",
      "Recommend exactly one item only.",
      "Reply in exactly 2 short lines in plain text.",
      "Line 1: item name (include metadata in name as requested).",
      "Line 2: very short why only (max 12 words).",
      "Recommend only real, existing works/resources. If unsure, choose a widely known real item instead.",
      "Never invent titles, artists, authors, directors, years, tools, channels, or resources.",
      "Do not use placeholder metadata like unknown artist, unknown author, or fictional title.",
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
      input: `Subject: ${mode}\nUser message: ${input}${buildUserContext({
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

async function getAiTasteItemFeedback({
  mode,
  lang,
  item,
  labelKey = "",
  labelTitle = "",
}) {
  const section = String(mode || "").trim();
  const normalizedItem = normalizeInput(item);
  if (!section || !normalizedItem) {
    return { ok: false, reason: "empty_input" };
  }

  if (isLowQualityAiListItem(normalizedItem)) {
    return {
      ok: true,
      text: buildUnknownItemFeedback({ lang, item: normalizedItem }),
      cached: true,
      matchType: "unknown_input",
      normalizedInput: normalizeCacheItem(normalizedItem),
    };
  }

  const predefinedFeedback = getPredefinedTasteFeedback({
    section,
    item: normalizedItem,
    lang,
  });
  if (predefinedFeedback) {
    return {
      ok: true,
      text: predefinedFeedback,
      cached: true,
      matchType: "predefined",
      normalizedInput: normalizeCacheItem(normalizedItem),
    };
  }

  const openai = getClient(aiConfig);
  const language = lang === "fa" ? "Persian" : "English";
  const category = normalizeCategory(section);

  return getAiFeedbackResponseCache().getOrCreate({
    originalInput: normalizedItem,
    category,
    purpose: FEEDBACK_CACHE_PURPOSE,
    lang,
    metadata: {
      section,
      labelKey,
      labelTitle,
      model: aiConfig.model,
      embeddingModel: aiConfig.embeddingModel,
    },
    generateEmbedding: openai
      ? (input) => getEmbedding(openai, input, { config: aiConfig, log: logger })
      : null,
    generateResponse: async () => {
      if (!openai) {
        return {
          ok: true,
          text: buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item: normalizedItem }),
          fallback: true,
        };
      }

      try {
        const startedAt = Date.now();
        const response = await withAiTimeout(
          openai.responses.create({
            model: aiConfig.model,
            max_output_tokens: FEEDBACK_MAX_OUTPUT_TOKENS,
            instructions: [
              "You react naturally to what someone shared, but ONLY if you actually recognize it.",
              `Respond only in ${language}.`,
              "CRITICAL: If you don't clearly recognize this specific work/item, you MUST say so honestly. Never pretend or guess.",
              "For recognized items: react like a witty friend who genuinely knows it.",
              "Write one short, warm, playful line. Gentle teasing, excitement, or light exaggeration is welcome.",
              "Ground the joke or reaction in one concrete vibe, scene quality, style, joke, sound, theme, or feeling tied to the item.",
              "Prefer lines like 'The Office? Secondhand embarrassment is your hobby too!' over a review or formal compliment.",
              "Do not define, introduce, or summarize the item as if writing an encyclopedia entry.",
              "For unrecognized items: be direct and honest—say you don't know it. Don't invent details or fake recognition.",
              "Never say generic praise like 'sounds interesting', 'seems special', 'looks good' for items you don't actually know.",
              `Use 6 to ${FEEDBACK_MAX_WORDS} words whenever natural; never exceed ${FEEDBACK_MAX_WORDS}.`,
              "For recognized items, mention at least one word from the title.",
              "For unrecognized items, just admit it clearly.",
              "Do not ask for another item.",
              "Do not invent creators, facts, entities, or characters.",
              "Plain text only; at most one relevant emoji.",
            ].join(" "),
            input: `Section: ${section}\nItem: ${normalizedItem}\nDetected label: ${labelTitle || labelKey || "eclectic"}`,
          }),
          "ai_feedback_timeout",
          aiConfig.timeoutMs,
        );
        void recordAiApiEvent({
          ok: true,
          operation: "taste_feedback",
          provider: "responses",
          durationMs: Date.now() - startedAt,
        });

        const generated = sanitizeTasteFeedback(
          (response.output_text || "").trim(),
          lang,
          FEEDBACK_MAX_WORDS,
        );
        const text = (
          generated &&
          isFeedbackRelevantToItem(generated, normalizedItem) &&
          !isGenericTasteFeedback(generated, lang) &&
          !isEncyclopedicTasteFeedback(generated, lang)
        )
          ? generated
          : buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item: normalizedItem });

        return { ok: true, text };
      } catch (error) {
        const message = error?.message || String(error);
        void recordAiApiEvent({
          ok: false,
          operation: "taste_feedback",
          provider: "responses",
          reason: message,
        });
        if (message === "ai_feedback_timeout") {
          logger.info("AI taste feedback fallback", { reason: message });
        } else {
          logger.warn("AI taste feedback failed", { error: message });
        }
        return {
          ok: true,
          text: buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item: normalizedItem }),
          fallback: true,
        };
      }
    },
  });
}

module.exports = {
  getAiSingleSuggestion,
  getAiTasteItemFeedback,
  getAiFeedbackCacheStats: getAiResponseCacheStats,
  isEncyclopedicTasteFeedback,
  isFeedbackRelevantToItem,
  isGenericTasteFeedback,
  buildTasteFeedbackFallbackWithItem,
  buildInterestSuggestionFallback,
  extractAiResponseText,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  getSuggestionRealityIssue,
  sanitizeTasteFeedback,
};
