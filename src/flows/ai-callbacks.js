const path = require("node:path");
const messages = require("../messages");
const { getAiConfig } = require("../config");
const { logger } = require("../services/logger");

const AI_PLACEHOLDER_TIMEOUT_MS = getAiConfig().timeoutMs + 3000;
const BOOKS_SECTION_BANNER_PATH = path.join(__dirname, "../../assets/books-section-banner.jpg");
const MUSIC_SECTION_BANNER_PATH = path.join(__dirname, "../../assets/music-section-banner.jpg");
const MOVIES_SECTION_BANNER_PATH = path.join(__dirname, "../../assets/movies-section-banner.jpg");
const AI_SECTION_BANNERS = Object.freeze({
  movies: {
    bannerKey: "movies_section_v2",
    localSource: MOVIES_SECTION_BANNER_PATH,
    configuredFileId: process.env.MOVIES_SECTION_BANNER_FILE_ID,
  },
  music: {
    bannerKey: "music_section_v2",
    localSource: MUSIC_SECTION_BANNER_PATH,
    configuredFileId: process.env.MUSIC_SECTION_BANNER_FILE_ID,
  },
  books: {
    bannerKey: "books_section_v4",
    localSource: BOOKS_SECTION_BANNER_PATH,
    configuredFileId: process.env.BOOKS_SECTION_BANNER_FILE_ID,
  },
});
const {
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionCopyKeyboard,
  aiSuggestionNextKeyboard,
  aiSuggestionLimitKeyboard,
  aiPaidSuggestionConfirmKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionNeedTopTenKeyboard,
  aiSuggestionAddedOptionsKeyboard,
  aiListManageMenuKeyboard,
  aiListRemoveItemsKeyboard,
  aiListCancelAddKeyboard,
  aiInterestTopTenChipKeyboard,
  getInterestTopTenChipTitle,
  aiListActionItemsKeyboard,
  aiListCancelCommentKeyboard,
  aiTasteRecheckConfirmKeyboard,
  aiTasteSuggestionKeyboard,
  mainMenuKeyboard,
} = require("../keyboards");
const { callBacks } = require("../constants");
const {
  updateProfileField,
  updateUserState,
  removeAiListItem,
  addAiListItem,
  addAiRecentSuggestion,
  addAiRejectedSuggestion,
  consumeAiSuggestionQuota,
  refundAiSuggestionQuota,
  getAiListItemsFromUser,
  getWatchlistItemsByStatusFromUser,
  toggleWatchlistItemWatched,
  promoteWatchlistItemToTopTen,
  syncAiTasteForSection,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  getAiRejectedSuggestionTitlesFromUser,
  getAiTasteFromUser,
  confirmAiTasteLabel,
  recalculateAiTasteForSection,
  skipAiTasteLabel,
} = require("../services/users");
const { sendNavigationFootprint } = require("../services/navigation-footprints");
const { MODES, setNavigationMode } = require("../services/reply-keyboard-navigation");
const { getAiSingleSuggestion } = require("../services/ai");
const { startAiPlaceholder, editPlaceholder } = require("../services/ai-placeholder");
const {
  getSectionEmoji,
  getSectionLabel,
  getSectionListLabel,
  getSectionMessage,
  getTasteLabelStyleHint,
} = require("../services/ai-section");
const { isAllowedTasteLabel } = require("../services/taste-label-classifier");
const { sendTasteLabelReview, withTasteInsight } = require("./ai-taste-labels");
const {
  setPendingSuggestion,
  getPendingSuggestion,
  clearPendingSuggestion,
  clearSuggestionMood,
  getSuggestionMood,
} = require("../services/ai-suggestion-cache");
const { getAiListDuplicateMatch } = require("../services/ai-list-duplicates");
const {
  AI_RECENT_SUGGESTIONS_LIMIT,
  AI_SUGGESTION_MAX_ATTEMPTS,
  AI_WATCHLIST_PROMPT_LIMIT,
} = require("../constants/ai");
const { operationalLimits } = require("../services/operational-limits");
const {
  buildAiListManagerMessage,
  buildTopTenInsightMessage,
  buildTopTenSavedMessage,
  formatAiItemsList,
  formatAiLimitMessage,
  formatSuggestionLimitMessage,
  formatSuggestionResultMessage,
  getDuplicateListMessage,
  getDuplicateTopTenMessage,
  getNeedTopTenMessage,
  getSectionLabelWithEmoji,
  toTitleSet,
  withAiSectionTitle,
} = require("../services/ai-list-ui");
const {
  rememberAiPendingInputPrompt,
  clearAiPendingInputPrompt,
} = require("./ai-input-prompts");
const { getAiListAddPrompt } = require("./ai-list-input");
const {
  clearAiActionMessage,
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
  deleteRememberedAiListMessage,
  forgetRememberedAiListMessage,
  rememberAiActionMessage,
  rememberAiSectionEntryMessage,
  replaceRememberedAiListMessage,
} = require("./ai-cards");
const {
  formatAiCommentPrompt,
  openAiListManager,
} = require("./ai-text");
const { sendAiAssistantHub } = require("./ai-hub");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
  formatStarNumber,
  notifyExternalReferralReward,
} = require("../services/stars-ui");
const {
  createPaidSuggestionQuote,
  confirmPaidSuggestion,
  completePaidSuggestion,
  refundPaidSuggestion,
} = require("../services/ai-paid-suggestions");
const { starEconomy } = require("../services/star-settings");
const {
  cancelTasteLabelRecheck,
  completeTasteLabelRecheck,
  confirmTasteLabelRecheck,
  createTasteLabelRecheckQuote,
  refundTasteLabelRecheck,
} = require("../services/taste-label-rechecks");

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
  return (
    data.startsWith(callBacks.aiSuggestMovies) ||
    data.startsWith(callBacks.aiSuggestMusic) ||
    data.startsWith(callBacks.aiSuggestBooks) ||
    data.startsWith(callBacks.aiSuggestRandom) ||
    data.startsWith(callBacks.aiListManageMenu) ||
    data.startsWith(callBacks.aiListManageShow) ||
    data.startsWith(callBacks.aiTopTenInsight) ||
    data.startsWith(callBacks.aiTasteRecheckConfirm) ||
    data.startsWith(callBacks.aiTasteRecheckCancel) ||
    data.startsWith(callBacks.aiTasteRecheck) ||
    data.startsWith(callBacks.aiTasteRetry) ||
    data.startsWith(callBacks.aiTasteReview) ||
    data.startsWith(callBacks.aiTasteConfirm) ||
    data.startsWith(callBacks.aiTasteChoose) ||
    data === callBacks.aiTasteClose ||
    data.startsWith(callBacks.aiTasteSkip) ||
    data.startsWith(callBacks.aiListManageTogglePicker) ||
    data.startsWith(callBacks.aiListManageToggleItem) ||
    data.startsWith(callBacks.aiListManageCommentPicker) ||
    data.startsWith(callBacks.aiListManageCommentItem) ||
    data.startsWith(callBacks.aiListManageCancelComment) ||
    data.startsWith(callBacks.aiListManagePromotePicker) ||
    data.startsWith(callBacks.aiListManagePromoteItem) ||
    data.startsWith(callBacks.aiListManageAdd) ||
    data.startsWith(callBacks.aiListManageCancelAdd) ||
    data.startsWith(callBacks.aiListManageRemovePicker) ||
    data.startsWith(callBacks.aiListManageRemoveItem) ||
    data.startsWith(callBacks.aiListManageBack) ||
    data.startsWith(callBacks.aiSectionAddSuggestion) ||
    data.startsWith(callBacks.aiSectionAddSuggestionDone) ||
    data.startsWith(callBacks.aiSectionRejectSuggestion) ||
    data.startsWith(callBacks.aiSectionAnotherSuggestion) ||
    data.startsWith(callBacks.aiSectionSuggestMenu) ||
    data.startsWith(callBacks.aiSectionSuggestNeedTopTenAck) ||
    data.startsWith(callBacks.aiSectionSuggestFromTopTen) ||
    data.startsWith(callBacks.aiSectionSuggestContextCancel) ||
    data.startsWith(callBacks.aiPaidSuggestionConfirm) ||
    data.startsWith(callBacks.aiPaidSuggestionCancel) ||
    data.startsWith(callBacks.aiInterestTopTenChip) ||
    data.startsWith(callBacks.aiInterestTopTenMore) ||
    data === callBacks.aiBack
  );
}

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

