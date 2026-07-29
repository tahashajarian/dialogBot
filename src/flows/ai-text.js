const messages = require("../messages");
const { getAiConfig } = require("../config");
const { logger } = require("../services/logger");
const { sendBannerPhoto } = require("../services/banner-media");

const AI_PLACEHOLDER_TIMEOUT_MS = getAiConfig().timeoutMs + 3000;
const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
const {
  aiAssistantKeyboard,
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionAddedOptionsKeyboard,
  aiSuggestionCopyKeyboard,
  aiSuggestionNextKeyboard,
  aiPaidSuggestionConfirmKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionContextCancelKeyboard,
  aiListManageMenuKeyboard,
  aiWatchlistCardKeyboard,
  aiListCancelAddKeyboard,
  aiListCancelCommentKeyboard,
  aiInterestTopTenChipKeyboard,
} = require("../keyboards");
const {
  updateProfileField,
  updateUserState,
  addAiListItem,
  removeAiListItem,
  addAiRecentSuggestion,
  consumeAiSuggestionQuota,
  refundAiSuggestionQuota,
  normalizeAiListItem,
  normalizeAiListComment,
  getAiListItemsFromUser,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  getAiRejectedSuggestionTitlesFromUser,
  getAiLikedSuggestionTitlesFromUser,
  setAiListItemComment,
  toggleWatchlistItemWatched,
  promoteWatchlistItemToTopTen,
  getAiTasteFromUser,
  getTasteProgressStatus,
  markAiTasteAutomaticCheckAttempted,
  markSectionTipShownForContext,
  syncAiTasteForSection,
} = require("../services/users");
const { setNavigationMode } = require("../services/reply-keyboard-navigation");
const { getAiSingleSuggestion } = require("../services/ai");
const {
  buildSuggestionAttemptText,
  buildSuggestionCopyText,
} = require("../services/ai-suggestion-quality");
const { startAiPlaceholder } = require("../services/ai-placeholder");
const { sendTasteLabelReview } = require("./ai-taste-labels");
const {
  clearSuggestionMood,
  setPendingSuggestion,
  setSuggestionMood,
} = require("../services/ai-suggestion-cache");
const {
  replyWithKeyboardRemovalNoticeThenInline,
} = require("../services/bot-navigation");
const {
  getAiSectionFromState,
  getSectionEmoji,
  getSectionMessage,
  getSectionListButtonLabel,
  getSectionLabel,
  getSectionListLabel,
  getTasteLabelTitle,
  getTasteLabelStyleHint,
  getSuggestionActionPrompt,
} = require("../services/ai-section");
const { getAiListDuplicateMatch } = require("../services/ai-list-duplicates");
const {
  getAiListAddPrompt,
  resolveAiListAddInput,
} = require("./ai-list-input");
const {
  rememberAiPendingInputPrompt,
  clearAiPendingInputPrompt,
  replaceAiPendingInputPrompt,
} = require("./ai-input-prompts");
const {
  clearAiActionMessage,
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
  deleteRememberedAiListMessage,
  rememberAiActionMessage,
  rememberAiListMessage,
} = require("./ai-cards");
const {
  AI_RECENT_SUGGESTIONS_LIMIT,
  AI_SUGGESTION_CONTEXT_MAX_CHARS,
  AI_SUGGESTION_MAX_ATTEMPTS,
  AI_WATCHLIST_PROMPT_LIMIT,
} = require("../constants/ai");
const { operationalLimits } = require("../services/operational-limits");
const { formatInlineListCaptureTip } = require("../services/inline-list-capture-ui");
const {
  buildAiAssistantMenuMessage,
  buildAiListManagerMessage,
  getWatchlistPage,
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
} = require("../services/ai-list-ui");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
  formatStarNumber,
  notifyExternalReferralReward,
} = require("../services/stars-ui");
const {
  createPaidSuggestionQuote,
  completePaidSuggestion,
  refundPaidSuggestion,
} = require("../services/ai-paid-suggestions");

const AI_MANAGE_STATE_PATTERN = /^ai_manage_(movies|music|books|random)_(watchlist|top_ten)(?:_(add_input|comment_input))?$/;
const AI_SUGGEST_CONTEXT_STATE_PATTERN = /^ai_suggest_context_(movies|music|books|random)$/;
const AI_SUGGEST_GENERATING_STATE_PATTERN = /^ai_suggest_generating_(movies|music|books|random)$/;

function normalizeKeyboardText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\uFE0F/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

function getActiveWatchlistFilter(ctx, section) {
  const match = String(ctx.user?.navigationMode || "").match(
    /^ai_list_filter:(movies|music|books|random):(watched|not_watched)$/,
  );
  return match?.[1] === section ? match[2] : "all";
}

function isAiBackText(text) {
  const normalizedText = normalizeKeyboardText(text);
  const backLabels = [
    messages.fa.aiBack,
    messages.en.aiBack,
  ].map(normalizeKeyboardText);

  if (backLabels.includes(normalizedText)) {
    return true;
  }

  const plainText = normalizedText
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .toLowerCase()
    .trim();

  return plainText === "back" || plainText === "برگشت" || plainText === "بازگشت";
}

function isAiListText(text) {
  const normalizedText = normalizeKeyboardText(text);
  const plainText = normalizedText
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .toLowerCase()
    .trim();

  return plainText === "list" || plainText === "لیست";
}

