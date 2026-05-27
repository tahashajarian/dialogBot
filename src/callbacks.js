const messages = require("./messages");
const path = require("path");
const { setLanguage, detectLanguage, normalizeLang } = require("./lang");
const { getAiSingleSuggestion } = require("./services/ai");
const { startAiPlaceholder } = require("./services/ai-placeholder");
const {
  mainMenuKeyboard,
  languageKeyboard,
  aiAssistantKeyboard,
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionNextKeyboard,
  aiSuggestionAddedOptionsKeyboard,
  aiListManageMenuKeyboard,
  aiListRemoveItemsKeyboard,
  aiListCancelAddKeyboard,
  aiListActionItemsKeyboard,
  aiListCancelCommentKeyboard,
  profileKeyboard,
  ageKeyboard,
  ageRangeKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  cancelEditKeyboard,
} = require("./keyboards");
const { callBacks } = require("./constances");
const {
  updateProfileField,
  updateUserState,
  removeAiListItem,
  addAiListItem,
  getAiListItemsFromUser,
  getWatchlistItemsByStatusFromUser,
  toggleWatchlistItemWatched,
  setAiListItemComment,
  promoteWatchlistItemToTopTen,
  syncAiTasteForSection,
  getAiListTitlesFromUser,
  getAiTasteFromUser,
  getTasteProgressStatus,
  inferTasteLabel,
} = require("./services/users");
const { sendProfileMessage, toPlainUser } = require("./services/profile");
const {
  clearAiSectionPin,
  pinAiSectionTitle,
  getSectionLabel,
  getTasteLabelTitle,
  getTasteLabelStyleHint,
} = require("./services/ai-section");
const {
  setPendingSuggestion,
  getPendingSuggestion,
  clearPendingSuggestion,
} = require("./services/ai-suggestion-cache");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");
const AI_WATCHLIST_LIMIT = 100;

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

function formatListWithWatched({ title, items, emptyText }) {
  if (!items.length) {
    return emptyText;
  }

  const lines = items.map((entry, index) => {
    const watchedBadge = entry?.watched ? "✅" : "⬜";
    const commentPart = entry?.comment ? ` — ${entry.comment}` : "";
    return `${index + 1}. ${watchedBadge} ${entry.title}${commentPart}`;
  });
  return `${title}\n${lines.join("\n")}`;
}

function getSectionReadyMessage(lang, section) {
  if (section === "movies") return messages[lang].aiMoviesChatReady;
  if (section === "music") return messages[lang].aiMusicChatReady;
  if (section === "books") return messages[lang].aiBooksChatReady;
  return messages[lang].aiRandomChatReady;
}

function formatTopTenItemsList(title, items, emptyText) {
  if (!items.length) {
    return emptyText;
  }

  return `${title}\n${items.map((entry, index) => `${index + 1}. ${entry.title}`).join("\n")}`;
}

function buildTopTenListMessage(ctx, lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const title = messages[lang].aiTopTenTitle.replace("{section}", sectionLabel);
  const emptyText = messages[lang].aiTopTenEmpty.replace("{section}", sectionLabel);
  const items = getAiListItemsFromUser(ctx.user, section, "topTen");
  return formatTopTenItemsList(title, items, emptyText);
}

async function buildTopTenSectionMessage(ctx, lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const items = getAiListItemsFromUser(ctx.user, section, "topTen");
  const topTenTitles = items.map((entry) => entry.title);
  const progress = getTasteProgressStatus(section, topTenTitles.length);

  if (!progress.labelReady) {
    return [
      getSectionReadyMessage(lang, section),
      messages[lang].aiSectionCollectTopTenPrompt
        .replace("{section}", sectionLabel)
        .replace("{count}", String(progress.count))
        .replace("{goal}", String(progress.goal)),
    ].join("\n\n");
  }

  let taste = getAiTasteFromUser(ctx.user, section);
  if (!taste.labelKey) {
    const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
    taste = syncedTaste.ok ? syncedTaste.taste : inferTasteLabel(section, topTenTitles);
  }

  const labelTitle = getTasteLabelTitle(messages, lang, section, taste.labelKey);
  const styleHint = getTasteLabelStyleHint(messages, lang, section, taste.labelKey);

  return [
    getSectionReadyMessage(lang, section),
    messages[lang].aiTasteLabelKnownIntro
      .replace("{section}", sectionLabel)
      .replace("{label}", labelTitle),
    messages[lang].aiTasteStyleHintIntro.replace("{style}", styleHint),
  ].join("\n\n");
}

