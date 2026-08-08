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
  getMediaSuggestionQualityIssue,
  getSingleSuggestionDetailInstruction,
  getSuggestionCreatorIssue,
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
    return [
      "Subject is movies and TV/streaming series.",
      "Recommend the movies or series that best fit the Favorites and current request.",
      "Infer national cinema, language, genre, themes, mood, pacing, and style directly from the strongest repeated patterns in Favorites.",
      "Stay inside those strongest repeated patterns unless the current request explicitly asks for something different.",
      `Reply in ${language}. Keep it short and useful.`,
    ].join(" ");
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

function normalizeContextItem(value) {
  return String(value || "")
    .trim()
    .replace(/^[0-9۰-۹٠-٩]+[.)،:-]\s*/u, "")
    .replace(/\s+/g, " ");
}

function buildUserContext({
  personalized,
  topTenItems = [],
  watchlistItems = [],
  recentSuggestionItems = [],
  rejectedSuggestionItems = [],
  likedSuggestionItems = [],
  recentSuggestionCreators = [],
}) {
  if (!personalized) {
    return "";
  }

  const compactList = (items) => {
    const normalized = items.map(normalizeContextItem).filter(Boolean);
    return normalized.length ? normalized.join(" | ") : "None";
  };
  const exclusions = [
    ...watchlistItems,
    ...recentSuggestionItems,
    ...rejectedSuggestionItems,
    ...likedSuggestionItems,
  ];
  return [
    `Favorites: ${compactList(topTenItems)}`,
    `Hard exclusions — do not infer taste from these and never suggest the same work under another language, translation, transliteration, spelling, edition, or localized title: ${compactList(exclusions)}`,
    `Recently suggested creators: ${compactList(recentSuggestionCreators)}`,
  ].join("\n");
}

function getPersonalizedSuggestionInstruction() {
  return [
    "Use Favorites as the only evidence of the user's taste. Base recommendation relevance only on specific overlaps with those Favorites and the current request.",
    "Favorites may be works or creators such as directors, authors, artists, or bands.",
    "Treat a favorite creator as a taste signal for discovery, not as a request for that creator's most famous works.",
    "If a Favorite is a creator, recommend an established adjacent work by a different creator that shares specific style, themes, atmosphere, or structure.",
    "Do not recommend a work by a favorite creator unless the user's current request explicitly asks for that creator; this rule also applies when that creator's works appear in liked-and-already-consumed items.",
    "Never describe a work as similar or close to a person, and never use a creator's name as the target of a comparison. Describe the concrete shared qualities instead.",
    "Saved-for-later, recent, liked, and rejected items are exclusions only. Never infer taste from them.",
    "Treat the saved-for-later list as a hard exclusion list: never recommend the same work under another language, translation, transliteration, spelling, edition, or localized title.",
    "Avoid repeating favorites, saved-for-later, liked-and-consumed, recently suggested, or rejected items.",
  ].join(" ");
}

