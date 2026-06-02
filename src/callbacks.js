const messages = require("./messages");
const path = require("path");
const { setLanguage, detectLanguage, normalizeLang } = require("./lang");
const { getAiSingleSuggestion, getAiTasteItemFeedback } = require("./services/ai");
const { startAiPlaceholder, editPlaceholder } = require("./services/ai-placeholder");
const {
  inlineKeyboard,
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
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionRoomKeyboard,
  discussionRemoveMembersKeyboard,
  profileViewBackKeyboard,
  savedProfilesListKeyboard,
} = require("./keyboards");
const { callBacks } = require("./constants");
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
const {
  getDiscussionErrorMessage,
  decorateDiscussionsForList,
  paginateDiscussions,
  buildDiscussionListText,
} = require("./services/discussion-ui");
const {
  isCodeSaved,
  buildSavedProfileListItems,
  paginateSavedProfiles,
  buildSavedProfilesListText,
  buildProfileSavedFooter,
} = require("./services/saved-profiles-ui");
const {
  formatDiscussionRoom,
  formatRecentDiscussionMessages,
  formatDiscussionMemberLines,
} = require("./services/discussion-room-ui");
const User = require("./models/user");
const {
  listActiveDiscussions,
  listMyDiscussions,
  joinOrSwitchActiveDiscussion,
  ensurePublicProfileCode,
  addSavedProfileCode,
  removeSavedProfileCode,
  normalizePublicProfileCode,
} = require("./services/discussions");
const {
  closeDiscussionAndNotify,
  joinDiscussionAndNotify,
  leaveDiscussionAndNotify,
  removeDiscussionMemberAndNotify,
} = require("./services/discussion-actions");
const {
  clearRememberedDiscussionRoomCards,
  rememberDiscussionRoomCards,
  rememberDiscussionListMessage,
  clearDiscussionListMessage,
  clearDiscussionMenuNotice,
  rememberDiscussionMenuNotice,
  shouldKeepDiscussionRoomCardsForCallback,
  isDiscussionCreateFlowCallback,
  isDiscussionCreateState,
} = require("./flows/discussions-callbacks");
const {
  isDiscussionCreateCallback,
  handleDiscussionCreateCallback,
} = require("./flows/discussions-create-callbacks");
const {
  joinDiscussionFromInvite,
} = require("./flows/discussions-text");
const {
  rememberAiPendingInputPrompt,
  clearAiPendingInputPrompt,
} = require("./flows/ai-input-prompts");

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

async function replaceRememberedAiListMessage(ctx, section, listType, message) {
  const currentMessageId = ctx.user?.aiLastListMessageId;
  const currentSection = ctx.user?.aiLastListSection;
  const currentListType = ctx.user?.aiLastListType;
  const nextMessageId = getMessageId(message);

  if (
    currentMessageId &&
    ctx.deleteMessage &&
    (currentSection !== section || currentListType !== listType) &&
    Number(currentMessageId) !== Number(nextMessageId)
  ) {
    await ctx.deleteMessage(currentMessageId);
  }

  await rememberAiListMessage(ctx, section, listType, message);
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

async function clearRememberedAiListMessage(ctx) {
  const messageId = ctx.user?.aiLastListMessageId;
  if (!messageId || !ctx.deleteMessage) {
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

async function rememberAiSectionEntryMessage(ctx, message) {
  const messageId = getMessageId(message);
  await updateProfileField(ctx.userId, "aiSectionEntryMessageId", messageId || null);
}

async function clearAiSectionEntryMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.aiSectionEntryMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "aiSectionEntryMessageId", null);
  }
  return deleted;
}

async function rememberSavedProfilesListMessage(ctx, messageOrId) {
  const messageId = Number(getMessageId(messageOrId) || messageOrId);
  if (!Number.isInteger(messageId) || messageId <= 0) return;
  if (!ctx.user || typeof ctx.user.toObject !== "function") return;
  await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", messageId);
}

