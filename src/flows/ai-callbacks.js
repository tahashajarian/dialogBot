const path = require("node:path");
const messages = require("../messages");
const { logger } = require("../services/logger");
const { hasSectionTipBeenShown } = require("../services/users");

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
  aiSuggestionNextKeyboard,
  aiSuggestionLimitKeyboard,
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
  addAiRejectedSuggestion,
  getAiListItemsFromUser,
  toggleWatchlistItemWatched,
  promoteWatchlistItemToTopTen,
  syncAiTasteForSection,
  getAiListTitlesFromUser,
  getAiTasteFromUser,
  confirmAiTasteLabel,
  recalculateAiTasteForSection,
  skipAiTasteLabel,
} = require("../services/users");
const { sendNavigationFootprint } = require("../services/navigation-footprints");
const { MODES, setNavigationMode } = require("../services/reply-keyboard-navigation");
const { startAiPlaceholder, editPlaceholder } = require("../services/ai-placeholder");
const {
  getSectionEmoji,
  getSectionLabel,
  getSectionListLabel,
  getSectionMessage,
} = require("../services/ai-section");
const { isAllowedTasteLabel } = require("../services/taste-label-classifier");
const {
  sendTasteLabelReview,
  shouldShowTasteReviewPlaceholder,
  withTasteInsight,
} = require("./ai-taste-labels");
const {
  claimSuggestionAction,
  getPendingSuggestion,
  clearPendingSuggestion,
  getSuggestionMood,
} = require("../services/ai-suggestion-cache");

