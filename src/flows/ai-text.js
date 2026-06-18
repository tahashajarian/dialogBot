const messages = require("../messages");
const {
  aiAssistantKeyboard,
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionContextCancelKeyboard,
  aiListManageMenuKeyboard,
  aiListCancelAddKeyboard,
  aiListCancelCommentKeyboard,
  aiInterestTopTenChipKeyboard,
} = require("../keyboards");
const {
  updateProfileField,
  updateUserState,
  addAiListItem,
  addAiRecentSuggestion,
  consumeAiSuggestionQuota,
  refundAiSuggestionQuota,
  normalizeAiListItem,
  normalizeAiListComment,
  getAiListItemsFromUser,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  setAiListItemComment,
  inferTasteLabel,
  getAiTasteFromUser,
  getTasteProgressStatus,
  syncAiTasteForSection,
} = require("../services/users");
const { getAiSingleSuggestion } = require("../services/ai");
const { startAiPlaceholder } = require("../services/ai-placeholder");
const { setPendingSuggestion } = require("../services/ai-suggestion-cache");
const { replyWithRemovedKeyboardThenInline } = require("../services/bot-navigation");
const {
  getAiSectionFromState,
  getSectionListButtonLabel,
  getSectionLabel,
  getSectionListLabel,
  getTasteLabelTitle,
  getTasteLabelStyleHint,
  clearAiSectionPin,
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
  clearRememberedAiListMessage,
  deleteRememberedAiListMessage,
  rememberAiActionMessage,
  rememberAiListMessage,
} = require("./ai-cards");
const {
  AI_WATCHLIST_LIMIT,
  AI_TOP_TEN_LIMIT,
  AI_RECENT_SUGGESTIONS_LIMIT,
  AI_SUGGESTIONS_PER_HOUR,
  AI_WATCHLIST_PROMPT_LIMIT,
} = require("../constants/ai");
const {
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
} = require("../services/ai-list-ui");

const AI_MANAGE_STATE_PATTERN = /^ai_manage_(movies|music|books|random)_(watchlist|top_ten)(?:_(add_input|comment_input))?$/;
const AI_SUGGEST_CONTEXT_STATE_PATTERN = /^ai_suggest_context_(movies|music|books|random)$/;

function normalizeKeyboardText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\uFE0F/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
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

  return plainText === "back" || plainText === "بازگشت";
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
  ].map(normalizeKeyboardText);
  return labels.includes(normalizedText);
}

function isAiSectionSuggestText(text) {
  const normalizedText = normalizeKeyboardText(text);
  const labels = [
    messages.fa.aiSectionSuggestButton,
    messages.en.aiSectionSuggestButton,
  ].map(normalizeKeyboardText);
  return labels.includes(normalizedText);
}

function parseAiSuggestContextState(state) {
  const matched = String(state || "").match(AI_SUGGEST_CONTEXT_STATE_PATTERN);
  return matched ? matched[1] : "";
}

async function promptSuggestionMode(ctx, lang, section) {
  const previousPromptMessageId = Number(ctx.user?.aiPendingInputMessageId);
  await updateUserState(ctx.userId, `ai_chat_${section}`);
  await clearAiActionMessage(ctx);
  const prompt = await ctx.reply(
    messages[lang].aiSuggestionModePrompt,
    aiSuggestionModeKeyboard(lang, section),
  );
  await rememberAiPendingInputPrompt(ctx, prompt);
  await rememberAiActionMessage(ctx, `suggest_mode:${section}`, prompt);
  const promptMessageId = Number(prompt?.message_id || prompt?.messageId);
  if (
    previousPromptMessageId
    && previousPromptMessageId !== promptMessageId
    && ctx.deleteMessage
  ) {
    await ctx.deleteMessage(previousPromptMessageId);
  }
  return prompt;
}