async function clearSavedProfilesListMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.savedProfilesLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || !ctx.deleteMessage) return false;
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
  }
  return deleted;
}

async function forgetSavedProfilesListMessage(ctx) {
  if (!ctx.user || typeof ctx.user.toObject !== "function") return;
  if (ctx.user?.savedProfilesLastListMessageId) {
    await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
  }
}

async function removeBottomKeyboard(ctx, text) {
  const sent = await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
  const messageId = getMessageId(sent);
  if (messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }
}

async function sendSavedProfilesList(ctx, lang, codes = [], page = 0) {
  const items = await buildSavedProfileListItems({
    codes,
    normalizePublicProfileCode,
    findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
      .select("publicProfileCode profileName firstName")
      .lean(),
  });
  const paged = paginateSavedProfiles(items, page);
  const sent = await ctx.reply(
    buildSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex }),
    savedProfilesListKeyboard(lang, {
      page: paged.page,
      totalPages: paged.totalPages,
    }),
  );
  await rememberSavedProfilesListMessage(ctx, sent);
  return sent;
}

function shouldKeepAiListTitleForCallback(data = "") {
  return (
    data.startsWith(callBacks.aiAssistant) ||
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
    data.startsWith(callBacks.aiInterestTopTenChip)
  );
}

function discussionCloseConfirmKeyboard(lang, discussionId) {
  return inlineKeyboard([
    [{ text: messages[lang].discussionCloseConfirmYes, callback_data: `${callBacks.discussionCloseConfirm}${discussionId}` }],
    [{ text: messages[lang].discussionCloseConfirmNo, callback_data: `${callBacks.discussionCloseCancel}${discussionId}` }],
  ]);
}

async function renderActiveDiscussionList(ctx, lang, page = 0, joinableOnly = false) {
  const result = await listActiveDiscussions({ limit: 100 });
  if (!result.discussions.length) {
    await ctx.answerCb?.(messages[lang].discussionListEmpty.replace(/^🤖\s*/, ""));
    return editCallbackMessageOrReply(ctx, messages[lang].discussionListEmpty, discussionsMenuKeyboard(lang));
  }
  await ctx.answerCb?.();
  const decorated = await decorateDiscussionsForList(ctx.user, result.discussions);
  const filtered = joinableOnly ? decorated.filter((entry) => entry.isJoinable) : decorated;
  if (!filtered.length) {
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionListJoinableEmpty,
      discussionListNavigationKeyboard(lang, {
        listType: "active",
        page: 0,
        totalPages: 1,
        joinableOnly,
      }),
    );
    await rememberDiscussionListMessage(ctx, "active", ctx.callbackMessageId || listMessage);
    return listMessage;
  }
  const paged = paginateDiscussions(filtered, page);
  const listMessage = await editCallbackMessageOrReply(
    ctx,
    buildDiscussionListText(messages, lang, messages[lang].discussionActiveList, paged.items, {
      startIndex: paged.startIndex,
    }),
    discussionListNavigationKeyboard(lang, {
      listType: "active",
      page: paged.page,
      totalPages: paged.totalPages,
      joinableOnly,
    }),
  );
  await rememberDiscussionListMessage(ctx, "active", ctx.callbackMessageId || listMessage);
  return listMessage;
}

async function renderMyDiscussionList(ctx, lang, page = 0) {
  const result = await listMyDiscussions(ctx.userId, { limit: 100 });
  if (!result.ok) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
  }
  if (!result.discussions.length) {
    await ctx.answerCb?.(messages[lang].discussionListMineEmpty.replace(/^🤖\s*/, ""));
    return editCallbackMessageOrReply(ctx, messages[lang].discussionListMineEmpty, discussionsMenuKeyboard(lang));
  }
  await ctx.answerCb?.();
  const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, true);
  const paged = paginateDiscussions(decorated, page);
  const listMessage = await editCallbackMessageOrReply(
    ctx,
    buildDiscussionListText(messages, lang, messages[lang].discussionMyList, paged.items, {
      startIndex: paged.startIndex,
    }),
    discussionListNavigationKeyboard(lang, {
      listType: "mine",
      page: paged.page,
      totalPages: paged.totalPages,
    }),
  );
  await rememberDiscussionListMessage(ctx, "mine", ctx.callbackMessageId || listMessage);
  return listMessage;
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

