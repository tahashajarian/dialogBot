const { callBacks } = require("../constants");
const { getAiSuggestionCallbackSection } = require("../services/callback-contracts");

const AI_CALLBACK_PREFIXES = Object.freeze([
  callBacks.aiSuggestMovies,
  callBacks.aiSuggestMusic,
  callBacks.aiSuggestBooks,
  callBacks.aiSuggestRandom,
  callBacks.aiListManageMenu,
  callBacks.aiListManageShow,
  callBacks.aiTopTenInsight,
  callBacks.aiTasteRecheckConfirm,
  callBacks.aiTasteRecheckCancel,
  callBacks.aiTasteRecheck,
  callBacks.aiTasteRetry,
  callBacks.aiTasteReview,
  callBacks.aiTasteConfirm,
  callBacks.aiTasteChoose,
  callBacks.aiTasteSkip,
  callBacks.aiListManageTogglePicker,
  callBacks.aiListManageToggleItem,
  callBacks.aiListManageCommentPicker,
  callBacks.aiListManageCommentItem,
  callBacks.aiListManageCancelComment,
  callBacks.aiListManagePromotePicker,
  callBacks.aiListManagePromoteItem,
  callBacks.aiListManageAdd,
  callBacks.aiListManageCancelAdd,
  callBacks.aiListManageRemovePicker,
  callBacks.aiListManageRemoveItem,
  callBacks.aiListManageBack,
  callBacks.aiSectionAddSuggestion,
  callBacks.aiSectionAddSuggestionDone,
  callBacks.aiSectionRejectSuggestion,
  callBacks.aiSectionAnotherSuggestion,
  callBacks.aiSectionSuggestMenu,
  callBacks.aiSectionSuggestNeedTopTenAck,
  callBacks.aiSectionSuggestFromTopTen,
  callBacks.aiSectionSuggestContextCancel,
  callBacks.aiPaidSuggestionConfirm,
  callBacks.aiPaidSuggestionCancel,
  callBacks.aiInterestTopTenChip,
  callBacks.aiInterestTopTenMore,
]);

const AI_EXACT_CALLBACKS = new Set([callBacks.aiTasteClose, callBacks.aiBack]);
const STATE_SCOPED_SUGGESTION_PREFIXES = Object.freeze([
  callBacks.aiSectionAnotherSuggestion,
  callBacks.aiSectionSuggestMenu,
  callBacks.aiSectionSuggestFromTopTen,
  callBacks.aiSectionSuggestContextCancel,
  callBacks.aiPaidSuggestionCancel,
]);

function normalizeAiListTypeToken(value) {
  if (value === "watchlist") return "watchlist";
  if (value === "top_ten" || value === "topTen") return "topTen";
  return "";
}

function toAiManageStateListType(value) {
  return value === "topTen" ? "top_ten" : "watchlist";
}

function normalizeWatchlistFilter(value) {
  if (value === "watched") return "watched";
  if (value === "not_watched") return "not_watched";
  return "all";
}

function isAiCallback(data = "") {
  const value = String(data || "");
  return AI_EXACT_CALLBACKS.has(value)
    || AI_CALLBACK_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isSuggestionCallbackValidForState(data = "", state = "") {
  const value = String(data || "");
  const isStateScoped = STATE_SCOPED_SUGGESTION_PREFIXES.some((prefix) => value.startsWith(prefix));
  if (!isStateScoped) return true;
  const section = getAiSuggestionCallbackSection(value);
  if (!section) return false;
  if (value.startsWith(callBacks.aiSectionSuggestContextCancel)) {
    return state === `ai_suggest_context_${section}`;
  }
  return state === `ai_chat_${section}`
    || state === `ai_suggest_context_${section}`
    || state.startsWith(`ai_manage_${section}_`);
}

module.exports = {
  isAiCallback,
  isSuggestionCallbackValidForState,
  normalizeAiListTypeToken,
  normalizeWatchlistFilter,
  toAiManageStateListType,
};
