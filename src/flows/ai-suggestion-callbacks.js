const messages = require("../messages");
const { getAiConfig } = require("../config");
const { logger } = require("../services/logger");
const {
  aiPaidSuggestionConfirmKeyboard,
  aiSuggestionAddKeyboard,
  aiSuggestionCopyKeyboard,
  aiSuggestionLimitKeyboard,
  aiSuggestionModeKeyboard,
} = require("../keyboards");
const {
  addAiRecentSuggestion,
  consumeAiSuggestionQuota,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  getAiRejectedSuggestionTitlesFromUser,
  getAiLikedSuggestionTitlesFromUser,
  getAiTasteFromUser,
  refundAiSuggestionQuota,
  updateUserState,
} = require("../services/users");
const { setNavigationMode } = require("../services/reply-keyboard-navigation");
const { getAiSingleSuggestion } = require("../services/ai");
const {
  buildSuggestionAttemptText,
  buildSuggestionCopyText,
} = require("../services/ai-suggestion-quality");
const { startAiPlaceholder } = require("../services/ai-placeholder");
const { getSuggestionActionPrompt, getTasteLabelStyleHint } = require("../services/ai-section");
const {
  setPendingSuggestion,
  clearPendingSuggestion,
  clearSuggestionMood,
} = require("../services/ai-suggestion-cache");
const { getAiListDuplicateMatch } = require("../services/ai-list-duplicates");
const {
  AI_RECENT_SUGGESTIONS_LIMIT,
  AI_SUGGESTION_MAX_ATTEMPTS,
  AI_WATCHLIST_PROMPT_LIMIT,
} = require("../constants/ai");
const {
  formatSuggestionLimitMessage,
  formatSuggestionResultMessage,
} = require("../services/ai-list-ui");
const { rememberAiPendingInputPrompt } = require("./ai-input-prompts");
const { clearAiActionMessage, rememberAiActionMessage } = require("./ai-cards");
const { openAiListManager } = require("./ai-text");
const { formatStarNumber } = require("../services/stars-ui");
const {
  createPaidSuggestionQuote,
  completePaidSuggestion,
  refundPaidSuggestion,
} = require("../services/ai-paid-suggestions");

const AI_PLACEHOLDER_TIMEOUT_MS = getAiConfig().timeoutMs + 3000;

async function promptSuggestionMode(ctx, lang, section) {
  clearSuggestionMood(ctx.userId, section);
  await updateUserState(ctx.userId, `ai_suggest_context_${section}`);
  await clearAiActionMessage(ctx);
  await setNavigationMode(ctx, `ai_suggestion_mode:${section}`);
  if (ctx.user) {
    ctx.user.state = `ai_suggest_context_${section}`;
    ctx.user.navigationMode = `ai_suggestion_mode:${section}`;
  }
  const prompt = await ctx.reply(
    messages[lang].aiSuggestionModePrompt,
    aiSuggestionModeKeyboard(lang, section),
  );
  await rememberAiPendingInputPrompt(ctx, prompt);
  return prompt;
}

function recoverExpiredSuggestion(ctx, lang, section) {
  clearPendingSuggestion(ctx.userId, section);
  return openAiListManager(ctx, lang, section, "topTen", {
    prefix: messages[lang].aiSuggestionExpired || messages[lang].unknownAction,
  });
}

function getSuggestionResetMinutes(resetAt) {
  const resetTime = new Date(resetAt).getTime();
  if (!Number.isFinite(resetTime)) return 1;
  return Math.max(1, Math.ceil((resetTime - Date.now()) / 60000));
}

function buildPaidSuggestionOfferText(lang, quote, balance, resetAt) {
  return messages[lang].aiSuggestionPaidOffer
    .replace("{minutes}", formatStarNumber(getSuggestionResetMinutes(resetAt), lang))
    .replace("{cost}", formatStarNumber(quote.quotedCost, lang))
    .replace("{balance}", formatStarNumber(balance, lang));
}

function getPromptWatchlistItems(watchlistItems = []) {
  return watchlistItems.slice(-AI_WATCHLIST_PROMPT_LIMIT);
}