async function sendFollowupSuggestion({
  ctx,
  lang,
  section,
  watchlistItems = [],
}) {
  const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
  const taste = getAiTasteFromUser(ctx.user, section);
  const tasteStyleHint = taste?.labelKey
    ? getTasteLabelStyleHint(messages, lang, section, taste.labelKey)
    : "";

  const placeholder = await startAiPlaceholder(ctx, [
    messages[lang].aiThinking,
    messages[lang].aiThinkingStill,
    messages[lang].aiThinkingAlmost,
  ]);
  const suggestionResult = await getAiSingleSuggestion({
    mode: section,
    lang,
    userText: section === "random" ? "Suggest one thing for me" : `Suggest one ${section} item`,
    topTenItems,
    watchlistItems,
    personalized: true,
    tasteStyleHint,
  });

  if (!suggestionResult.ok || !suggestionResult.title) {
    return placeholder.finish(messages[lang].aiNoResponse || messages[lang].aiTemporaryUnavailable);
  }

  setPendingSuggestion(ctx.userId, section, suggestionResult.title, suggestionResult.reason || "");
  return placeholder.finish(
    `${suggestionResult.title}\n${suggestionResult.reason || messages[lang].aiSuggestionFallbackTitle}`,
    aiSuggestionAddKeyboard(lang, section),
  );
}

function getWatchStatusCopy(lang, section) {
  if (section === "music") {
    return {
      togglePrompt: messages[lang].aiWatchlistTogglePromptMusic || messages[lang].aiWatchlistTogglePrompt,
      doneText: messages[lang].aiWatchlistWatchedOnMusic || messages[lang].aiWatchlistWatchedOn,
      pendingText: messages[lang].aiWatchlistWatchedOffMusic || messages[lang].aiWatchlistWatchedOff,
    };
  }

  if (section === "books") {
    return {
      togglePrompt: messages[lang].aiWatchlistTogglePromptBooks || messages[lang].aiWatchlistTogglePrompt,
      doneText: messages[lang].aiWatchlistWatchedOnBooks || messages[lang].aiWatchlistWatchedOn,
      pendingText: messages[lang].aiWatchlistWatchedOffBooks || messages[lang].aiWatchlistWatchedOff,
    };
  }

  if (section === "random") {
    return {
      togglePrompt: messages[lang].aiWatchlistTogglePromptRandom || messages[lang].aiWatchlistTogglePrompt,
      doneText: messages[lang].aiWatchlistWatchedOnRandom || messages[lang].aiWatchlistWatchedOn,
      pendingText: messages[lang].aiWatchlistWatchedOffRandom || messages[lang].aiWatchlistWatchedOff,
    };
  }

  return {
    togglePrompt: messages[lang].aiWatchlistTogglePromptMovies || messages[lang].aiWatchlistTogglePrompt,
    doneText: messages[lang].aiWatchlistWatchedOnMovies || messages[lang].aiWatchlistWatchedOn,
    pendingText: messages[lang].aiWatchlistWatchedOffMovies || messages[lang].aiWatchlistWatchedOff,
  };
}

function getSuggestionDoneCompliment(lang, section) {
  if (section === "music") return messages[lang].aiSuggestionDoneComplimentMusic;
  if (section === "books") return messages[lang].aiSuggestionDoneComplimentBooks;
  if (section === "random") return messages[lang].aiSuggestionDoneComplimentRandom;
  return messages[lang].aiSuggestionDoneComplimentMovies;
}

function getSuggestionAddedDoneMessage(lang, section) {
  if (section === "music") return messages[lang].aiSuggestionAddedDoneMusic || messages[lang].aiSuggestionAddedDone;
  if (section === "books") return messages[lang].aiSuggestionAddedDoneBooks || messages[lang].aiSuggestionAddedDone;
  if (section === "random") return messages[lang].aiSuggestionAddedDoneRandom || messages[lang].aiSuggestionAddedDone;
  return messages[lang].aiSuggestionAddedDoneMovies || messages[lang].aiSuggestionAddedDone;
}

