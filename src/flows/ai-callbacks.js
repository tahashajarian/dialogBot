const messages = require("../messages");
const {
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionNextKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionContextCancelKeyboard,
  aiSuggestionAddedOptionsKeyboard,
  aiListManageMenuKeyboard,
  aiListRemoveItemsKeyboard,
  aiListCancelAddKeyboard,
  aiInterestTopTenChipKeyboard,
  getInterestTopTenChipTitle,
  aiListActionItemsKeyboard,
  aiListCancelCommentKeyboard,
  mainMenuKeyboard,
} = require("../keyboards");
const { callBacks } = require("../constants");
const {
  updateProfileField,
  updateUserState,
  removeAiListItem,
  addAiListItem,
  addAiRecentSuggestion,
  consumeAiSuggestionQuota,
  refundAiSuggestionQuota,
  getAiListItemsFromUser,
  getWatchlistItemsByStatusFromUser,
  toggleWatchlistItemWatched,
  promoteWatchlistItemToTopTen,
  syncAiTasteForSection,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  getAiTasteFromUser,
} = require("../services/users");
const { getAiSingleSuggestion } = require("../services/ai");
const { startAiPlaceholder, editPlaceholder } = require("../services/ai-placeholder");
const {
  clearAiSectionPin,
  getSectionLabel,
  getSectionListLabel,
  getSectionMessage,
  getTasteLabelStyleHint,
} = require("../services/ai-section");
const {
  setPendingSuggestion,
  getPendingSuggestion,
  clearPendingSuggestion,
} = require("../services/ai-suggestion-cache");
const { getAiListDuplicateMatch } = require("../services/ai-list-duplicates");
const {
  AI_WATCHLIST_LIMIT,
  AI_RECENT_SUGGESTIONS_LIMIT,
  AI_SUGGESTIONS_PER_HOUR,
  AI_TOP_TEN_LIMIT,
  AI_WATCHLIST_PROMPT_LIMIT,
} = require("../constants/ai");
const {
  buildTopTenInsightMessage,
  buildTopTenListMessage,
  buildTopTenSavedMessage,
  buildWatchlistMessage,
  formatAiItemsList,
  formatSuggestionLimitMessage,
  formatSuggestionResultMessage,
  getDuplicateListMessage,
  getDuplicateTopTenMessage,
  getNeedTopTenMessage,
  getTopTenManageEntryMessage,
  toTitleSet,
  withAiSectionTitle,
} = require("../services/ai-list-ui");
const {
  rememberAiPendingInputPrompt,
  clearAiPendingInputPrompt,
} = require("./ai-input-prompts");
const {
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
  deleteRememberedAiListMessage,
  rememberAiSectionEntryMessage,
  replaceRememberedAiListMessage,
} = require("./ai-cards");

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
    data.startsWith(callBacks.aiSectionAnotherSuggestion) ||
    data.startsWith(callBacks.aiSectionSuggestFromTopTen) ||
    data.startsWith(callBacks.aiSectionSuggestWithContext) ||
    data.startsWith(callBacks.aiSectionSuggestContextCancel) ||
    data.startsWith(callBacks.aiInterestTopTenChip) ||
    data === callBacks.aiBack
  );
}

async function promptSuggestionMode(ctx, lang, section) {
  await clearAiPendingInputPrompt(ctx);
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
    callBacks.aiSectionSuggestFromTopTen,
    callBacks.aiSectionSuggestContextCancel,
    callBacks.aiSectionSuggestWithContext,
  ];
  const prefix = prefixes.find((entry) => data.startsWith(entry));
  return prefix ? data.slice(prefix.length).trim() : "";
}

