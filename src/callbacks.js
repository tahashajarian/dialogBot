const messages = require("./messages");
const path = require("path");
const { setLanguage, detectLanguage, normalizeLang } = require("./lang");
const { getAiSingleSuggestion, getAiTasteItemFeedback } = require("./services/ai");
const { startAiPlaceholder, editPlaceholder } = require("./services/ai-placeholder");
const {
  mainMenuKeyboard,
  languageKeyboard,
  aiAssistantKeyboard,
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
  addAiRecentSuggestion,
  consumeAiSuggestionQuota,
  refundAiSuggestionQuota,
  inferTasteLabel,
  DEFAULT_TASTE_LABEL_BY_SECTION,
  getAiListItemsFromUser,
  getWatchlistItemsByStatusFromUser,
  toggleWatchlistItemWatched,
  setAiListItemComment,
  promoteWatchlistItemToTopTen,
  syncAiTasteForSection,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  getAiTasteFromUser,
} = require("./services/users");
const { sendProfileMessage, toPlainUser } = require("./services/profile");
const {
  clearAiSectionPin,
  getSectionLabel,
  getTasteLabelEmoji,
  getTasteLabelStyleHint,
  getTasteLabelTitle,
} = require("./services/ai-section");
const {
  setPendingSuggestion,
  getPendingSuggestion,
  clearPendingSuggestion,
} = require("./services/ai-suggestion-cache");
const { getAiListDuplicateMatch } = require("./services/ai-list-duplicates");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");
const AI_WATCHLIST_LIMIT = 100;
const AI_RECENT_SUGGESTIONS_LIMIT = 20;
const AI_SUGGESTIONS_PER_HOUR = 10;
const AI_TOP_TEN_LIMIT = 10;
const AI_WATCHLIST_PROMPT_LIMIT = 30;

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

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function rememberAiListMessage(ctx, section, listType, message) {
  const messageId = getMessageId(message);
  if (!messageId) {
    return;
  }

  await updateProfileField(ctx.userId, "aiLastListMessageId", messageId);
  await updateProfileField(ctx.userId, "aiLastListSection", section);
  await updateProfileField(ctx.userId, "aiLastListType", listType);
}

async function deleteRememberedAiListMessage(ctx, section, listType) {
  const messageId = ctx.user?.aiLastListMessageId;
  if (
    !messageId ||
    ctx.user?.aiLastListSection !== section ||
    ctx.user?.aiLastListType !== listType ||
    !ctx.deleteMessage
  ) {
    return false;
  }

  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "aiLastListMessageId", null);
    await updateProfileField(ctx.userId, "aiLastListSection", "");
    await updateProfileField(ctx.userId, "aiLastListType", "");
  }
  return deleted;
}

function getDuplicateItemTitle(result) {
  return result?.duplicate?.title || result?.duplicate || "";
}

function getDuplicateListMessage(lang, result) {
  const duplicateTitle = getDuplicateItemTitle(result);
  if (!duplicateTitle) {
    return messages[lang].aiListAlreadyExists;
  }

  return messages[lang].aiListDuplicateMatch.replace("{item}", duplicateTitle);
}

function toTitleSet(items = []) {
  return new Set(items.map((entry) => String(entry?.title || entry || "").trim().toLowerCase()).filter(Boolean));
}

function formatListWithWatched({ title, items, emptyText, topTenTitleSet = new Set() }) {
  if (!items.length) {
    return emptyText;
  }

  const lines = items.map((entry, index) => {
    const watchedBadge = entry?.watched ? "✅" : "⬜";
    const topTenBadge = topTenTitleSet.has(String(entry?.title || "").trim().toLowerCase()) ? " 🏆" : "";
    const commentPart = entry?.comment ? ` — ${entry.comment}` : "";
    return `${index + 1}. ${watchedBadge} ${entry.title}${topTenBadge}${commentPart}`;
  });
  return `${title}\n\n${lines.join("\n")}`;
}