async function sendFollowupSuggestion({
  ctx,
  lang,
  section,
  watchlistItems = [],
  userText = "",
  paidSuggestion = null,
  placeholderMessage = null,
}) {
  const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
  const recentSuggestionItems = getAiRecentSuggestionTitlesFromUser(ctx.user, section);
  const rejectedSuggestionItems = getAiRejectedSuggestionTitlesFromUser(ctx.user, section);
  const likedSuggestionItems = getAiLikedSuggestionTitlesFromUser(ctx.user, section);
  const blockedSuggestionItems = [
    ...topTenItems,
    ...watchlistItems,
    ...recentSuggestionItems,
    ...rejectedSuggestionItems,
  ].map((title) => ({ title }));
  const taste = getAiTasteFromUser(ctx.user, section);
  const tasteStyleHint = taste?.labelKey
    ? getTasteLabelStyleHint(messages, lang, section, taste.labelKey)
    : "";

  const restoreSuggestionMode = async () => {
    await updateUserState(ctx.userId, `ai_suggest_context_${section}`);
    if (ctx.user) ctx.user.state = `ai_suggest_context_${section}`;
    await setNavigationMode(ctx, `ai_suggestion_mode:${section}`);
    if (ctx.user) ctx.user.navigationMode = `ai_suggestion_mode:${section}`;
  };
  await updateUserState(ctx.userId, `ai_suggest_generating_${section}`);
  if (ctx.user) ctx.user.state = `ai_suggest_generating_${section}`;
  await setNavigationMode(ctx, `ai_suggestion_loading:${section}`);
  if (ctx.user) ctx.user.navigationMode = `ai_suggestion_loading:${section}`;

  const placeholder = await startAiPlaceholder(ctx, [
    messages[lang].aiThinking,
    messages[lang].aiThinkingStill,
    messages[lang].aiThinkingAlmost,
    messages[lang].aiThinkingLonger,
  ], {
    placeholder: placeholderMessage,
    initialExtra: placeholderMessage
      ? { reply_markup: { inline_keyboard: [] } }
      : { reply_markup: { remove_keyboard: true, selective: true } },
    fallbackText: paidSuggestion ? messages[lang].aiSuggestionPaidRefunded : messages[lang].aiNoResponse,
    fallbackExtra: aiSuggestionModeKeyboard(lang, section),
    timeoutMs: AI_PLACEHOLDER_TIMEOUT_MS,
    onFallback: async () => {
      if (paidSuggestion) {
        await refundPaidSuggestion(
          paidSuggestion.quote._id,
          paidSuggestion.spend?.transaction?._id,
          { reason: "ai_paid_suggestion_timeout" },
        );
      }
      await restoreSuggestionMode();
    },
  });
  const quota = paidSuggestion ? { ok: true, paid: true } : await consumeAiSuggestionQuota(ctx.userId, section);
  if (!quota.ok) {
    await restoreSuggestionMode();
    if (quota.reason === "limit") {
      const quoteResult = await createPaidSuggestionQuote(ctx.userId, section, { userText });
      if (quoteResult.ok) {
        return placeholder.finish(
          buildPaidSuggestionOfferText(lang, quoteResult.quote, ctx.user?.starBalance || 0, quota.resetAt),
          aiPaidSuggestionConfirmKeyboard(lang, quoteResult.quote.publicCode, quoteResult.quote.quotedCost, section),
        );
      }
    }
    return placeholder.finish(
      quota.reason === "limit" ? formatSuggestionLimitMessage(lang, quota.resetAt) : messages[lang].aiNoResponse,
      quota.reason === "limit" ? aiSuggestionLimitKeyboard(lang, section) : aiSuggestionModeKeyboard(lang, section),
    );
  }

  let suggestionResult = null;
  for (let attempt = 0; attempt < AI_SUGGESTION_MAX_ATTEMPTS; attempt += 1) {
    suggestionResult = await getAiSingleSuggestion({
      userId: ctx.userId,
      mode: section,
      lang,
      userText: buildSuggestionAttemptText(
        userText,
        section === "random" ? "Suggest one thing for me" : `Suggest one ${section} item`,
        attempt,
      ),
      topTenItems,
      watchlistItems: getPromptWatchlistItems(watchlistItems),
      recentSuggestionItems,
      rejectedSuggestionItems,
      likedSuggestionItems,
      personalized: true,
      tasteStyleHint,
    });
    if (!suggestionResult.ok || !suggestionResult.title) break;
    if (!getAiListDuplicateMatch(suggestionResult.title, blockedSuggestionItems)) break;
    suggestionResult = { ok: false, reason: "duplicate_suggestion" };
  }

  if (placeholder.isSettled()) {
    if (!paidSuggestion) await refundAiSuggestionQuota(ctx.userId, section, quota.consumedAt);
    return null;
  }

  if (!suggestionResult.ok || !suggestionResult.title) {
    logger.warn("AI suggestion flow fell back", {
      section,
      reason: suggestionResult?.reason || "missing_result",
      qualityIssue: suggestionResult?.qualityIssue || "",
    });
    await restoreSuggestionMode();
    if (paidSuggestion) {
      await refundPaidSuggestion(paidSuggestion.quote._id, paidSuggestion.spend?.transaction?._id);
      return placeholder.finish(messages[lang].aiSuggestionPaidRefunded, aiSuggestionModeKeyboard(lang, section));
    }
    const fallbackMessage = await placeholder.finish(
      suggestionResult.reason === "capacity_busy" ? messages[lang].serviceBusy : messages[lang].aiNoResponse,
      aiSuggestionModeKeyboard(lang, section),
    );
    try {
      await refundAiSuggestionQuota(ctx.userId, section, quota.consumedAt);
    } catch (error) {
      logger.warn("Failed to refund free AI suggestion quota after fallback", error);
    }
    return fallbackMessage;
  }

  if (paidSuggestion) await completePaidSuggestion(paidSuggestion.quote._id, suggestionResult.title);
  await addAiRecentSuggestion(ctx.userId, section, suggestionResult.title, AI_RECENT_SUGGESTIONS_LIMIT);
  setPendingSuggestion(
    ctx.userId,
    section,
    suggestionResult.title,
    suggestionResult.reason || "",
    suggestionResult.metadata || "",
  );
  await updateUserState(ctx.userId, `ai_chat_${section}`);
  if (ctx.user) ctx.user.state = `ai_chat_${section}`;
  await setNavigationMode(ctx, `ai_suggestion_result:${section}`);
  if (ctx.user) ctx.user.navigationMode = `ai_suggestion_result:${section}`;
  const resultMessage = await placeholder.finish(
    formatSuggestionResultMessage(lang, suggestionResult.title, suggestionResult.reason, userText, suggestionResult.metadata),
    aiSuggestionCopyKeyboard(
      lang,
      buildSuggestionCopyText(section, suggestionResult.title, suggestionResult.metadata),
    ),
  );
  if (resultMessage) {
    const actionMessage = await ctx.reply(
      getSuggestionActionPrompt(messages, lang, section),
      aiSuggestionAddKeyboard(lang, section),
    );
    await rememberAiActionMessage(ctx, `suggest_result:${section}`, actionMessage);
  }
  return resultMessage;
}

module.exports = {
  promptSuggestionMode,
  recoverExpiredSuggestion,
  sendFollowupSuggestion,
};