function withAiSectionTitle(lang, section, body) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const heading = messages[lang].aiSectionPinnedTitle.replace("{section}", sectionLabel);
  return `${heading}\n\n${body}`;
}

function buildTopTenListMessage(ctx, lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const title = messages[lang].aiTopTenTitle.replace("{section}", sectionLabel);
  const emptyText = messages[lang].aiTopTenEmpty.replace("{section}", sectionLabel);
  const items = getAiListItemsFromUser(ctx.user, section, "topTen");
  return withAiSectionTitle(lang, section, formatTopTenItemsList(title, items, emptyText));
}

function buildWatchlistMessage(ctx, lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const listLabel = getSectionListLabel(messages, lang, section);
  const title = messages[lang].aiWatchlistTitle
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);
  const emptyText = messages[lang].aiWatchlistEmpty
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);
  const items = getAiListItemsFromUser(ctx.user, section, "watchlist");
  const content = formatListWithWatched({
    title,
    items,
    emptyText,
    topTenTitleSet: toTitleSet(getAiListItemsFromUser(ctx.user, section, "topTen")),
  });
  return withAiSectionTitle(lang, section, content);
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
  const title = messages[lang].aiSectionPinnedTitle.replace("{section}", sectionLabel);
  const body = messages[lang].aiSectionEntryGuidance.replace("{section}", sectionLabel);
  return `${title}\n\n${body}`;
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
  await clearRememberedAiListMessage(ctx);
  await clearAiSectionEntryMessage(ctx, [ctx.callbackMessageId]);
  await updateProfileField(ctx.userId, "aiSectionPinnedMessageId", null);
  await updateProfileField(ctx.userId, "aiSectionPinnedSection", null);
  await deleteCallbackMessageIfPossible(ctx);
  const entryMessage = await getAiSectionEntryMessage(ctx, lang, section);
  const sent = await ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, section));
  await rememberAiSectionEntryMessage(ctx, sent);
  return sent;
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

async function removeCallbackInlineKeyboardIfPossible(ctx) {
  if (!ctx.callbackMessageId || !ctx.editMessageReplyMarkup) {
    return false;
  }
  return ctx.editMessageReplyMarkup(ctx.callbackMessageId, { inline_keyboard: [] });
}

function isProfileCallbackMessage(ctx) {
  const message = ctx.callbackMessage || {};
  return Boolean(message.caption || message.photo || message.document);
}

async function startProfileEdit(ctx, state, prompt, keyboard) {
  await deleteCallbackMessageIfPossible(ctx);
  await updateUserState(ctx.userId, state);
  return ctx.reply(prompt, keyboard);
}

async function sendDiscussionRoom(ctx, lang, discussion) {
  await clearRememberedDiscussionRoomCards(ctx, [ctx.callbackMessageId]);
  await deleteCallbackMessageIfPossible(ctx);
  const headerMessage = await ctx.reply(formatDiscussionRoom(messages, lang, discussion));
  const recentMessage = await ctx.reply(
    `${formatRecentDiscussionMessages(messages, lang, discussion)}\n\n${messages[lang].discussionRoomSendHint}`,
    discussionRoomKeyboard(lang, discussion.creatorUserId === ctx.userId),
  );
  await rememberDiscussionRoomCards(ctx, headerMessage, recentMessage);
  return recentMessage;
}