function getSuggestionCallbackSection(data = "") {
  const prefixes = [
    callBacks.aiSectionAnotherSuggestion,
    callBacks.aiSectionSuggestMenu,
    callBacks.aiSectionSuggestFromTopTen,
    callBacks.aiSectionSuggestContextCancel,
    callBacks.aiPaidSuggestionCancel,
  ];
  const prefix = prefixes.find((entry) => data.startsWith(entry));
  return prefix ? data.slice(prefix.length).trim() : "";
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

function isSuggestionCallbackValidForState(data = "", state = "") {
  const section = getSuggestionCallbackSection(data);
  if (!section) return true;
  if (data.startsWith(callBacks.aiSectionSuggestContextCancel)) {
    return state === `ai_suggest_context_${section}`;
  }
  return state === `ai_chat_${section}`
    || state === `ai_suggest_context_${section}`
    || state.startsWith(`ai_manage_${section}_`);
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

  await updateUserState(ctx.userId, `ai_suggest_context_${section}`);
  if (ctx.user) ctx.user.state = `ai_suggest_context_${section}`;
  await setNavigationMode(ctx, `ai_suggestion_mode:${section}`);
  if (ctx.user) ctx.user.navigationMode = `ai_suggestion_mode:${section}`;

  const placeholder = await startAiPlaceholder(ctx, [
    messages[lang].aiThinking,
    messages[lang].aiThinkingStill,
    messages[lang].aiThinkingAlmost,
    messages[lang].aiThinkingLonger,
  ], {
    placeholder: placeholderMessage,
    retainSteps: true,
    initialExtra: { reply_markup: { remove_keyboard: true } },
    fallbackText: paidSuggestion ? messages[lang].aiSuggestionPaidRefunded : messages[lang].aiNoResponse,
    fallbackExtra: aiSuggestionModeKeyboard(lang, section),
    timeoutMs: AI_PLACEHOLDER_TIMEOUT_MS,
    onFallback: paidSuggestion
      ? () => refundPaidSuggestion(
        paidSuggestion.quote._id,
        paidSuggestion.spend?.transaction?._id,
        { reason: "ai_paid_suggestion_timeout" },
      )
      : undefined,
  });
  const quota = paidSuggestion ? { ok: true, paid: true } : await consumeAiSuggestionQuota(ctx.userId, section);
  if (!quota.ok) {
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
      quota.reason === "limit"
        ? formatSuggestionLimitMessage(lang, quota.resetAt)
        : messages[lang].aiNoResponse,
      quota.reason === "limit"
        ? aiSuggestionLimitKeyboard(lang, section)
        : aiSuggestionModeKeyboard(lang, section),
    );
  }

  let suggestionResult = null;
  for (let attempt = 0; attempt < AI_SUGGESTION_MAX_ATTEMPTS; attempt += 1) {
    const retryInstruction = "Suggest a different item. The previous one was already known.";
    suggestionResult = await getAiSingleSuggestion({
      mode: section,
      lang,
      userText: attempt === 0
        ? (userText || (section === "random" ? "Suggest one thing for me" : `Suggest one ${section} item`))
        : retryInstruction,
      topTenItems,
      watchlistItems: getPromptWatchlistItems(watchlistItems),
      recentSuggestionItems,
      rejectedSuggestionItems,
      personalized: true,
      tasteStyleHint,
    });

    if (!suggestionResult.ok || !suggestionResult.title) {
      break;
    }

    const duplicateMatch = getAiListDuplicateMatch(suggestionResult.title, blockedSuggestionItems);
    if (!duplicateMatch) {
      break;
    }

    suggestionResult = { ok: false, reason: "duplicate_suggestion" };
  }

  if (placeholder.isSettled()) {
    if (!paidSuggestion) await refundAiSuggestionQuota(ctx.userId, section, quota.consumedAt);
    return null;
  }

  if (!suggestionResult.ok || !suggestionResult.title) {
    if (paidSuggestion) {
      await refundPaidSuggestion(
        paidSuggestion.quote._id,
        paidSuggestion.spend?.transaction?._id,
      );
      return placeholder.finish(
        messages[lang].aiSuggestionPaidRefunded,
        aiSuggestionModeKeyboard(lang, section),
      );
    }
    const fallbackMessage = await placeholder.finish(
      messages[lang].aiNoResponse,
      aiSuggestionModeKeyboard(lang, section),
    );
    try {
      await refundAiSuggestionQuota(ctx.userId, section, quota.consumedAt);
    } catch (error) {
      logger.warn("Failed to refund free AI suggestion quota after fallback", error);
    }
    return fallbackMessage;
  }

  if (paidSuggestion) {
    await completePaidSuggestion(paidSuggestion.quote._id, suggestionResult.title);
  }
  await addAiRecentSuggestion(ctx.userId, section, suggestionResult.title, AI_RECENT_SUGGESTIONS_LIMIT);
  setPendingSuggestion(ctx.userId, section, suggestionResult.title, suggestionResult.reason || "");
  await updateUserState(ctx.userId, `ai_chat_${section}`);
  if (ctx.user) ctx.user.state = `ai_chat_${section}`;
  await setNavigationMode(ctx, `ai_suggestion_result:${section}`);
  if (ctx.user) ctx.user.navigationMode = `ai_suggestion_result:${section}`;
  const resultMessage = await placeholder.finish(
    formatSuggestionResultMessage(lang, suggestionResult.title, suggestionResult.reason, userText),
    aiSuggestionCopyKeyboard(lang, suggestionResult.title),
  );
  if (resultMessage) {
    await ctx.reply(messages[lang].aiSuggestionChooseAction, aiSuggestionAddKeyboard(lang, section));
  }
  return resultMessage;
}