function isSuggestionCallbackValidForState(data = "", state = "") {
  const section = getSuggestionCallbackSection(data);
  if (!section) return true;
  if (data.startsWith(callBacks.aiSectionSuggestContextCancel)) {
    return state === `ai_suggest_context_${section}`;
  }
  return state === `ai_chat_${section}`;
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
}) {
  const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
  const recentSuggestionItems = getAiRecentSuggestionTitlesFromUser(ctx.user, section);
  const blockedSuggestionItems = [
    ...topTenItems,
    ...watchlistItems,
    ...recentSuggestionItems,
  ].map((title) => ({ title }));
  const taste = getAiTasteFromUser(ctx.user, section);
  const tasteStyleHint = taste?.labelKey
    ? getTasteLabelStyleHint(messages, lang, section, taste.labelKey)
    : "";

  const placeholder = await startAiPlaceholder(ctx, [
    messages[lang].aiThinking,
    messages[lang].aiThinkingStill,
    messages[lang].aiThinkingAlmost,
  ]);
  const quota = await consumeAiSuggestionQuota(ctx.userId, section, AI_SUGGESTIONS_PER_HOUR);
  if (!quota.ok) {
    return placeholder.finish(
      quota.reason === "limit"
        ? formatSuggestionLimitMessage(lang, quota.resetAt)
        : messages[lang].aiTemporaryUnavailable,
      aiSuggestionNextKeyboard(lang, section),
    );
  }

  let suggestionResult = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    suggestionResult = await getAiSingleSuggestion({
      mode: section,
      lang,
      userText: attempt === 0
        ? (userText || (section === "random" ? "Suggest one thing for me" : `Suggest one ${section} item`))
        : "Suggest a different item. The previous one was already known.",
      topTenItems,
      watchlistItems: getPromptWatchlistItems(watchlistItems),
      recentSuggestionItems,
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

  if (!suggestionResult.ok || !suggestionResult.title) {
    await refundAiSuggestionQuota(ctx.userId, section, quota.consumedAt);
    return placeholder.finish(messages[lang].aiNoResponse || messages[lang].aiTemporaryUnavailable);
  }

  await addAiRecentSuggestion(ctx.userId, section, suggestionResult.title, AI_RECENT_SUGGESTIONS_LIMIT);
  setPendingSuggestion(ctx.userId, section, suggestionResult.title, suggestionResult.reason || "");
  return placeholder.finish(
    formatSuggestionResultMessage(lang, suggestionResult.title, suggestionResult.reason),
    aiSuggestionAddKeyboard(lang, section),
  );
}

function getWatchStatusCopy(lang, section) {
  return {
    togglePrompt: getSectionMessage(messages, lang, "aiWatchlistTogglePrompt", section, "aiWatchlistTogglePrompt"),
    doneText: getSectionMessage(messages, lang, "aiWatchlistWatchedOn", section, "aiWatchlistWatchedOn"),
    pendingText: getSectionMessage(messages, lang, "aiWatchlistWatchedOff", section, "aiWatchlistWatchedOff"),
  };
}

function getSuggestionDoneCompliment(lang, section) {
  return getSectionMessage(messages, lang, "aiSuggestionDoneCompliment", section);
}

function getSuggestionAddedDoneMessage(lang, section) {
  return getSectionMessage(messages, lang, "aiSuggestionAddedDone", section, "aiSuggestionAddedDone");
}

async function getAiSectionEntryMessage(ctx, lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const title = messages[lang].aiSectionPinnedTitle.replace("{section}", sectionLabel);
  const body = messages[lang].aiSectionEntryGuidance.replace("{section}", sectionLabel);
  return `${title}\n\n${body}`;
}

function getAiSectionNotificationTitle(lang, section) {
  return getSectionMessage(messages, lang, "aiSuggest", section, "aiSuggestRandom");
}

async function enterAiSection(ctx, lang, section, helpers) {
  await ctx.answerCb?.(
    messages[lang].aiSectionOpeningNotification
      .replace("{section}", getAiSectionNotificationTitle(lang, section)),
  );
  await updateUserState(ctx.userId, `ai_chat_${section}`);
  await clearRememberedAiListMessage(ctx);
  await clearAiSectionEntryMessage(ctx, [ctx.callbackMessageId]);
  await updateProfileField(ctx.userId, "aiSectionPinnedMessageId", null);
  await updateProfileField(ctx.userId, "aiSectionPinnedSection", null);
  await helpers.deleteCallbackMessageIfPossible(ctx);
  const entryMessage = await getAiSectionEntryMessage(ctx, lang, section);
  const sent = await ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, section));
  await rememberAiSectionEntryMessage(ctx, sent);
  return sent;
}