async function notifyDiscussionUsers(ctx, userIds = [], text) {
  const targets = [...new Set((userIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  await Promise.all(targets.map((userId) => ctx.sendToUser?.(userId, text)));
}

function formatDiscussionLeftMessage(lang, discussionTitle = "") {
  return messages[lang].discussionLeft.replace("{title}", discussionTitle || "-");
}

async function sendPublicProfileByCode(ctx, lang, rawCode, { fromSavedList = false } = {}) {
  const code = normalizePublicProfileCode(rawCode);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);

  const target = await User.findOne({ publicProfileCode: code });
  if (!target) return ctx.reply(messages[lang].profileCodeNotFound);

  const current = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
  const saved = isCodeSaved(current, code);
  if (!target.profileDiscoverable) {
    return ctx.reply(
      messages[lang].profilePrivateShort,
      fromSavedList ? profileViewBackKeyboard(lang) : undefined,
    );
  }

  return sendProfileMessage({
    ctx,
    user: target,
    lang,
    keyboard: fromSavedList ? profileViewBackKeyboard(lang) : undefined,
    messages,
    defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
    isOwnProfile: false,
    footerText: buildProfileSavedFooter(messages, lang, code, saved),
  });
}

async function handleCallback(ctx) {
  const data = ctx.callbackData || "";
  const lang = detectLanguage(ctx);

  if (!data) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
  }

  if (!shouldKeepAiListTitleForCallback(data)) {
    await clearRememberedAiListMessage(ctx);
  }
  if (!shouldKeepAiListTitleForCallback(data)) {
    await clearAiSectionEntryMessage(ctx, [ctx.callbackMessageId]);
  }
  if (!shouldKeepDiscussionRoomCardsForCallback(data)) {
    await clearRememberedDiscussionRoomCards(ctx, [ctx.callbackMessageId]);
  }
  if (!shouldKeepDiscussionRoomCardsForCallback(data)) {
    await clearDiscussionMenuNotice(ctx, [ctx.callbackMessageId]);
  }

  // menu routes
  if (data === callBacks.menuMain) {
    await ctx.answerCb?.();
    await updateProfileField(ctx.userId, "activeDiscussionId", null);
    await forgetSavedProfilesListMessage(ctx);
    return editCallbackMessageOrReply(ctx, messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === callBacks.language) {
    await ctx.answerCb?.();
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    return editCallbackMessageOrReply(ctx, messages[lang].chooseLanguage, languageKeyboard());
  }

  if (data === callBacks.profile) {
    await ctx.answerCb?.();
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    await deleteCallbackMessageIfPossible(ctx);
    return sendProfile(ctx, lang, ctx.user || {}, { loading: true });
  }

  if (data === callBacks.aiAssistant) {
    await ctx.answerCb?.(messages[lang].aiAssistant);
    await forgetSavedProfilesListMessage(ctx);
    return editCallbackMessageOrReply(
      ctx,
      `${messages[lang].aiAssistant}\n\n${messages[lang].aiAssistantMenu}`,
      aiAssistantKeyboard(lang),
    );
  }

  if (data === callBacks.discussions) {
    await ctx.answerCb?.();
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionsMenu,
      discussionsMenuKeyboard(lang),
    );
  }

  if (isDiscussionCreateFlowCallback(data) && !isDiscussionCreateState(ctx.user?.state || "")) {
    await ctx.answerCb?.(messages[lang].unknownAction.replace(/^🤖\s*/, ""));
    return deleteCallbackMessageIfPossible(ctx);
  }

  if (data === callBacks.savedProfiles) {
    await ctx.answerCb?.();
    await clearRememberedAiListMessage(ctx);
    if (isProfileCallbackMessage(ctx)) {
      await removeCallbackInlineKeyboardIfPossible(ctx);
    } else {
      await deleteCallbackMessageIfPossible(ctx);
      await removeBottomKeyboard(ctx, messages[lang].savedProfilesTitle);
    }
    await forgetSavedProfilesListMessage(ctx);
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    return sendSavedProfilesList(ctx, lang, codes, 0);
  }

  if (data.startsWith(callBacks.savedProfilesPage)) {
    await ctx.answerCb?.();
    const pageRaw = data.replace(callBacks.savedProfilesPage, "");
    const page = Number(pageRaw);
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const items = await buildSavedProfileListItems({
      codes,
      normalizePublicProfileCode,
      findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
        .select("publicProfileCode profileName firstName")
        .lean(),
    });
    const paged = paginateSavedProfiles(items, page);
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      buildSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex }),
      savedProfilesListKeyboard(lang, {
        page: paged.page,
        totalPages: paged.totalPages,
      }),
    );
    await rememberSavedProfilesListMessage(ctx, ctx.callbackMessageId || listMessage);
    return listMessage;
  }

  if (data.startsWith(callBacks.savedProfilesOpen)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesOpen, "");
    await deleteCallbackMessageIfPossible(ctx);
    await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList: true });
  }

  if (data.startsWith(callBacks.savedProfilesRemove)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesRemove, "");
    const removed = await removeSavedProfileCode(ctx.userId, code);
    if (!removed.ok) {
      return ctx.reply(removed.reason === "not_found" ? messages[lang].savedProfilesEmpty : messages[lang].unknownAction);
    }
    await updateProfileField(ctx.userId, "savedProfileCodes", removed.items || []);
    const items = await buildSavedProfileListItems({
      codes: removed.items || [],
      normalizePublicProfileCode,
      findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
        .select("publicProfileCode profileName firstName")
        .lean(),
    });
    const paged = paginateSavedProfiles(items, 0);
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      paged.items.length
        ? `${messages[lang].savedProfileRemoved}\n\n${buildSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex })}`
        : messages[lang].savedProfileRemoved,
      savedProfilesListKeyboard(lang, {
        page: paged.page,
        totalPages: paged.totalPages,
      }),
    );
    await rememberSavedProfilesListMessage(ctx, ctx.callbackMessageId || listMessage);
    return listMessage;
  }

  if (data === callBacks.discussionListActive) {
    return renderActiveDiscussionList(ctx, lang, 0, false);
  }

  if (data.startsWith(callBacks.discussionListActivePage)) {
    const payload = data.replace(callBacks.discussionListActivePage, "");
    const [pageRaw = "0", filter = "all"] = payload.split(":");
    return renderActiveDiscussionList(ctx, lang, Number(pageRaw), filter === "joinable");
  }

  if (data === callBacks.discussionListMine) {
    return renderMyDiscussionList(ctx, lang, 0);
  }

  if (data.startsWith(callBacks.discussionListMinePage)) {
    const pageRaw = data.replace(callBacks.discussionListMinePage, "");
    return renderMyDiscussionList(ctx, lang, Number(pageRaw));
  }

  if (isDiscussionCreateCallback(data)) {
    return handleDiscussionCreateCallback(ctx, lang, {
      editCallbackMessageOrReply,
      deleteCallbackMessageIfPossible,
      clearDiscussionMenuNotice,
      rememberDiscussionMenuNotice,
      sendDiscussionRoom,
    });
  }

  if (data.startsWith(callBacks.discussionOpen)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionOpen, "");
    const joined = await joinDiscussionAndNotify({
      ctx,
      messages,
      discussionId,
    });
    if (!joined.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, joined.reason);
      await ctx.answerCb?.(errorText.replace(/^🤖\s*/, ""));
      const errorNotice = await ctx.reply(errorText);
      await rememberDiscussionMenuNotice(ctx, errorNotice);
      return errorNotice;
    }
    await clearDiscussionListMessage(ctx, [ctx.callbackMessageId]);
    await clearDiscussionMenuNotice(ctx);
    await ctx.reply(joined.joined ? messages[lang].discussionJoined : messages[lang].discussionSwitched);
    return sendDiscussionRoom(ctx, lang, joined.discussion);
  }

  if (data.startsWith(callBacks.discussionInviteJoin)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.discussionInviteJoin, "");
    return joinDiscussionFromInvite(ctx, lang, code, {
      editMessage: (text, keyboard) => editCallbackMessageOrReply(ctx, text, keyboard),
      clearListMessage: () => clearDiscussionListMessage(ctx, [ctx.callbackMessageId]),
      clearMenuNotice: () => clearDiscussionMenuNotice(ctx, [ctx.callbackMessageId]),
      sendRoom: (roomCtx, roomLang, discussion) => sendDiscussionRoom(roomCtx, roomLang, discussion),
    });
  }

  if (data === callBacks.discussionLeave || data.startsWith(callBacks.discussionLeave)) {
    await ctx.answerCb?.();
    const explicitId = data.startsWith(callBacks.discussionLeave)
      ? data.replace(callBacks.discussionLeave, "")
      : "";
    const discussionId = explicitId || String(ctx.user?.activeDiscussionId || "");
    if (!discussionId) {
      return ctx.reply(messages[lang].discussionNotMember);
    }
    const left = await leaveDiscussionAndNotify({
      ctx,
      messages,
      discussionId,
    });
    if (!left.ok) {
      if (left.reason === "owner_cannot_leave_open") return ctx.reply(messages[lang].discussionOwnerCannotLeave);
      return ctx.reply(messages[lang].discussionNotMember);
    }
    await clearDiscussionListMessage(ctx, [ctx.callbackMessageId]);
    const discussionTitle = left?.discussionTitle || "";
    return editCallbackMessageOrReply(
      ctx,
      `${formatDiscussionLeftMessage(lang, discussionTitle)}\n\n${messages[lang].discussionsMenu}`,
      discussionsMenuKeyboard(lang),
    );
  }

  if (
    data.startsWith(callBacks.discussionClose) &&
    !data.startsWith(callBacks.discussionCloseConfirm) &&
    !data.startsWith(callBacks.discussionCloseCancel)
  ) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionClose, "");
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionCloseConfirmPrompt,
      discussionCloseConfirmKeyboard(lang, discussionId),
    );
  }

  if (data.startsWith(callBacks.discussionCloseConfirm)) {
    await ctx.answerCb?.();
    await clearDiscussionMenuNotice(ctx);
    await clearRememberedDiscussionRoomCards(ctx);
    await clearDiscussionListMessage(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible(ctx);
    const discussionId = data.replace(callBacks.discussionCloseConfirm, "");
    
    const closed = await closeDiscussionAndNotify({
      ctx,
      messages,
      discussionId,
      discussionsMenuKeyboard,
    });
    if (!closed.ok) {
      return ctx.reply(getDiscussionErrorMessage(messages, lang, closed.reason));
    }

    return editCallbackMessageOrReply(
      ctx,
      `${messages[lang].discussionClosed}\n\n${messages[lang].discussionsMenu}`,
      discussionsMenuKeyboard(lang),
    );
  }

  if (data.startsWith(callBacks.discussionCloseCancel)) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible(ctx);
    const discussionId = data.replace(callBacks.discussionCloseCancel, "");
    const opened = await joinOrSwitchActiveDiscussion(ctx.userId, discussionId);
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^🤖\s*/, ""));
      return ctx.reply(errorText);
    }
    return sendDiscussionRoom(ctx, lang, opened.discussion);
  }

  if (data.startsWith(callBacks.discussionMembers)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionMembers, "");
    const opened = await joinOrSwitchActiveDiscussion(ctx.userId, discussionId);
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^🤖\s*/, ""));
      return ctx.reply(errorText);
    }
    const memberUsers = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName publicProfileCode activeDiscussionId")
      .lean();
    await Promise.all(memberUsers.map((entry) => ensurePublicProfileCode(entry.userId)));
    const refreshed = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName publicProfileCode activeDiscussionId")
      .lean();
    const rows = formatDiscussionMemberLines(messages, lang, refreshed, opened.discussion.creatorUserId, ctx.userId, opened.discussion._id);
    return editCallbackMessageOrReply(
      ctx,
      `${messages[lang].discussionMembersTitle}\n\n${rows.join("\n")}`,
      { reply_markup: { inline_keyboard: [] } },
    );
  }

  if (data.startsWith(callBacks.discussionRemoveMemberPicker)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionRemoveMemberPicker, "");
    const opened = await joinOrSwitchActiveDiscussion(ctx.userId, discussionId);
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^🤖\s*/, ""));
      return ctx.reply(errorText);
    }
    if (opened.discussion.creatorUserId !== ctx.userId) {
      const errorText = getDiscussionErrorMessage(messages, lang, "not_owner");
      await ctx.answerCb?.(errorText.replace(/^🤖\s*/, ""));
      return ctx.reply(errorText);
    }
    const memberUsers = await User.find({
      userId: {
        $in: opened.discussion.memberUserIds.filter((id) => id !== ctx.userId),
      },
    }).select("userId profileName firstName publicProfileCode").lean();
    await Promise.all(memberUsers.map((entry) => ensurePublicProfileCode(entry.userId)));
    const refreshed = await User.find({
      userId: {
        $in: opened.discussion.memberUserIds.filter((id) => id !== ctx.userId),
      },
    }).select("userId profileName firstName publicProfileCode").lean();
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionRemoveMember,
      discussionRemoveMembersKeyboard(lang, String(opened.discussion._id), refreshed),
    );
  }

  if (data.startsWith(callBacks.discussionRemoveMember)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.discussionRemoveMember, "");
    const [discussionId = "", memberCodeRaw = ""] = payload.split(":");
    const memberCode = normalizePublicProfileCode(memberCodeRaw);
    const member = memberCode
      ? await User.findOne({ publicProfileCode: memberCode }).select("userId").lean()
      : null;
    const memberUserId = Number(member?.userId);
    if (!discussionId || !Number.isInteger(memberUserId)) return ctx.reply(getDiscussionErrorMessage(messages, lang, "not_member"));
    const removed = await removeDiscussionMemberAndNotify({
      ctx,
      messages,
      discussionId,
      memberUserId,
      discussionsMenuKeyboard,
    });
    if (!removed.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, removed.reason));
    await deleteCallbackMessageIfPossible(ctx);

    return ctx.reply(messages[lang].discussionMemberRemoved.replace("{name}", removed.removedMemberName || "عضو"));
  }

  if (data.startsWith(callBacks.profileViewByCode)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.profileViewByCode, "");
    await deleteCallbackMessageIfPossible(ctx);
    return sendPublicProfileByCode(ctx, lang, code);
  }

  if (data.startsWith(callBacks.profileSaveByCode)) {
    const code = data.replace(callBacks.profileSaveByCode, "");
    await deleteCallbackMessageIfPossible(ctx);
    const saved = await addSavedProfileCode(ctx.userId, code);
    if (!saved.ok) {
      await ctx.answerCb?.();
      if (saved.reason === "exists") return ctx.reply(messages[lang].savedProfileAlreadySaved);
      if (saved.reason === "saved_profiles_limit") return ctx.reply(messages[lang].savedProfilesLimit);
      return ctx.reply(messages[lang].unknownAction);
    }
    await updateProfileField(ctx.userId, "savedProfileCodes", saved.items || []);
    await ctx.answerCb?.(messages[lang].savedProfileSaved);
    return ctx.reply(messages[lang].savedProfileSaved);
  }

  if (data.startsWith(callBacks.profileUnsaveByCode)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.profileUnsaveByCode, "");
    await deleteCallbackMessageIfPossible(ctx);
    const removed = await removeSavedProfileCode(ctx.userId, code);
    if (!removed.ok) return ctx.reply(messages[lang].unknownAction);
    await updateProfileField(ctx.userId, "savedProfileCodes", removed.items || []);
    await ctx.reply(messages[lang].savedProfileRemoved);
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList: true });
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

    const listText = listType === "topTen"
      ? buildTopTenListMessage(ctx, lang, section)
      : buildWatchlistMessage(ctx, lang, section);
    const listMessage = await ctx.reply(listText);
    await replaceRememberedAiListMessage(ctx, section, listType, listMessage);

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
    const titledListText = withAiSectionTitle(lang, section, listText);

    const listMessage = await ctx.reply(titledListText, aiListManageMenuKeyboard(lang, section, listType));
    await replaceRememberedAiListMessage(ctx, section, listType, listMessage);
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
    if (!section || !listType) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const expectedState = `ai_manage_${section}_${toAiManageStateListType(listType)}_comment_input`;
    if (ctx.user?.state !== expectedState) {
      await clearAiPendingInputPrompt(ctx);
      return deleteCallbackMessageIfPossible(ctx);
    }

    await updateProfileField(ctx.userId, "aiSectionPendingCommentItem", null);
    await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", null);
    await clearAiPendingInputPrompt(ctx);
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

    const expectedState = `ai_manage_${section}_${toAiManageStateListType(listType)}_add_input`;
    if (ctx.user?.state !== expectedState) {
      await clearAiPendingInputPrompt(ctx);
      return deleteCallbackMessageIfPossible(ctx);
    }

    await clearAiPendingInputPrompt(ctx);
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
    if (!item) {
      return ctx.reply(messages[lang].unknownAction);
    }
    if (ctx.user?.state !== "ai_manage_random_top_ten_add_input") {
      await clearAiPendingInputPrompt(ctx);
      return deleteCallbackMessageIfPossible(ctx);
    }

    await deleteCallbackMessageIfPossible(ctx);
    await clearAiPendingInputPrompt(ctx);

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
    if (ctx.user?.state !== `ai_suggest_context_${section}`) {
      await ctx.answerCb?.();
      await clearAiPendingInputPrompt(ctx);
      return deleteCallbackMessageIfPossible(ctx);
    }

    await ctx.answerCb?.(
      messages[lang].aiSectionOpeningNotification
        .replace("{section}", getAiSectionNotificationTitle(lang, section)),
    );
    await updateUserState(ctx.userId, `ai_chat_${section}`);
    await clearRememberedAiListMessage(ctx);
    await clearAiSectionEntryMessage(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible(ctx);
    const entryMessage = await getAiSectionEntryMessage(ctx, lang, section);
    const sent = await ctx.reply(entryMessage, aiSectionKeyboardForSection(lang, section));
    await rememberAiSectionEntryMessage(ctx, sent);
    return sent;
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
    await clearAiPendingInputPrompt(ctx);
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
    await updateProfileField(ctx.userId, "activeDiscussionId", null);
    await clearAiPendingInputPrompt(ctx);
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

  if (data === callBacks.profileToggleActiveDiscussionVisible) {
    const nextValue = !ctx.user?.showActiveDiscussionOnProfile;
    await ctx.answerCb?.(
      nextValue
        ? messages[lang].profileActiveDiscussionVisibleOn
        : messages[lang].profileActiveDiscussionVisibleOff,
    );
    await deleteCallbackMessageIfPossible(ctx);
    await updateProfileField(ctx.userId, "showActiveDiscussionOnProfile", nextValue);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.showActiveDiscussionOnProfile = nextValue;
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
    await ctx.reply(" ", {
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
    keyboard: profileKeyboard(
      lang,
      Boolean(user?.photoFileId),
      Boolean(user?.profileDiscoverable),
      Boolean(user?.showActiveDiscussionOnProfile),
    ),
    messages,
    defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
    loadingText: options.loading ? messages[lang].profileLoading : "",
    isOwnProfile: true,
  });
}

module.exports = { handleCallback };