function getWatchStatusCopy(lang, section) {
  return {
    togglePrompt: getSectionMessage(messages, lang, "aiWatchlistTogglePrompt", section, "aiWatchlistTogglePrompt"),
    doneText: getSectionMessage(messages, lang, "aiWatchlistWatchedOn", section, "aiWatchlistWatchedOn"),
    pendingText: getSectionMessage(messages, lang, "aiWatchlistWatchedOff", section, "aiWatchlistWatchedOff"),
  };
}

function formatSuggestionAddedMessage(lang, section, markDone = false) {
  if (markDone) {
    return getSectionMessage(messages, lang, "aiSuggestionAddedDone", section, "aiSuggestionAddedDone")
      .replace("{listName}", getSectionListLabel(messages, lang, section));
  }
  return messages[lang].aiSuggestionAdded.replace("{listName}", getSectionListLabel(messages, lang, section));
}

function setCtxAiListItems(ctx, section, listType, items = []) {
  if (!ctx.user) return;
  if (!ctx.user.aiLists) ctx.user.aiLists = {};
  if (!ctx.user.aiLists[section]) ctx.user.aiLists[section] = {};
  ctx.user.aiLists[section][listType] = items;
}

async function enterAiSection(ctx, lang, section, helpers) {
  await ctx.answerCb?.();
  await clearAiActionMessage(ctx, { waitForDelete: false, fallbackToEdit: false });
  await clearRememberedAiListMessage(ctx, { waitForDelete: false });
  await clearAiSectionEntryMessage(ctx, [ctx.callbackMessageId]);
  await helpers.deleteCallbackMessageIfPossible?.(ctx);
  await rememberAiSectionEntryMessage(ctx, null);
  const titleText = `${getSectionEmoji(section)} ${getSectionLabel(messages, lang, section)}`;
  const banner = AI_SECTION_BANNERS[section] || null;
  if (!banner) {
    await sendNavigationFootprint(ctx, { lang, destination: "aiSection", title: titleText });
  }
  return openAiListManager(ctx, lang, section, "topTen", {
    banner,
  });
}

