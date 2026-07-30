const { AI_SUGGESTION_MAX_ATTEMPTS } = require("../constants/ai");
const { getAiSingleSuggestion } = require("./ai");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");
const {
  buildSuggestionAttemptText,
  isRetryableSuggestionFailure,
} = require("./ai-suggestion-quality");

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
} = {}) {
  let suggestionResult = null;
  let previousSuggestionIssue = "";

  for (let attempt = 0; attempt < AI_SUGGESTION_MAX_ATTEMPTS; attempt += 1) {
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
    });

    if (!suggestionResult.ok || !suggestionResult.title) {
      previousSuggestionIssue = suggestionResult?.qualityIssue || suggestionResult?.reason || "";
      if (isRetryableSuggestionFailure(suggestionResult)) continue;
      break;
    }

    if (!findDuplicate(suggestionResult.title, blockedSuggestionItems)) break;
    suggestionResult = { ok: false, reason: "duplicate_suggestion" };
    previousSuggestionIssue = suggestionResult.reason;
  }

  return suggestionResult || { ok: false, reason: "missing_result" };
}

module.exports = {
  generateUsableSuggestion,
};
