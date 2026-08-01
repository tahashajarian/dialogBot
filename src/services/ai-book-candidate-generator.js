const { getAiConfig } = require("../config");
const { getClient, requestSuggestionText } = require("./ai-client");
const { logger } = require("./logger");
const { getMediaSuggestionQualityIssue } = require("./ai-suggestion-quality");

const BOOK_CANDIDATE_COUNT = 5;
const BOOK_GENERATION_TIMEOUT_MS = 14000;
const MAX_CONTEXT_ITEMS = 50;

function cleanJson(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function compactContext(items) {
  return (items || [])
    .map((item) => String(item?.title || item || "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(-MAX_CONTEXT_ITEMS);
}

function normalizeCandidate(value, { favorites }) {
  const originalTitle = String(value?.originalTitle || value?.original_title || "")
    .trim()
    .replace(/\s+/g, " ");
  const originalAuthor = String(value?.originalAuthor || value?.original_author || "")
    .trim()
    .replace(/\s+/g, " ");
  const mood = String(value?.mood || "").trim().replace(/\s+/g, " ");
  const reason = String(value?.reason || "").trim().replace(/\s+/g, " ");

  if (!originalTitle || !originalAuthor || !reason) return null;
  if (originalTitle.length > 160 || originalAuthor.length > 120) return null;
  const qualityIssue = getMediaSuggestionQualityIssue({
    reason,
    excludedReferenceItems: favorites,
  });
  if (qualityIssue) return null;

  return {
    originalTitle,
    originalAuthor,
    mood,
    reason,
  };
}

function candidateIdentityKey(candidate) {
  return `${candidate.originalTitle}::${candidate.originalAuthor}`
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function parseBookCandidates(value, options = {}) {
  try {
    const parsed = JSON.parse(cleanJson(value));
    const list = Array.isArray(parsed) ? parsed : parsed?.candidates;
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const candidates = [];
    for (const entry of list) {
      const candidate = normalizeCandidate(entry, options);
      if (!candidate) continue;
      const key = candidateIdentityKey(candidate);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
      if (candidates.length >= BOOK_CANDIDATE_COUNT) break;
    }
    return candidates;
  } catch (_) {
    return [];
  }
}

async function generateBookCandidates({
  userId,
  lang,
  userText = "",
  favorites = [],
  likedSuggestions = [],
  rejectedSuggestions = [],
  hardExclusions = [],
  tasteStyleHint = "",
}, {
  config = getAiConfig(),
  requestText = requestSuggestionText,
  client,
} = {}) {
  const openai = client || getClient(config);
  if (!openai) return { ok: false, reason: "missing_key", candidates: [] };

  const requestConfig = {
    ...config,
    timeoutMs: Math.min(
      BOOK_GENERATION_TIMEOUT_MS,
      Math.max(1000, Number(config?.timeoutMs) || BOOK_GENERATION_TIMEOUT_MS),
    ),
  };
  const instructions = [
    `Return only a valid JSON array with up to ${BOOK_CANDIDATE_COUNT} real book candidates, ordered from strongest to weakest match.`,
    "Each object must contain exactly these string fields: originalTitle, originalAuthor, mood, reason.",
    "Use the official original-language title and the author's established catalogue name. Never translate, localize, transliterate, rename, merge, approximate, or invent a title or author.",
    "Only use real, published books. The originalTitle and originalAuthor pair must be exact enough for an external catalogue search. Never attribute a real title to the wrong author.",
    "Favorites and explicitly liked books are positive taste evidence. Saved-for-later items are neutral hard exclusions, not evidence that the user likes them. Rejected books are negative evidence.",
    "Never return a favorite, saved, recent, or rejected book, including the same work under a translated, transliterated, alternate, or edition title.",
    "Prefer adjacent authors and works rather than repeatedly recommending another book by an author already dominant in Favorites, unless the current request explicitly asks for that author.",
    "The reason must describe the selected book itself using concrete, well-known qualities. Never infer plot or mood from the title alone. Never mention the user, their taste, Favorites, matching, AI, or verification.",
    lang === "fa"
      ? "Write mood and reason in concise natural Persian. Prefer a short standalone two-part reason separated by «؛». Keep originalTitle and originalAuthor in their verified original catalogue form, even when the explanation is Persian."
      : "Write mood and reason in concise natural English.",
    "If fewer than five candidates are genuinely certain, return fewer. If none are certain, return an empty JSON array. No markdown, commentary, display-title fields, translated-title fields, or extra keys.",
  ].join(" ");
  const input = [
    `Request: ${String(userText || "Suggest one book").trim()}`,
    `Taste direction: ${String(tasteStyleHint || "").trim() || "None"}`,
    `Favorites: ${compactContext(favorites).join(" | ") || "None"}`,
    `Explicitly liked and read: ${compactContext(likedSuggestions).join(" | ") || "None"}`,
    `Rejected: ${compactContext(rejectedSuggestions).join(" | ") || "None"}`,
    `Hard exclusions — saved for later and recent: ${compactContext(hardExclusions).join(" | ") || "None"}`,
  ].join("\n");

  try {
    const result = await requestText(openai, {
      userId,
      config: requestConfig,
      operation: "book_candidate_generation",
      maxOutputTokens: 620,
      instructions,
      input,
    });
    const candidates = parseBookCandidates(result.text, { favorites });
    if (candidates.length) return { ok: true, candidates };
    return {
      ok: false,
      reason: result.capacityRejected ? "capacity_busy" : "invalid_book_candidates",
      candidates: [],
    };
  } catch (error) {
    logger.warn("Book candidate generation failed", { error: error?.message || String(error) });
    return { ok: false, reason: "api_error", candidates: [] };
  }
}

module.exports = {
  BOOK_CANDIDATE_COUNT,
  generateBookCandidates,
  parseBookCandidates,
};
