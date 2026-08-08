const {
  AI_SUGGESTION_BATCH_SIZE,
  AI_SUGGESTION_MAX_BATCHES,
} = require("../constants/ai");
const { getAiSingleSuggestion } = require("./ai");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");
const {
  extractSuggestionCreator,
  getSuggestionCreatorIssue,
} = require("./ai-suggestion-quality");
const { verifyAiMediaPair } = require("./ai-media-pair-verifier");
const { retrieveMusicCandidates } = require("./music-candidate-retriever");
const { rankRetrievedMusic } = require("./ai-music-retrieval-ranker");
const { discoverAdjacentMusicArtists } = require("./ai-music-artist-discovery");
const { generateBookCandidates } = require("./ai-book-candidate-generator");
const { verifyBookSuggestionCandidate } = require("./book-suggestion-verifier");
const { inferAuthorQueries } = require("./book-author-inference");
const { verifyWikidataSuggestion } = require("./wikidata-suggestion-verifier");
const {
  creatorIsExplicitlyRequested,
} = require("./ai-suggestion-diversity");
const { normalizeAiInput } = require("./input-normalization");
const {
  buildSuggestionAttemptText,
  isRetryableSuggestionFailure,
} = require("./ai-suggestion-quality");

const MOVIE_EXTENDED_HISTORY_THRESHOLD = 20;
const MOVIE_PAIR_CHECK_TIMEOUT_MS = 3500;
const MOVIE_GENERATION_TIMEOUT_MS = 13000;
const SUGGESTION_WORK_BUDGET_MS = 23500;

function normalizeMusicWorkIdentity(value) {
  const title = String(value?.title || value || "")
    .split(/\s+[—–|]\s+/u)[0]
    .replace(/\s*\((?:bonus track|remaster(?:ed)?(?: \d{4})?|live(?: at| from)?[^)]*|cover|demo|edit|version)\)\s*$/i, "")
    .replace(/\s*[-–—]\s*(?:remaster(?:ed)?(?: \d{4})?|live|cover|bonus track|version)\s*$/i, "")
    .trim();
  return normalizeAiInput(title);
}

function isBlockedMusicWork(candidate, blockedItems = []) {
  const candidateIdentity = normalizeMusicWorkIdentity(candidate?.title);
  return Boolean(candidateIdentity && blockedItems.some((item) => (
    normalizeMusicWorkIdentity(item) === candidateIdentity
  )));
}

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