function getPromptWatchlistItems(watchlistItems = []) {
  return watchlistItems.slice(-AI_WATCHLIST_PROMPT_LIMIT);
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
    } else {
      taste = inferTasteLabel(section, topTenItems);
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
}) {
  const recentSuggestionItems = getAiRecentSuggestionTitlesFromUser(ctx.user, section);
  const blockedSuggestionItems = [
    ...topTenItems,
    ...watchlistItems,
    ...recentSuggestionItems,
  ].map((title) => ({ title }));
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
      aiSectionKeyboardForSection(lang, section),
    );
  }

  let suggestionResult = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const retryInstruction = suggestionResult?.reason === "low_quality_interest"
      ? `The previous result was rejected (${suggestionResult.qualityIssue}). Give a specific, different recommendation with a concrete connection to the saved interests.`
      : "Suggest a different item. The previous one was already known.";
    suggestionResult = await getAiSingleSuggestion({
      mode: section,
      lang,
      userText: attempt === 0
        ? (userText || (section === "random" ? "Suggest one thing for me" : `Suggest one ${section} item`))
        : retryInstruction,
      topTenItems,
      watchlistItems: getPromptWatchlistItems(watchlistItems),
      recentSuggestionItems,
      personalized: true,
      tasteStyleHint,
    });

    if (
      (!suggestionResult.ok || !suggestionResult.title)
      && suggestionResult?.reason === "low_quality_interest"
      && attempt < 2
    ) {
      continue;
    }

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
    return placeholder.finish(
      messages[lang].aiNoResponse || messages[lang].aiTemporaryUnavailable,
      aiSectionKeyboardForSection(lang, section),
    );
  }

  await addAiRecentSuggestion(ctx.userId, section, suggestionResult.title, AI_RECENT_SUGGESTIONS_LIMIT);
  setPendingSuggestion(ctx.userId, section, suggestionResult.title, suggestionResult.reason || "");
  const resultMessage = await placeholder.finish(
    formatSuggestionResultMessage(lang, suggestionResult.title, suggestionResult.reason),
    aiSuggestionAddKeyboard(lang, section),
  );
  await rememberAiActionMessage(ctx, `suggest_result:${section}`, resultMessage);
  return resultMessage;
}

async function openAiListManager(ctx, lang, section, listType) {
  const listLabel = getSectionListLabel(messages, lang, section);
  const nextState = `ai_manage_${section}_${listType === "topTen" ? "top_ten" : "watchlist"}`;
  await clearAiPendingInputPrompt(ctx);
  await updateUserState(ctx.userId, nextState);
  const listMessage = listType === "topTen"
    ? await ctx.reply(buildTopTenListMessage({ ctx, lang, section }))
    : await ctx.reply(buildWatchlistMessage({ ctx, lang, section }));
  await rememberAiListMessage(ctx, section, listType, listMessage);
  const actionMessage = await ctx.reply(
    listType === "topTen"
      ? await getTopTenManageEntryMessage(ctx, lang, section)
      : messages[lang].aiListManageInlineEntry.replace("{listName}", listLabel),
    aiListManageMenuKeyboard(lang, section, listType),
  );
  await rememberAiActionMessage(ctx, `manage:${section}:${listType}`, actionMessage);
  return actionMessage;
}