function isAiSectionListText(text, section) {
  const normalizedText = normalizeKeyboardText(text);
  const labels = [
    getSectionListButtonLabel(messages, "fa", section),
    getSectionListButtonLabel(messages, "en", section),
  ].map(normalizeKeyboardText);
  return labels.includes(normalizedText);
}

function isAiSectionTopTenText(text) {
  const normalizedText = normalizeKeyboardText(text);
  const labels = [
    messages.fa.aiSectionTopTenButton,
    messages.en.aiSectionTopTenButton,
    ...["movies", "music", "books"].flatMap((section) => [
      `${getSectionEmoji(section)} ${messages.fa.aiSectionTopTenButton}`,
      `${getSectionEmoji(section)} ${messages.en.aiSectionTopTenButton}`,
    ]),
  ].map(normalizeKeyboardText);
  return labels.includes(normalizedText);
}

function shouldStartAutomaticTasteCheck(taste = {}) {
  return !taste.freeClassificationAutoAttemptedAt && !taste.freeClassificationUsedAt;
}

function isAiSectionSuggestText(text) {
  const normalizedText = normalizeKeyboardText(text);
  const labels = [
    messages.fa.aiSectionSuggestButton,
    messages.en.aiSectionSuggestButton,
    ...["movies", "music", "books"].flatMap((section) => [
      `${getSectionEmoji(section)} ${messages.fa.aiSectionSuggestButton}`,
      `${getSectionEmoji(section)} ${messages.en.aiSectionSuggestButton}`,
    ]),
  ].map(normalizeKeyboardText);
  return labels.includes(normalizedText);
}

function isSuggestionControlText(text) {
  const normalizedText = normalizeKeyboardText(text);
  if (!normalizedText) return false;
  const labels = [];
  for (const candidateLang of ["fa", "en"]) {
    labels.push(
      messages[candidateLang].aiSuggestionFromTopTenButton,
      messages[candidateLang].aiSuggestionRejectButton,
      messages[candidateLang].aiSuggestionAnotherButton,
      messages[candidateLang].aiSuggestionGoToFavoritesButton,
    );
    for (const section of ["movies", "music", "books", "random"]) {
      const listLabel = getSectionListLabel(messages, candidateLang, section);
      labels.push(
        messages[candidateLang].aiSuggestionAddToListButton.replace("{listName}", listLabel),
        messages[candidateLang].aiSuggestionGoToListButton.replace("{listName}", listLabel),
      );
    }
    labels.push(
      messages[candidateLang].aiSuggestionAddDoneButtonMovies,
      messages[candidateLang].aiSuggestionAddDoneButtonMusic,
      messages[candidateLang].aiSuggestionAddDoneButtonBooks,
      messages[candidateLang].aiSuggestionAddDoneButtonRandom,
    );
  }
  return labels.some((label) => normalizeKeyboardText(label) === normalizedText);
}