async function handleAiCallback(ctx, lang, helpers) {
  const data = ctx.callbackData || "";

  if (!isSuggestionCallbackValidForState(data, ctx.user?.state || "")) {
    await ctx.answerCb?.();
    await clearAiPendingInputPrompt(ctx);
    return helpers.deleteCallbackMessageIfPossible(ctx);
  }

  if (data.startsWith(callBacks.aiListManageMenu)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageMenu, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    await helpers.deleteCallbackMessageIfPossible(ctx);
    const sectionLabel = getSectionLabel(messages, lang, section);
    const listLabel = getSectionListLabel(messages, lang, section);
    const title = listType === "watchlist"
      ? messages[lang].aiWatchlistTitle.replace("{section}", sectionLabel).replace("{listName}", listLabel)
      : messages[lang].aiTopTenTitle.replace("{section}", sectionLabel);

    const listText = listType === "topTen"
      ? buildTopTenListMessage({ ctx, lang, section })
      : buildWatchlistMessage({ ctx, lang, section, includeWatched: true });
    const listMessage = await ctx.reply(listText);
    await replaceRememberedAiListMessage(ctx, section, listType, listMessage);

    const menuText = listType === "topTen"
      ? await getTopTenManageEntryMessage(ctx, lang, section)
      : messages[lang].aiListManageInlineMenu.replace("{title}", title);

    return ctx.reply(menuText, aiListManageMenuKeyboard(lang, section, listType));
  }

  if (data.startsWith(callBacks.aiListManageShow)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageShow, "");
    const [section = "", rawListType = "", rawFilter = "all"] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    const filter = normalizeWatchlistFilter(rawFilter);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    await helpers.deleteCallbackMessageIfPossible(ctx);
    const sectionLabel = getSectionLabel(messages, lang, section);
    const listLabel = getSectionListLabel(messages, lang, section);
    const title = (listType === "watchlist" ? messages[lang].aiWatchlistTitle : messages[lang].aiTopTenTitle)
      .replace("{section}", sectionLabel)
      .replace("{listName}", listLabel);
    const emptyText = (listType === "watchlist" ? messages[lang].aiWatchlistEmpty : messages[lang].aiTopTenEmpty)
      .replace("{section}", sectionLabel)
      .replace("{listName}", listLabel);
    const items = listType === "watchlist"
      ? getWatchlistItemsByStatusFromUser(ctx.user, section, filter)
      : getAiListItemsFromUser(ctx.user, section, listType);
    const listText = listType === "watchlist"
      ? formatAiItemsList(title, items, filter === "all" ? emptyText : messages[lang].aiWatchlistFilterEmpty, {
        includeWatched: true,
        topTenTitleSet: toTitleSet(getAiListItemsFromUser(ctx.user, section, "topTen")),
      })
      : formatAiItemsList(title, items, emptyText);
    const titledListText = withAiSectionTitle(lang, section, listText);

    const listMessage = await ctx.reply(titledListText, aiListManageMenuKeyboard(lang, section, listType));
    await replaceRememberedAiListMessage(ctx, section, listType, listMessage);
    return listMessage;
  }

  if (data.startsWith(callBacks.aiTopTenInsight)) {
    await ctx.answerCb?.(messages[lang].aiTopTenInsightNotification);
    const section = data.replace(callBacks.aiTopTenInsight, "").trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);

    const items = getAiListItemsFromUser(ctx.user, section, "topTen");
    await helpers.deleteCallbackMessageIfPossible(ctx);
    await ctx.reply(`${messages[lang].aiTopTenInsightIntro}\n\n${buildTopTenInsightMessage(lang, section, items)}`);
    return ctx.reply(
      await getTopTenManageEntryMessage(ctx, lang, section, items),
      aiListManageMenuKeyboard(lang, section, "topTen"),
    );
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

    const statusCopy = getWatchStatusCopy(lang, section);
    return ctx.reply(
      toggled.item?.watched ? statusCopy.doneText : statusCopy.pendingText,
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
    const prompt = await ctx.reply(
      listType === "topTen" ? messages[lang].aiTopTenCommentAskText : messages[lang].aiWatchlistCommentAskText,
      { reply_markup: { remove_keyboard: true } },
    );
    const editedPrompt = await editPlaceholder(
      ctx,
      prompt,
      listType === "topTen" ? messages[lang].aiTopTenCommentAskText : messages[lang].aiWatchlistCommentAskText,
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
    await helpers.deleteCallbackMessageIfPossible(ctx);
    return ctx.reply(
      listType === "topTen" ? messages[lang].aiTopTenCommentCanceled : messages[lang].aiWatchlistCommentCanceled,
      aiListManageMenuKeyboard(lang, section, listType),
    );
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
    if (topTenItems.length >= 10) {
      return ctx.reply(messages[lang].aiTopTenLimitReached, aiListManageMenuKeyboard(lang, section, "watchlist"));
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

    const promoteResult = await promoteWatchlistItemToTopTen(ctx.userId, section, itemTitle, 10);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    if (!promoteResult.ok) {
      if (promoteResult.reason === "top_ten_limit") {
        return ctx.reply(messages[lang].aiTopTenLimitReached, aiListManageMenuKeyboard(lang, section, "watchlist"));
      }
      if (promoteResult.reason === "exists") {
        return ctx.reply(messages[lang].aiWatchlistPromoteAlreadyTopTen, aiListManageMenuKeyboard(lang, section, "watchlist"));
      }
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    await syncAiTasteForSection(ctx.userId, section);
    return ctx.reply(messages[lang].aiWatchlistPromotedToTopTen, aiListManageMenuKeyboard(lang, section, "watchlist"));
  }

  if (data.startsWith(callBacks.aiListManageCancelAdd)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageCancelAdd, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    const expectedState = `ai_manage_${section}_${toAiManageStateListType(listType)}_add_input`;
    if (ctx.user?.state !== expectedState) {
      await clearAiPendingInputPrompt(ctx);
      return helpers.deleteCallbackMessageIfPossible(ctx);
    }

    await clearAiPendingInputPrompt(ctx);
    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}`);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    return ctx.reply(messages[lang].aiListManageAddCanceled, aiListManageMenuKeyboard(lang, section, listType));
  }

  if (data.startsWith(callBacks.aiListManageAdd)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageAdd, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) return ctx.reply(messages[lang].unknownAction);

    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}_add_input`);
    const isInterestTopTen = section === "random" && listType === "topTen";
    await helpers.deleteCallbackMessageIfPossible(ctx);
    const prompt = await ctx.reply(
      isInterestTopTen ? messages[lang].aiInterestTopTenAddPrompt : messages[lang].aiListManageAddPrompt,
      { reply_markup: { remove_keyboard: true } },
    );
    const editedPrompt = await editPlaceholder(
      ctx,
      prompt,
      isInterestTopTen ? messages[lang].aiInterestTopTenAddPrompt : messages[lang].aiListManageAddPrompt,
      isInterestTopTen ? aiInterestTopTenChipKeyboard(lang) : aiListCancelAddKeyboard(lang, section, listType),
    );
    await rememberAiPendingInputPrompt(ctx, editedPrompt || prompt);
    return editedPrompt;
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
    await clearAiPendingInputPrompt(ctx);

    const currentItems = getAiListItemsFromUser(ctx.user, "random", "topTen");
    const result = await addAiListItem(ctx.userId, "random", "topTen", { title: item, comment: "" }, AI_TOP_TEN_LIMIT);

    if (!result.ok) {
      if (result.reason === "exists") {
        return ctx.reply(getDuplicateTopTenMessage(lang, result, currentItems.length), aiListManageMenuKeyboard(lang, "random", "topTen"));
      }
      if (result.reason === "limit") {
        return ctx.reply(messages[lang].aiTopTenLimitReached, aiListManageMenuKeyboard(lang, "random", "topTen"));
      }
      if (result.reason === "invalid_item_quality") {
        const errorMessage = messages[lang].aiTopTenInvalidItemQualityRandom || messages[lang].aiTopTenInvalidItemQuality;
        return ctx.reply(errorMessage, aiListManageMenuKeyboard(lang, "random", "topTen"));
      }
      return ctx.reply(messages[lang].aiListInvalidInput, aiListManageMenuKeyboard(lang, "random", "topTen"));
    }

    await updateUserState(ctx.userId, "ai_manage_random_top_ten");
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
    return placeholder.finish(savedText, aiListManageMenuKeyboard(lang, "random", "topTen"));
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

    await deleteRememberedAiListMessage(ctx, section, listType);
    const removedText = messages[lang].aiListRemovedNamed.replace("{item}", itemTitle);

    if (listType === "topTen") {
      return ctx.reply(
        `${removedText}\n\n${await getTopTenManageEntryMessage(ctx, lang, section, removeResult.items)}`,
        aiListManageMenuKeyboard(lang, section, listType),
      );
    }

    const listLabel = getSectionListLabel(messages, lang, section);
    return ctx.reply(
      `${removedText}\n\n${messages[lang].aiListManageInlineEntry.replace("{listName}", listLabel)}`,
      aiListManageMenuKeyboard(lang, section, listType),
    );
  }

  if (data.startsWith(callBacks.aiListManageBack)) {
    const section = data.replace(callBacks.aiListManageBack, "");
    if (!section) {
      await ctx.answerCb?.();
      return ctx.reply(messages[lang].unknownAction);
    }

    await ctx.answerCb?.(
      messages[lang].aiSectionOpeningNotification
        .replace("{section}", getAiSectionNotificationTitle(lang, section)),
    );
    await updateUserState(ctx.userId, `ai_chat_${section}`);
    await clearAiPendingInputPrompt(ctx);
    await clearRememberedAiListMessage(ctx);
    await clearAiSectionEntryMessage(ctx, [ctx.callbackMessageId]);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    const entryMessage = await getAiSectionEntryMessage(ctx, lang, section);
    const sent = await ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, section));
    await rememberAiSectionEntryMessage(ctx, sent);
    return sent;
  }

  if (data.startsWith(callBacks.aiSectionAnotherSuggestion)) {
    await ctx.answerCb?.(messages[lang].aiSuggestionNotification);
    const section = data.replace(callBacks.aiSectionAnotherSuggestion, "").trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    if (topTenItems.length < 3) return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));

    await helpers.deleteCallbackMessageIfPossible(ctx);
    return promptSuggestionMode(ctx, lang, section);
  }

  if (data.startsWith(callBacks.aiSectionSuggestContextCancel)) {
    const section = data.replace(callBacks.aiSectionSuggestContextCancel, "").trim();
    if (!section) {
      await ctx.answerCb?.();
      return ctx.reply(messages[lang].unknownAction);
    }

    await ctx.answerCb?.(
      messages[lang].aiSectionOpeningNotification
        .replace("{section}", getAiSectionNotificationTitle(lang, section)),
    );
    await updateUserState(ctx.userId, `ai_chat_${section}`);
    await clearAiPendingInputPrompt(ctx);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    const entryMessage = await getAiSectionEntryMessage(ctx, lang, section);
    return ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, section));
  }

  if (data.startsWith(callBacks.aiSectionSuggestWithContext)) {
    await ctx.answerCb?.(messages[lang].aiSuggestionContextNotification);
    const section = data.replace(callBacks.aiSectionSuggestWithContext, "").trim();
    if (!section) return ctx.reply(messages[lang].unknownAction);

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    if (topTenItems.length < 3) return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));

    await clearAiPendingInputPrompt(ctx);
    await updateUserState(ctx.userId, `ai_suggest_context_${section}`);
    await helpers.deleteCallbackMessageIfPossible(ctx);
    const prompt = await ctx.reply(messages[lang].aiSuggestionContextPrompt, {
      reply_markup: { remove_keyboard: true },
    });
    const editedPrompt = await editPlaceholder(
      ctx,
      prompt,
      messages[lang].aiSuggestionContextPrompt,
      aiSuggestionContextCancelKeyboard(lang, section),
    );
    await rememberAiPendingInputPrompt(ctx, editedPrompt || prompt);
    return editedPrompt;
  }

  if (data.startsWith(callBacks.aiSectionSuggestFromTopTen)) {
    await ctx.answerCb?.(messages[lang].aiSuggestionTopTenNotification);
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
    });

    if (sentSuggestion) return sentSuggestion;
    return ctx.reply(messages[lang].aiTemporaryUnavailable, aiSectionKeyboardForSection(lang, section));
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
    if (!title) return ctx.reply(messages[lang].aiSuggestionExpired || messages[lang].unknownAction);

    await helpers.deleteCallbackMessageIfPossible(ctx);
    const result = await addAiListItem(ctx.userId, section, "watchlist", { title, comment, watched: markDone }, AI_WATCHLIST_LIMIT);

    if (!result.ok) {
      if (result.reason === "exists") return ctx.reply(getDuplicateListMessage(lang, result), aiSuggestionAddKeyboard(lang, section));
      if (result.reason === "limit") return ctx.reply(messages[lang].aiSuggestionListFull, aiListManageMenuKeyboard(lang, section, "watchlist"));
      return ctx.reply(messages[lang].aiTemporaryUnavailable);
    }

    clearPendingSuggestion(ctx.userId, section);
    await updateUserState(ctx.userId, `ai_chat_${section}`);
    if (!markDone) {
      return ctx.reply(messages[lang].aiSuggestionAdded, aiSuggestionAddedOptionsKeyboard(lang, section));
    }

    return ctx.reply(
      `${getSuggestionDoneCompliment(lang, section)}\n${getSuggestionAddedDoneMessage(lang, section)}`,
      aiSuggestionNextKeyboard(lang, section),
    );
  }

  if (data === callBacks.aiSuggestMovies) return enterAiSection(ctx, lang, "movies", helpers);
  if (data === callBacks.aiSuggestMusic) return enterAiSection(ctx, lang, "music", helpers);
  if (data === callBacks.aiSuggestBooks) return enterAiSection(ctx, lang, "books", helpers);
  if (data === callBacks.aiSuggestRandom) return enterAiSection(ctx, lang, "random", helpers);

  if (data === callBacks.aiBack) {
    await ctx.answerCb?.(messages[lang].mainMenuTitle);
    await updateUserState(ctx.userId, "idle");
    await updateProfileField(ctx.userId, "activeDiscussionId", null);
    await clearAiPendingInputPrompt(ctx);
    await clearAiSectionPin({ ctx, updateProfileField });
    return helpers.editCallbackMessageOrReply(ctx, messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  return null;
}

module.exports = {
  handleAiCallback,
  isAiCallback,
  isSuggestionCallbackValidForState,
};