async function handleAiText(ctx, lang, text, state) {
  const manageState = parseAiManageState(state);
  if (manageState) {
    if (isAiBackText(text)) {
      await clearAiPendingInputPrompt(ctx);
      await clearAiActionMessage(ctx);
      await updateUserState(ctx.userId, "idle");
      await clearRememberedAiListMessage(ctx);
      await clearAiSectionPin({ ctx, updateProfileField });
      return replyWithRemovedKeyboardThenInline(ctx, messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const section = manageState.section;
    const sectionLabel = getSectionLabel(messages, lang, section);
    const listLabel = getSectionListLabel(messages, lang, section);
    const isWatchlist = manageState.isWatchlist;
    const listType = manageState.listType;
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

      await deleteRememberedAiListMessage(ctx, section, listType);
      await clearAiPendingInputPrompt(ctx);

      const result = await addAiListItem(
        ctx.userId,
        section,
        listType,
        { title: item, comment },
        isWatchlist ? AI_WATCHLIST_LIMIT : AI_TOP_TEN_LIMIT,
      );

      if (!result.ok) {
        if (result.reason === "exists") {
          if (!isWatchlist) {
            return ctx.reply(
              getDuplicateTopTenMessage(lang, result, currentItems.length),
              aiListManageMenuKeyboard(lang, section, listType),
            );
          }
          return ctx.reply(getDuplicateListMessage(lang, result), aiListManageMenuKeyboard(lang, section, listType));
        }
        if (result.reason === "limit") {
          return ctx.reply(
            isWatchlist ? messages[lang].aiWatchlistLimitReached : messages[lang].aiTopTenLimitReached,
            aiListManageMenuKeyboard(lang, section, listType),
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
          () => ctx.reply(messages[lang].aiListInvalidInput, aiListCancelAddKeyboard(lang, section, listType)),
        );
      }

      rememberCtxAiListItems(ctx, section, listType, result.items);
      const listIsFull = result.items.length >= (isWatchlist ? AI_WATCHLIST_LIMIT : AI_TOP_TEN_LIMIT);
      const nextState = listIsFull
        ? getAiManageState(section, listType)
        : getAiManageState(section, listType, "add_input");
      await updateUserState(ctx.userId, nextState);
      if (ctx.user) ctx.user.state = nextState;

      if (!isWatchlist) {
        const placeholder = await startAiPlaceholder(ctx, [
          messages[lang].aiThinking,
          messages[lang].aiThinkingStill,
          messages[lang].aiThinkingAlmost,
        ]);
        const savedMessage = await buildTopTenSavedMessage({
          ctx,
          lang,
          section,
          item,
          items: result.items,
        });
        const saved = await placeholder.finish(
          savedMessage,
          listIsFull
            ? aiListManageMenuKeyboard(lang, section, listType)
            : getContinuousAddKeyboard(lang, section, listType, result.items),
        );
        if (!listIsFull) await rememberAiPendingInputPrompt(ctx, saved);
        return saved;
      }

      const saved = await ctx.reply(
        `${messages[lang].aiListSaved}\n${formatAiItemsList(title, result.items, emptyText, {
          topTenTitleSet: toTitleSet(topTenItems),
          includeWatched: true,
        })}${listIsFull ? "" : `\n\n${messages[lang].aiListManageAddNextPrompt}`}`,
        listIsFull
          ? aiListManageMenuKeyboard(lang, section, listType)
          : getContinuousAddKeyboard(lang, section, listType, result.items),
      );
      if (!listIsFull) await rememberAiPendingInputPrompt(ctx, saved);
      return saved;
    }

    if (manageState.commentInputMode) {
      const pendingItem = normalizeAiListItem(ctx.user?.aiSectionPendingCommentItem);
      const pendingListType = ctx.user?.aiSectionPendingCommentListType === "topTen" ? "topTen" : "watchlist";
      if (!pendingItem) {
        await clearAiPendingInputPrompt(ctx);
        await updateUserState(ctx.userId, `ai_manage_${section}_${pendingListType === "topTen" ? "top_ten" : "watchlist"}`);
        await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", null);
        return ctx.reply(
          pendingListType === "topTen" ? messages[lang].aiTopTenCommentCanceled : messages[lang].aiWatchlistCommentCanceled,
          aiListManageMenuKeyboard(lang, section, pendingListType),
        );
      }

      if (text.startsWith("/")) {
        await clearAiPendingInputPrompt(ctx);
        const prompt = await ctx.reply(
          pendingListType === "topTen" ? messages[lang].aiTopTenCommentAskText : messages[lang].aiWatchlistCommentAskText,
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
      if (pendingListType === "topTen") {
        await syncAiTasteForSection(ctx.userId, section);
        return ctx.reply(
          `${messages[lang].aiTopTenCommentSaved}\n${formatAiItemsList(title, updated.items, emptyText)}`,
          aiListManageMenuKeyboard(lang, section, pendingListType),
        );
      }
      return ctx.reply(
        messages[lang].aiWatchlistCommentSaved,
        aiListManageMenuKeyboard(lang, section, pendingListType),
      );
    }

    await clearAiActionMessage(ctx);
    const manageDescription = listType === "topTen"
      ? await getTopTenManageEntryMessage(ctx, lang, section, currentItems)
      : messages[lang].aiListManageInlineEntry.replace("{listName}", listLabel);
    const actionMessage = await ctx.reply(
      `${manageDescription}\n\n${messages[lang].aiListManageUseButtonsTip}`,
      aiListManageMenuKeyboard(lang, section, listType),
    );
    await rememberAiActionMessage(ctx, `manage:${section}:${listType}`, actionMessage);
    return actionMessage;
  }

  const suggestContextSection = parseAiSuggestContextState(state);
  if (suggestContextSection) {
    if (isAiBackText(text)) {
      await clearAiPendingInputPrompt(ctx);
      await updateUserState(ctx.userId, `ai_chat_${suggestContextSection}`);
      return ctx.reply(messages[lang].aiSectionUseButtonsOnly, aiSectionKeyboardForSection(lang, suggestContextSection));
    }

    const userText = String(text || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!userText || text.startsWith("/")) {
      await clearAiPendingInputPrompt(ctx);
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
    if (isAiBackText(text)) {
      await clearAiPendingInputPrompt(ctx);
      await clearAiActionMessage(ctx);
      await updateUserState(ctx.userId, "idle");
      await clearRememberedAiListMessage(ctx);
      await clearAiSectionPin({ ctx, updateProfileField });
      return replyWithRemovedKeyboardThenInline(ctx, messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    if (isAiSectionListText(text, section)) {
      return openAiListManager(ctx, lang, section, "watchlist");
    }

    if (isAiSectionTopTenText(text)) {
      return openAiListManager(ctx, lang, section, "topTen");
    }

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");

    if (isAiSectionSuggestText(text)) {
      if (topTenItems.length < 3) {
        return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));
      }

      return promptSuggestionMode(ctx, lang, section);
    }

    const actionContext = String(ctx.user?.aiActionContext || "");
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
  isAiBackText,
  isAiSectionListText,
  isAiSectionSuggestText,
  isAiSectionTopTenText,
  isAiTextState,
};
