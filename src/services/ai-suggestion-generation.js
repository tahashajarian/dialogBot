const {
  AI_SUGGESTION_BATCH_SIZE,
  AI_SUGGESTION_MAX_BATCHES,
} = require("../constants/ai");
const { getAiSingleSuggestion } = require("./ai");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");
const { extractSuggestionCreator } = require("./ai-suggestion-quality");
const { verifyAiMediaPair } = require("./ai-media-pair-verifier");
const { retrieveMusicCandidates } = require("./music-candidate-retriever");
const { rankRetrievedMusic } = require("./ai-music-retrieval-ranker");
const { generateBookCandidates } = require("./ai-book-candidate-generator");
const { verifyOpenLibraryBookCandidate } = require("./open-library-book-verifier");
const { getPreferredSuggestionDisplayLanguage } = require("./ai-suggestion-display-language");
const { normalizeAiInput } = require("./input-normalization");
const {
  buildSuggestionAttemptText,
  isRetryableSuggestionFailure,
} = require("./ai-suggestion-quality");

const MOVIE_EXTENDED_HISTORY_THRESHOLD = 20;
const MOVIE_PAIR_CHECK_TIMEOUT_MS = 3500;

function normalizePersianBookTitle(value) {
  const title = String(value || "")
    .trim()
    .replace(/^["'«»“”]+|["'«»“”]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  if (!title || !/[\u0600-\u06ff]/u.test(title) || /[a-z]/i.test(title)) return "";
  return title;
}

function normalizeEnglishBookTitle(value) {
  const title = String(value || "").trim().replace(/\s+/g, " ");
  if (!title || /[^\p{ASCII}]/u.test(title)) return title;
  const minorWords = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "the", "to", "with"]);
  const words = title.split(" ");
  return words.map((word, index) => {
    if (!/[a-z]/i.test(word)) return word;
    if (/[A-Z].*[A-Z]/.test(word)) return word;
    const lower = word.toLowerCase();
    if (index > 0 && index < words.length - 1 && minorWords.has(lower)) return lower;
    return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
  }).join(" ");
}

function applyLocalizedBookTitle(suggestion, section, lang) {
  if (section !== "books" || lang !== "fa") return suggestion;
  const localizedTitle = normalizePersianBookTitle(suggestion?.localizedTitle);
  if (!localizedTitle) return suggestion;
  return {
    ...suggestion,
    title: localizedTitle,
  };
}

function simplifyBookSuggestion(suggestion, displayLanguage) {
  const localizedTitle = displayLanguage === "fa"
    ? normalizePersianBookTitle(suggestion?.localizedTitle)
    : "";
  const title = localizedTitle || String(suggestion?.title || "").trim();
  const localizedCreator = displayLanguage === "fa" && /[\u0600-\u06ff]/u.test(
    String(suggestion?.localizedCreator || ""),
  )
    ? String(suggestion.localizedCreator).trim()
    : "";
  const creator = localizedCreator || extractSuggestionCreator(suggestion?.metadata || "");
  return {
    ...suggestion,
    title,
    metadata: creator ? `Author: ${creator}` : "",
    localizedTitle: "",
    localizedCreator: "",
    originalTitle: "",
  };
}

function getPersianLocalizedValue(value) {
  const clean = String(value || "").trim().replace(/\s+/g, " ");
  return clean && /[\u0600-\u06ff]/u.test(clean) ? clean : "";
}