function getMovieRequestRelevanceIssue(requestText, reason) {
  const request = String(requestText || "").toLowerCase();
  const explanation = String(reason || "").toLowerCase();
  const requestedComedy = /(?:کمدی|طنز|comedy|comic|funny|humou?r)/u.test(request);
  if (requestedComedy && !/(?:کمدی|طنز|شوخ|بامزه|خنده|comic|comedy|funny|humou?r|satir)/u.test(explanation)) {
    return "requested_comedy_not_supported";
  }
  const requestedHorror = /(?:ترسناک|وحشت|horror)/u.test(request);
  if (requestedHorror && !/(?:ترس|وحشت|دلهره|هراس|horror|scary|terror|dread)/u.test(explanation)) {
    return "requested_horror_not_supported";
  }
  const requestedDocumentary = /(?:مستند|documentary)/u.test(request);
  if (requestedDocumentary && !/(?:مستند|واقعی|مصاحبه|آرشیو|documentary|nonfiction|real[- ]life|archiv)/u.test(explanation)) {
    return "requested_documentary_not_supported";
  }
  const requestedSciFi = /(?:علمی[‌\s-]*تخیلی|science[\s-]*fiction|sci[\s-]*fi)/u.test(request);
  if (requestedSciFi && !/(?:علمی[‌\s-]*تخیلی|آینده|فناوری|فضا|بیگانه|هوش مصنوعی|ربات|جهان[‌\s-]*سازی|science[\s-]*fiction|sci[\s-]*fi|futur|technolog|space|alien|android|artificial intelligence|world[\s-]*build)/u.test(explanation)) {
    return "requested_scifi_not_supported";
  }
  return "";
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
  const distinctOriginalTitle = localizedTitle
    && normalizeAiInput(localizedTitle) !== normalizeAiInput(suggestion.title)
    ? suggestion.title
    : "";
  return {
    ...suggestion,
    title: localizedTitle || suggestion.title,
    metadata: `${isSeriesCreator ? "Creator" : "Director"}: ${localizedCreator || originalCreator}`,
    originalTitle: distinctOriginalTitle,
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
  recentSuggestionCreators = [],
  blockedSuggestionItems = [],
}, dependencies = {}) {
  const requestSuggestion = dependencies.requestSuggestion || getAiSingleSuggestion;
  const findDuplicate = dependencies.findDuplicate || getAiListDuplicateMatch;
  const verifyMediaPair = dependencies.verifyMediaPair || verifyAiMediaPair;
  const retrieveMusic = dependencies.retrieveMusic || retrieveMusicCandidates;
  const rankMusic = dependencies.rankMusic || rankRetrievedMusic;
  const discoverMusicArtists = dependencies.discoverMusicArtists || discoverAdjacentMusicArtists;
  const generateBooks = dependencies.generateBooks || generateBookCandidates;
  const verifyBook = dependencies.verifyBook || verifyBookSuggestionCandidate;
  const verifyMovie = dependencies.verifyMovie || verifyWikidataSuggestion;
  const useLegacyMovieVerifier = Object.prototype.hasOwnProperty.call(dependencies, "verifyMediaPair");
  let suggestionResult = null;
  let previousSuggestionIssue = "";
  const displayLanguage = "original";
  const diagnostics = {
    attempts: 0,
    generatedCandidates: 0,
    duplicateCandidates: 0,
    invalidPairCandidates: 0,
    verifiedCandidates: 0,
  };
  const deadlineAt = Date.now() + SUGGESTION_WORK_BUDGET_MS;
  const blockedTitles = [
    ...blockedSuggestionItems,
    ...watchlistItems,
    ...recentSuggestionItems,
    ...rejectedSuggestionItems,
  ]
    .map((entry) => (typeof entry === "string" ? entry : entry?.title))
    .map((title) => String(title || "").trim())
    .filter(Boolean);

  if (section === "music") {
    const discoveryArtists = Object.prototype.hasOwnProperty.call(dependencies, "retrieveMusic")
      ? []
      : await discoverMusicArtists({
        userId,
        favorites: topTenItems,
        requestText: userText,
        recentCreators: recentSuggestionCreators,
        savedCreators: [],
      });
    const retrieved = await retrieveMusic({
      favorites: topTenItems,
      requestText: userText,
      recentCreators: recentSuggestionCreators,
      savedCreators: [],
      discoveryArtists,
    });
    const available = retrieved.filter((candidate) => (
      !findDuplicate(candidate.title, blockedSuggestionItems)
      && !isBlockedMusicWork(candidate, blockedSuggestionItems)
    ));
    const ranked = await rankMusic({
      userId,
      lang,
      userText,
      favorites: topTenItems,
      recentCreators: recentSuggestionCreators,
      candidates: available,
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
      hardExclusions: blockedTitles,
      requestTimeoutMs: Math.min(10000, Math.max(1000, deadlineAt - Date.now() - 5500)),
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
    const available = generated.candidates.filter((candidate) => !originalIdentityBlocked(candidate)).slice(0, 5);
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

    const verificationResults = [];
    let verifiedCandidates = 0;
    let duplicateCandidates = 0;
    let favoriteAuthorLocalizedFallback = null;
    const favoriteAuthors = inferAuthorQueries(topTenItems, 10);
    const favoriteAuthorItems = favoriteAuthors.map((title) => ({ title }));
    const recentAuthorItems = recentSuggestionCreators.map((title) => ({ title }));
    for (const candidate of available) {
      if (deadlineAt - Date.now() < 1800) break;
      const verified = await verifyBook(candidate, {
        displayLanguage,
        timeoutMs: Math.min(1800, Math.max(1000, deadlineAt - Date.now() - 1000)),
      });
      verificationResults.push(verified);
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
      const creatorAliases = [
        canonicalAuthor,
        selected.localizedAuthor,
        verified.displayAuthor,
        ...(verified.authorAliases || []),
        ...(verified.canonicalAuthors || []),
      ].filter(Boolean);
      const creatorExplicitlyRequested = creatorAliases.some((creator) => (
        creatorIsExplicitlyRequested(creator, userText)
      ));
      const recentAuthorBlocked = creatorAliases.some((creator) => (
        findDuplicate(creator, recentAuthorItems)
      ));
      if (recentAuthorBlocked && !creatorExplicitlyRequested) {
        continue;
      }
      const favoriteAuthorBlocked = creatorAliases.some((creator) => (
        findDuplicate(creator, favoriteAuthorItems)
      )) && !creatorExplicitlyRequested;
      const displayTitle = selected.originalTitle;
      const displayAuthor = selected.originalAuthor;
      const localizedDuplicate = findDuplicate(displayTitle, blockedSuggestionItems)
        || findDuplicate(`${displayTitle} ${displayAuthor}`, blockedSuggestionItems);
      if (localizedDuplicate) {
        duplicateCandidates += 1;
        continue;
      }
      const usableResult = {
        ok: true,
        title: displayTitle,
        metadata: `Author: ${displayAuthor}`,
        mood: selected.mood,
        reason: selected.reason,
        sourceTitle: verified.canonicalTitle || selected.originalTitle,
        sourceAuthor: canonicalAuthor,
        source: verified.source || "open_library",
        sourceId: verified.sourceId || "",
      };
      if (favoriteAuthorBlocked) {
        favoriteAuthorLocalizedFallback ||= usableResult;
        continue;
      }
      return usableResult;
    }

    const unavailableCount = verificationResults.filter((result) => (
      result?.reason === "catalog_unavailable"
    )).length;
    if (favoriteAuthorLocalizedFallback) {
      return { ...favoriteAuthorLocalizedFallback, favoriteAuthorFallback: true };
    }
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
    const remainingBeforeGeneration = deadlineAt - Date.now();
    if (remainingBeforeGeneration < 1000) {
      suggestionResult = { ok: false, reason: "suggestion_timeout" };
      break;
    }
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
      watchlistItems: blockedTitles,
      recentSuggestionItems: [],
      rejectedSuggestionItems: [],
      recentSuggestionCreators,
      personalized: true,
      candidateCount: section === "movies" ? 5 : AI_SUGGESTION_BATCH_SIZE,
      displayLanguage,
      requestTimeoutMs: section === "movies"
        ? Math.min(MOVIE_GENERATION_TIMEOUT_MS, remainingBeforeGeneration)
        : remainingBeforeGeneration,
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
    const movieVerifications = section === "movies"
      ? await Promise.all(candidates.map(async (candidate) => {
        const displayCandidate = simplifyMediaSuggestion(candidate, section, displayLanguage);
        const duplicate = findDuplicate(displayCandidate.title, blockedSuggestionItems)
          || (displayCandidate.originalTitle ? findDuplicate(displayCandidate.originalTitle, blockedSuggestionItems) : null)
          || (candidate.localizedTitle ? findDuplicate(candidate.localizedTitle, blockedSuggestionItems) : null)
          || (displayCandidate.title !== candidate.title ? findDuplicate(candidate.title, blockedSuggestionItems) : null)
          || getMovieIdentityDuplicate(candidate, displayCandidate, blockedSuggestionItems)
          || (movieReasonReportsDuplicate(candidate.reason) ? { type: "self_reported_duplicate" } : null);
        if (duplicate || getMovieRequestRelevanceIssue(userText, candidate.reason)) return null;
        const remainingBeforeVerification = deadlineAt - Date.now();
        if (remainingBeforeVerification < 1000) return { ok: false, reason: "suggestion_timeout" };
        return useLegacyMovieVerifier
          ? verifyMediaPair({
            userId,
            section,
            title: candidate.title,
            metadata: candidate.metadata,
            timeoutMs: Math.min(MOVIE_PAIR_CHECK_TIMEOUT_MS, remainingBeforeVerification),
          })
          : verifyMovie(candidate, {
            timeoutMs: Math.min(MOVIE_PAIR_CHECK_TIMEOUT_MS, remainingBeforeVerification),
          });
      }))
      : [];
    if (section === "movies") {
      diagnostics.verifiedCandidates += movieVerifications.filter((result) => result?.ok).length;
    }
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
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
        const relevanceIssue = getMovieRequestRelevanceIssue(userText, suggestionResult.reason);
        if (relevanceIssue) {
          suggestionResult = { ok: false, reason: "irrelevant_suggestion", qualityIssue: relevanceIssue };
          previousSuggestionIssue = relevanceIssue;
          continue;
        }
        const verification = movieVerifications[candidateIndex]
          || { ok: false, reason: "invalid_title_creator_pair" };
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
        const verifiedGenres = verification.suggestion?.catalogGenres || [];
        if (verifiedGenres.length) {
          const catalogRelevanceIssue = getMovieRequestRelevanceIssue(
            userText,
            verifiedGenres.join(" "),
          );
          if (catalogRelevanceIssue) {
            suggestionResult = {
              ok: false,
              reason: "irrelevant_suggestion",
              qualityIssue: `catalog_${catalogRelevanceIssue}`,
            };
            previousSuggestionIssue = suggestionResult.qualityIssue;
            continue;
          }
        }
        if (!useLegacyMovieVerifier && verification.suggestion) {
          suggestionResult = {
            ...suggestionResult,
            title: verification.suggestion.title,
            metadata: verification.suggestion.metadata,
            localizedTitle: "",
            localizedCreator: "",
          };
          const verifiedDisplay = simplifyMediaSuggestion(suggestionResult, section, displayLanguage);
          const verifiedDuplicate = findDuplicate(verifiedDisplay.title, blockedSuggestionItems)
            || (verifiedDisplay.originalTitle
              ? findDuplicate(verifiedDisplay.originalTitle, blockedSuggestionItems)
              : null)
            || findDuplicate(verification.suggestion.title, blockedSuggestionItems)
            || (verification.suggestion.aliases || []).some((alias) => (
              findDuplicate(alias, blockedSuggestionItems)
            ))
            || getMovieIdentityDuplicate(suggestionResult, verifiedDisplay, blockedSuggestionItems);
          if (verifiedDuplicate) {
            diagnostics.duplicateCandidates += 1;
            suggestionResult = { ok: false, reason: "duplicate_suggestion" };
            previousSuggestionIssue = suggestionResult.reason;
            continue;
          }
          const verifiedCreatorIssue = getSuggestionCreatorIssue({
            metadata: verifiedDisplay.metadata,
            topTenItems,
            recentSuggestionCreators,
            requestText: userText,
          });
          if (verifiedCreatorIssue) {
            suggestionResult = {
              ok: false,
              reason: "creator_repetition",
              qualityIssue: verifiedCreatorIssue,
            };
            previousSuggestionIssue = verifiedCreatorIssue;
            continue;
          }
          return {
            ...verifiedDisplay,
            sourceTitle: verification.suggestion.title,
            sourceCreator: extractSuggestionCreator(verification.suggestion.metadata),
            source: "wikidata",
            sourceId: verification.suggestion.wikidataId || "",
            diagnostics: {
              ...diagnostics,
              selectedCandidateRank: candidateIndex + 1,
            },
          };
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
  getMovieRequestRelevanceIssue,
  isBlockedMusicWork,
  normalizeMusicWorkIdentity,
};