async function getAiSectionEntryMessage(ctx, lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
  const progress = getTasteProgressStatus(section, topTenItems.length);

  if (!progress.labelReady) {
    return messages[lang].aiSectionCollectTopTenPrompt
      .replace("{section}", sectionLabel)
      .replace("{count}", String(progress.count))
      .replace("{goal}", String(progress.goal));
  }

  let taste = getAiTasteFromUser(ctx.user, section);
  if (!taste.labelKey) {
    const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
    taste = syncedTaste.ok ? syncedTaste.taste : inferTasteLabel(section, topTenItems);
  }

  const labelTitle = getTasteLabelTitle(messages, lang, section, taste.labelKey);
  const styleHint = getTasteLabelStyleHint(messages, lang, section, taste.labelKey);

  return [
    getSectionReadyMessage(lang, section),
    messages[lang].aiTasteLabelKnownIntro
      .replace("{section}", sectionLabel)
      .replace("{label}", labelTitle),
    messages[lang].aiTasteStyleHintIntro.replace("{style}", styleHint),
  ].join("\n");
}

async function handleCallback(ctx) {
  const data = ctx.callbackData || "";
  const lang = detectLanguage(ctx);

  if (!data) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
  }

  // menu routes
  if (data === callBacks.menuMain) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === callBacks.language) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].chooseLanguage, languageKeyboard());
  }

  if (data === callBacks.profile) {
    await ctx.answerCb?.();
    return sendProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.aiAssistant) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
  }

  if (data.startsWith(callBacks.aiListManageMenu)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageMenu, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const sectionLabel = getSectionLabel(messages, lang, section);
    const listLabel = section === "movies"
      ? messages[lang].aiSectionListLabelMovies
      : section === "music"
        ? messages[lang].aiSectionListLabelMusic
        : section === "books"
          ? messages[lang].aiSectionListLabelBooks
          : messages[lang].aiSectionListLabelRandom;
    const title = listType === "watchlist"
      ? messages[lang].aiWatchlistTitle.replace("{section}", sectionLabel).replace("{listName}", listLabel)
      : messages[lang].aiTopTenTitle.replace("{section}", sectionLabel);

    if (listType === "topTen") {
      await ctx.reply(buildTopTenListMessage(ctx, lang, section));
    }

    const menuText = listType === "topTen"
      ? `${await buildTopTenSectionMessage(ctx, lang, section)}\n\n${messages[lang].aiListManageInlineMenu.replace("{title}", title)}`
      : messages[lang].aiListManageInlineMenu.replace("{title}", title);

    return ctx.reply(
      menuText,
      aiListManageMenuKeyboard(lang, section, listType),
    );
  }

  if (data.startsWith(callBacks.aiListManageShow)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageShow, "");
    const [section = "", rawListType = "", rawFilter = "all"] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    const filter = normalizeWatchlistFilter(rawFilter);
    if (!section || !listType) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const sectionLabel = getSectionLabel(messages, lang, section);
    const listLabel = section === "movies"
      ? messages[lang].aiSectionListLabelMovies
      : section === "music"
        ? messages[lang].aiSectionListLabelMusic
        : section === "books"
          ? messages[lang].aiSectionListLabelBooks
          : messages[lang].aiSectionListLabelRandom;
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
      ? formatListWithWatched({
        title,
        items,
        emptyText: filter === "all" ? emptyText : messages[lang].aiWatchlistFilterEmpty,
      })
      : (!items.length
        ? emptyText
        : `${title}\n${items.map((entry, index) => `${index + 1}. ${entry.title}`).join("\n")}`);

    return ctx.reply(listText, aiListManageMenuKeyboard(lang, section, listType));
  }

  if (data.startsWith(callBacks.aiListManageTogglePicker)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageTogglePicker, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || listType !== "watchlist") {
      return ctx.reply(messages[lang].unknownAction);
    }

    const items = getAiListItemsFromUser(ctx.user, section, "watchlist");
    if (!items.length) {
      return ctx.reply(messages[lang].aiWatchlistFilterEmpty, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const statusCopy = getWatchStatusCopy(lang, section);
    return ctx.reply(
      statusCopy.togglePrompt,
      aiListActionItemsKeyboard(lang, section, "watchlist", "toggle", items),
    );
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
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const toggled = await toggleWatchlistItemWatched(ctx.userId, section, itemTitle);
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
    if (!section || !listType) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const items = getAiListItemsFromUser(ctx.user, section, listType);
    if (!items.length) {
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));
    }

    const isTopTen = listType === "topTen";
    return ctx.reply(
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
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));
    }

    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}_comment_input`);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", itemTitle);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", listType);
    return ctx.reply(
      listType === "topTen" ? messages[lang].aiTopTenCommentAskText : messages[lang].aiWatchlistCommentAskText,
      aiListCancelCommentKeyboard(lang, section, listType),
    );
  }

  if (data.startsWith(callBacks.aiListManageCancelComment)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageCancelComment, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", null);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", null);
    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}`);
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
    if (!section || listType !== "watchlist") {
      return ctx.reply(messages[lang].unknownAction);
    }

    const watchlistItems = getAiListItemsFromUser(ctx.user, section, "watchlist");
    if (!watchlistItems.length) {
      return ctx.reply(messages[lang].aiWatchlistFilterEmpty, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const topTenItems = getAiListItemsFromUser(ctx.user, section, "topTen");
    if (topTenItems.length >= 10) {
      return ctx.reply(messages[lang].aiTopTenLimitReached, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    return ctx.reply(
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

    const watchlistItems = getAiListItemsFromUser(ctx.user, section, "watchlist");
    const itemTitle = watchlistItems[itemIndex]?.title;
    if (!itemTitle) {
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const promoteResult = await promoteWatchlistItemToTopTen(ctx.userId, section, itemTitle, 10);
    if (!promoteResult.ok) {
      if (promoteResult.reason === "top_ten_limit") {
        return ctx.reply(messages[lang].aiTopTenLimitReached, aiListManageMenuKeyboard(lang, section, "watchlist"));
      }
      if (promoteResult.reason === "exists") {
        return ctx.reply(messages[lang].aiListAlreadyExists, aiListManageMenuKeyboard(lang, section, "watchlist"));
      }
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    await syncAiTasteForSection(ctx.userId, section);
    return ctx.reply(
      messages[lang].aiWatchlistPromotedToTopTen,
      aiListManageMenuKeyboard(lang, section, "watchlist"),
    );
  }

  if (data.startsWith(callBacks.aiListManageAdd)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageAdd, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}_add_input`);
    return ctx.reply(
      messages[lang].aiListManageAddPrompt,
      aiListCancelAddKeyboard(lang, section, listType),
    );
  }

  if (data.startsWith(callBacks.aiListManageCancelAdd)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageCancelAdd, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}`);
    return ctx.reply(
      messages[lang].aiListManageAddCanceled,
      aiListManageMenuKeyboard(lang, section, listType),
    );
  }

  if (data.startsWith(callBacks.aiListManageRemovePicker)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageRemovePicker, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const items = getAiListItemsFromUser(ctx.user, section, listType);
    if (!items.length) {
      return ctx.reply(
        messages[lang].aiListNotFound,
        aiListManageMenuKeyboard(lang, section, listType),
      );
    }

    return ctx.reply(
      messages[lang].aiListManageRemovePrompt,
      aiListRemoveItemsKeyboard(lang, section, listType, items),
    );
  }

  if (data.startsWith(callBacks.aiListManageRemoveItem)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageRemoveItem, "");
    const [section = "", rawListType = "", itemIndexRaw = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    const itemIndex = Number(itemIndexRaw);
    if (!section || !listType || !Number.isInteger(itemIndex) || itemIndex < 0) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const currentItems = getAiListItemsFromUser(ctx.user, section, listType);
    const itemTitle = currentItems[itemIndex]?.title;
    if (!itemTitle) {
      return ctx.reply(
        messages[lang].aiListNotFound,
        aiListManageMenuKeyboard(lang, section, listType),
      );
    }

    const removeResult = await removeAiListItem(ctx.userId, section, listType, itemTitle);
    if (!removeResult.ok) {
      return ctx.reply(
        messages[lang].aiListNotFound,
        aiListManageMenuKeyboard(lang, section, listType),
      );
    }

    if (listType === "topTen") {
      await syncAiTasteForSection(ctx.userId, section);
    }

    return ctx.reply(
      messages[lang].aiListRemoved,
      aiListManageMenuKeyboard(lang, section, listType),
    );
  }

  if (data.startsWith(callBacks.aiListManageBack)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiListManageBack, "");
    if (!section) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await updateUserState(ctx.userId, `ai_chat_${section}`);
    return ctx.reply(messages[lang].aiSectionBackToChat, aiSectionKeyboardForSection(lang, section));
  }

  if (data.startsWith(callBacks.aiSectionAnotherSuggestion)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.aiSectionAnotherSuggestion, "").trim();
    if (!section) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const sentSuggestion = await sendFollowupSuggestion({
      ctx,
      lang,
      section,
      watchlistItems: getAiListTitlesFromUser(ctx.user, section, "watchlist"),
    });

    if (sentSuggestion) {
      return sentSuggestion;
    }

    return ctx.reply(messages[lang].aiTemporaryUnavailable, aiSectionKeyboardForSection(lang, section));
  }

  if (data.startsWith(callBacks.aiSectionAddSuggestion) || data.startsWith(callBacks.aiSectionAddSuggestionDone)) {
    await ctx.answerCb?.();
    const markDone = data.startsWith(callBacks.aiSectionAddSuggestionDone);
    const payload = data.replace(
      markDone ? callBacks.aiSectionAddSuggestionDone : callBacks.aiSectionAddSuggestion,
      "",
    );
    const section = payload.trim();
    if (!section) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const pending = getPendingSuggestion(ctx.userId, section);
    const title = String(pending?.title || "").trim();
    const comment = String(pending?.comment || "").trim();
    if (!title) {
      return ctx.reply(messages[lang].aiSuggestionExpired || messages[lang].unknownAction);
    }

    const result = await addAiListItem(
      ctx.userId,
      section,
      "watchlist",
      { title, comment, watched: markDone },
      AI_WATCHLIST_LIMIT,
    );

    if (!result.ok) {
      if (result.reason === "exists") {
        return ctx.reply(messages[lang].aiSuggestionAlreadyInList, aiSuggestionAddKeyboard(lang, section));
      }
      if (result.reason === "limit") {
        return ctx.reply(messages[lang].aiSuggestionListFull, aiListManageMenuKeyboard(lang, section, "watchlist"));
      }
      return ctx.reply(messages[lang].aiTemporaryUnavailable);
    }

    clearPendingSuggestion(ctx.userId, section);
    if (!markDone) {
      await updateUserState(ctx.userId, `ai_chat_${section}`);
      return ctx.reply(
        messages[lang].aiSuggestionAdded,
        aiSuggestionAddedOptionsKeyboard(lang, section),
      );
    }

    await updateUserState(ctx.userId, `ai_chat_${section}`);
    return ctx.reply(
      `${getSuggestionDoneCompliment(lang, section)}\n${getSuggestionAddedDoneMessage(lang, section)}`,
      aiSuggestionNextKeyboard(lang, section),
    );
  }

  if (data === callBacks.aiSuggestMovies) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "ai_chat_movies");
    await pinAiSectionTitle({
      ctx,
      lang,
      section: "movies",
      messages,
      updateProfileField,
    });
    const entryMessage = await getAiSectionEntryMessage(ctx, lang, "movies");
    return ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, "movies"));
  }

  if (data === callBacks.aiSuggestMusic) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "ai_chat_music");
    await pinAiSectionTitle({
      ctx,
      lang,
      section: "music",
      messages,
      updateProfileField,
    });
    const entryMessage = await getAiSectionEntryMessage(ctx, lang, "music");
    return ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, "music"));
  }

  if (data === callBacks.aiSuggestBooks) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "ai_chat_books");
    await pinAiSectionTitle({
      ctx,
      lang,
      section: "books",
      messages,
      updateProfileField,
    });
    const entryMessage = await getAiSectionEntryMessage(ctx, lang, "books");
    return ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, "books"));
  }

  if (data === callBacks.aiSuggestRandom) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "ai_chat_random");
    await pinAiSectionTitle({
      ctx,
      lang,
      section: "random",
      messages,
      updateProfileField,
    });
    const entryMessage = await getAiSectionEntryMessage(ctx, lang, "random");
    return ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, "random"));
  }

  if (data === callBacks.aiBack) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    await clearAiSectionPin({ ctx, updateProfileField });
    await ctx.reply(messages[lang].cancelMessage, {
      reply_markup: { remove_keyboard: true },
    });
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === callBacks.profileEditName) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_name");
    return ctx.reply(messages[lang].profileAskName, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileEditCity) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_city");
    return ctx.reply(messages[lang].profileAskCity, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileEditAge) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_age");
    return ctx.reply(messages[lang].profileAskAge, ageKeyboard(lang));
  }

  if (data === callBacks.profileEditGender) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_gender");
    return ctx.reply(messages[lang].profileAskGender, genderKeyboard(lang));
  }

  if (data === callBacks.profileEditPetPreference) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_pet_preference");
    return ctx.reply(messages[lang].profileAskPetPreference, petPreferenceKeyboard(lang));
  }

  if (data === callBacks.profileEditBio) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_bio");
    return ctx.reply(messages[lang].profileAskBio, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileEditLocation) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_location");
    return ctx.reply(messages[lang].profileAskLocation, locationKeyboard(lang));
  }

  if (data.startsWith(callBacks.profileGenderSet)) {
    const gender = data.replace(callBacks.profileGenderSet, "");
    const allowedGenders = new Set([
      "female",
      "male",
      "other",
    ]);

    await ctx.answerCb?.();

    if (!allowedGenders.has(gender)) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await updateProfileField(ctx.userId, "gender", gender);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.gender = gender;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data.startsWith(callBacks.profilePetSet)) {
    const petPreference = data.replace(callBacks.profilePetSet, "");
    const allowedPetPreferences = new Set([
      "any",
      "none",
      "cat",
      "dog",
      "bird",
      "small_pets",
    ]);

    await ctx.answerCb?.();

    if (!allowedPetPreferences.has(petPreference)) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await updateProfileField(ctx.userId, "petPreference", petPreference);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.petPreference = petPreference;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data.startsWith(callBacks.profileAgeRangeSet)) {
    const startAge = Number(data.replace(callBacks.profileAgeRangeSet, ""));

    await ctx.answerCb?.();

    if (
      !Number.isInteger(startAge) ||
      startAge < 10 ||
      startAge > 79 ||
      startAge % 10 !== 0
    ) {
      return ctx.reply(messages[lang].unknownAction);
    }

    return ctx.reply(messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge));
  }

  if (data === callBacks.profileAgeRangeBack) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].profileAskAge, ageKeyboard(lang));
  }

  if (data.startsWith(callBacks.profileAgeSet)) {
    const age = Number(data.replace(callBacks.profileAgeSet, ""));

    await ctx.answerCb?.();

    if (!Number.isInteger(age) || age < 10 || age > 79) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await updateProfileField(ctx.userId, "age", age);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.age = age;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileEditPhoto) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_photo");
    return ctx.reply(messages[lang].profileAskPhoto, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileResetPhoto) {
    await ctx.answerCb?.();
    await updateProfileField(ctx.userId, "photoFileId", null);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = null;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileCancelEdit) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    await ctx.reply(messages[lang].cancelMessage, {
      reply_markup: { remove_keyboard: true },
    });
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileBack) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  // language routes
  if (data.startsWith(callBacks.langSet)) {
    const raw = data.split(":")[2];
    const selected = normalizeLang(raw); // fa/en

    await ctx.answerCb?.();

    if (!selected) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const userId = ctx.user?.userId;
    if (!userId) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const ok = await setLanguage(userId, selected); // DB update + normalize inside too
    if (!ok) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const newLang = selected;

    try {
      // Telegraf editMessageText: (text, extra)
      return await ctx.editMessage(
        messages[newLang].languageChanged,
        mainMenuKeyboard(newLang)
      );
    } catch {
      return await ctx.reply(
        messages[newLang].languageChanged,
        mainMenuKeyboard(newLang)
      );
    }
  }

  await ctx.answerCb?.();
  return ctx.reply(messages[lang].unknownAction);
}

async function sendProfile(ctx, lang, user = ctx.user) {
  return sendProfileMessage({
    ctx,
    user,
    lang,
    keyboard: profileKeyboard(lang, Boolean(user?.photoFileId)),
    messages,
    defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
  });
}

module.exports = { handleCallback };