function formatTopTenItemsList(title, items, emptyText) {
  if (!items.length) {
    return emptyText;
  }

  const lines = items.map((entry, index) => {
    const commentPart = entry?.comment ? ` — ${entry.comment}` : "";
    return `${index + 1}. ${entry.title}${commentPart}`;
  });
  return `${title}\n\n${lines.join("\n")}`;
}

function buildTopTenListMessage(ctx, lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const title = messages[lang].aiTopTenTitle.replace("{section}", sectionLabel);
  const emptyText = messages[lang].aiTopTenEmpty.replace("{section}", sectionLabel);
  const items = getAiListItemsFromUser(ctx.user, section, "topTen");
  return formatTopTenItemsList(title, items, emptyText);
}

function formatTasteWithStoredEmoji(section, taste, labelTitle) {
  return `${taste?.emoji || getTasteLabelEmoji(section, taste?.labelKey)} ${labelTitle}`;
}

function buildTopTenInsightMessage(lang, section, items) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const goal = AI_TOP_TEN_LIMIT;
  if (items.length < goal) {
    return messages[lang].aiTopTenInsightNeedComplete
      .replace("{section}", sectionLabel)
      .replace("{count}", String(items.length))
      .replace("{goal}", String(goal));
  }

  const inferredTaste = inferTasteLabel(section, items.map((entry) => entry.title));
  const labelTitle = getTasteLabelTitle(messages, lang, section, inferredTaste.labelKey);
  const label = formatTasteWithStoredEmoji(section, inferredTaste, labelTitle);
  const style = getTasteLabelStyleHint(messages, lang, section, inferredTaste.labelKey);
  return messages[lang].aiTopTenInsightText
    .replace("{section}", sectionLabel)
    .replace("{label}", label)
    .replace("{style}", style || messages[lang].aiTasteLabelStyleFallback);
}

async function getTopTenManageEntryMessage(ctx, lang, section, topTenItemsOverride = null) {
  const topTenItems = Array.isArray(topTenItemsOverride)
    ? topTenItemsOverride
    : getAiListItemsFromUser(ctx.user, section, "topTen");
  if (topTenItems.length < AI_TOP_TEN_LIMIT) {
    const peopleHint = topTenItems.length <= 3 ? `\n\n${messages[lang].aiTopTenManagePeopleHint}` : "";
    if (topTenItems.length >= 3) {
      const taste = inferTasteLabel(section, topTenItems.map((entry) => entry.title));
      const labelTitle = getTasteLabelTitle(messages, lang, section, taste.labelKey);
      const label = formatTasteWithStoredEmoji(section, taste, labelTitle);
      return `${messages[lang].aiTopTenManageInlineEntryWithLabel.replace("{label}", label)}${peopleHint}`;
    }
    return `${messages[lang].aiTopTenManageInlineEntry}${peopleHint}`;
  }

  let taste = getAiTasteFromUser(ctx.user, section);
  if (!taste.labelKey) {
    const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
    if (syncedTaste.ok) {
      taste = syncedTaste.taste;
    }
  }

  const labelTitle = getTasteLabelTitle(messages, lang, section, taste.labelKey);
  const label = formatTasteWithStoredEmoji(section, taste, labelTitle);
  return messages[lang].aiTopTenManageInlineEntryComplete.replace("{label}", label);
}

function formatSuggestionLimitMessage(lang, resetAt) {
  const resetTime = resetAt ? new Date(resetAt).getTime() : Date.now();
  const minutes = Math.max(1, Math.ceil((resetTime - Date.now()) / (60 * 1000)));
  return messages[lang].aiSuggestionHourlyLimit.replace("{minutes}", String(minutes));
}

function formatSuggestionResultMessage(lang, title, reason) {
  const cleanReason = reason || messages[lang].aiSuggestionFallbackTitle;
  return [
    messages[lang].aiSuggestionResultTitle.replace("{item}", title),
    messages[lang].aiSuggestionResultReason.replace("{reason}", cleanReason),
  ].join("\n\n");
}

