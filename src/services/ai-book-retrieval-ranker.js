const { getAiConfig } = require("../config");
const { getClient, requestSuggestionText } = require("./ai-client");
const { logger } = require("./logger");
const { getMediaSuggestionQualityIssue } = require("./ai-suggestion-quality");

const BOOK_RANKING_TIMEOUT_MS = 7000;
const MAX_CONTEXT_ITEMS = 50;

function cleanJson(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function parseRankedBook(value, candidateCount) {
  try {
    const parsed = JSON.parse(cleanJson(value));
    const oneBasedIndex = Number(parsed?.index);
    const index = Number.isInteger(oneBasedIndex) ? oneBasedIndex - 1 : -1;
    const mood = String(parsed?.mood || "").trim();
    const reason = String(parsed?.reason || "").trim();
    if (index < 0 || index >= candidateCount || !reason) return null;
    return { index, mood, reason };
  } catch (_) {
    return null;
  }
}

function compactContext(items) {
  return (items || []).map((item) => String(item || "").trim()).filter(Boolean).slice(-MAX_CONTEXT_ITEMS);
}

async function rankRetrievedBooks({
  userId,
  lang,
  displayLanguage = lang,
  userText = "",
  favorites = [],
  likedSuggestions = [],
  rejectedSuggestions = [],
  hardExclusions = [],
  tasteStyleHint = "",
  candidates = [],
}, {
  config = getAiConfig(),
  requestText = requestSuggestionText,
  client,
} = {}) {
  const usable = (candidates || []).slice(0, 30);
  if (!usable.length) return { ok: false, reason: "no_catalog_candidates" };
  const openai = client || getClient(config);
  if (!openai) return { ok: false, reason: "ranker_unavailable" };

  const rankingConfig = {
    ...config,
    timeoutMs: Math.min(
      BOOK_RANKING_TIMEOUT_MS,
      Math.max(1000, Number(config?.timeoutMs) || BOOK_RANKING_TIMEOUT_MS),
    ),
  };

  try {
    const list = usable.map((item, index) => {
      const subjects = (item.subjects || []).slice(0, 3).join(", ");
      const description = String(item.description || "").trim().replace(/\s+/g, " ").slice(0, 220);
      const evidence = [
        subjects ? `Subjects: ${subjects}` : "",
        description ? `Description: ${description}` : "",
      ].filter(Boolean).join(" | ");
      return `${index + 1}. ${item.title} — ${item.author}${evidence ? ` [${evidence}]` : ""}`;
    }).join("\n");
    const result = await requestText(openai, {
      userId,
      config: rankingConfig,
      operation: "book_retrieval_ranking",
      maxOutputTokens: 100,
      instructions: [
        "Choose exactly one book from the supplied real catalogue candidates by returning its 1-based index.",
        "Never invent, translate, rewrite, correct, combine, or replace a title or author. The application displays the selected catalogue identity exactly as supplied.",
        "Use favorites, liked books, the taste direction, and the current request as positive evidence.",
        "Use rejected books as negative evidence without overgeneralizing from one rejection.",
        "Never choose a favorite, saved, recent, or rejected work, including the same work under a translated, transliterated, alternate, or edition title.",
        "Prefer candidates whose supplied subjects or description provide concrete evidence of relevance. Do not infer a plot, mood, or theme from the title alone.",
        "Prefer a different author from the favorites when several candidates are equally suitable, but do not sacrifice relevance merely to change authors.",
        displayLanguage === "fa"
          ? "Every supplied candidate has a Persian-script catalogue title. Choose only from them and preserve the supplied title and author exactly; never output a Latin title or create a translation."
          : "When equally suitable, prefer the supplied original/Latin catalogue identity; never localize it.",
        "Return only JSON: {\"index\": number, \"mood\": string, \"reason\": string}.",
        "The reason must describe the selected book itself, not the user, favorites, recommendation process, or catalogue.",
        lang === "fa"
          ? "Write mood and reason in Persian. Keep reason short and standalone, preferably two concrete parts separated by «؛»."
          : "Write mood and reason in concise, natural English.",
      ].join(" "),
      input: [
        `Request: ${userText || "Suggest one book"}`,
        `Taste direction: ${String(tasteStyleHint || "").trim() || "None"}`,
        `Favorites: ${compactContext(favorites).join(" | ") || "None"}`,
        `Liked books: ${compactContext(likedSuggestions).join(" | ") || "None"}`,
        `Rejected books: ${compactContext(rejectedSuggestions).join(" | ") || "None"}`,
        `Hard exclusions: ${compactContext(hardExclusions).join(" | ") || "None"}`,
        `Candidates:\n${list}`,
      ].join("\n"),
    });
    const ranked = parseRankedBook(result.text, usable.length);
    if (!ranked) {
      return {
        ok: false,
        reason: result.capacityRejected ? "capacity_busy" : "invalid_ranker_output",
      };
    }
    const qualityIssue = getMediaSuggestionQualityIssue({
      reason: ranked.reason,
      excludedReferenceItems: favorites,
    });
    if (qualityIssue) {
      return { ok: false, reason: "low_quality_media", qualityIssue };
    }
    return {
      ok: true,
      candidate: usable[ranked.index],
      mood: ranked.mood,
      reason: ranked.reason,
    };
  } catch (error) {
    logger.warn("Retrieved book ranking failed", { error: error?.message || String(error) });
    return { ok: false, reason: "ranker_unavailable" };
  }
}

module.exports = {
  parseRankedBook,
  rankRetrievedBooks,
};
