const messages = require("../messages");
const { logger } = require("../services/logger");
const { getAiSuggestionTimeoutMs } = require("../services/ai-suggestion-timing");
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
  getAiListItemsFromUser,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  getAiRecentSuggestionCreatorsFromUser,
  getAiRejectedSuggestionTitlesFromUser,
  getAiLikedSuggestionTitlesFromUser,
  getAiTasteFromUser,
  refundAiSuggestionQuota,
  updateUserState,
} = require("../services/users");
const { setNavigationMode } = require("../services/reply-keyboard-navigation");
const {
  buildSuggestionCopyText,
  extractSuggestionCreator,
} = require("../services/ai-suggestion-quality");
const { generateUsableSuggestion } = require("../services/ai-suggestion-generation");
const { startAiPlaceholder } = require("../services/ai-placeholder");
const { getSuggestionActionPrompt, getTasteLabelStyleHint } = require("../services/ai-section");
const {
  setPendingSuggestion,
  clearPendingSuggestion,
  clearSuggestionMood,
} = require("../services/ai-suggestion-cache");
const {
  AI_RECENT_SUGGESTIONS_LIMIT,
  AI_RECENT_SUGGESTION_CREATORS_LIMIT,
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
  const paidRefundMessage = messages[lang].aiSuggestionPaidRefunded.replace(
    "{cost}",
    String(paidSuggestion?.quote?.quotedCost || 1),
  );
  const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
  const recentSuggestionItems = getAiRecentSuggestionTitlesFromUser(ctx.user, section);
  const recentSuggestionCreators = getAiRecentSuggestionCreatorsFromUser(ctx.user, section);
  const rejectedSuggestionItems = getAiRejectedSuggestionTitlesFromUser(ctx.user, section);
  const likedSuggestionItems = getAiLikedSuggestionTitlesFromUser(ctx.user, section);
  const watchlistCreators = getAiListItemsFromUser(ctx.user, section, "watchlist")
    .map((entry) => extractSuggestionCreator(entry?.metadata || ""))
    .filter(Boolean);
  const blockedSuggestionItems = [
    ...topTenItems,
    ...watchlistItems,
    ...recentSuggestionItems,
    ...rejectedSuggestionItems,
  ].map((entry) => ({
    title: typeof entry === "string" ? entry : String(entry?.title || "").trim(),
  })).filter((entry) => entry.title);
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
    messages[lang].aiSuggestionPreparing,
  ], {
    // Callback cards use inline keyboards, so keep editing the tapped card in
    // place. Text-triggered flows have no placeholderMessage and still use the
    // safer send/delete path for reply-keyboard removal.
    disableEdits: !placeholderMessage,
    placeholder: placeholderMessage,
    initialExtra: placeholderMessage
      ? { reply_markup: { inline_keyboard: [] } }
      : { reply_markup: { remove_keyboard: true, selective: true } },
    fallbackText: paidSuggestion ? paidRefundMessage : messages[lang].aiNoResponse,
    fallbackExtra: aiSuggestionModeKeyboard(lang, section),
    timeoutMs: getAiSuggestionTimeoutMs(section),
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

  const suggestionResult = await generateUsableSuggestion({
    userId: ctx.userId,
    section,
    lang,
    userText,
    topTenItems,
    watchlistItems: getPromptWatchlistItems(watchlistItems),
    recentSuggestionItems,
    rejectedSuggestionItems,
    likedSuggestionItems,
    recentSuggestionCreators,
    blockedSuggestionItems,
    watchlistCreators,
    tasteStyleHint,
  });

  if (placeholder.isSettled()) {
    if (!paidSuggestion) await refundAiSuggestionQuota(ctx.userId, section, quota.consumedAt);
    return null;
  }

  if (!suggestionResult.ok || !suggestionResult.title) {
    logger.warn("AI suggestion flow fell back", {
      section,
      reason: suggestionResult?.reason || "missing_result",
      qualityIssue: suggestionResult?.qualityIssue || "",
      ...(suggestionResult?.diagnostics ? { diagnostics: suggestionResult.diagnostics } : {}),
    });
    await restoreSuggestionMode();
    if (paidSuggestion) {
      await refundPaidSuggestion(paidSuggestion.quote._id, paidSuggestion.spend?.transaction?._id);
      return placeholder.finish(paidRefundMessage, aiSuggestionModeKeyboard(lang, section));
    }
    const fallbackMessage = await placeholder.finish(
      ["capacity_busy", "catalog_unavailable", "suggestion_timeout"].includes(suggestionResult.reason)
        ? messages[lang].aiNoResponse
        : messages[lang].aiNoSuitableSuggestion,
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
  await addAiRecentSuggestion(
    ctx.userId,
    section,
    suggestionResult.title,
    AI_RECENT_SUGGESTIONS_LIMIT,
    {
      creator: extractSuggestionCreator(suggestionResult.metadata),
      maxCreatorItems: AI_RECENT_SUGGESTION_CREATORS_LIMIT,
    },
  );
  setPendingSuggestion(
    ctx.userId,
    section,
    suggestionResult.title,
    suggestionResult.reason || "",
    suggestionResult.metadata || "",
    {
      sourceTitle: suggestionResult.sourceTitle || "",
      sourceArtist: suggestionResult.sourceArtist || "",
      sourceAuthor: suggestionResult.sourceAuthor || "",
      sourceCreator: suggestionResult.sourceCreator || "",
    },
  );
  await updateUserState(ctx.userId, `ai_chat_${section}`);
  if (ctx.user) ctx.user.state = `ai_chat_${section}`;
  await setNavigationMode(ctx, `ai_suggestion_result:${section}`);
  if (ctx.user) ctx.user.navigationMode = `ai_suggestion_result:${section}`;
  const resultMessage = await placeholder.finish(
    formatSuggestionResultMessage(
      lang,
      suggestionResult.title,
      suggestionResult.reason,
      userText,
      suggestionResult.metadata,
      {
        localizedTitle: suggestionResult.localizedTitle,
        localizedCreator: suggestionResult.localizedCreator,
        originalTitle: suggestionResult.originalTitle,
        section,
      },
    ),
    {
      ...aiSuggestionCopyKeyboard(
        lang,
        buildSuggestionCopyText(section, suggestionResult.title, suggestionResult.metadata),
      ),
      ...(suggestionResult.originalTitle ? { parse_mode: "HTML" } : {}),
    },
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