function promptSuggestionMode(ctx, lang, section) {
  return ctx.reply(messages[lang].aiSuggestionModePrompt, aiSuggestionModeKeyboard(lang, section));
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

function getNeedTopTenMessage(lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  return messages[lang].aiSectionSuggestNeedTopTenItem.replace("{section}", sectionLabel);
}

function getDuplicateTopTenMessage(lang, result, count) {
  const duplicateTitle = getDuplicateItemTitle(result);
  if (!duplicateTitle) {
    return messages[lang].aiTasteItemAlreadySent
      .replace("{count}", String(count))
      .replace("{goal}", String(AI_TOP_TEN_LIMIT));
  }

  return messages[lang].aiTasteDuplicateMatch
    .replace("{item}", duplicateTitle)
    .replace("{count}", String(count))
    .replace("{goal}", String(AI_TOP_TEN_LIMIT));
}

function buildTasteItemFeedbackFallback(lang, item, labelTitle) {
  return messages[lang].aiTasteItemFeedbackFallback
    .replace("{item}", item)
    .replace("{label}", labelTitle || messages[lang].aiTasteLabelTitleFallback);
}

function formatTasteLabelWithEmoji(section, labelKey, labelTitle) {
  return `${getTasteLabelEmoji(section, labelKey)} ${labelTitle}`;
}

function formatAiComplimentFeedback(feedback) {
  return `🤖 ${feedback}`;
}

function getTopTenNextPrompt(lang, count) {
  const key = `aiTasteAskNext_${count}`;
  return messages[lang][key] || messages[lang].aiTasteAskNext;
}

function isWeakTasteLabel(section, taste) {
  return (
    !taste?.labelKey ||
    taste.labelKey === DEFAULT_TASTE_LABEL_BY_SECTION[section] ||
    Number(taste.confidence) < 0.55
  );
}

async function buildTopTenSavedMessage({ ctx, lang, section, item, items }) {
  const count = items.length;
  const goal = AI_TOP_TEN_LIMIT;
  const itemTitles = items.map((entry) => entry.title);
  const inferredTaste = inferTasteLabel(section, itemTitles);
  const rawLabelTitle = getTasteLabelTitle(messages, lang, section, inferredTaste.labelKey);
  const labelTitle = formatTasteLabelWithEmoji(section, inferredTaste.labelKey, rawLabelTitle);
  const feedbackResult = await getAiTasteItemFeedback({
    mode: section,
    lang,
    item,
    labelKey: inferredTaste.labelKey,
    labelTitle: rawLabelTitle,
  });
  const feedback = feedbackResult.ok && feedbackResult.text
    ? feedbackResult.text
    : buildTasteItemFeedbackFallback(lang, item, labelTitle);
  const savedText = messages[lang].aiInterestTopTenChipSaved
    .replace("{item}", item)
    .replace("{count}", String(count))
    .replace("{goal}", String(goal));

  const responseParts = [formatAiComplimentFeedback(feedback)];

  if (count >= 3 && count < goal) {
    const preliminaryText = isWeakTasteLabel(section, inferredTaste)
      ? messages[lang].aiTastePreliminaryWeak
      : messages[lang].aiTastePreliminaryLabel.replace("{label}", labelTitle);
    responseParts.push(
      preliminaryText
        .replace("{count}", String(count))
        .replace("{goal}", String(goal)),
    );
  }

  responseParts.push(savedText);

  if (count < goal) {
    responseParts.push(getTopTenNextPrompt(lang, count));
    return responseParts.join("\n\n");
  }

  const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
  const resolvedTaste = syncedTaste.ok ? syncedTaste.taste : inferredTaste;
  const finalLabel = formatTasteWithStoredEmoji(
    section,
    resolvedTaste,
    getTasteLabelTitle(messages, lang, section, resolvedTaste.labelKey),
  );
  const styleHint = getTasteLabelStyleHint(messages, lang, section, resolvedTaste.labelKey);
  const sectionLabel = getSectionLabel(messages, lang, section);
  const unlockedText = (messages[lang].aiTasteLabelUnlockedDetailed || messages[lang].aiTasteLabelUnlocked)
    .replace("{section}", sectionLabel)
    .replace("{label}", finalLabel)
    .replace("{style}", styleHint)
    .replace("{count}", String(count))
    .replace("{goal}", String(goal));

  responseParts.push(unlockedText);
  return responseParts.join("\n\n");
}

async function getAiSectionEntryMessage(ctx, lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  return messages[lang].aiSectionEntryGuidance.replace("{section}", sectionLabel);
}

function getAiSectionNotificationTitle(lang, section) {
  if (section === "movies") return messages[lang].aiSuggestMovies;
  if (section === "music") return messages[lang].aiSuggestMusic;
  if (section === "books") return messages[lang].aiSuggestBooks;
  return messages[lang].aiSuggestRandom;
}

async function enterAiSection(ctx, lang, section) {
  await ctx.answerCb?.(
    messages[lang].aiSectionOpeningNotification
      .replace("{section}", getAiSectionNotificationTitle(lang, section)),
  );
  await updateUserState(ctx.userId, `ai_chat_${section}`);
  await updateProfileField(ctx.userId, "aiSectionPinnedMessageId", null);
  await updateProfileField(ctx.userId, "aiSectionPinnedSection", null);
  await deleteCallbackMessageIfPossible(ctx);
  const entryMessage = await getAiSectionEntryMessage(ctx, lang, section);
  return ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, section));
}