function getTitleAliasVariants(value) {
  const clean = String(value || "")
    .trim()
    .replace(/^["'«»“”]+|["'«»“”]+$/g, "")
    .replace(/\s+/g, " ");
  if (!clean) return [];

  const variants = new Set([clean]);
  const withoutParenthetical = clean.replace(/\s*[（(][^()（）]+[)）]\s*/gu, " ").replace(/\s+/g, " ").trim();
  if (withoutParenthetical) variants.add(withoutParenthetical);
  for (const match of clean.matchAll(/[（(]([^()（）]+)[)）]/gu)) {
    const inside = String(match[1] || "").trim();
    if (inside) variants.add(inside);
  }
  return [...variants];
}

function getExactBlockedIdentityMatch(identities, blockedItems = []) {
  const blocked = new Map();
  for (const entry of blockedItems) {
    const raw = typeof entry === "string" ? entry : entry?.title;
    const normalized = normalizeAiInput(raw);
    if (normalized) blocked.set(normalized, entry);
  }
  for (const identity of identities) {
    const normalized = normalizeAiInput(identity);
    if (normalized && blocked.has(normalized)) {
      return { item: blocked.get(normalized), score: 100, type: "exact_identity" };
    }
  }
  return null;
}

function getMovieIdentityDuplicate(suggestion, displaySuggestion, blockedItems = []) {
  const titles = new Set([
    ...getTitleAliasVariants(displaySuggestion?.title),
    ...getTitleAliasVariants(displaySuggestion?.originalTitle),
    ...getTitleAliasVariants(suggestion?.title),
    ...getTitleAliasVariants(suggestion?.localizedTitle),
  ].filter(Boolean));
  const creators = new Set([
    extractSuggestionCreator(displaySuggestion?.metadata || ""),
    extractSuggestionCreator(suggestion?.metadata || ""),
    String(displaySuggestion?.originalCreator || "").trim(),
    String(suggestion?.localizedCreator || "").trim(),
  ].filter(Boolean));

  const identities = [];
  for (const title of titles) {
    for (const creator of creators) identities.push(`${title} ${creator}`);
  }
  return getExactBlockedIdentityMatch(identities, blockedItems);
}

function movieReasonReportsDuplicate(reason) {
  const text = String(reason || "").trim();
  if (!text) return false;
  if (/\bnot\s+already\s+(?:in|on)\s+your\s+(?:list|favorites|watchlist)/i.test(text)) return false;
  if (/(?:تکراری\s+نیست|در\s+(?:فهرست|لیست)(?:ت|\s+تو)?\s+(?:نیست|وجود\s+ندارد))/u.test(text)) {
    return false;
  }
  return /(?:already\s+(?:in|on)\s+your\s+(?:list|favorites|watchlist)|should\s+not\s+be\s+repeated)/i.test(text)
    || /(?:از\s+قبل\s+در\s+(?:فهرست|لیست)(?:ت|\s+تو)?\s+(?:هست|وجود\s+دارد)|نباید\s+تکرار\s+شود|(?:اثر|فیلم|عنوان|پیشنهاد)?\s*تکراری(?:\s+است)?\s+(?:در|داخل)\s+(?:فهرست|لیست)(?:ت|\s+تو)?)/u.test(text);
}

function simplifyMediaSuggestion(suggestion, section, displayLanguage) {
  if (section !== "movies" && section !== "music") return suggestion;
  const originalCreator = extractSuggestionCreator(suggestion?.metadata || "");
  if (!originalCreator) return suggestion;
  if (section === "music") {
    return { ...suggestion, metadata: `Artist: ${originalCreator}` };
  }
  const localizedTitle = displayLanguage === "fa" ? getPersianLocalizedValue(suggestion?.localizedTitle) : "";
  const localizedCreator = displayLanguage === "fa" ? getPersianLocalizedValue(suggestion?.localizedCreator) : "";
  const isSeriesCreator = /\bcreator\s*:/i.test(String(suggestion?.metadata || ""))
    || /سازنده\s*:/u.test(String(suggestion?.metadata || ""));
  return {
    ...suggestion,
    title: localizedTitle || suggestion.title,
    metadata: `${isSeriesCreator ? "Creator" : "Director"}: ${localizedCreator || originalCreator}`,
    originalTitle: localizedTitle ? suggestion.title : "",
    originalCreator: localizedCreator ? originalCreator : "",
  };
}

async function generateUsableSuggestion({
  userId,
  section,
  lang,
  userText = "",
  topTenItems = [],
  watchlistItems = [],
  recentSuggestionItems = [],
  rejectedSuggestionItems = [],
  likedSuggestionItems = [],
  recentSuggestionCreators = [],
  blockedSuggestionItems = [],
  tasteStyleHint = "",
}, {
  requestSuggestion = getAiSingleSuggestion,
  findDuplicate = getAiListDuplicateMatch,
  verifyMediaPair = verifyAiMediaPair,
  retrieveMusic = retrieveMusicCandidates,
  rankMusic = rankRetrievedMusic,
  generateBooks = generateBookCandidates,
  verifyBook = verifyOpenLibraryBookCandidate,
} = {}) {
  let suggestionResult = null;
  let previousSuggestionIssue = "";
  const displayLanguage = getPreferredSuggestionDisplayLanguage(topTenItems, lang);
  const diagnostics = {
    attempts: 0,
    generatedCandidates: 0,
    duplicateCandidates: 0,
    invalidPairCandidates: 0,
  };

  if (section === "music") {
    const retrieved = await retrieveMusic({ favorites: topTenItems });
    const available = retrieved.filter((candidate) => !findDuplicate(candidate.title, blockedSuggestionItems));
    const ranked = await rankMusic({
      userId,
      lang,
      userText,
      favorites: topTenItems,
      rejectedSuggestions: rejectedSuggestionItems,
      candidates: available,
      displayLanguage,
    });
    if (ranked.ok) {
      return {
        ok: true,
        title: ranked.displayTitle || ranked.candidate.title,
        metadata: `Artist: ${ranked.displayArtist || ranked.candidate.artist}`,
        mood: ranked.mood,
        reason: ranked.reason,
        sourceTitle: ranked.candidate.title,
        sourceArtist: ranked.candidate.artist,
      };
    }
    return { ok: false, reason: ranked.reason || "no_catalog_candidates" };
  }

  if (section === "books") {
    const generated = await generateBooks({
      userId,
      lang,
      userText,
      favorites: topTenItems,
      likedSuggestions: likedSuggestionItems,
      rejectedSuggestions: rejectedSuggestionItems,
      tasteStyleHint,
      hardExclusions: [
        ...watchlistItems,
        ...recentSuggestionItems,
        ...rejectedSuggestionItems,
      ],
    });
    if (!generated.ok || !generated.candidates?.length) {
      return {
        ok: false,
        reason: generated.reason || "invalid_book_candidates",
        diagnostics: { generatedCandidates: generated.candidates?.length || 0 },
      };
    }

    const originalIdentityBlocked = (candidate) => [
      candidate.originalTitle,
      `${candidate.originalTitle} ${candidate.originalAuthor}`,
    ].filter(Boolean).some((identity) => findDuplicate(identity, blockedSuggestionItems));
    const available = generated.candidates.filter((candidate) => !originalIdentityBlocked(candidate));
    if (!available.length) {
      return {
        ok: false,
        reason: "duplicate_suggestion",
        diagnostics: {
          generatedCandidates: generated.candidates.length,
          availableCandidates: 0,
        },
      };
    }

    const verificationResults = await Promise.all(
      available.map((candidate) => verifyBook(candidate, { displayLanguage })),
    );
    let verifiedCandidates = 0;
    let duplicateCandidates = 0;
    for (const verified of verificationResults) {
      if (!verified?.ok || !verified.candidate) continue;
      verifiedCandidates += 1;
      const creators = [
        ...(verified.canonicalAuthors || []),
        ...(verified.authorAliases || []),
        verified.candidate.originalAuthor,
      ].filter(Boolean);
      const aliases = [
        ...(verified.aliases || []),
        verified.canonicalTitle,
        verified.displayTitle,
        verified.candidate.originalTitle,
      ].filter(Boolean);
      const identities = [
        ...aliases,
        ...aliases.flatMap((title) => creators.map((creator) => `${title} ${creator}`)),
      ];
      const duplicate = identities.some((identity) => findDuplicate(identity, blockedSuggestionItems));
      if (duplicate) {
        duplicateCandidates += 1;
        continue;
      }

      const selected = verified.candidate;
      const canonicalAuthor = verified.canonicalAuthors?.[0] || selected.originalAuthor;
      return {
        ok: true,
        title: verified.displayTitle || verified.canonicalTitle || selected.originalTitle,
        metadata: `Author: ${verified.displayAuthor || canonicalAuthor}`,
        mood: selected.mood,
        reason: selected.reason,
        sourceTitle: verified.canonicalTitle || selected.originalTitle,
        sourceAuthor: canonicalAuthor,
        source: verified.source || "open_library",
        sourceId: verified.sourceId || "",
      };
    }

    const unavailableCount = verificationResults.filter((result) => (
      result?.reason === "catalog_unavailable"
    )).length;
    return {
      ok: false,
      reason: duplicateCandidates > 0 && duplicateCandidates === verifiedCandidates
        ? "duplicate_suggestion"
        : unavailableCount === verificationResults.length
          ? "catalog_unavailable"
          : "no_catalog_candidates",
      diagnostics: {
        generatedCandidates: generated.candidates.length,
        availableCandidates: available.length,
        verifiedCandidates,
        duplicateCandidates,
        catalogUnavailable: unavailableCount,
        catalogUnverified: verificationResults.length - unavailableCount - verifiedCandidates,
      },
    };
  }

  const maxAttempts = section === "movies" && blockedSuggestionItems.length >= MOVIE_EXTENDED_HISTORY_THRESHOLD
    ? AI_SUGGESTION_MAX_BATCHES + 1
    : AI_SUGGESTION_MAX_BATCHES;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    diagnostics.attempts += 1;
    suggestionResult = await requestSuggestion({
      userId,
      mode: section,
      lang,
      userText: buildSuggestionAttemptText(
        userText,
        section === "random" ? "Suggest one thing for me" : `Suggest one ${section} item`,
        attempt,
        previousSuggestionIssue,
      ),
      topTenItems,
      watchlistItems,
      recentSuggestionItems,
      rejectedSuggestionItems,
      likedSuggestionItems,
      recentSuggestionCreators,
      personalized: true,
      tasteStyleHint,
      candidateCount: AI_SUGGESTION_BATCH_SIZE,
      displayLanguage,
    });

    if (!suggestionResult.ok) {
      previousSuggestionIssue = suggestionResult?.qualityIssue || suggestionResult?.reason || "";
      if (isRetryableSuggestionFailure(suggestionResult)) continue;
      break;
    }

    const candidates = suggestionResult.candidates?.length
      ? suggestionResult.candidates
      : suggestionResult.title
        ? [suggestionResult]
        : [];
    if (!candidates.length) {
      suggestionResult = { ok: false, reason: "invalid_output" };
      previousSuggestionIssue = suggestionResult.reason;
      continue;
    }

    diagnostics.generatedCandidates += candidates.length;
    for (const candidate of candidates) {
      suggestionResult = candidate;
      const displaySuggestion = section === "books"
        ? simplifyBookSuggestion(suggestionResult, displayLanguage)
        : simplifyMediaSuggestion(suggestionResult, section, displayLanguage);
      const duplicate = findDuplicate(displaySuggestion.title, blockedSuggestionItems)
        || (displaySuggestion.originalTitle
          ? findDuplicate(displaySuggestion.originalTitle, blockedSuggestionItems)
          : null)
        || (suggestionResult.localizedTitle
          ? findDuplicate(suggestionResult.localizedTitle, blockedSuggestionItems)
          : null)
        || (
          displaySuggestion.title !== suggestionResult.title
            ? findDuplicate(suggestionResult.title, blockedSuggestionItems)
            : null
        )
        || (section === "movies"
          ? getMovieIdentityDuplicate(suggestionResult, displaySuggestion, blockedSuggestionItems)
          : null)
        || (section === "movies" && movieReasonReportsDuplicate(suggestionResult.reason)
          ? { type: "self_reported_duplicate" }
          : null);
      if (duplicate) {
        diagnostics.duplicateCandidates += 1;
        suggestionResult = { ok: false, reason: "duplicate_suggestion" };
        previousSuggestionIssue = suggestionResult.reason;
        continue;
      }

      // Duplicate checks are intentionally done before the extra movie pair
      // check. A large real watchlist should not spend time verifying titles
      // that are already known to be unusable.
      if (section === "movies") {
        const verification = await verifyMediaPair({
          userId,
          section,
          title: suggestionResult.title,
          metadata: suggestionResult.metadata,
          timeoutMs: MOVIE_PAIR_CHECK_TIMEOUT_MS,
        });
        if (!verification.ok) {
          diagnostics.invalidPairCandidates += 1;
          suggestionResult = {
            ok: false,
            reason: verification.reason || "invalid_title_creator_pair",
            qualityIssue: verification.reason || "invalid_title_creator_pair",
          };
          previousSuggestionIssue = suggestionResult.qualityIssue;
          continue;
        }
      }

      return displaySuggestion;
    }
  }


  return {
    ...(suggestionResult || { ok: false, reason: "missing_result" }),
    diagnostics,
  };
}

module.exports = {
  applyLocalizedBookTitle,
  generateUsableSuggestion,
  normalizeEnglishBookTitle,
  normalizePersianBookTitle,
  simplifyBookSuggestion,
  simplifyMediaSuggestion,
};