function parseAiSuggestContextState(state) {
  const matched = String(state || "").match(AI_SUGGEST_CONTEXT_STATE_PATTERN);
  return matched ? matched[1] : "";
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

function getPromptWatchlistItems(watchlistItems = []) {
  return watchlistItems.slice(-AI_WATCHLIST_PROMPT_LIMIT);
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

function parseAiManageState(state) {
  const matched = String(state || "").match(AI_MANAGE_STATE_PATTERN);
  if (!matched) {
    return null;
  }

  const section = matched[1];
  const listType = matched[2] === "top_ten" ? "topTen" : "watchlist";
  const modeToken = matched[3] || "";
  const addInputMode = modeToken === "add_input";
  const commentInputMode = modeToken === "comment_input";

  return {
    section,
    listType,
    isWatchlist: listType === "watchlist",
    addInputMode,
    commentInputMode,
  };
}

function parseAiListActionCommand(text = "") {
  const compactMatched = String(text || "").trim().match(
    /^\/(dn|un|tt|cm|rm)_(mv|mu|bk|in)_(l|t)_(\d+)$/i,
  );
  if (compactMatched) {
    const actionMap = {
      dn: "done",
      un: "undone",
      tt: "top10",
      cm: "comment",
      rm: "remove",
    };
    const sectionMap = {
      mv: "movies",
      mu: "music",
      bk: "books",
      in: "random",
    };
    const action = actionMap[compactMatched[1].toLowerCase()] || "";
    const section = sectionMap[compactMatched[2].toLowerCase()] || "";
    const listType = compactMatched[3].toLowerCase() === "t" ? "topTen" : "watchlist";
    const itemIndex = Number(compactMatched[4]) - 1;
    if (!action || !section || !Number.isInteger(itemIndex) || itemIndex < 0) return null;
    return { action, section, listType, itemIndex };
  }

  const matched = String(text || "").trim().match(
    /^\/(done|undone|top10|comment|remove)_(movies|music|books|random)_(list|top)_(\d+)$/i,
  );
  if (!matched) return null;
  const action = matched[1].toLowerCase();
  const section = matched[2].toLowerCase();
  const listType = matched[3].toLowerCase() === "top" ? "topTen" : "watchlist";
  const itemIndex = Number(matched[4]) - 1;
  if (!Number.isInteger(itemIndex) || itemIndex < 0) return null;
  return { action, section, listType, itemIndex };
}

function toAiManageStateListType(value) {
  return value === "topTen" ? "top_ten" : "watchlist";
}

function getAiManageState(section, listType, suffix = "") {
  const base = `ai_manage_${section}_${toAiManageStateListType(listType)}`;
  return suffix ? `${base}_${suffix}` : base;
}

function rememberCtxAiListItems(ctx, section, listType, items = []) {
  if (!ctx.user) return;
  if (!ctx.user.aiLists) ctx.user.aiLists = {};
  if (!ctx.user.aiLists[section]) ctx.user.aiLists[section] = {};
  ctx.user.aiLists[section][listType] = items;
}

function getContinuousAddKeyboard(lang, section, listType, items = []) {
  if (section === "random" && listType === "topTen") {
    return aiInterestTopTenChipKeyboard(
      lang,
      items.map((entry) => entry.title),
      0,
      { backToList: true },
    );
  }
  return aiListCancelAddKeyboard(lang, section, listType, { backToList: true });
}

function isAiTextState(state = "") {
  return Boolean(
    parseAiManageState(state) ||
    parseAiSuggestContextState(state) ||
    AI_SUGGEST_GENERATING_STATE_PATTERN.test(String(state)) ||
    getAiSectionFromState(state),
  );
}

async function resolveSectionTasteContext({ ctx, lang, section, topTenItems }) {
  const progress = getTasteProgressStatus(section, topTenItems.length);
  let taste = getAiTasteFromUser(ctx.user, section);

  if (progress.labelReady && !taste.labelKey) {
    const syncResult = await syncAiTasteForSection(ctx.userId, section);
    if (syncResult.ok) {
      taste = syncResult.taste;
    }
  }

  if (!progress.labelReady) {
    return {
      progress,
      taste: { labelKey: "", confidence: 0, sampleCount: progress.count },
      labelTitle: "",
      styleHint: "",
    };
  }

  const labelKey = taste?.labelKey || "";
  const labelTitle = labelKey ? getTasteLabelTitle(messages, lang, section, labelKey) : "";
  const styleHint = labelKey ? getTasteLabelStyleHint(messages, lang, section, labelKey) : "";

  return {
    progress,
    taste,
    labelTitle,
    styleHint,
  };
}

async function sendSingleSectionSuggestion({
  ctx,
  lang,
  section,
  topTenItems,
  watchlistItems,
  tasteStyleHint,
  userText = "",
  paidSuggestion = null,
}) {
  const recentSuggestionItems = getAiRecentSuggestionTitlesFromUser(ctx.user, section);
  const rejectedSuggestionItems = getAiRejectedSuggestionTitlesFromUser(ctx.user, section);
  const likedSuggestionItems = getAiLikedSuggestionTitlesFromUser(ctx.user, section);
  const blockedSuggestionItems = [
    ...topTenItems,
    ...watchlistItems,
    ...recentSuggestionItems,
    ...rejectedSuggestionItems,
  ].map((title) => ({ title }));
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
    initialExtra: { reply_markup: { remove_keyboard: true, selective: true } },
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
      quota.reason === "limit"
        ? formatSuggestionLimitMessage(lang, quota.resetAt)
        : messages[lang].aiNoResponse,
      quota.reason === "limit"
        ? aiSectionKeyboardForSection(lang, section)
        : aiSuggestionModeKeyboard(lang, section),
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
    logger.warn("AI suggestion flow fell back", {
      section,
      reason: suggestionResult?.reason || "missing_result",
      qualityIssue: suggestionResult?.qualityIssue || "",
    });
    await restoreSuggestionMode();
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

  if (paidSuggestion) {
    await completePaidSuggestion(paidSuggestion.quote._id, suggestionResult.title);
  }
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

async function openAiListManager(ctx, lang, section, listType, {
  prefix = "",
  banner = null,
  bannerSeenKey = "",
  filter = null,
  page = null,
  replaceCard = false,
  includeManageTip = false,
} = {}) {
  const previousMode = String(ctx.user?.navigationMode || "");
  const previousState = String(ctx.user?.state || "");
  let activeFilter = listType === "watchlist"
    ? (filter || getActiveWatchlistFilter(ctx, section))
    : "all";
  if (listType === "watchlist" && activeFilter !== "all") {
    const currentItems = getAiListItemsFromUser(ctx.user, section, "watchlist");
    const hasMixedStatuses = currentItems.some((entry) => entry?.watched === true)
      && currentItems.some((entry) => entry?.watched !== true);
    if (!hasMixedStatuses) activeFilter = "all";
  }
  const rememberedPage = (
    ctx.user?.aiLastListSection === section
    && ctx.user?.aiLastListType === listType
  ) ? Math.max(0, Number(ctx.user?.aiLastListPage) || 0) : 0;
  const activePage = page === null ? rememberedPage : Math.max(0, Number(page) || 0);
  const watchlistPage = listType === "watchlist"
    ? getWatchlistPage({ ctx, section, filter: activeFilter, page: activePage })
    : null;
  const nextState = `ai_manage_${section}_${listType === "topTen" ? "top_ten" : "watchlist"}`;
  const nextMode = listType === "watchlist" && activeFilter !== "all"
    ? `ai_list_filter:${section}:${activeFilter}`
    : `ai_list:${section}:${listType}`;
  await clearAiPendingInputPrompt(ctx, { waitForDelete: false, fallbackToEdit: false });
  await clearAiActionMessage(ctx, { waitForDelete: false, fallbackToEdit: false });
  await updateUserState(ctx.userId, nextState);
  if (ctx.user) ctx.user.state = nextState;
  await setNavigationMode(ctx, nextMode);
  if (ctx.user) ctx.user.navigationMode = nextMode;
  const items = getAiListItemsFromUser(ctx.user, section, listType);
  const listText = await buildAiListManagerMessage({
    ctx,
    lang,
    section,
    listType,
    prefix,
    filter: activeFilter,
    page: watchlistPage?.page || 0,
  });
  const showInlineCaptureTip = (
    listType === "watchlist"
    && ["movies", "music", "books"].includes(section)
    && !ctx.user?.sectionTipsShownAt?.forLaterInline
  );
  const inlineCaptureTip = showInlineCaptureTip
    ? formatInlineListCaptureTip(ctx, lang)
    : "";
  const text = [listText, inlineCaptureTip].filter(Boolean).join("\n\n");
  const replyKeyboard = aiListManageMenuKeyboard(lang, section, listType, {
    hasItems: items.length > 0,
    itemCount: items.length,
    hasWatchlistItems: getAiListItemsFromUser(ctx.user, section, "watchlist").length > 0,
    hasTasteLabel: (() => {
      if (!["movies", "music", "books"].includes(section)) return false;
      const taste = getAiTasteFromUser(ctx.user, section);
      return (["confirmed", "confirmed_review"].includes(taste.classificationStatus) && taste.labelKey) ||
        (taste.classificationStatus === "skipped" && taste.suggestedLabelKeys.length > 0);
    })(),
  });
  let listMessage;
  if (listType === "watchlist" && items.length > 0) {
    const inlineKeyboard = aiWatchlistCardKeyboard(lang, section, {
      filter: activeFilter,
      page: watchlistPage.page,
      totalPages: watchlistPage.totalPages,
      watchlistItems: watchlistPage.allEntries,
    });
    const hasInlineControls = Boolean(inlineKeyboard?.reply_markup?.inline_keyboard?.length);
    const alreadyInThisManager = previousMode === `ai_list:${section}:watchlist`
      || previousMode.startsWith(`ai_list_filter:${section}:`);
    const tipKey = hasInlineControls
      ? "aiListManageUseButtonsTipWithInline"
      : "aiListManageUseButtonsTip";
    if (!alreadyInThisManager || previousState !== nextState) {
      await ctx.reply(messages[lang][tipKey], replyKeyboard);
    }
    const watchlistText = includeManageTip
      ? `${text}\n\n${messages[lang][tipKey]}`
      : text;
    if (replaceCard && typeof ctx.editMessageText === "function") {
      try {
        listMessage = await ctx.editMessageText(ctx.callbackMessageId, watchlistText, inlineKeyboard);
      } catch {
        listMessage = await ctx.reply(watchlistText, inlineKeyboard);
      }
    } else {
      listMessage = await ctx.reply(watchlistText, inlineKeyboard);
    }
  } else if (banner && ctx.replyWithPhoto && text.length <= TELEGRAM_CAPTION_MAX_LENGTH) {
    try {
      listMessage = await sendBannerPhoto(ctx, {
        ...banner,
        extra: { ...replyKeyboard, caption: text },
      });
      if (bannerSeenKey) {
        await markSectionTipShownForContext(ctx, bannerSeenKey, new Date()).catch(() => null);
      }
    } catch {
      listMessage = await ctx.reply(text, replyKeyboard);
    }
  } else {
    listMessage = await ctx.reply(text, replyKeyboard);
  }
  await rememberAiListMessage(ctx, section, listType, listMessage, {
    navigationMode: nextMode,
    page: watchlistPage?.page || 0,
    filter: activeFilter,
  });
  if (inlineCaptureTip) {
    await markSectionTipShownForContext(ctx, "forLaterInline", new Date()).catch(() => null);
  }
  return listMessage;
}

function formatAiCommentPrompt(lang, listType, itemTitle) {
  const key = listType === "topTen" ? "aiTopTenCommentAskText" : "aiWatchlistCommentAskText";
  return messages[lang][key].replace("{item}", itemTitle);
}

function formatAiCommentSaved(lang, listType, itemTitle) {
  const key = listType === "topTen" ? "aiTopTenCommentSaved" : "aiWatchlistCommentSaved";
  return messages[lang][key].replace("{item}", itemTitle);
}

async function handleAiListActionCommand(ctx, lang, command) {
  const { action, section, listType, itemIndex } = command;
  const activeFilter = listType === "watchlist"
    ? getActiveWatchlistFilter(ctx, section)
    : "all";
  const expectedState = getAiManageState(section, listType);
  const currentState = String(ctx.user?.state || "");
  if (currentState !== expectedState) {
    return null;
  }

  const items = getAiListItemsFromUser(ctx.user, section, listType);
  const itemTitle = items[itemIndex]?.title;
  if (!itemTitle) {
    await deleteRememberedAiListMessage(ctx, section, listType);
    return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));
  }

  if ((action === "done" || action === "undone") && listType !== "watchlist") {
    return ctx.reply(messages[lang].unknownAction);
  }
  if (action === "top10" && listType !== "watchlist") {
    return ctx.reply(messages[lang].unknownAction);
  }

  if (action === "comment") {
    await deleteRememberedAiListMessage(ctx, section, listType, { waitForDelete: false });
    await updateUserState(ctx.userId, getAiManageState(section, listType, "comment_input"));
    if (ctx.user) ctx.user.state = getAiManageState(section, listType, "comment_input");
    await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", itemTitle);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", listType);
    const prompt = await ctx.reply(
      formatAiCommentPrompt(lang, listType, itemTitle),
      aiListCancelCommentKeyboard(lang, section, listType),
    );
    await rememberAiPendingInputPrompt(ctx, prompt);
    return prompt;
  }

  await deleteRememberedAiListMessage(ctx, section, listType, { waitForDelete: false });

  if (action === "remove") {
    const removed = await removeAiListItem(ctx.userId, section, listType, itemTitle);
    if (!removed.ok) return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));
    rememberCtxAiListItems(ctx, section, listType, removed.items);
    if (listType === "topTen") await syncAiTasteForSection(ctx.userId, section);
    await ctx.reply(messages[lang].aiListRemovedNamed.replace("{item}", itemTitle));
    return openAiListManager(ctx, lang, section, listType, { filter: activeFilter });
  }

  if (action === "done" || action === "undone") {
    const currentItem = items[itemIndex];
    if ((action === "done" && !currentItem?.watched) || (action === "undone" && currentItem?.watched)) {
      const toggled = await toggleWatchlistItemWatched(ctx.userId, section, itemTitle);
      if (!toggled.ok) return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
      rememberCtxAiListItems(ctx, section, "watchlist", toggled.items);
      const statusText = toggled.item?.watched
        ? getSectionMessage(messages, lang, "aiWatchlistWatchedOn", section, "aiWatchlistWatchedOn")
        : getSectionMessage(messages, lang, "aiWatchlistWatchedOff", section, "aiWatchlistWatchedOff");
      await ctx.reply(statusText);
    }
    return openAiListManager(ctx, lang, section, "watchlist", { filter: activeFilter });
  }

  if (action === "top10") {
    const promoted = await promoteWatchlistItemToTopTen(ctx.userId, section, itemTitle, operationalLimits.aiTopTenItems);
    if (!promoted.ok) {
      if (promoted.reason === "top_ten_limit") {
        return ctx.reply(formatAiLimitMessage(lang, "aiTopTenLimitReached"), aiListManageMenuKeyboard(lang, section, "watchlist"));
      }
      if (promoted.reason === "exists") {
        return ctx.reply(messages[lang].aiWatchlistPromoteAlreadyTopTen, aiListManageMenuKeyboard(lang, section, "watchlist"));
      }
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }
    rememberCtxAiListItems(ctx, section, "watchlist", promoted.watchlistItems);
    rememberCtxAiListItems(ctx, section, "topTen", promoted.topTenItems);
    applyStarRewardsToContext(ctx, promoted.starRewards);
    await notifyExternalReferralReward(ctx, messages, promoted.externalReferralReward);
    const starNotice = buildStarRewardNotice(messages, lang, promoted.starRewards, promoted.starProgress);
    await syncAiTasteForSection(ctx.userId, section);
    await ctx.reply([messages[lang].aiWatchlistPromotedToTopTen, starNotice].filter(Boolean).join("\n\n"));
    return openAiListManager(ctx, lang, section, "watchlist", { filter: activeFilter });
  }

  return null;
}

