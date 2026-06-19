const {
  createAiResponseCache,
  getAiResponseCacheStats,
  normalizeCategory,
} = require("./ai-response-cache");
const { getAiConfig } = require("../config");
const { isLowQualityAiListItem } = require("./ai-input-quality");
const { logger } = require("./logger");
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

const aiConfig = getAiConfig();
const MAX_INPUT_CHARS = 180;
const FEEDBACK_MAX_OUTPUT_TOKENS = 48;
const FEEDBACK_MAX_WORDS = 18;
const FEEDBACK_CACHE_PURPOSE = "taste_item_feedback_v5";
const FEEDBACK_TITLE_STOPWORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with",
  "از", "با", "به", "برای", "تا", "در", "را", "و",
]);

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

function normalizeCacheItem(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function tokenizeSignalWords(text) {
  return normalizeCacheItem(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => {
      const isAscii = /^[a-z0-9]+$/i.test(token);
      return isAscii ? token.length >= 3 : token.length >= 2;
    })
    .filter((token) => !FEEDBACK_TITLE_STOPWORDS.has(token));
}

function isFeedbackRelevantToItem(feedback, item) {
  const feedbackNorm = normalizeCacheItem(feedback);
  if (!feedbackNorm) return false;

  const itemSignals = tokenizeSignalWords(item).slice(0, 6);
  if (!itemSignals.length) return true;

  return itemSignals.some((token) => feedbackNorm.includes(token));
}

function isGenericTasteFeedback(feedback, lang) {
  const normalized = normalizeCacheItem(feedback);
  if (!normalized) return true;

  const patterns = lang === "fa"
    ? [
      /انتخاب(?:ت| شما)?\s+(?:خیلی\s+)?(?:\S+\s*){0,2}(?:است|ه|ایه|ای|بود)?$/,
      /انتخاب (باحال|خوب|عالی|جالب|خاص|فوق العاده)/,
      /عنوان (جالب|خوب|خاص|باحال)/,
      /به نظر (میاد|می رسد|می یاد).*(حس|احساس).*(خوب|خاص|جالب)/,
      /واقعی و جذاب/,
      /حس.*خاص.*داره/,
      /^(وای|عجب|به به)[،!\s]/,
      /سلیقه ات/,
      /نشون می ده/,
      /یعنی (آدم|ذهنت|تو)/,
      /انرژی .* داری/,
    ]
    : [
      /\b(great|good|nice|cool|solid|interesting|unique|excellent|amazing|fantastic) (choice|pick)\b/,
      /\b(sounds|seems|looks) (interesting|special|unique|good)\b/,
      /\bhas a (good|special|unique) (feel|vibe)\b/,
      /\b(choice|pick)[.!]?\s*$/,
      /^(wow|nice|great)[,!\s]/,
      /\byour taste\b/,
      /\bthis says you\b/,
      /\byou (have|like|enjoy|are)\b/,
    ];

  return patterns.some((pattern) => pattern.test(normalized));
}

function isEncyclopedicTasteFeedback(feedback, lang) {
  const normalized = normalizeCacheItem(feedback);
  if (!normalized) return false;

  const patterns = lang === "fa"
    ? [
      /یکی از .*(محبوب|معروف|شناخته شده|برجسته).*(است|ه)/,
      /به (داستان|زندگی|ماجرای|روایت) .* می پردازد/,
      /در مورد .* است/,
      /ژانر .* دارد/,
    ]
    : [
      /\bis one of the (most )?(popular|famous|well known|best known)\b/,
      /\bfollows the (story|life|lives|journey)\b/,
      /\bis about\b/,
      /\bbelongs to the .* genre\b/,
    ];

  return patterns.some((pattern) => pattern.test(normalized));
}

function shortenItemForFeedback(item) {
  const words = String(item || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words.slice(0, 6).join(" ");
}

function limitWords(text, maxWords = FEEDBACK_MAX_WORDS) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ").trim();
}

function sanitizeTasteFeedback(text, lang) {
  let clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const enPatterns = [
    /\b(send|give|drop|show|tell)\b[^.!?]*\bnext\b[^.!?]*[.!?]?/gi,
    /\bnext\b[^.!?]*[.!?]?/gi,
  ];
  const faPatterns = [
    /بعدی[^.!؟\n]*[.!؟]?/gi,
    /مورد بعد[^.!؟\n]*[.!؟]?/gi,
  ];
  const patterns = lang === "fa" ? faPatterns : enPatterns;

  for (const pattern of patterns) {
    clean = clean.replace(pattern, " ").replace(/\s+/g, " ").trim();
  }

  return limitWords(clean, FEEDBACK_MAX_WORDS);
}

function buildTasteFeedbackFallbackWithItem({ lang, item }) {
  const shortItem = shortenItemForFeedback(item);
  if (lang === "fa") {
    return limitWords(`«${shortItem || "این مورد"}» رو ثبت کردم.`, 18);
  }

  return limitWords(`Saved "${shortItem || "that item"}".`, 18);
}

function buildUnknownItemFeedback({ lang, item }) {
  const shortItem = shortenItemForFeedback(item);
  if (lang === "fa") {
    return limitWords(`«${shortItem || "این"}» رو نمی‌شناسم، ولی ثبتش کردم.`, 12);
  }
  return limitWords(`Don't know "${shortItem || "that"}" yet, but saved it.`, 12);
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
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
} = createSuggestionHelpers({
  limitWords,
  normalizeCacheItem,
  tokenizeSignalWords,
});

function buildUserContext({
  personalized,
  topTenItems = [],
  watchlistItems = [],
  recentSuggestionItems = [],
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

  return `\nUser top 10:\n${topTen}\n\nUser watchlist:\n${watchlist}\n\nRecently suggested:\n${recentSuggestions}`;
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
      getSingleSuggestionDetailInstruction(mode),
      "No numbering, no markdown, no emojis.",
      personalized
        ? "Base the recommendation on specific overlaps with the user's top 10. Avoid repeating top 10, watchlist, or recently suggested items."
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
      })}`,
    });
    const rawText = request.text;
    if (!rawText) {
      if (mode === "random" && topTenItems.length) {
        return buildInterestSuggestionFallback({ lang, topTenItems });
      }
      logger.warn("AI suggestion providers returned no text", { errors: request.errors || [] });
      return { ok: false, reason: "empty_output" };
    }

    const parsed = parseSingleSuggestionResponse(rawText, lang);
    if (!parsed.title) {
      if (mode === "random" && topTenItems.length) {
        return buildInterestSuggestionFallback({ lang, topTenItems });
      }
      return { ok: false, reason: "invalid_output" };
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
        const response = await withAiTimeout(
          openai.responses.create({
            model: aiConfig.model,
            max_output_tokens: FEEDBACK_MAX_OUTPUT_TOKENS,
            instructions: [
              "You react naturally to what someone shared, but ONLY if you actually recognize it.",
              `Respond only in ${language}.`,
              "CRITICAL: If you don't clearly recognize this specific work/item, you MUST say so honestly. Never pretend or guess.",
              "For recognized items: sound like a quick human reaction, not a database summary.",
              "Mention one concrete vibe, scene quality, style, joke, sound, theme, or feeling tied to the item.",
              "Prefer lines like 'The Office is painfully awkward in the funniest way' over 'The Office is a popular comedy about office workers'.",
              "Do not define, introduce, or summarize the item as if writing an encyclopedia entry.",
              "For unrecognized items: be direct and honest—say you don't know it. Don't invent details or fake recognition.",
              "Never say generic praise like 'sounds interesting', 'seems special', 'looks good' for items you don't actually know.",
              `Max ${FEEDBACK_MAX_WORDS} words.`,
              "For recognized items, mention at least one word from the title.",
              "For unrecognized items, just admit it clearly.",
              "Do not ask for another item.",
              "Do not invent creators, facts, entities, or characters.",
              "Use plain text only.",
            ].join(" "),
            input: `Section: ${section}\nItem: ${normalizedItem}\nDetected label: ${labelTitle || labelKey || "eclectic"}`,
          }),
          "ai_feedback_timeout",
          aiConfig.timeoutMs,
        );

        const generated = sanitizeTasteFeedback((response.output_text || "").trim(), lang);
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
  sanitizeTasteFeedback,
};