async function editCallbackMessageOrReply(ctx, text, keyboard) {
  if (ctx.callbackMessageId && ctx.editMessageText) {
    const edited = await ctx.editMessageText(ctx.callbackMessageId, text, keyboard);
    if (edited) {
      return edited;
    }
  }

  return ctx.reply(text, keyboard);
}

async function deleteCallbackMessageIfPossible(ctx) {
  if (!ctx.callbackMessageId || !ctx.deleteMessage) {
    return false;
  }

  return ctx.deleteMessage(ctx.callbackMessageId);
}

async function startProfileEdit(ctx, state, prompt, keyboard) {
  await deleteCallbackMessageIfPossible(ctx);
  await updateUserState(ctx.userId, state);
  return ctx.reply(prompt, keyboard);
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
    return editCallbackMessageOrReply(ctx, messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === callBacks.language) {
    await ctx.answerCb?.();
    return editCallbackMessageOrReply(ctx, messages[lang].chooseLanguage, languageKeyboard());
  }

  if (data === callBacks.profile) {
    await ctx.answerCb?.();
    return sendProfile(ctx, lang, ctx.user || {}, { loading: true });
  }

  if (data === callBacks.aiAssistant) {
    await ctx.answerCb?.(messages[lang].aiAssistant);
    return editCallbackMessageOrReply(ctx, messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
  }

  if (data.startsWith(callBacks.aiListManageMenu)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.aiListManageMenu, "");
    const [section = "", rawListType = ""] = payload.split(":");
    const listType = normalizeAiListTypeToken(rawListType);
    if (!section || !listType) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await deleteCallbackMessageIfPossible(ctx);
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
      const listMessage = await ctx.reply(buildTopTenListMessage(ctx, lang, section));
      await rememberAiListMessage(ctx, section, listType, listMessage);
    }

    const menuText = listType === "topTen"
      ? await getTopTenManageEntryMessage(ctx, lang, section)
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

    await deleteCallbackMessageIfPossible(ctx);
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
        topTenTitleSet: toTitleSet(getAiListItemsFromUser(ctx.user, section, "topTen")),
      })
      : formatTopTenItemsList(title, items, emptyText);

    const listMessage = await ctx.reply(listText, aiListManageMenuKeyboard(lang, section, listType));
    await rememberAiListMessage(ctx, section, listType, listMessage);
    return listMessage;
  }

  if (data.startsWith(callBacks.aiTopTenInsight)) {
    await ctx.answerCb?.(messages[lang].aiTopTenInsightNotification);
    const section = data.replace(callBacks.aiTopTenInsight, "").trim();
    if (!section) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const items = getAiListItemsFromUser(ctx.user, section, "topTen");
    await deleteCallbackMessageIfPossible(ctx);
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
    if (!section || listType !== "watchlist") {
      return ctx.reply(messages[lang].unknownAction);
    }

    const items = getAiListItemsFromUser(ctx.user, section, "watchlist");
    if (!items.length) {
      return ctx.reply(messages[lang].aiWatchlistFilterEmpty, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const statusCopy = getWatchStatusCopy(lang, section);
    return editCallbackMessageOrReply(
      ctx,
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
      await deleteCallbackMessageIfPossible(ctx);
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const toggled = await toggleWatchlistItemWatched(ctx.userId, section, itemTitle);
    await deleteCallbackMessageIfPossible(ctx);
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
    return editCallbackMessageOrReply(
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
      await deleteCallbackMessageIfPossible(ctx);
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, listType));
    }

    await deleteCallbackMessageIfPossible(ctx);
    await updateUserState(ctx.userId, `ai_manage_${section}_${toAiManageStateListType(listType)}_comment_input`);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", itemTitle);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", listType);
    const prompt = await ctx.reply(
      listType === "topTen" ? messages[lang].aiTopTenCommentAskText : messages[lang].aiWatchlistCommentAskText,
      { reply_markup: { remove_keyboard: true } },
    );
    return editPlaceholder(
      ctx,
      prompt,
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
    await deleteCallbackMessageIfPossible(ctx);
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

    return editCallbackMessageOrReply(
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
      await deleteCallbackMessageIfPossible(ctx);
      return ctx.reply(messages[lang].aiListNotFound, aiListManageMenuKeyboard(lang, section, "watchlist"));
    }

    const promoteResult = await promoteWatchlistItemToTopTen(ctx.userId, section, itemTitle, 10);
    await deleteCallbackMessageIfPossible(ctx);
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
    return ctx.reply(
      messages[lang].aiWatchlistPromotedToTopTen,
      aiListManageMenuKeyboard(lang, section, "watchlist"),
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
    await deleteCallbackMessageIfPossible(ctx);
    return ctx.reply(
      messages[lang].aiListManageAddCanceled,
      aiListManageMenuKeyboard(lang, section, listType),
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
    const isInterestTopTen = section === "random" && listType === "topTen";
    await deleteCallbackMessageIfPossible(ctx);
    const prompt = await ctx.reply(
      isInterestTopTen ? messages[lang].aiInterestTopTenAddPrompt : messages[lang].aiListManageAddPrompt,
      { reply_markup: { remove_keyboard: true } },
    );
    return editPlaceholder(
      ctx,
      prompt,
      isInterestTopTen ? messages[lang].aiInterestTopTenAddPrompt : messages[lang].aiListManageAddPrompt,
      isInterestTopTen ? aiInterestTopTenChipKeyboard(lang) : aiListCancelAddKeyboard(lang, section, listType),
    );
  }

  if (data.startsWith(callBacks.aiInterestTopTenChip)) {
    await ctx.answerCb?.();
    const chipIndex = Number(data.replace(callBacks.aiInterestTopTenChip, ""));
    const item = getInterestTopTenChipTitle(chipIndex, lang);
    if (!item) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await deleteCallbackMessageIfPossible(ctx);

    const currentItems = getAiListItemsFromUser(ctx.user, "random", "topTen");
    const result = await addAiListItem(
      ctx.userId,
      "random",
      "topTen",
      { title: item, comment: "" },
      AI_TOP_TEN_LIMIT,
    );

    if (!result.ok) {
      if (result.reason === "exists") {
        return ctx.reply(
          getDuplicateTopTenMessage(lang, result, currentItems.length),
          aiListManageMenuKeyboard(lang, "random", "topTen"),
        );
      }
      if (result.reason === "limit") {
        return ctx.reply(messages[lang].aiTopTenLimitReached, aiListManageMenuKeyboard(lang, "random", "topTen"));
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
    });
    return placeholder.finish(savedText, aiListManageMenuKeyboard(lang, "random", "topTen"));
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

    return editCallbackMessageOrReply(
      ctx,
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
      await deleteCallbackMessageIfPossible(ctx);
      return ctx.reply(
        messages[lang].aiListNotFound,
        aiListManageMenuKeyboard(lang, section, listType),
      );
    }

    const removeResult = await removeAiListItem(ctx.userId, section, listType, itemTitle);
    await deleteCallbackMessageIfPossible(ctx);
    if (!removeResult.ok) {
      return ctx.reply(
        messages[lang].aiListNotFound,
        aiListManageMenuKeyboard(lang, section, listType),
      );
    }

    if (listType === "topTen") {
      await syncAiTasteForSection(ctx.userId, section);
    }

    await deleteRememberedAiListMessage(ctx, section, listType);
    const removedText = messages[lang].aiListRemovedNamed.replace("{item}", itemTitle);

    if (listType === "topTen") {
      return ctx.reply(
        `${removedText}\n\n${await getTopTenManageEntryMessage(ctx, lang, section, removeResult.items)}`,
        aiListManageMenuKeyboard(lang, section, listType),
      );
    }

    const listLabel = section === "movies"
      ? messages[lang].aiSectionListLabelMovies
      : section === "music"
        ? messages[lang].aiSectionListLabelMusic
        : section === "books"
          ? messages[lang].aiSectionListLabelBooks
          : messages[lang].aiSectionListLabelRandom;
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
    await deleteCallbackMessageIfPossible(ctx);
    const entryMessage = await getAiSectionEntryMessage(ctx, lang, section);
    return ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, section));
  }

  if (data.startsWith(callBacks.aiSectionAnotherSuggestion)) {
    await ctx.answerCb?.(messages[lang].aiSuggestionNotification);
    const section = data.replace(callBacks.aiSectionAnotherSuggestion, "").trim();
    if (!section) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    if (topTenItems.length < 3) {
      return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));
    }

    await deleteCallbackMessageIfPossible(ctx);
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
    await deleteCallbackMessageIfPossible(ctx);
    const entryMessage = await getAiSectionEntryMessage(ctx, lang, section);
    return ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, section));
  }

  if (data.startsWith(callBacks.aiSectionSuggestWithContext)) {
    await ctx.answerCb?.(messages[lang].aiSuggestionContextNotification);
    const section = data.replace(callBacks.aiSectionSuggestWithContext, "").trim();
    if (!section) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    if (topTenItems.length < 3) {
      return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));
    }

    await updateUserState(ctx.userId, `ai_suggest_context_${section}`);
    await deleteCallbackMessageIfPossible(ctx);
    const prompt = await ctx.reply(messages[lang].aiSuggestionContextPrompt, {
      reply_markup: { remove_keyboard: true },
    });
    return editPlaceholder(
      ctx,
      prompt,
      messages[lang].aiSuggestionContextPrompt,
      aiSuggestionContextCancelKeyboard(lang, section),
    );
  }

  if (data.startsWith(callBacks.aiSectionSuggestFromTopTen)) {
    await ctx.answerCb?.(messages[lang].aiSuggestionTopTenNotification);
    const section = data.replace(callBacks.aiSectionSuggestFromTopTen, "").trim();
    if (!section) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    if (topTenItems.length < 3) {
      return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));
    }

    await deleteCallbackMessageIfPossible(ctx);
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

    await deleteCallbackMessageIfPossible(ctx);
    const result = await addAiListItem(
      ctx.userId,
      section,
      "watchlist",
      { title, comment, watched: markDone },
      AI_WATCHLIST_LIMIT,
    );

    if (!result.ok) {
      if (result.reason === "exists") {
        return ctx.reply(getDuplicateListMessage(lang, result), aiSuggestionAddKeyboard(lang, section));
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
    return enterAiSection(ctx, lang, "movies");
  }

  if (data === callBacks.aiSuggestMusic) {
    return enterAiSection(ctx, lang, "music");
  }

  if (data === callBacks.aiSuggestBooks) {
    return enterAiSection(ctx, lang, "books");
  }

  if (data === callBacks.aiSuggestRandom) {
    return enterAiSection(ctx, lang, "random");
  }

  if (data === callBacks.aiBack) {
    await ctx.answerCb?.(messages[lang].mainMenuTitle);
    await updateUserState(ctx.userId, "idle");
    await clearAiSectionPin({ ctx, updateProfileField });
    return editCallbackMessageOrReply(ctx, messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === callBacks.profileEditName) {
    await ctx.answerCb?.();
    return startProfileEdit(ctx, "editing_name", messages[lang].profileAskName, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileToggleDiscoverable) {
    const nextValue = !ctx.user?.profileDiscoverable;
    await ctx.answerCb?.(nextValue ? messages[lang].profileDiscoverableOn : messages[lang].profileDiscoverableOff);
    await deleteCallbackMessageIfPossible(ctx);
    await updateProfileField(ctx.userId, "profileDiscoverable", nextValue);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.profileDiscoverable = nextValue;
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileEditCity) {
    await ctx.answerCb?.();
    return startProfileEdit(ctx, "editing_city", messages[lang].profileAskCity, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileEditAge) {
    await ctx.answerCb?.();
    return startProfileEdit(ctx, "editing_age", messages[lang].profileAskAge, ageKeyboard(lang));
  }

  if (data === callBacks.profileEditGender) {
    await ctx.answerCb?.();
    return startProfileEdit(ctx, "editing_gender", messages[lang].profileAskGender, genderKeyboard(lang));
  }

  if (data === callBacks.profileEditPetPreference) {
    await ctx.answerCb?.();
    return startProfileEdit(ctx, "editing_pet_preference", messages[lang].profileAskPetPreference, petPreferenceKeyboard(lang));
  }

  if (data === callBacks.profileEditBio) {
    await ctx.answerCb?.();
    return startProfileEdit(ctx, "editing_bio", messages[lang].profileAskBio, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileEditLocation) {
    await ctx.answerCb?.();
    return startProfileEdit(ctx, "editing_location", messages[lang].profileAskLocation, locationKeyboard(lang));
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

    await deleteCallbackMessageIfPossible(ctx);
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

    await deleteCallbackMessageIfPossible(ctx);
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

    return editCallbackMessageOrReply(ctx, messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge));
  }

  if (data === callBacks.profileAgeRangeBack) {
    await ctx.answerCb?.();
    return editCallbackMessageOrReply(ctx, messages[lang].profileAskAge, ageKeyboard(lang));
  }

  if (data.startsWith(callBacks.profileAgeSet)) {
    const age = Number(data.replace(callBacks.profileAgeSet, ""));

    await ctx.answerCb?.();

    if (!Number.isInteger(age) || age < 10 || age > 79) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await deleteCallbackMessageIfPossible(ctx);
    await updateProfileField(ctx.userId, "age", age);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.age = age;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileEditPhoto) {
    await ctx.answerCb?.();
    return startProfileEdit(ctx, "editing_photo", messages[lang].profileAskPhoto, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileResetPhoto) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible(ctx);
    await updateProfileField(ctx.userId, "photoFileId", null);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = null;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileCancelEdit) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible(ctx);
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
    await deleteCallbackMessageIfPossible(ctx);
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

async function sendProfile(ctx, lang, user = ctx.user, options = {}) {
  return sendProfileMessage({
    ctx,
    user,
    lang,
    keyboard: profileKeyboard(lang, Boolean(user?.photoFileId), Boolean(user?.profileDiscoverable)),
    messages,
    defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
    loadingText: options.loading ? messages[lang].profileLoading : "",
  });
}

module.exports = { handleCallback };