async function handleAiText(ctx, lang, text, state) {
  if (AI_SUGGEST_GENERATING_STATE_PATTERN.test(String(state))) return null;

  const listActionCommand = parseAiListActionCommand(text);
  if (listActionCommand) {
    const handled = await handleAiListActionCommand(ctx, lang, listActionCommand);
    if (handled) return handled;
  }

  const manageState = parseAiManageState(state);
  if (manageState) {
    if (isAiBackText(text)) {
      await clearAiPendingInputPrompt(ctx);
      await clearAiActionMessage(ctx);
      await updateUserState(ctx.userId, "idle");
      await clearRememberedAiListMessage(ctx);
      await clearAiSectionEntryMessage(ctx);
      return replyWithKeyboardRemovalNoticeThenInline(
        ctx,
        messages[lang].navigationFootprintTaste,
        buildAiAssistantMenuMessage(lang, { user: ctx.user }),
        aiAssistantKeyboard(lang),
      );
    }

    const section = manageState.section;
    const isWatchlist = manageState.isWatchlist;
    const listType = manageState.listType;
    const sectionLabel = listType === "topTen"
      ? getSectionLabelWithEmoji(messages, lang, section)
      : getSectionLabel(messages, lang, section);
    const listLabel = getSectionListLabel(messages, lang, section);
    const topTenItems = getAiListItemsFromUser(ctx.user, section, "topTen");
    const topTenTitles = topTenItems.map((entry) => entry.title);
    const title = (isWatchlist ? messages[lang].aiWatchlistTitle : messages[lang].aiTopTenTitle)
      .replace("{section}", sectionLabel)
      .replace("{listName}", listLabel);
    const emptyText = (isWatchlist ? messages[lang].aiWatchlistEmpty : messages[lang].aiTopTenEmpty)
      .replace("{section}", sectionLabel)
      .replace("{listName}", listLabel);
    const currentItems = getAiListItemsFromUser(ctx.user, section, listType);

    if (isAiSectionListText(text, section)) {
      return openAiListManager(ctx, lang, section, "watchlist");
    }

    if (isAiSectionTopTenText(text)) {
      return openAiListManager(ctx, lang, section, "topTen");
    }

    if (isAiSectionSuggestText(text)) {
      if (topTenTitles.length < 3) {
        return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));
      }

      return promptSuggestionMode(ctx, lang, section);
    }

    if (isAiListText(text) && !manageState.addInputMode) {
      const listOptions = isWatchlist
        ? { topTenTitleSet: toTitleSet(topTenItems), includeWatched: true }
        : {};
      return ctx.reply(
        formatAiItemsList(title, currentItems, emptyText, listOptions),
        aiSectionKeyboardForSection(lang, section),
      );
    }

    if (manageState.addInputMode) {
      const addInput = resolveAiListAddInput(ctx, section, text);
      const item = addInput.item;
      const comment = normalizeAiListComment("");
      if (!item) {
        const isInterestTopTen = section === "random" && listType === "topTen";
        const retryKeyboard = isInterestTopTen
          ? aiInterestTopTenChipKeyboard(lang, currentItems.map((entry) => entry.title))
          : aiListCancelAddKeyboard(lang, section, isWatchlist ? "watchlist" : "topTen");
        const retryText = addInput.reason === "untitled_audio"
          ? messages[lang].aiMusicAudioTitleMissing
          : addInput.reason === "unsupported_media"
            ? (section === "music"
              ? messages[lang].aiMusicAddTextOrAudioOnly
              : messages[lang].aiListAddTextOnly)
            : getAiListAddPrompt(lang, section, listType);
        return replaceAiPendingInputPrompt(
          ctx,
          () => ctx.reply(retryText, retryKeyboard),
        );
      }

      const result = await addAiListItem(
        ctx.userId,
        section,
        listType,
        { title: item, comment },
        isWatchlist ? operationalLimits.aiWatchlistItems : operationalLimits.aiTopTenItems,
      );

      if (!result.ok) {
        if (result.reason === "exists") {
          if (!isWatchlist) {
            return ctx.reply(
              getDuplicateTopTenMessage(lang, result, currentItems.length),
              getContinuousAddKeyboard(lang, section, listType, currentItems),
            );
          }
          return ctx.reply(
            getDuplicateListMessage(lang, result),
            getContinuousAddKeyboard(lang, section, listType, currentItems),
          );
        }
        if (result.reason === "limit") {
          if (isWatchlist) {
            return openAiListManager(ctx, lang, section, listType, {
              prefix: formatAiLimitMessage(lang, "aiWatchlistLimitReached"),
              filter: getActiveWatchlistFilter(ctx, section),
              page: Math.max(0, Number(ctx.user?.aiLastListPage) || 0),
            });
          }
          return ctx.reply(
            formatAiLimitMessage(lang, "aiTopTenLimitReachedHere"),
            aiListManageMenuKeyboard(lang, section, listType, {
              hasItems: currentItems.length > 0,
              itemCount: currentItems.length,
              hasWatchlistItems: getAiListItemsFromUser(ctx.user, section, "watchlist").length > 0,
            }),
          );
        }
        if (result.reason === "invalid_item_quality") {
          const sectionKey = section.charAt(0).toUpperCase() + section.slice(1);
          const messageKey = `aiTopTenInvalidItemQuality${sectionKey}`;
          const errorMessage = messages[lang][messageKey] || messages[lang].aiTopTenInvalidItemQuality;

          return replaceAiPendingInputPrompt(
            ctx,
            () => ctx.reply(errorMessage, aiListCancelAddKeyboard(lang, section, listType)),
          );
        }
        return replaceAiPendingInputPrompt(
          ctx,
          () => ctx.reply(messages[lang].aiListSaveFailed, aiListCancelAddKeyboard(lang, section, listType)),
        );
      }

      rememberCtxAiListItems(ctx, section, listType, result.items);
      applyStarRewardsToContext(ctx, result.starRewards);
      await notifyExternalReferralReward(ctx, messages, result.externalReferralReward);
      const starNotice = buildStarRewardNotice(messages, lang, result.starRewards, result.starProgress);
      const listIsFull = result.items.length >= (isWatchlist ? operationalLimits.aiWatchlistItems : operationalLimits.aiTopTenItems);
      const nextState = listIsFull
        ? getAiManageState(section, listType)
        : getAiManageState(section, listType, "add_input");
      await updateUserState(ctx.userId, nextState);
      if (ctx.user) ctx.user.state = nextState;
      if (listIsFull && !isWatchlist && ["movies", "music", "books"].includes(section)) {
        await setNavigationMode(ctx, `ai_list_completion:${section}:topTen`);
      }

      if (!isWatchlist) {
        let automaticTasteAttempt = null;
        const isCompletedMediaFavorites = listIsFull && ["movies", "music", "books"].includes(section);
        if (isCompletedMediaFavorites) {
          const taste = getAiTasteFromUser(ctx.user, section);
          if (shouldStartAutomaticTasteCheck(taste)) {
            automaticTasteAttempt = await markAiTasteAutomaticCheckAttempted(ctx.userId, section);
            if (automaticTasteAttempt.ok && ctx.user) {
              if (!ctx.user.aiTaste) ctx.user.aiTaste = {};
              if (!ctx.user.aiTaste[section]) ctx.user.aiTaste[section] = {};
              ctx.user.aiTaste[section].freeClassificationAutoAttemptedAt = automaticTasteAttempt.attemptedAt;
            }
          }
        }
        const savedMessage = await buildTopTenSavedMessage({
          ctx,
          lang,
          section,
          item,
          items: result.items,
          includeNextPrompt: false,
          includeCompletionPrompt: !isCompletedMediaFavorites || Boolean(automaticTasteAttempt?.ok),
        });
        if (isCompletedMediaFavorites && !automaticTasteAttempt?.ok) {
          return openAiListManager(ctx, lang, section, listType, {
            prefix: [savedMessage, starNotice].filter(Boolean).join("\n\n"),
          });
        }
        const saved = await ctx.reply(
          [
            savedMessage,
            starNotice,
            listIsFull ? "" : messages[lang].aiListManageAddNextPrompt,
          ].filter(Boolean).join("\n\n"),
          listIsFull
            ? aiListCancelAddKeyboard(lang, section, listType, { backToList: true })
            : getContinuousAddKeyboard(lang, section, listType, result.items),
        );
        if (listIsFull) {
          await rememberAiPendingInputPrompt(ctx, saved);
          if (automaticTasteAttempt?.ok) {
            await sendTasteLabelReview(ctx, lang, section, { withPlaceholder: true });
          }
          return saved;
        }
        await rememberAiPendingInputPrompt(ctx, saved);
        return saved;
      }

      const listLabel = getSectionListLabel(messages, lang, section);
      const savedText = messages[lang].aiListSaved
        .replace("{item}", item)
        .replace("{listName}", listLabel);
      const saved = await ctx.reply(
        [savedText, listIsFull ? "" : messages[lang].aiListManageAddNextPrompt].filter(Boolean).join("\n\n"),
        listIsFull
          ? aiListManageMenuKeyboard(lang, section, listType, {
            hasItems: result.items.length > 0,
            itemCount: result.items.length,
          })
          : getContinuousAddKeyboard(lang, section, listType, result.items),
      );
      if (!listIsFull) await rememberAiPendingInputPrompt(ctx, saved);
      return saved;
    }

    if (manageState.commentInputMode) {
      const pendingItem = normalizeAiListItem(ctx.user?.aiSectionPendingCommentItem);
      const pendingListType = ctx.user?.aiSectionPendingCommentListType === "topTen" ? "topTen" : "watchlist";
      const returnView = pendingListType === "watchlist"
        ? {
          filter: getActiveWatchlistFilter(ctx, section),
          page: Math.max(0, Number(ctx.user?.aiLastListPage) || 0),
        }
        : {};
      if (!pendingItem) {
        await clearAiPendingInputPrompt(ctx);
        await updateUserState(ctx.userId, `ai_manage_${section}_${pendingListType === "topTen" ? "top_ten" : "watchlist"}`);
        await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", null);
        await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", null);
        return openAiListManager(ctx, lang, section, pendingListType, returnView);
      }

      if (text.startsWith("/")) {
        await clearAiPendingInputPrompt(ctx);
        const prompt = await ctx.reply(
          formatAiCommentPrompt(lang, pendingListType, pendingItem),
          aiListCancelCommentKeyboard(lang, section, pendingListType),
        );
        await rememberAiPendingInputPrompt(ctx, prompt);
        return prompt;
      }

      await clearAiPendingInputPrompt(ctx);
      const updated = await setAiListItemComment(ctx.userId, section, pendingListType, pendingItem, text);
      if (!updated.ok) {
        await updateUserState(ctx.userId, `ai_manage_${section}_${pendingListType === "topTen" ? "top_ten" : "watchlist"}`);
        await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", null);
        await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", null);
        return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, pendingListType));
      }

      await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", null);
      await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", null);
      await updateUserState(ctx.userId, `ai_manage_${section}_${pendingListType === "topTen" ? "top_ten" : "watchlist"}`);
      rememberCtxAiListItems(ctx, section, pendingListType, updated.items);
      if (pendingListType === "topTen") {
        await syncAiTasteForSection(ctx.userId, section);
      }
      await ctx.reply(formatAiCommentSaved(lang, pendingListType, pendingItem));
      return openAiListManager(ctx, lang, section, pendingListType, returnView);
    }

    await clearAiActionMessage(ctx);
    if (isWatchlist) {
      return openAiListManager(ctx, lang, section, listType, {
        filter: getActiveWatchlistFilter(ctx, section),
        page: Math.max(0, Number(ctx.user?.aiLastListPage) || 0),
        includeManageTip: true,
      });
    }
    const actionMessage = await ctx.reply(
      `${await buildAiListManagerMessage({ ctx, lang, section, listType })}\n\n${messages[lang].aiListManageUseButtonsTip}`,
      aiListManageMenuKeyboard(lang, section, listType, {
        hasItems: currentItems.length > 0,
        itemCount: currentItems.length,
        hasWatchlistItems: getAiListItemsFromUser(ctx.user, section, "watchlist").length > 0,
      }),
    );
    await rememberAiActionMessage(ctx, `manage:${section}:${listType}`, actionMessage);
    return actionMessage;
  }

  const suggestContextSection = parseAiSuggestContextState(state);
  if (suggestContextSection) {
    // Exact-mode reply buttons are resolved before AI text handling. If an old
    // visible Back button reaches this branch, keep it as guidance rather than
    // interpreting it as suggestion mood text or navigating on stale UI.
    if (isAiBackText(text)) {
      return ctx.reply(
        messages[lang].aiSuggestionUseButtons,
        aiSuggestionModeKeyboard(lang, suggestContextSection),
      );
    }

    const userText = String(text || "").trim().replace(/\s+/g, " ");
    if (userText.length > AI_SUGGESTION_CONTEXT_MAX_CHARS) {
      return ctx.reply(
        messages[lang].aiSuggestionContextTooLong,
        aiSuggestionModeKeyboard(lang, suggestContextSection),
      );
    }
    if (!userText || text.startsWith("/")) {
      await clearAiPendingInputPrompt(ctx);
      await setNavigationMode(ctx, `ai_suggestion_context:${suggestContextSection}`);
      if (ctx.user) ctx.user.navigationMode = `ai_suggestion_context:${suggestContextSection}`;
      const prompt = await ctx.reply(messages[lang].aiSuggestionContextPrompt, aiSuggestionContextCancelKeyboard(lang, suggestContextSection));
      await rememberAiPendingInputPrompt(ctx, prompt);
      return prompt;
    }

    const topTenItems = getAiListTitlesFromUser(ctx.user, suggestContextSection, "topTen");
    if (topTenItems.length < 3) {
      await clearAiPendingInputPrompt(ctx);
      await updateUserState(ctx.userId, `ai_chat_${suggestContextSection}`);
      return ctx.reply(getNeedTopTenMessage(lang, suggestContextSection), aiSectionKeyboardForSection(lang, suggestContextSection));
    }

    const tasteContext = await resolveSectionTasteContext({
      ctx,
      lang,
      section: suggestContextSection,
      topTenItems,
    });
    await updateUserState(ctx.userId, `ai_chat_${suggestContextSection}`);
    await clearAiPendingInputPrompt(ctx);
    setSuggestionMood(ctx.userId, suggestContextSection, userText);
    return sendSingleSectionSuggestion({
      ctx,
      lang,
      section: suggestContextSection,
      topTenItems,
      watchlistItems: getAiListTitlesFromUser(ctx.user, suggestContextSection, "watchlist"),
      tasteStyleHint: tasteContext.styleHint,
      userText,
    });
  }

  const section = getAiSectionFromState(state);
  if (section) {
    const actionContext = String(ctx.user?.aiActionContext || "");
    const navigationMode = String(ctx.user?.navigationMode || "");
    const canReplaceSuggestionMood = (
      navigationMode === `ai_suggestion_next:${section}`
      || navigationMode === `ai_suggestion_added:${section}`
    );

    if (canReplaceSuggestionMood) {
      const userText = String(text || "").trim().replace(/\s+/g, " ");
      if (isSuggestionControlText(userText)) return null;
      if (userText && !userText.startsWith("/") && !isAiBackText(userText)) {
        if (userText.length > AI_SUGGESTION_CONTEXT_MAX_CHARS) {
          return ctx.reply(
            messages[lang].aiSuggestionContextTooLong,
            navigationMode === `ai_suggestion_added:${section}`
              ? aiSuggestionAddedOptionsKeyboard(lang, section)
              : aiSuggestionNextKeyboard(lang, section),
          );
        }

        const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
        if (topTenItems.length < 3) {
          return ctx.reply(
            getNeedTopTenMessage(lang, section),
            aiSectionKeyboardForSection(lang, section),
          );
        }

        const tasteContext = await resolveSectionTasteContext({
          ctx,
          lang,
          section,
          topTenItems,
        });
        setSuggestionMood(ctx.userId, section, userText);
        return sendSingleSectionSuggestion({
          ctx,
          lang,
          section,
          topTenItems,
          watchlistItems: getAiListTitlesFromUser(ctx.user, section, "watchlist"),
          tasteStyleHint: tasteContext.styleHint,
          userText,
        });
      }
    }

    if (actionContext === `suggest_mode:${section}`) {
      await clearAiPendingInputPrompt(ctx);
      await clearAiActionMessage(ctx);
      const actionMessage = await ctx.reply(
        messages[lang].aiSuggestionUseButtons,
        aiSuggestionModeKeyboard(lang, section),
      );
      await rememberAiPendingInputPrompt(ctx, actionMessage);
      await rememberAiActionMessage(ctx, actionContext, actionMessage);
      return actionMessage;
    }

    if (actionContext === `suggest_result:${section}`) {
      await clearAiActionMessage(ctx);
      const actionMessage = await ctx.reply(
        messages[lang].aiSuggestionUseButtons,
        aiSuggestionAddKeyboard(lang, section),
      );
      await rememberAiActionMessage(ctx, actionContext, actionMessage);
      return actionMessage;
    }

    return ctx.reply(
      messages[lang].aiSectionUseButtonsOnly,
      aiSectionKeyboardForSection(lang, section),
    );
  }

  return null;
}

module.exports = {
  handleAiText,
  promptSuggestionMode,
  openAiListManager,
  formatAiCommentPrompt,
  formatAiCommentSaved,
  isAiBackText,
  isAiSectionListText,
  isAiSectionSuggestText,
  isAiSectionTopTenText,
  isAiTextState,
  shouldStartAutomaticTasteCheck,
};
