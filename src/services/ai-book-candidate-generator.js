const { getAiConfig } = require("../config");
const { getClient, requestSuggestionText } = require("./ai-client");
const { logger } = require("./logger");
const { getMediaSuggestionQualityIssue } = require("./ai-suggestion-quality");

// Five complete identities are more reliable than a larger JSON response: the
// latter was frequently truncated or padded with translated duplicates.
const BOOK_CANDIDATE_COUNT = 5;
const BOOK_GENERATION_TIMEOUT_MS = 30000;
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

function normalizePersianIdentity(value, maxLength) {
  const clean = String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean && /[\u0600-\u06ff]/u.test(clean) && !/[A-Za-z]/.test(clean) ? clean : "";
}

function normalizeCandidate(value, { favorites, lang = "" }) {
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

  const localizedTitle = lang === "fa"
    ? normalizePersianIdentity(value?.localizedTitle || value?.localized_title, 80)
    : "";
  const localizedAuthor = lang === "fa"
    ? normalizePersianIdentity(value?.localizedAuthor || value?.localized_author, 100)
    : "";
  return {
    originalTitle,
    originalAuthor,
    ...(localizedTitle && localizedAuthor ? { localizedTitle, localizedAuthor } : {}),
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
  requestTimeoutMs = null,
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
      Number.isFinite(Number(requestTimeoutMs)) && Number(requestTimeoutMs) > 0
        ? Math.min(BOOK_GENERATION_TIMEOUT_MS, Number(requestTimeoutMs))
        : BOOK_GENERATION_TIMEOUT_MS,
      Math.max(1000, Number(config?.timeoutMs) || BOOK_GENERATION_TIMEOUT_MS),
    ),
  };
  const instructions = [
    `Return only a valid JSON array with exactly ${BOOK_CANDIDATE_COUNT} real, established, widely catalogued book candidates, ordered from strongest to weakest match.`,
    lang === "fa"
      ? "Each object must contain exactly these string fields: originalTitle, originalAuthor, localizedTitle, localizedAuthor, mood, reason."
      : "Each object must contain exactly these string fields: originalTitle, originalAuthor, mood, reason.",
    "Use the official original-language title and the author's established catalogue name. Never translate, localize, transliterate, rename, merge, approximate, or invent a title or author.",
    "Only use real, published books. The originalTitle and originalAuthor pair must be exact enough for an external catalogue search. Never attribute a real title to the wrong author.",
    "Favorites and explicitly liked books are positive taste evidence. Saved-for-later items are neutral hard exclusions, not evidence that the user likes them. Rejected books are negative evidence.",
    "Treat broad genre, mood, and taste wording as a soft direction, not an exact subtype requirement, unless the request explicitly says only/exclusively/فقط. Build an adjacent, varied shortlist connected through concrete qualities such as voice, atmosphere, structure, themes, setting, or reading experience; do not make all candidates near-identical in genre or premise.",
    "Never return a favorite, saved, recent, or rejected book, including the same work under a translated, transliterated, alternate, or edition title.",
    "Never return a book by an author represented in Favorites unless the current request explicitly asks for that author. Use those authors only as taste evidence for discovering adjacent writers.",
    "The reason must describe the selected book itself using concrete, well-known qualities. Never infer plot or mood from the title alone. Never mention the user, their taste, Favorites, matching, AI, or verification.",
    lang === "fa"
      ? "Write mood and reason in concise natural Persian. Keep the reason to at most 16 words and prefer two concrete parts separated by «؛». Keep originalTitle and originalAuthor in their official catalogue form. localizedTitle and localizedAuthor must be the confidently established Persian publication title and conventional Persian author spelling; never create a literal translation, and use empty strings when uncertain."
      : "Write mood and reason in concise natural English.",
    `Use well-established books so all ${BOOK_CANDIDATE_COUNT} identities can be externally verified. If none are certain, return an empty JSON array. No markdown, commentary, or extra keys.`,
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
      maxOutputTokens: 760,
      instructions,
      input,
    });
    const candidates = parseBookCandidates(result.text, { favorites, lang });
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