async function handleAiCallback(ctx, lang, helpers) {
  const data = ctx.callbackData || "";

  if (!isSuggestionCallbackValidForState(data, ctx.user?.state || "")) {
    await ctx.answerCb?.();
    await clearAiPendingInputPrompt(ctx);
    return helpers.deleteCallbackMessageIfPossible(ctx);
  }

  if (data.startsWith(callBacks.aiTasteRecheckConfirm)) {
    await ctx.answerCb?.();
    const publicCode = data.replace(callBacks.aiTasteRecheckConfirm, "").trim();
    const paid = await confirmTasteLabelRecheck(ctx.userId, publicCode);
    if (!paid.ok) {
      if (paid.reason === "insufficient_balance") {
        return helpers.editCallbackMessageOrReply(
          ctx,
          messages[lang].aiTasteRecheckInsufficient
            .replace("{cost}", formatStarNumber(paid.quote?.quotedCost ?? starEconomy.tasteLabelRecheckCost, lang))
            .replace("{balance}", formatStarNumber(paid.balance, lang)),
        );
      }
      if (paid.reason === "list_changed") {
        return helpers.editCallbackMessageOrReply(ctx, messages[lang].aiTasteRecheckListChanged);
      }
      return helpers.editCallbackMessageOrReply(ctx, messages[lang].aiTasteRecheckUnavailable);
    }

    if (ctx.user && paid.spend?.balance !== undefined) {
      ctx.user.starBalance = Number(paid.spend.balance) || 0;
    }
    const placeholder = await startAiPlaceholder(ctx, [
      messages[lang].aiTasteAnalyzing,
      messages[lang].aiTasteWaitingStill,
      messages[lang].aiTasteWaitingLonger,
    ], {
      placeholder: ctx.callbackMessageId ? { message_id: ctx.callbackMessageId } : null,
    });

    let recalculated;
    try {
      recalculated = await recalculateAiTasteForSection(ctx.userId, paid.quote.section);
    } catch (error) {
      logger.warn("Taste-label recheck failed", error);
      recalculated = { ok: false, reason: "unexpected_error" };
    }
    if (!recalculated.ok) {
      const refund = await refundTasteLabelRecheck(
        paid.quote._id,
        paid.spend?.transaction?._id,
      );
      if (ctx.user && refund.balance !== undefined) {
        ctx.user.starBalance = Number(refund.balance) || 0;
      }
      return placeholder.finish(
        refund.ok ? messages[lang].aiTasteRecheckRefunded : messages[lang].aiTemporaryUnavailable,
      );
    }

    const completed = await completeTasteLabelRecheck(
      paid.quote._id,
      recalculated.suggestedLabelKeys,
      recalculated.suggestionInsight,
    );
    if (!completed.ok) logger.warn("Taste-label recheck result could not be finalized", completed);
    if (ctx.user) {
      if (!ctx.user.aiTaste) ctx.user.aiTaste = {};
      ctx.user.aiTaste[paid.quote.section] = recalculated.taste;
    }
    return placeholder.finish(
      withTasteInsight(
        messages[lang][recalculated.hadActiveLabel ? "aiTasteRecheckDifferent" : "aiTasteRecheckDifferentNoLabel"],
        recalculated.suggestionInsight,
      ),
      aiTasteSuggestionKeyboard(lang, paid.quote.section, recalculated.suggestedLabelKeys, {
        selectedNoLabel: !recalculated.hadActiveLabel,
      }),
    );
  }

  if (data.startsWith(callBacks.aiTasteRecheckCancel)) {
    await ctx.answerCb?.();
    const publicCode = data.replace(callBacks.aiTasteRecheckCancel, "").trim();
    await cancelTasteLabelRecheck(ctx.userId, publicCode);
    return helpers.editCallbackMessageOrReply(ctx, messages[lang].aiTasteRecheckCancelled);
  }

  if (data.startsWith(callBacks.aiTasteRecheck)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiTasteRecheck, "").trim();
    const quoteResult = await createTasteLabelRecheckQuote(ctx.userId, section);
    if (!quoteResult.ok) {
      const text = quoteResult.reason === "incomplete_list"
        ? messages[lang].aiTasteRecheckListChanged
        : messages[lang].aiTasteRecheckUnavailable;
      return helpers.editCallbackMessageOrReply(ctx, text);
    }
    return helpers.editCallbackMessageOrReply(
      ctx,
      messages[lang][quoteResult.quote.previousClassificationStatus === "skipped"
        ? "aiTasteRecheckQuoteNoLabel"
        : "aiTasteRecheckQuote"]
        .replace("{cost}", formatStarNumber(quoteResult.quote.quotedCost, lang))
        .replace("{balance}", formatStarNumber(quoteResult.balance, lang)),
      aiTasteRecheckConfirmKeyboard(lang, quoteResult.quote.publicCode),
    );
  }

  if (data.startsWith(callBacks.aiTasteRetry)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiTasteRetry, "").trim();
    if (!["movies", "music", "books"].includes(section)) return ctx.reply(messages[lang].unknownAction);
    return sendTasteLabelReview(ctx, lang, section, {
      withPlaceholder: true,
      placeholderMessage: ctx.callbackMessageId ? { message_id: ctx.callbackMessageId } : null,
      retryFailed: true,
    });
  }

  if (data.startsWith(callBacks.aiTasteReview)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiTasteReview, "").trim();
    if (!["movies", "music", "books"].includes(section)) return ctx.reply(messages[lang].unknownAction);
    const taste = getAiTasteFromUser(ctx.user, section);
    const retryFailed = taste.classificationStatus === "needs_choice" && !taste.freeClassificationUsedAt;
    return sendTasteLabelReview(ctx, lang, section, {
      withPlaceholder: retryFailed,
      retryFailed,
      replaceMessage: !retryFailed && ctx.callbackMessageId
        ? { message_id: ctx.callbackMessageId }
        : null,
    });
  }

  if (data === callBacks.aiTasteClose) {
    await ctx.answerCb?.();
    return helpers.deleteCallbackMessageIfPossible(ctx);
  }

  if (data.startsWith(callBacks.aiTasteChoose)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiTasteChoose, "").trim();
    if (!["movies", "music", "books"].includes(section)) return ctx.reply(messages[lang].unknownAction);
    const taste = getAiTasteFromUser(ctx.user, section);
    if (!taste.suggestedLabelKeys.length) return sendTasteLabelReview(ctx, lang, section, {
      replaceMessage: ctx.callbackMessageId ? { message_id: ctx.callbackMessageId } : null,
    });
    return helpers.editCallbackMessageOrReply(ctx,
      withTasteInsight(messages[lang].aiTasteSavedSuggestionsPrompt, taste.suggestionInsight),
      aiTasteSuggestionKeyboard(lang, section, taste.suggestedLabelKeys, {
        selectedLabelKey: taste.labelKey,
        includeClose: true,
      }));
  }

  if (data.startsWith(callBacks.aiTasteConfirm)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiTasteConfirm, "");
    const [section = "", labelKey = ""] = payload.split(":");
    if (!isAllowedTasteLabel(section, labelKey)) return ctx.reply(messages[lang].unknownAction);
    const result = await confirmAiTasteLabel(ctx.userId, section, labelKey);
    if (result.reason === "stale_suggestion") return sendTasteLabelReview(ctx, lang, section);
    if (!result.ok) return ctx.reply(messages[lang].aiTemporaryUnavailable);
    if (ctx.user) {
      if (!ctx.user.aiTaste) ctx.user.aiTaste = {};
      ctx.user.aiTaste[section] = result.taste;
    }
    await helpers.deleteCallbackMessageIfPossible(ctx);
    return openAiListManager(ctx, lang, section, "topTen");
  }

  if (data.startsWith(callBacks.aiTasteSkip)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiTasteSkip, "").trim();
    const result = await skipAiTasteLabel(ctx.userId, section);
    if (result.reason === "stale_suggestion") return sendTasteLabelReview(ctx, lang, section, {
      replaceMessage: ctx.callbackMessageId ? { message_id: ctx.callbackMessageId } : null,
    });
    if (!result.ok) return ctx.reply(messages[lang].aiTemporaryUnavailable);
    if (ctx.user?.aiTaste?.[section]) {
      ctx.user.aiTaste[section].labelKey = "";
      ctx.user.aiTaste[section].suggestedLabelKeys = result.suggestedLabelKeys;
      ctx.user.aiTaste[section].suggestionInsight = result.suggestionInsight;
      ctx.user.aiTaste[section].classificationStatus = "skipped";
    }
    await helpers.deleteCallbackMessageIfPossible(ctx);
    return openAiListManager(ctx, lang, section, "topTen");
  }

  if (data.startsWith(callBacks.aiListManageMenu)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageMenu, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    await helpers.deleteCallbackMessageIfPossible(ctx);
    return openAiListManager(ctx, lang, section, listType);
  }

  if (data.startsWith(callBacks.aiListManageShow)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageShow, "");
    const [section = "", rawListType = "", rawFilter = "all"] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    const filter = normalizeWatchlistFilter(rawFilter);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    await helpers.deleteCallbackMessageIfPossible(ctx);
    const managerState = `ai_manage_${section}_${toAiManageStateListType(listType)}`;
    await updateUserState(ctx.userId, managerState);
    if (ctx.user) ctx.user.state = managerState;
    await setNavigationMode(ctx, `ai_list:${section}:${listType}`);
    if (ctx.user) ctx.user.navigationMode = `ai_list:${section}:${listType}`;
    const sectionLabel = listType === "topTen"
      ? getSectionLabelWithEmoji(messages, lang, section)
      : getSectionLabel(messages, lang, section);
    const listLabel = getSectionListLabel(messages, lang, section);
    const title = (listType === "watchlist" ? messages[lang].aiWatchlistTitle : messages[lang].aiTopTenTitle)
      .replace("{section}", sectionLabel)
      .replace("{listName}", listLabel);
    const emptyText = (listType === "watchlist" ? messages[lang].aiWatchlistEmpty : messages[lang].aiTopTenEmpty)
      .replace("{section}", sectionLabel)
      .replace("{listName}", listLabel);
    const allWatchlistItems = getAiListItemsFromUser(ctx.user, section, "watchlist");
    const items = listType === "watchlist"
      ? getWatchlistItemsByStatusFromUser(ctx.user, section, filter).map((entry) => ({
        ...entry,
        commandIndex: allWatchlistItems.findIndex((candidate) => candidate.title === entry.title) + 1,
      }))
      : getAiListItemsFromUser(ctx.user, section, listType);
    const itemCount = getAiListItemsFromUser(ctx.user, section, listType).length;
    const hasItems = itemCount > 0;
    const listText = listType === "watchlist"
      ? formatAiItemsList(title, items, filter === "all" ? emptyText : messages[lang].aiWatchlistFilterEmpty, {
        includeWatched: true,
        topTenTitleSet: toTitleSet(getAiListItemsFromUser(ctx.user, section, "topTen")),
        includeActions: true,
        canPromote: getAiListItemsFromUser(ctx.user, section, "topTen").length < operationalLimits.aiTopTenItems,
        lang,
        section,
        listType,
      })
      : formatAiItemsList(title, items, emptyText, {
        includeActions: true,
        lang,
        section,
        listType,
      });
    const titledListText = withAiSectionTitle(lang, section, listText);

    const listMessage = await ctx.reply(
      titledListText,
      aiListManageMenuKeyboard(lang, section, listType, {
        hasItems,
        itemCount,
        filter,
        watchlistItems: allWatchlistItems,
        hasWatchlistItems: allWatchlistItems.length > 0,
      }),
    );
    await replaceRememberedAiListMessage(ctx, section, listType, listMessage);
    if (listType === "watchlist" && filter !== "all") {
      await setNavigationMode(ctx, `ai_list_filter:${section}:${filter}`);
      if (ctx.user) ctx.user.navigationMode = `ai_list_filter:${section}:${filter}`;
    }
    return listMessage;
  }

  if (data.startsWith(callBacks.aiTopTenInsight)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiTopTenInsight, "").trim();
    if (!["movies", "music", "books"].includes(section)) return ctx.reply(messages[lang].unknownAction);

    const items = getAiListItemsFromUser(ctx.user, section, "topTen");
    await helpers.deleteCallbackMessageIfPossible(ctx);
    await ctx.reply(`${messages[lang].aiTopTenInsightIntro}\n\n${buildTopTenInsightMessage(
      lang,
      section,
      items,
      getAiTasteFromUser(ctx.user, section),
    )}`);
    const actionMessage = await ctx.reply(
      await buildAiListManagerMessage({ ctx, lang, section, listType: "topTen" }),
      aiListManageMenuKeyboard(lang, section, "topTen", {
        hasItems: items.length > 0,
        itemCount: items.length,
        hasWatchlistItems: getAiListItemsFromUser(ctx.user, section, "watchlist").length > 0,
      }),
    );
    await rememberAiActionMessage(ctx, `manage:${section}:topTen`, actionMessage);
    return actionMessage;
  }

  if (data.startsWith(callBacks.aiListManageTogglePicker)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageTogglePicker, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || listType !== "watchlist") return ctx.reply(messages[lang].unknownAction);

    const items = getAiListItemsFromUser(ctx.user, section, "watchlist");
    if (!items.length) {
      return ctx.reply(messages[lang].aiWatchlistFilterEmpty, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const statusCopy = getWatchStatusCopy(lang, section);
    return helpers.editCallbackMessageOrReply(ctx, statusCopy.togglePrompt, aiListActionItemsKeyboard(lang, section, "watchlist", "toggle", items));
  }

  if (data.startsWith(callBacks.aiListManageToggleItem)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageToggleItem, "");
    const [section = "", rawListType = "", itemIndexRaw = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    const itemIndex = Number(itemIndexRaw);
    if (!section || listType !== "watchlist" || !Number.isInteger(itemIndex) || itemIndex < 0) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const items = getAiListItemsFromUser(ctx.user, section, "watchlist");
    const itemTitle = items[itemIndex]?.title;
    if (!itemTitle) {
      await helpers.deleteCallbackMessageIfPossible(ctx);
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const toggled = await toggleWatchlistItemWatched(ctx.userId, section, itemTitle);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    if (!toggled.ok) {
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    setCtxAiListItems(ctx, section, "watchlist", toggled.items);
    const statusCopy = getWatchStatusCopy(lang, section);
    return ctx.reply(
      await buildAiListManagerMessage({
        ctx,
        lang,
        section,
        listType: "watchlist",
        prefix: toggled.item?.watched ? statusCopy.doneText : statusCopy.pendingText,
      }),
      aiListManageMenuKeyboard(lang, section, "watchlist"),
    );
  }

  if (data.startsWith(callBacks.aiListManageCommentPicker)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageCommentPicker, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    const items = getAiListItemsFromUser(ctx.user, section, listType);
    if (!items.length) {
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));
    }

    const isTopTen = listType === "topTen";
    return helpers.editCallbackMessageOrReply(
      ctx,
      isTopTen ? messages[lang].aiTopTenCommentPrompt : messages[lang].aiWatchlistCommentPrompt,
      aiListActionItemsKeyboard(lang, section, listType, "comment", items),
    );
  }

  if (data.startsWith(callBacks.aiListManageCommentItem)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageCommentItem, "");
    const [section = "", rawListType = "", itemIndexRaw = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    const itemIndex = Number(itemIndexRaw);
    if (!section || !listType || !Number.isInteger(itemIndex) || itemIndex < 0) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const items = getAiListItemsFromUser(ctx.user, section, listType);
    const itemTitle = items[itemIndex]?.title;
    if (!itemTitle) {
      await helpers.deleteCallbackMessageIfPossible(ctx);
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));
    }

    await helpers.deleteCallbackMessageIfPossible(ctx);
    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}_comment_input`);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", itemTitle);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", listType);
    const promptText = formatAiCommentPrompt(lang, listType, itemTitle);
    const prompt = await ctx.reply(
      promptText,
      { reply_markup: { remove_keyboard: true } },
    );
    const editedPrompt = await editPlaceholder(
      ctx,
      prompt,
      promptText,
      aiListCancelCommentKeyboard(lang, section, listType),
    );
    await rememberAiPendingInputPrompt(ctx, editedPrompt || prompt);
    return editedPrompt;
  }

  if (data.startsWith(callBacks.aiListManageCancelComment)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageCancelComment, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    const expectedState = `ai_manage_${section}_${toAiManageStateListType(listType)}_comment_input`;
    if (ctx.user?.state !== expectedState) {
      await clearAiPendingInputPrompt(ctx);
      return helpers.deleteCallbackMessageIfPossible(ctx);
    }

    await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", null);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", null);
    await clearAiPendingInputPrompt(ctx);
    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}`);
    return openAiListManager(ctx, lang, section, listType);
  }

  if (data.startsWith(callBacks.aiListManagePromotePicker)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManagePromotePicker, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || listType !== "watchlist") return ctx.reply(messages[lang].unknownAction);

    const watchedItems = getAiListItemsFromUser(ctx.user, section, "watchlist")
      .filter((entry) => entry?.watched);
    if (!watchedItems.length) {
      return ctx.reply(messages[lang].aiWatchlistPromoteDoneOnlyEmpty, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const topTenItems = getAiListItemsFromUser(ctx.user, section, "topTen");
    if (topTenItems.length >= operationalLimits.aiTopTenItems) {
      return ctx.reply(formatAiLimitMessage(lang, "aiTopTenLimitReached"), aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const topTenTitleSet = toTitleSet(topTenItems);
    const watchlistItems = watchedItems.filter((entry) => !topTenTitleSet.has(String(entry?.title || "").trim().toLowerCase()));
    if (!watchlistItems.length) {
      return ctx.reply(messages[lang].aiWatchlistPromoteNoEligibleItems, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    return helpers.editCallbackMessageOrReply(
      ctx,
      messages[lang].aiWatchlistPromotePrompt,
      aiListActionItemsKeyboard(lang, section, "watchlist", "promote", watchlistItems),
    );
  }

  if (data.startsWith(callBacks.aiListManagePromoteItem)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManagePromoteItem, "");
    const [section = "", rawListType = "", itemIndexRaw = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    const itemIndex = Number(itemIndexRaw);
    if (!section || listType !== "watchlist" || !Number.isInteger(itemIndex) || itemIndex < 0) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const topTenTitleSet = toTitleSet(getAiListItemsFromUser(ctx.user, section, "topTen"));
    const watchlistItems = getAiListItemsFromUser(ctx.user, section, "watchlist")
      .filter((entry) => entry?.watched && !topTenTitleSet.has(String(entry?.title || "").trim().toLowerCase()));
    const itemTitle = watchlistItems[itemIndex]?.title;
    if (!itemTitle) {
      await helpers.deleteCallbackMessageIfPossible(ctx);
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const promoteResult = await promoteWatchlistItemToTopTen(ctx.userId, section, itemTitle, operationalLimits.aiTopTenItems);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    if (!promoteResult.ok) {
      if (promoteResult.reason === "top_ten_limit") {
        return ctx.reply(formatAiLimitMessage(lang, "aiTopTenLimitReached"), aiListManageMenuKeyboard(lang, section, "watchlist"));
      }
      if (promoteResult.reason === "exists") {
        return ctx.reply(messages[lang].aiWatchlistPromoteAlreadyTopTen, aiListManageMenuKeyboard(lang, section, "watchlist"));
      }
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    await syncAiTasteForSection(ctx.userId, section);
    setCtxAiListItems(ctx, section, "watchlist", promoteResult.watchlistItems);
    setCtxAiListItems(ctx, section, "topTen", promoteResult.topTenItems);
    applyStarRewardsToContext(ctx, promoteResult.starRewards);
    await notifyExternalReferralReward(ctx, messages, promoteResult.externalReferralReward);
    const starNotice = buildStarRewardNotice(messages, lang, promoteResult.starRewards, promoteResult.starProgress);
    return ctx.reply(
      await buildAiListManagerMessage({
        ctx,
        lang,
        section,
        listType: "watchlist",
        prefix: [messages[lang].aiWatchlistPromotedToTopTen, starNotice].filter(Boolean).join("\n\n"),
      }),
      aiListManageMenuKeyboard(lang, section, "watchlist"),
    );
  }

  if (data.startsWith(callBacks.aiListManageCancelAdd)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageCancelAdd, "");
    const [section = "", rawListType = "", action = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    const managerState = `ai_manage_${section}_${toAiManageStateListType(listType)}`;
    const expectedState = `${managerState}_add_input`;
    const isCompletedListBack = action === "back" && ctx.user?.state === managerState;
    if (ctx.user?.state !== expectedState && !isCompletedListBack) {
      await clearAiPendingInputPrompt(ctx);
      return helpers.deleteCallbackMessageIfPossible(ctx);
    }

    const promptMessageId = Number(ctx.user?.aiPendingInputMessageId);
    await clearAiPendingInputPrompt(ctx, { waitForDelete: false, fallbackToEdit: false });
    await updateUserState(ctx.userId, managerState);
    if (promptMessageId !== Number(ctx.callbackMessageId)) {
      await helpers.deleteCallbackMessageIfPossible(ctx);
    }
    if (action === "back") {
      return openAiListManager(ctx, lang, section, listType);
    }
    await ctx.reply(messages[lang].aiListManageAddCanceled);
    return openAiListManager(ctx, lang, section, listType);
  }

  if (data.startsWith(callBacks.aiListManageAdd)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageAdd, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    const addInputState = `ai_manage_${section}_${toAiManageStateListType(listType)}_add_input`;
    await updateUserState(ctx.userId, addInputState);
    if (ctx.user) ctx.user.state = addInputState;
    const isInterestTopTen = section === "random" && listType === "topTen";
    const currentItems = isInterestTopTen
      ? getAiListItemsFromUser(ctx.user, "random", "topTen")
      : [];
    const trackedListMessageId = Number(ctx.user?.aiLastListMessageId);
    await deleteRememberedAiListMessage(ctx, section, listType, { waitForDelete: false });
    if (trackedListMessageId !== Number(ctx.callbackMessageId)) {
      await helpers.deleteCallbackMessageIfPossible(ctx);
    }
    const prompt = await ctx.reply(
      getAiListAddPrompt(lang, section, listType),
      isInterestTopTen
        ? aiInterestTopTenChipKeyboard(lang, currentItems.map((entry) => entry.title))
        : aiListCancelAddKeyboard(lang, section, listType),
    );
    await rememberAiPendingInputPrompt(ctx, prompt);
    return prompt;
  }

  if (data.startsWith(callBacks.aiInterestTopTenMore)) {
    await ctx.answerCb?.();
    if (ctx.user?.state !== "ai_manage_random_top_ten_add_input") {
      await clearAiPendingInputPrompt(ctx);
      return helpers.deleteCallbackMessageIfPossible(ctx);
    }

    const [pageRaw = "0", action = ""] = data.replace(callBacks.aiInterestTopTenMore, "").split(":");
    const page = Number(pageRaw) || 0;
    const currentItems = getAiListItemsFromUser(ctx.user, "random", "topTen");
    return helpers.editCallbackMessageOrReply(
      ctx,
      messages[lang].aiInterestTopTenAddPrompt,
      aiInterestTopTenChipKeyboard(
        lang,
        currentItems.map((entry) => entry.title),
        page,
        { backToList: action === "back" },
      ),
    );
  }

  if (data.startsWith(callBacks.aiInterestTopTenChip)) {
    await ctx.answerCb?.();
    const chipIndex = Number(data.replace(callBacks.aiInterestTopTenChip, ""));
    const item = getInterestTopTenChipTitle(chipIndex, lang);
    if (!item) return ctx.reply(messages[lang].unknownAction);
    if (ctx.user?.state !== "ai_manage_random_top_ten_add_input") {
      await clearAiPendingInputPrompt(ctx);
      return helpers.deleteCallbackMessageIfPossible(ctx);
    }

    await helpers.deleteCallbackMessageIfPossible(ctx);
    await deleteRememberedAiListMessage(ctx, "random", "topTen");
    await clearAiPendingInputPrompt(ctx);

    const currentItems = getAiListItemsFromUser(ctx.user, "random", "topTen");
    const result = await addAiListItem(ctx.userId, "random", "topTen", { title: item, comment: "" }, operationalLimits.aiTopTenItems);

    if (!result.ok) {
      if (result.reason === "exists") {
        return ctx.reply(
          getDuplicateTopTenMessage(lang, result, currentItems.length),
          aiInterestTopTenChipKeyboard(lang, currentItems.map((entry) => entry.title), 0, { backToList: true }),
        );
      }
      if (result.reason === "limit") {
        await updateUserState(ctx.userId, "ai_manage_random_top_ten");
        if (ctx.user) ctx.user.state = "ai_manage_random_top_ten";
        return ctx.reply(formatAiLimitMessage(lang, "aiTopTenLimitReachedHere"), aiListManageMenuKeyboard(lang, "random", "topTen", {
          hasItems: currentItems.length > 0,
          itemCount: currentItems.length,
        }));
      }
      if (result.reason === "invalid_item_quality") {
        const errorMessage = messages[lang].aiTopTenInvalidItemQualityRandom || messages[lang].aiTopTenInvalidItemQuality;
        return ctx.reply(errorMessage, aiListManageMenuKeyboard(lang, "random", "topTen"));
      }
      return ctx.reply(messages[lang].aiListInvalidInput, aiListManageMenuKeyboard(lang, "random", "topTen"));
    }

    if (ctx.user) {
      if (!ctx.user.aiLists) ctx.user.aiLists = {};
      if (!ctx.user.aiLists.random) ctx.user.aiLists.random = {};
      ctx.user.aiLists.random.topTen = result.items;
    }
    applyStarRewardsToContext(ctx, result.starRewards);
    await notifyExternalReferralReward(ctx, messages, result.externalReferralReward);
    const starNotice = buildStarRewardNotice(messages, lang, result.starRewards, result.starProgress);
    const listIsFull = result.items.length >= operationalLimits.aiTopTenItems;
    await updateUserState(ctx.userId, listIsFull ? "ai_manage_random_top_ten" : "ai_manage_random_top_ten_add_input");
    if (ctx.user) ctx.user.state = listIsFull ? "ai_manage_random_top_ten" : "ai_manage_random_top_ten_add_input";
    const placeholder = await startAiPlaceholder(ctx, [
      messages[lang].aiThinking,
      messages[lang].aiThinkingStill,
      messages[lang].aiThinkingAlmost,
    ]);
    const savedText = await buildTopTenSavedMessage({
      ctx,
      lang,
      section: "random",
      item,
      items: result.items,
      savedMessageKey: "aiInterestTopTenChipSaved",
    });
    const saved = await placeholder.finish(
      [savedText, starNotice].filter(Boolean).join("\n\n"),
      listIsFull
        ? undefined
        : aiInterestTopTenChipKeyboard(lang, result.items.map((entry) => entry.title), 0, { backToList: true }),
    );
    if (listIsFull) {
      return openAiListManager(ctx, lang, "random", "topTen");
    }
    await rememberAiPendingInputPrompt(ctx, saved);
    return saved;
  }

  if (data.startsWith(callBacks.aiListManageRemovePicker)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageRemovePicker, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    const items = getAiListItemsFromUser(ctx.user, section, listType);
    if (!items.length) return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));

    return helpers.editCallbackMessageOrReply(ctx, messages[lang].aiListManageRemovePrompt, aiListRemoveItemsKeyboard(lang, section, listType, items));
  }

  if (data.startsWith(callBacks.aiListManageRemoveItem)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageRemoveItem, "");
    const [section = "", rawListType = "", itemIndexRaw = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    const itemIndex = Number(itemIndexRaw);
    if (!section || !listType || !Number.isInteger(itemIndex) || itemIndex < 0) return ctx.reply(messages[lang].unknownAction);

    const currentItems = getAiListItemsFromUser(ctx.user, section, listType);
    const itemTitle = currentItems[itemIndex]?.title;
    if (!itemTitle) {
      await helpers.deleteCallbackMessageIfPossible(ctx);
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));
    }

    const removeResult = await removeAiListItem(ctx.userId, section, listType, itemTitle);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    if (!removeResult.ok) return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));

    if (listType === "topTen") await syncAiTasteForSection(ctx.userId, section);
    setCtxAiListItems(ctx, section, listType, removeResult.items);

    await deleteRememberedAiListMessage(ctx, section, listType);
    const removedText = messages[lang].aiListRemovedNamed.replace("{item}", itemTitle);

    return ctx.reply(
      await buildAiListManagerMessage({ ctx, lang, section, listType, prefix: removedText }),
      aiListManageMenuKeyboard(lang, section, listType, {
        hasItems: removeResult.items.length > 0,
        itemCount: removeResult.items.length,
        hasWatchlistItems: getAiListItemsFromUser(ctx.user, section, "watchlist").length > 0,
      }),
    );
  }

  if (data.startsWith(callBacks.aiListManageBack)) {
    const section = data.replace(callBacks.aiListManageBack, "");
    if (!section) {
      await ctx.answerCb?.();
      return ctx.reply(messages[lang].unknownAction);
    }

    await ctx.answerCb?.();
    await clearAiPendingInputPrompt(ctx, { waitForDelete: false, fallbackToEdit: false });
    await clearAiActionMessage(ctx, { waitForDelete: false, fallbackToEdit: false });
    const stateListType = String(ctx.user?.state || "").includes("_watchlist") ? "watchlist" : "topTen";
    if (stateListType === "watchlist") {
      await deleteRememberedAiListMessage(ctx, section, "watchlist");
      return openAiListManager(ctx, lang, section, "topTen");
    }

    await updateUserState(ctx.userId, "idle");
    const callbackMessageId = Number(ctx.callbackMessageId);
    const currentListIsCallbackMessage = Number(ctx.user?.aiLastListMessageId) === callbackMessageId;
    await clearAiSectionEntryMessage(ctx, [], { waitForDelete: false });
    const shouldClearKeyboard = helpers.hasTemporaryReplyKeyboard?.(ctx);
    if (currentListIsCallbackMessage) {
      await deleteRememberedAiListMessage(ctx, section, stateListType);
    } else {
      await clearRememberedAiListMessage(ctx, { waitForDelete: false });
      await helpers.deleteCallbackMessageIfPossible?.(ctx);
    }
    await sendNavigationFootprint(ctx, { lang, destination: "taste", removeKeyboard: shouldClearKeyboard });
    await setNavigationMode(ctx, MODES.FAVORITES);
    if (ctx.user) ctx.user.navigationMode = MODES.FAVORITES;
    return sendAiAssistantHub(ctx, lang);
  }

  if (data.startsWith(callBacks.aiSectionAnotherSuggestion)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiSectionAnotherSuggestion, "").trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    if (topTenItems.length < 3) return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));

    await helpers.deleteCallbackMessageIfPossible(ctx);
    return sendFollowupSuggestion({
      ctx,
      lang,
      section,
      watchlistItems: getAiListTitlesFromUser(ctx.user, section, "watchlist"),
      userText: getSuggestionMood(ctx.userId, section),
      placeholderMessage: ctx.callbackMessageId ? { message_id: ctx.callbackMessageId } : null,
    });
  }

  if (data.startsWith(callBacks.aiPaidSuggestionCancel)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiPaidSuggestionCancel, "").trim();
    await helpers.deleteCallbackMessageIfPossible(ctx);
    if (!section) return ctx.reply(messages[lang].unknownAction);
    return openAiListManager(ctx, lang, section, "topTen");
  }

  if (data.startsWith(callBacks.aiPaidSuggestionConfirm)) {
    await ctx.answerCb?.();
    const publicCode = data.replace(callBacks.aiPaidSuggestionConfirm, "").trim();
    const paid = await confirmPaidSuggestion(ctx.userId, publicCode);
    if (!paid.ok) {
      const section = paid.quote?.section || "random";
      if (paid.reason === "insufficient_balance") {
        return helpers.editCallbackMessageOrReply(
          ctx,
          messages[lang].aiSuggestionPaidInsufficient,
          aiSuggestionLimitKeyboard(lang, section),
        );
      }
      if (paid.reason === "quote_expired" || paid.reason === "stale_price") {
        return helpers.editCallbackMessageOrReply(ctx, messages[lang].aiSuggestionPaidExpired, aiSuggestionLimitKeyboard(lang, section));
      }
      return helpers.editCallbackMessageOrReply(ctx, messages[lang].aiSuggestionPaidUnavailable, aiSuggestionLimitKeyboard(lang, section));
    }

    if (ctx.user && paid.spend?.balance !== undefined) {
      ctx.user.starBalance = Number(paid.spend.balance) || 0;
    }
    return sendFollowupSuggestion({
      ctx,
      lang,
      section: paid.quote.section,
      watchlistItems: getAiListTitlesFromUser(ctx.user, paid.quote.section, "watchlist"),
      userText: paid.quote.userText || "",
      paidSuggestion: paid,
      placeholderMessage: ctx.callbackMessageId ? { message_id: ctx.callbackMessageId } : null,
    });
  }

  if (data.startsWith(callBacks.aiSectionSuggestContextCancel)) {
    const section = data.replace(callBacks.aiSectionSuggestContextCancel, "").trim();
    if (!section) {
      await ctx.answerCb?.();
      return ctx.reply(messages[lang].unknownAction);
    }

    await ctx.answerCb?.();
    await updateUserState(ctx.userId, `ai_chat_${section}`);
    await clearAiPendingInputPrompt(ctx);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    return openAiListManager(ctx, lang, section, "topTen");
  }

  if (data.startsWith(callBacks.aiSectionSuggestMenu)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiSectionSuggestMenu, "").trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    if (topTenItems.length < 3) {
      await forgetRememberedAiListMessage(ctx);
      const warning = await ctx.reply(getNeedTopTenMessage(lang, section), aiSuggestionNeedTopTenKeyboard(lang, section));
      await rememberAiActionMessage(ctx, `suggest_need_top_ten:${section}`, warning);
      return warning;
    }

    await helpers.deleteCallbackMessageIfPossible(ctx);
    return promptSuggestionMode(ctx, lang, section);
  }

  if (data.startsWith(callBacks.aiSectionSuggestNeedTopTenAck)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiSectionSuggestNeedTopTenAck, "").trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);

    const actionMessageId = Number(ctx.user?.aiActionMessageId);
    await clearAiActionMessage(ctx);
    if (actionMessageId !== Number(ctx.callbackMessageId)) {
      await helpers.deleteCallbackMessageIfPossible(ctx);
    }
    return openAiListManager(ctx, lang, section, "topTen");
  }

  if (data.startsWith(callBacks.aiSectionSuggestFromTopTen)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiSectionSuggestFromTopTen, "").trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    if (topTenItems.length < 3) return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));

    await clearAiPendingInputPrompt(ctx);
    const sentSuggestion = await sendFollowupSuggestion({
      ctx,
      lang,
      section,
      watchlistItems: getAiListTitlesFromUser(ctx.user, section, "watchlist"),
      placeholderMessage: ctx.callbackMessageId ? { message_id: ctx.callbackMessageId } : null,
    });

    if (sentSuggestion) return sentSuggestion;
    return ctx.reply(messages[lang].aiTemporaryUnavailable, aiSectionKeyboardForSection(lang, section));
  }

  if (data.startsWith(callBacks.aiSectionRejectSuggestion)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiSectionRejectSuggestion, "").trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);

    const pending = getPendingSuggestion(ctx.userId, section);
    const title = String(pending?.title || "").trim();
    if (!title) return recoverExpiredSuggestion(ctx, lang, section);

    const rejected = await addAiRejectedSuggestion(ctx.userId, section, title, AI_RECENT_SUGGESTIONS_LIMIT);
    if (ctx.user && rejected.ok) {
      if (!ctx.user.aiRejectedSuggestions) ctx.user.aiRejectedSuggestions = {};
      ctx.user.aiRejectedSuggestions[section] = rejected.items;
    }
    clearPendingSuggestion(ctx.userId, section);
    await updateUserState(ctx.userId, `ai_chat_${section}`);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    await setNavigationMode(ctx, `ai_suggestion_next:${section}`);
    if (ctx.user) ctx.user.navigationMode = `ai_suggestion_next:${section}`;
    const actionMessage = await ctx.reply(messages[lang].aiSuggestionRejected, aiSuggestionNextKeyboard(lang, section));
    return actionMessage;
  }

  if (data.startsWith(callBacks.aiSectionAddSuggestion) || data.startsWith(callBacks.aiSectionAddSuggestionDone)) {
    await ctx.answerCb?.();
    const markDone = data.startsWith(callBacks.aiSectionAddSuggestionDone);
    const payload = data.replace(markDone ? callBacks.aiSectionAddSuggestionDone : callBacks.aiSectionAddSuggestion, "");
    const section = payload.trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);

    const pending = getPendingSuggestion(ctx.userId, section);
    const title = String(pending?.title || "").trim();
    const comment = String(pending?.comment || "").trim();
    if (!title) return recoverExpiredSuggestion(ctx, lang, section);

    await helpers.deleteCallbackMessageIfPossible(ctx);
    const result = await addAiListItem(ctx.userId, section, "watchlist", { title, comment, watched: markDone }, operationalLimits.aiWatchlistItems);

    if (!result.ok) {
      if (result.reason === "exists") return ctx.reply(getDuplicateListMessage(lang, result), aiSuggestionAddKeyboard(lang, section));
      if (result.reason === "limit") return ctx.reply(formatAiLimitMessage(lang, "aiSuggestionListFull"), aiListManageMenuKeyboard(lang, section, "watchlist"));
      return ctx.reply(messages[lang].aiTemporaryUnavailable);
    }

    clearPendingSuggestion(ctx.userId, section);
    applyStarRewardsToContext(ctx, result.starRewards);
    await notifyExternalReferralReward(ctx, messages, result.externalReferralReward);
    const starNotice = buildStarRewardNotice(messages, lang, result.starRewards, result.starProgress);
    await updateUserState(ctx.userId, `ai_chat_${section}`);
    await setNavigationMode(ctx, `ai_suggestion_added:${section}`);
    if (ctx.user) ctx.user.navigationMode = `ai_suggestion_added:${section}`;
    return ctx.reply(
      [formatSuggestionAddedMessage(lang, section, markDone), starNotice].filter(Boolean).join("\n\n"),
      aiSuggestionAddedOptionsKeyboard(lang, section),
    );
  }

  if (data === callBacks.aiSuggestMovies) return enterAiSection(ctx, lang, "movies", helpers);
  if (data === callBacks.aiSuggestMusic) return enterAiSection(ctx, lang, "music", helpers);
  if (data === callBacks.aiSuggestBooks) return enterAiSection(ctx, lang, "books", helpers);
  if (data === callBacks.aiSuggestRandom) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    await helpers.deleteCallbackMessageIfPossible(ctx);
    return ctx.reply(messages[lang].profileInterestsMovedToProfile, {
      reply_markup: {
        inline_keyboard: [[
          { text: messages[lang].profileEditInterests, callback_data: callBacks.profileEditInterests },
        ]],
      },
    });
  }

  if (data === callBacks.aiBack) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = helpers.hasTemporaryReplyKeyboard?.(ctx);
    await updateUserState(ctx.userId, "idle");
    await updateProfileField(ctx.userId, "activeDiscussionId", null);
    await clearAiPendingInputPrompt(ctx);
    await helpers.deleteCallbackMessageIfPossible?.(ctx);
    await sendNavigationFootprint(ctx, { lang, destination: "menu", removeKeyboard: shouldClearKeyboard });
    await setNavigationMode(ctx, MODES.GLOBAL);
    if (ctx.user) ctx.user.navigationMode = MODES.GLOBAL;
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  return null;
}

module.exports = {
  handleAiCallback,
  isAiCallback,
  isSuggestionCallbackValidForState,
};