function getSuggestionNextGuidance(lang, userId, section, { saved = false } = {}) {
  const hasMood = Boolean(getSuggestionMood(userId, section));
  const key = saved
    ? (hasMood ? "aiSuggestionSavedNextGuidance" : "aiSuggestionSavedNextGuidanceNoMood")
    : (hasMood ? "aiSuggestionNextGuidance" : "aiSuggestionNextGuidanceNoMood");
  return messages[lang][key];
}
const {
  AI_RECENT_SUGGESTIONS_LIMIT,
} = require("../constants/ai");
const { operationalLimits } = require("../services/operational-limits");
const {
  aiListTelegramExtra,
  buildAiListManagerMessage,
  buildTopTenInsightMessage,
  buildTopTenSavedMessage,
  formatAiLimitMessage,
  formatAiListTelegramText,
  getDuplicateListMessage,
  getDuplicateTopTenMessage,
  getNeedTopTenMessage,
  toTitleSet,
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
  confirmPaidSuggestion,
} = require("../services/ai-paid-suggestions");
const { starEconomy } = require("../services/star-settings");
const {
  isAiCallback,
  isSuggestionCallbackValidForState,
  normalizeAiListTypeToken,
  normalizeWatchlistFilter,
  toAiManageStateListType,
} = require("./ai-callback-routing");
const {
  promptSuggestionMode,
  recoverExpiredSuggestion,
  sendFollowupSuggestion,
} = require("./ai-suggestion-callbacks");
const {
  cancelTasteLabelRecheck,
  completeTasteLabelRecheck,
  confirmTasteLabelRecheck,
  createTasteLabelRecheckQuote,
  refundTasteLabelRecheck,
} = require("../services/taste-label-rechecks");

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
  const bannerSeenKey = ["movies", "music", "books"].includes(section)
    ? `${section}Banner`
    : "";
  const banner = bannerSeenKey && !hasSectionTipBeenShown(ctx.user, bannerSeenKey)
    ? AI_SECTION_BANNERS[section] || null
    : null;
  if (!banner) {
    await sendNavigationFootprint(ctx, { lang, destination: "aiSection", title: titleText });
  }
  return openAiListManager(ctx, lang, section, "topTen", {
    banner,
    bannerSeenKey,
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
    const withPlaceholder = shouldShowTasteReviewPlaceholder(taste);
    return sendTasteLabelReview(ctx, lang, section, {
      withPlaceholder,
      retryFailed,
      replaceMessage: !withPlaceholder && ctx.callbackMessageId
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
    const [section = "", rawListType = "", rawFilter = "all", rawPage = "0"] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    const filter = normalizeWatchlistFilter(rawFilter);
    const page = Math.max(0, Number.parseInt(rawPage, 10) || 0);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    return openAiListManager(ctx, lang, section, listType, {
      filter,
      page,
      replaceCard: Boolean(ctx.callbackMessageId && !ctx.isReplyKeyboardAction),
    });
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
      formatAiListTelegramText(await buildAiListManagerMessage({ ctx, lang, section, listType: "topTen" })),
      aiListTelegramExtra(aiListManageMenuKeyboard(lang, section, "topTen", {
        hasItems: items.length > 0,
        itemCount: items.length,
        hasWatchlistItems: getAiListItemsFromUser(ctx.user, section, "watchlist").length > 0,
      })),
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
      formatAiListTelegramText(await buildAiListManagerMessage({
        ctx,
        lang,
        section,
        listType: "watchlist",
        prefix: toggled.item?.watched ? statusCopy.doneText : statusCopy.pendingText,
      })),
      aiListTelegramExtra(aiListManageMenuKeyboard(lang, section, "watchlist")),
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

    const returnView = listType === "watchlist"
      ? {
        filter: ["watched", "not_watched"].includes(ctx.user?.aiLastListFilter)
          ? ctx.user.aiLastListFilter
          : "all",
        page: Math.max(0, Number(ctx.user?.aiLastListPage) || 0),
      }
      : {};
    await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", null);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", null);
    await clearAiPendingInputPrompt(ctx);
    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}`);
    return openAiListManager(ctx, lang, section, listType, returnView);
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
      formatAiListTelegramText(await buildAiListManagerMessage({
        ctx,
        lang,
        section,
        listType: "watchlist",
        prefix: [messages[lang].aiWatchlistPromotedToTopTen, starNotice].filter(Boolean).join("\n\n"),
      })),
      aiListTelegramExtra(aiListManageMenuKeyboard(lang, section, "watchlist")),
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
    await setNavigationMode(ctx, `ai_list:${section}:${listType}`);
    if (ctx.user) ctx.user.navigationMode = `ai_list:${section}:${listType}`;
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
      return ctx.reply(messages[lang].aiListSaveFailed, aiListManageMenuKeyboard(lang, "random", "topTen"));
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
      formatAiListTelegramText(await buildAiListManagerMessage({ ctx, lang, section, listType, prefix: removedText })),
      aiListTelegramExtra(aiListManageMenuKeyboard(lang, section, listType, {
        hasItems: removeResult.items.length > 0,
        itemCount: removeResult.items.length,
        hasWatchlistItems: getAiListItemsFromUser(ctx.user, section, "watchlist").length > 0,
      })),
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
      userText: getSuggestionMood(ctx.userId, section),
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
    const actionMessage = await ctx.reply(
      `${messages[lang].aiSuggestionRejected}\n\n${getSuggestionNextGuidance(lang, ctx.userId, section)}`,
      aiSuggestionNextKeyboard(lang, section),
    );
    return actionMessage;
  }

  if (data.startsWith(callBacks.aiSectionAddSuggestion) || data.startsWith(callBacks.aiSectionAddSuggestionDone)) {
    await ctx.answerCb?.();
    const markDone = data.startsWith(callBacks.aiSectionAddSuggestionDone);
    const payload = data.replace(markDone ? callBacks.aiSectionAddSuggestionDone : callBacks.aiSectionAddSuggestion, "");
    const section = payload.trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);
    const releaseSuggestionAction = claimSuggestionAction(ctx.userId, section);
    if (!releaseSuggestionAction) return null;

    try {
      const pending = getPendingSuggestion(ctx.userId, section);
      const title = String(pending?.title || "").trim();
      const metadata = String(pending?.metadata || "").trim();
      const comment = String(pending?.comment || "").trim();
      if (!title) return recoverExpiredSuggestion(ctx, lang, section);

      const result = await addAiListItem(
        ctx.userId,
        section,
        "watchlist",
        {
          title,
          metadata,
          comment,
          commentSource: comment ? "ai" : "",
          watched: markDone,
          suggestionFeedback: markDone ? "liked" : "",
        },
        operationalLimits.aiWatchlistItems,
      );

      if (!result.ok) {
        if (result.reason === "exists") return ctx.reply(getDuplicateListMessage(lang, result), aiSuggestionAddKeyboard(lang, section));
        if (result.reason === "limit") return ctx.reply(formatAiLimitMessage(lang, "aiSuggestionListFull"), aiListManageMenuKeyboard(lang, section, "watchlist"));
        logger.warn("AI suggestion save failed", {
          section,
          reason: result.reason || "unknown",
        });
        return ctx.reply(messages[lang].aiSuggestionSaveFailed);
      }

      await helpers.deleteCallbackMessageIfPossible(ctx);
      clearPendingSuggestion(ctx.userId, section);
      applyStarRewardsToContext(ctx, result.starRewards);
      await notifyExternalReferralReward(ctx, messages, result.externalReferralReward);
      const starNotice = buildStarRewardNotice(messages, lang, result.starRewards, result.starProgress);
      await updateUserState(ctx.userId, `ai_chat_${section}`);
      await setNavigationMode(ctx, `ai_suggestion_added:${section}`);
      if (ctx.user) ctx.user.navigationMode = `ai_suggestion_added:${section}`;
      return ctx.reply(
        [
          formatSuggestionAddedMessage(lang, section, markDone),
          starNotice,
          getSuggestionNextGuidance(lang, ctx.userId, section, { saved: true }),
        ].filter(Boolean).join("\n\n"),
        aiSuggestionAddedOptionsKeyboard(lang, section),
      );
    } finally {
      releaseSuggestionAction();
    }
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
  getSuggestionNextGuidance,
  handleAiCallback,
  isAiCallback,
  isSuggestionCallbackValidForState,
};
