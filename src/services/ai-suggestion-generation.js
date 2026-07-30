const {
  AI_SUGGESTION_BATCH_SIZE,
  AI_SUGGESTION_MAX_BATCHES,
} = require("../constants/ai");
const { getAiSingleSuggestion } = require("./ai");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");
const { getSuggestionCreatorIssue } = require("./ai-suggestion-quality");
const { verifyWikidataSuggestion } = require("./wikidata-suggestion-verifier");
const { verifyMusicBrainzSuggestion } = require("./musicbrainz-suggestion-verifier");
const { verifyOpenLibrarySuggestion } = require("./open-library-suggestion-verifier");
const {
  readCatalogueVerification,
  writeCatalogueVerification,
} = require("./catalogue-verification-cache");
const { resolvePersianBookTitle } = require("./persian-book-title-resolver");
const {
  buildSuggestionAttemptText,
  isRetryableSuggestionFailure,
} = require("./ai-suggestion-quality");

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
  const originalTitle = normalizeEnglishBookTitle(suggestion?.title);
  const localizedTitle = normalizePersianBookTitle(suggestion?.localizedTitle);
  if (!originalTitle || !localizedTitle) return suggestion;
  return {
    ...suggestion,
    originalTitle,
    title: `${localizedTitle} (${originalTitle})`,
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
  verifyMovieSuggestion = verifyWikidataSuggestion,
  verifyMusicSuggestion = verifyMusicBrainzSuggestion,
  verifyBookSuggestion = verifyOpenLibrarySuggestion,
  resolveBookTitle = resolvePersianBookTitle,
} = {}) {
  let suggestionResult = null;
  let previousSuggestionIssue = "";

  for (let attempt = 0; attempt < AI_SUGGESTION_MAX_BATCHES; attempt += 1) {
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

    const verifier = section === "movies"
      ? verifyMovieSuggestion
      : section === "music"
        ? verifyMusicSuggestion
        : section === "books"
          ? verifyBookSuggestion
          : null;
    const usesDefaultVerifier = verifier && (
      verifier === verifyWikidataSuggestion
      || verifier === verifyMusicBrainzSuggestion
      || verifier === verifyOpenLibrarySuggestion
    );
    let stop = false;
    for (const candidate of candidates) {
      suggestionResult = candidate;
      if (verifier) {
        let verification = usesDefaultVerifier
          ? readCatalogueVerification(section, suggestionResult)
          : null;
        if (!verification) {
          verification = await verifier(suggestionResult);
          if (usesDefaultVerifier) {
            writeCatalogueVerification(section, suggestionResult, verification);
          }
        }
        if (!verification.ok) {
          suggestionResult = verification;
          previousSuggestionIssue = verification.qualityIssue || verification.reason || "";
          if (!isRetryableSuggestionFailure(verification)) stop = true;
          if (stop) break;
          continue;
        }
        suggestionResult = verification.suggestion;
        const verifiedCreatorIssue = getSuggestionCreatorIssue({
          metadata: suggestionResult.metadata,
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
      }

      if (
        section === "books"
        && lang === "fa"
        && !normalizePersianBookTitle(suggestionResult.localizedTitle)
      ) {
        const resolvedTitle = await resolveBookTitle({
          userId,
          title: suggestionResult.title,
          metadata: suggestionResult.metadata,
        });
        if (resolvedTitle) {
          suggestionResult = {
            ...suggestionResult,
            localizedTitle: resolvedTitle,
          };
        }
      }
      const displaySuggestion = applyLocalizedBookTitle(suggestionResult, section, lang);
      const duplicate = findDuplicate(suggestionResult.title, blockedSuggestionItems)
        || (
          displaySuggestion.localizedTitle
            ? findDuplicate(displaySuggestion.localizedTitle, blockedSuggestionItems)
            : null
        );
      if (!duplicate) {
        return displaySuggestion;
      }
      suggestionResult = { ok: false, reason: "duplicate_suggestion" };
      previousSuggestionIssue = suggestionResult.reason;
    }
    if (stop) break;
  }

  return suggestionResult || { ok: false, reason: "missing_result" };
}

module.exports = {
  applyLocalizedBookTitle,
  generateUsableSuggestion,
  normalizeEnglishBookTitle,
  normalizePersianBookTitle,
};