function getSuggestionReasonInstruction(lang) {
  return [
    "Write the reason so it works as a standalone saved comment about the suggested work itself.",
    "Do not name or quote any item or creator from the user's Favorites in the reason. Express the connection only through the suggestion's concrete qualities, themes, mood, style, or structure.",
    "Never mention the user, their taste, their list, favorites, or that the suggestion matches them. Avoid phrases such as 'fits your taste', 'matches your list', «با سلیقه‌ات جوره», or «با فهرستت هماهنگه».",
    lang === "fa"
      ? "In Persian, prefer a compact, natural, verb-free two-part phrase: specific qualities, then «؛», then two fitting adjectives. Example: «فضای اخلاقی خاکستری و تعلیق فلسفی؛ عمیق و ماندگار.» Keep it a useful standalone comment, not a slogan. Never begin with «برای» followed by favorites, and never use «درمی‌آید», «می‌گیردت», or «از کار درآمده»."
      : "",
  ].filter(Boolean).join(" ");
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

function parseSuggestionBatch(rawText) {
  const clean = String(rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(clean.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function validateSuggestionCandidate({
  candidate,
  mode,
  lang,
  input,
  topTenItems,
  recentSuggestionItems,
  recentSuggestionCreators,
}) {
  const parsed = typeof candidate === "string"
    ? parseSingleSuggestionResponse(candidate, lang)
    : {
        title: String(candidate?.title || "")
          .split(/\r?\n/, 1)[0]
          .trim(),
        localizedTitle: String(
          candidate?.localizedTitle
          || candidate?.persianTitle
          || candidate?.localized_title
          || candidate?.titleFa
          || candidate?.faTitle
          || "",
        ).trim(),
        localizedCreator: String(
          candidate?.localizedCreator
          || candidate?.persianCreator
          || candidate?.localized_creator
          || candidate?.creatorFa
          || candidate?.faCreator
          || "",
        ).trim(),
        metadata: String(candidate?.metadata || "").trim(),
        reason: String(candidate?.reason || "").trim(),
      };
  if (!parsed.title) return { ok: false, reason: "invalid_output", qualityIssue: "missing_title" };
  if (
    isSuggestionUncertainResponse(parsed.title)
    || isSuggestionUncertainResponse(parsed.metadata)
    || isSuggestionUncertainResponse(parsed.reason)
  ) {
    return {
      ok: false,
      reason: "uncertain_suggestion",
      qualityIssue: "uncertain_candidate_field",
    };
  }

  const realityIssue = getSuggestionRealityIssue({
    mode,
    title: parsed.title,
    localizedTitle: parsed.localizedTitle || "",
    metadata: parsed.metadata,
    reason: parsed.reason,
  });
  if (realityIssue) {
    return { ok: false, reason: "unverified_suggestion", qualityIssue: realityIssue };
  }
  if (mode !== "random") {
    const mediaQualityIssue = getMediaSuggestionQualityIssue({
      reason: parsed.reason,
      excludedReferenceItems: topTenItems,
      lang,
    });
    if (mediaQualityIssue) {
      return { ok: false, reason: "low_quality_media", qualityIssue: mediaQualityIssue };
    }
    const creatorIssue = getSuggestionCreatorIssue({
      metadata: parsed.metadata,
      topTenItems,
      recentSuggestionCreators,
      requestText: input,
    });
    if (creatorIssue) {
      return { ok: false, reason: "creator_repetition", qualityIssue: creatorIssue };
    }
  } else {
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
    metadata: parsed.metadata,
    reason: parsed.reason,
    localizedTitle: parsed.localizedTitle || "",
    localizedCreator: parsed.localizedCreator || "",
    text: `${parsed.title}\n${parsed.metadata}\n${parsed.reason}`.trim(),
  };
}

async function getAiSingleSuggestion({
  userId,
  mode,
  lang,
  userText,
  topTenItems = [],
  watchlistItems = [],
  recentSuggestionItems = [],
  rejectedSuggestionItems = [],
  likedSuggestionItems = [],
  recentSuggestionCreators = [],
  personalized = false,
  tasteStyleHint = "",
  candidateCount = 1,
  displayLanguage: _displayLanguage = lang,
  requestTimeoutMs = null,
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
    const batchSize = candidateCount > 1 ? Math.min(5, candidateCount) : 1;
    const instructions = [
      `Recommend exactly ${batchSize === 1 ? "one" : batchSize} real, established, widely known item${batchSize === 1 ? "" : "s"}.`,
      batchSize === 1
        ? "Use exactly 3 short plain-text lines: exact searchable item name; identifying metadata; then a reason of at most 12 words."
        : `Return only a valid JSON array with exactly ${batchSize} objects, ordered from strongest to weakest relevance to the Favorites and current request. Each object must have string fields "title", "metadata", and "reason"; reason is at most 12 words. Do not repeat candidates.`,
      mode === "books"
        ? 'For books, use the official original-language title in "title" and the author name in its official catalogue form in "metadata". Persian originals stay Persian; otherwise use the official English/international identity. Never translate or transliterate the title and do not include a year.'
        : "",
      mode === "music"
        ? 'For music, use the official original catalogue title and artist. Persian originals stay Persian; otherwise use the official English/international identity. Never translate or transliterate them.'
        : "",
      mode === "movies"
        ? 'For movies and series, use the exact official title in its original language in "title" and its real director or creator in "metadata". If the original title is Persian, write it in Persian. Otherwise use the official English or international title. Never translate a foreign title into Persian and do not add localizedTitle or localizedCreator fields.'
        : "",
      "Before answering, internally check that the title and creator belong to the same real item.",
      "Be factually certain: never invent or approximate titles, creators, tools, channels, or resources.",
      "Prefer certainty over novelty or a perfect taste match. If unsure, reply exactly UNSURE.",
      "Make the reason friendly, natural, specific, and conversational—not funny, poetic, exaggerated, or canned. Name at least two concrete qualities that connect it to the user's evidence; never give a generic taste-match reason.",
      getSuggestionReasonInstruction(lang),
      "Address the user informally; in Persian use تو/سلیقه‌ات, never شما/سلیقه‌تان.",
      lang === "fa"
        ? (mode === "books"
          ? "Keep book titles and author names in their official original identity. Write only mood and reason in Persian."
          : mode === "music"
            ? "Keep song titles and artist names in their official original identity. Write only mood and reason in Persian."
            : mode === "movies"
              ? "Keep every movie title in its original language: Persian originals in Persian and foreign originals in their official English/international form. Write the entire reason naturally in Persian with no English words."
              : "Keep exact official titles and proper names in their original form for searchability. Write line 2 labels and all of line 3 in Persian; source names such as IMDb may stay Latin.")
        : "",
      getSingleSuggestionDetailInstruction(mode),
      "No numbering, no markdown, no emojis.",
      personalized ? getPersonalizedSuggestionInstruction() : "",
      buildTasteStyleInstruction(tasteStyleHint, lang),
      getModeInstruction(mode, lang),
    ].join(" ");
    const requestConfig = Number.isFinite(Number(requestTimeoutMs)) && Number(requestTimeoutMs) > 0
      ? { ...aiConfig, timeoutMs: Math.max(1000, Number(requestTimeoutMs)) }
      : aiConfig;
    const request = await requestSuggestionText(openai, {
      userId,
      config: requestConfig,
      maxOutputTokens: batchSize === 1
        ? DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS
        : DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS * (batchSize + 1),
      instructions,
      input: `Request: ${input}\n${buildUserContext({
        personalized,
        topTenItems,
        watchlistItems,
        recentSuggestionItems,
        rejectedSuggestionItems,
        likedSuggestionItems,
        recentSuggestionCreators,
      })}`,
    });
    const rawText = request.text;
    if (!rawText) {
      if (request.capacityRejected) {
        return { ok: false, reason: "capacity_busy" };
      }
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
      logger.warn("AI suggestion output rejected", {
        mode,
        reason: "uncertain_suggestion",
        hasMetadata: false,
      });
      return { ok: false, reason: "uncertain_suggestion" };
    }

    const rawCandidates = batchSize === 1 ? [rawText] : parseSuggestionBatch(rawText).slice(0, batchSize);
    if (!rawCandidates.length) {
      if (mode === "random" && topTenItems.length) {
        return buildInterestSuggestionFallback({ lang, topTenItems });
      }
      logger.warn("AI suggestion output rejected", {
        mode,
        reason: "missing_title",
        hasMetadata: false,
      });
      return { ok: false, reason: "invalid_output" };
    }
    const validated = rawCandidates.map((candidate) => validateSuggestionCandidate({
      candidate,
      mode,
      lang,
      input,
      topTenItems,
      recentSuggestionItems,
      recentSuggestionCreators,
    }));
    const candidates = validated.filter((candidate) => candidate.ok);
    if (!candidates.length) return validated[0] || { ok: false, reason: "invalid_output" };
    return batchSize === 1 ? candidates[0] : { ok: true, candidates };
  } catch (error) {
    logger.warn("AI single suggestion failed", error);
    if (mode === "random" && topTenItems.length) {
      return buildInterestSuggestionFallback({ lang, topTenItems });
    }
    return { ok: false, reason: "api_error" };
  }
}

module.exports = {
  buildUserContext,
  getAiSingleSuggestion,
  getPersonalizedSuggestionInstruction,
  getSuggestionReasonInstruction,
  getModeInstruction,
  normalizeContextItem,
  buildInterestSuggestionFallback,
  extractAiResponseText,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  getSuggestionRealityIssue,
  isSuggestionUncertainResponse,
  parseSuggestionBatch,
  validateSuggestionCandidate,
};
