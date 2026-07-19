const messages = require("../messages");
const {
  aiTasteCurrentKeyboard,
  aiTasteFailureKeyboard,
  aiTasteSuggestionKeyboard,
} = require("../keyboards");
const { getTasteLabelEmoji, getTasteLabelTitle } = require("../services/ai-section");
const { editPlaceholder, startAiPlaceholder } = require("../services/ai-placeholder");
const { operationalLimits } = require("../services/operational-limits");
const { starEconomy } = require("../services/star-settings");
const { formatStarNumber } = require("../services/stars-ui");
const { isTasteLabelRecheckAvailable } = require("../services/taste-label-rechecks");
const { getAiListItemsFromUser, syncAiTasteForSection } = require("../services/users");

function formatTasteLabel(lang, section, labelKey) {
  return `${getTasteLabelEmoji(section, labelKey)} ${getTasteLabelTitle(messages, lang, section, labelKey)}`;
}

function withTasteInsight(text, insight = "") {
  const cleanInsight = String(insight || "").trim();
  if (!cleanInsight) return text;
  const paragraphs = String(text || "").split("\n\n");
  paragraphs.splice(Math.min(1, paragraphs.length), 0, `✨ ${cleanInsight}`);
  return paragraphs.join("\n\n");
}

function buildTasteReviewPresentation(lang, section, syncResult, {
  canRecheck = false,
  recheckCost = 0,
} = {}) {
  const taste = syncResult?.taste || {};
  if (taste.classificationStatus === "confirmed_review" && taste.suggestedLabelKeys?.length) {
    return {
      text: withTasteInsight(messages[lang].aiTasteRecheckDifferent, taste.suggestionInsight),
      extra: aiTasteSuggestionKeyboard(lang, section, taste.suggestedLabelKeys),
    };
  }
  if (taste.classificationStatus === "confirmed" && taste.labelKey) {
    return {
      text: messages[lang].aiTasteCurrentPrompt
        .replace("{label}", formatTasteLabel(lang, section, taste.labelKey)),
      extra: aiTasteCurrentKeyboard(lang, section, { canRecheck, recheckCost }),
    };
  }
  if (taste.classificationStatus === "suggested" && taste.suggestedLabelKeys?.length) {
    return {
      text: withTasteInsight(messages[lang].aiTasteSuggestedPrompt, taste.suggestionInsight),
      extra: aiTasteSuggestionKeyboard(lang, section, taste.suggestedLabelKeys),
    };
  }
  if (taste.classificationStatus === "skipped" && taste.suggestedLabelKeys?.length) {
    return {
      text: withTasteInsight(messages[lang].aiTasteSavedSuggestionsPrompt, taste.suggestionInsight),
      extra: aiTasteSuggestionKeyboard(lang, section, taste.suggestedLabelKeys, { includeClose: true }),
    };
  }
  const unavailable = syncResult?.needsManualSelection && syncResult?.classificationReason;
  if (unavailable) {
    return {
      text: messages[lang].aiTasteUnavailableChoosePrompt,
      extra: aiTasteFailureKeyboard(lang, section),
    };
  }
  return { text: messages[lang].aiTasteUnavailableChoosePrompt, extra: aiTasteFailureKeyboard(lang, section) };
}

async function sendTasteLabelReview(ctx, lang, section, {
  withPlaceholder = false,
  placeholderMessage = null,
  retryFailed = false,
  replaceMessage = null,
} = {}) {
  const placeholder = withPlaceholder
    ? await startAiPlaceholder(ctx, [
      messages[lang].aiTasteAnalyzing,
      messages[lang].aiTasteWaitingStill,
      messages[lang].aiTasteWaitingLonger,
    ], { placeholder: placeholderMessage })
    : null;
  const syncResult = await syncAiTasteForSection(ctx.userId, section, { retryFailed });
  const hasFullList = getAiListItemsFromUser(ctx.user, section, "topTen").length === operationalLimits.aiTopTenItems;
  const presentation = buildTasteReviewPresentation(lang, section, syncResult, {
    canRecheck: hasFullList && isTasteLabelRecheckAvailable(),
    recheckCost: formatStarNumber(starEconomy.tasteLabelRecheckCost, lang),
  });
  if (placeholder) return placeholder.finish(presentation.text, presentation.extra);
  if (replaceMessage) return editPlaceholder(ctx, replaceMessage, presentation.text, presentation.extra);
  return ctx.reply(presentation.text, presentation.extra);
}

module.exports = {
  buildTasteReviewPresentation,
  formatTasteLabel,
  sendTasteLabelReview,
  withTasteInsight,
};
