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
      "Recommend either a movie or a series without asking the user to choose a type.",
      "Infer the likely balance from their Favorites; if their short request explicitly asks for a movie or series, honor it.",
      "Identify the dominant cluster in the Favorites before choosing: national cinema or language, realism versus genre, recurring themes, pacing, and directing style.",
      "When a clear majority shares one national cinema or language, normally recommend inside that cinema or one close world-cinema step away. Do not jump to an unrelated genre merely because it is acclaimed or popular.",
      "Treat one malformed, ambiguous, or isolated Favorite as weak evidence; do not let it override the repeated pattern across the rest of the list.",
      "For a strongly realist social or family-drama list, prefer adjacent humanist, social, family, or moral drama unless the user explicitly asks for science fiction, fantasy, action, horror, or another genre.",
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
  return [
    `Favorites: ${compactList(topTenItems)}`,
    `Hard exclusions — already saved for later; never suggest the same work under another language, translation, transliteration, spelling, edition, or localized title: ${compactList(watchlistItems)}`,
    `Liked and already consumed: ${compactList(likedSuggestionItems)}`,
    `Recent suggestions: ${compactList(recentSuggestionItems)}`,
    `Recently suggested creators: ${compactList(recentSuggestionCreators)}`,
    `Rejected suggestions: ${compactList(rejectedSuggestionItems)}`,
  ].join("\n");
}

function getPersonalizedSuggestionInstruction() {
  return [
    "Base the recommendation primarily on specific overlaps with the user's favorites.",
    "Favorites may be works or creators such as directors, authors, artists, or bands.",
    "Treat a favorite creator as a taste signal for discovery, not as a request for that creator's most famous works.",
    "If a Favorite is a creator, recommend an established adjacent work by a different creator that shares specific style, themes, atmosphere, or structure.",
    "Do not recommend a work by a favorite creator unless the user's current request explicitly asks for that creator; this rule also applies when that creator's works appear in liked-and-already-consumed items.",
    "Never describe a work as similar or close to a person, and never use a creator's name as the target of a comparison. Describe the concrete shared qualities instead.",
    "Treat liked-and-already-consumed items as additional positive taste evidence.",
    "Treat rejected/not-for-me items as negative evidence and reduce genuinely similar suggestions, without overgeneralizing from one rejection.",
    "Saved-for-later items are neutral, not evidence that the user likes them.",
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
  displayLanguage = lang,
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
    const batchSize = candidateCount > 1 ? Math.min(3, candidateCount) : 1;
    const prefersPersianDisplay = displayLanguage === "fa";
    const isPersianBook = mode === "books" && prefersPersianDisplay;
    const isPersianMovie = mode === "movies" && prefersPersianDisplay;
    const instructions = [
      `Recommend exactly ${batchSize === 1 ? "one" : batchSize} real, established, widely known item${batchSize === 1 ? "" : "s"}.`,
      batchSize === 1
        ? "Use exactly 3 short plain-text lines: exact searchable item name; identifying metadata; then a reason of at most 12 words."
        : `Return only a valid JSON array with exactly ${batchSize} objects. Each object must have string fields "title", "metadata", and "reason"; reason is at most 12 words. Do not repeat candidates.`,
      isPersianBook
        ? 'For books, use the established Persian publication title in "title" and the conventional Persian author name in "metadata". If no established Persian title is confidently known, use the official original title and author instead. Do not invent or literally translate a title, and do not include a year.'
        : mode === "books"
          ? 'For books, use the official original title in "title" and the author name in its established original/Latin form in "metadata". Do not translate the title and do not include a year.'
          : "",
      isPersianMovie
        ? 'For movies and series, keep the official original searchable title and creator in "title" and "metadata". Also include "localizedTitle" and "localizedCreator" with the established Persian title and Persian creator name when confidently known. If no established Persian identity is confidently known, leave those localized fields empty so the original identity can be shown. Never invent a translation.'
        : mode === "movies"
          ? 'For movies and series, use the official original searchable title and creator in "title" and "metadata". Do not translate or localize their names.'
          : "",
      "Before answering, internally check that the title and creator belong to the same real item.",
      "Be factually certain: never invent or approximate titles, creators, tools, channels, or resources.",
      "Prefer certainty over novelty or a perfect taste match. If unsure, reply exactly UNSURE.",
      "Make the reason friendly, natural, specific, and conversational—not funny, poetic, exaggerated, or canned. Name at least two concrete qualities that connect it to the user's evidence; never give a generic taste-match reason.",
      getSuggestionReasonInstruction(lang),
      "Address the user informally; in Persian use تو/سلیقه‌ات, never شما/سلیقه‌تان.",
      lang === "fa"
        ? (mode === "books"
          ? (prefersPersianDisplay
            ? "The favorites are mainly in Persian script, so prefer established Persian book and author names; fall back to the official original identity when unavailable."
            : "The favorites are mainly in Latin script, so keep book titles and author names in their official original/Latin form. Write line 2 labels and all of line 3 in Persian.")
          : mode === "music"
            ? (prefersPersianDisplay
              ? "The favorites are mainly in Persian script, so prefer established Persian song and artist names when known. Write line 2 labels and all of line 3 in Persian."
              : "The favorites are mainly in Latin script, so keep song titles and artist names in their official original/Latin form. Write line 2 labels and all of line 3 in Persian.")
            : mode === "movies"
              ? (prefersPersianDisplay
                ? "The favorites are mainly in Persian script, so provide established Persian display fields when confidently known. Write line 2 labels and all of line 3 in Persian."
                : "The favorites are mainly in Latin script, so display movie titles and creator names in their official original/Latin form. Write line 2 labels and all of line 3 in Persian.")
              : "Keep exact official titles and proper names in their original form for searchability. Write line 2 labels and all of line 3 in Persian; source names such as IMDb may stay Latin.")
        : "",
      getSingleSuggestionDetailInstruction(mode),
      "No numbering, no markdown, no emojis.",
      personalized ? getPersonalizedSuggestionInstruction() : "",
      buildTasteStyleInstruction(tasteStyleHint, lang),
      getModeInstruction(mode, lang),
    ].join(" ");
    const request = await requestSuggestionText(openai, {
      userId,
      config: aiConfig,
      maxOutputTokens: batchSize === 1
        ? DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS
        : DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS * 4,
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
