const messages = require("./messages");
const path = require("path");
const { detectLanguage } = require("./lang");
const { handleCallback } = require("./callbacks");
const { callBacks } = require("./constants");
const {
  mainMenuKeyboard,
  languageKeyboard,
  aiAssistantKeyboard,
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  profileKeyboard,
  ageKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  cancelEditKeyboard,
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionContextCancelKeyboard,
  aiListManageMenuKeyboard,
  aiListCancelAddKeyboard,
  aiInterestTopTenChipKeyboard,
  discussionRoomKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionCreateConfirmKeyboard,
  profileViewBackKeyboard,
  savedProfilesListKeyboard,
} = require("./keyboards");
const {
  updateProfileField,
  updateUserState,
  addAiListItem,
  addAiRecentSuggestion,
  consumeAiSuggestionQuota,
  refundAiSuggestionQuota,
  removeAiListItem,
  normalizeAiListItem,
  normalizeAiListComment,
  DEFAULT_TASTE_LABEL_BY_SECTION,
  getAiListItemsFromUser,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  setAiListItemComment,
  inferTasteLabel,
  getAiTasteFromUser,
  getTasteProgressStatus,
  syncAiTasteForSection,
} = require("./services/users");
const { resolveCityByCoordinates } = require("./services/location");
const { getAiSingleSuggestion, getAiTasteItemFeedback } = require("./services/ai");
const { startAiPlaceholder } = require("./services/ai-placeholder");
const { setPendingSuggestion } = require("./services/ai-suggestion-cache");
const {
  saveLocationProfile,
  sendProfileMessage,
  isValidTextInput,
  toPlainUser,
} = require("./services/profile");
const {
  getAiSectionFromState,
  getSectionLabel,
  getSectionListButtonLabel,
  getSectionListLabel,
  getTasteLabelEmoji,
  getTasteLabelTitle,
  getTasteLabelStyleHint,
  clearAiSectionPin,
} = require("./services/ai-section");
const { getAiListDuplicateMatch } = require("./services/ai-list-duplicates");
const {
  addRecentMessage,
  closeDiscussionAsOwner,
  ensurePublicProfileCode,
  findDiscussionByPublicCode,
  joinOrSwitchActiveDiscussion,
  leaveDiscussionAsMember,
  listActiveDiscussions,
  listMyDiscussions,
  normalizePublicProfileCode,
  removeMemberAsOwner,
  reportDiscussionMember,
  addSavedProfileCode,
  removeSavedProfileCode,
  hasLink,
} = require("./services/discussions");
const {
  isCodeSaved,
  buildSavedProfileListItems,
  paginateSavedProfiles,
  buildSavedProfilesListText,
  buildProfileSavedFooter,
} = require("./services/saved-profiles-ui");
const {
  getDiscussionErrorMessage,
  decorateDiscussionsForList,
  paginateDiscussions,
  buildDiscussionListText,
  buildDiscussionPreviewText,
} = require("./services/discussion-ui");
const {
  formatDiscussionMemberLines,
  formatDiscussionRoom,
  formatRecentDiscussionMessages,
} = require("./services/discussion-room-ui");
const User = require("./models/user");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");
const FIELD_LIMITS = {
  profileName: 30,
  city: 30,
  bio: 120,
};
const AI_WATCHLIST_LIMIT = 100;
const AI_TOP_TEN_LIMIT = 10;
const AI_RECENT_SUGGESTIONS_LIMIT = 20;
const AI_SUGGESTIONS_PER_HOUR = 10;
const AI_WATCHLIST_PROMPT_LIMIT = 30;
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

function matchesMessageText(text, keys) {
  const normalizedText = normalizeKeyboardText(text);
  return keys
    .flatMap((key) => [messages.fa[key], messages.en[key]])
    .map(normalizeKeyboardText)
    .includes(normalizedText);
}

function isDiscussionMembersText(text) {
  const plainText = getPlainKeyboardText(text);
  return matchesMessageText(text, ["discussionMembersTitle"]) || plainText.includes("اعضا") || plainText.includes("members");
}

function isDiscussionMyListText(text) {
  return matchesMessageText(text, ["discussionMyList"]);
}

function isDiscussionLeaveText(text) {
  const plainText = getPlainKeyboardText(text);
  return matchesMessageText(text, ["discussionLeave"]) || (plainText.includes("خروج") && plainText.includes("بحث")) || plainText.includes("leave discussion");
}

function isDiscussionCloseText(text) {
  const plainText = getPlainKeyboardText(text);
  return matchesMessageText(text, ["discussionCloseButton"]) || (plainText.includes("بستن") && plainText.includes("بحث")) || plainText.includes("close discussion");
}

function isDiscussionCloseConfirmText(text) {
  return matchesMessageText(text, ["discussionCloseConfirmCommand"]);
}

function isDiscussionCloseCancelText(text) {
  return matchesMessageText(text, ["discussionCloseCancelCommand"]);
}

function isDiscussionReturnToMenuText(text) {
  const normalizedText = normalizeKeyboardText(text);
  const legacyLabels = [
    "💬 منوی بحث‌ها",
    "💬 Discussions menu",
  ].map(normalizeKeyboardText);
  const plainText = getPlainKeyboardText(text);
  return (
    matchesMessageText(text, ["discussionReturnToMenu"]) ||
    legacyLabels.includes(normalizedText) ||
    (plainText.includes("منوی") && plainText.includes("بحث")) ||
    (plainText.includes("discussion") && plainText.includes("menu"))
  );
}

function getPlainKeyboardText(text) {
  return normalizeKeyboardText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function isDiscussionBottomControlText(text) {
  return (
    isDiscussionReturnToMenuText(text) ||
    isDiscussionMembersText(text) ||
    isDiscussionLeaveText(text) ||
    isDiscussionCloseText(text)
  );
}

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function parseDiscussionCloseConfirmState(state = "") {
  if (!state.startsWith("discussion_close_confirm")) return {};
  const [, discussionId = "", messageIdRaw = "", source = "room"] = state.split(":");
  const messageId = Number(messageIdRaw);
  return {
    discussionId,
    messageId: Number.isInteger(messageId) && messageId > 0 ? messageId : null,
    source: source === "list" ? "list" : "room",
  };
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

async function clearRememberedAiListMessage(ctx) {
  const messageId = Number(ctx.user?.aiLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || !ctx.deleteMessage) {
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

function toTitleSet(items = []) {
  return new Set(items.map((entry) => String(entry?.title || entry || "").trim().toLowerCase()).filter(Boolean));
}

function formatAiItemsList(title, items, emptyText, options = {}) {
  if (!items.length) {
    return emptyText;
  }

  const topTenTitleSet = options.topTenTitleSet || new Set();
  const lines = items.map((item, index) => {
    const topTenBadge = topTenTitleSet.has(String(item?.title || "").trim().toLowerCase()) ? " 🏆" : "";
    if (item?.comment) {
      return `${index + 1}. ${item.title}${topTenBadge} — ${item.comment}`;
    }
    return `${index + 1}. ${item.title}${topTenBadge}`;
  });
  return `${title}\n\n${lines.join("\n")}`;
}

function withAiSectionTitle(lang, section, body) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const heading = messages[lang].aiSectionPinnedTitle.replace("{section}", sectionLabel);
  return `${heading}\n\n${body}`;
}

function parseAiListInput(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("+")) {
    return null;
  }

  const body = raw.slice(1).trim();
  if (!body) {
    return { title: "", comment: "" };
  }

  const separatorMatch = body.match(/\s[-—|]\s/);
  if (!separatorMatch) {
    return { title: body, comment: "" };
  }

  const separator = separatorMatch[0];
  const [titlePart, ...restParts] = body.split(separator);
  const commentPart = restParts.join(separator).trim();

  return {
    title: titlePart.trim(),
    comment: commentPart,
  };
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

function formatSuggestionLimitMessage(lang, resetAt) {
  const resetTime = resetAt ? new Date(resetAt).getTime() : Date.now();
  const minutes = Math.max(1, Math.ceil((resetTime - Date.now()) / (60 * 1000)));
  return messages[lang].aiSuggestionHourlyLimit.replace("{minutes}", String(minutes));
}

function parseAiSuggestContextState(state) {
  const matched = String(state || "").match(AI_SUGGEST_CONTEXT_STATE_PATTERN);
  return matched ? matched[1] : "";
}

function promptSuggestionMode(ctx, lang, section) {
  return ctx.reply(messages[lang].aiSuggestionModePrompt, aiSuggestionModeKeyboard(lang, section));
}

function getPromptWatchlistItems(watchlistItems = []) {
  return watchlistItems.slice(-AI_WATCHLIST_PROMPT_LIMIT);
}

function parseAiTopTenCollectorInput(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { title: "", comment: "" };
  }

  if (raw.startsWith("+")) {
    return parseAiListInput(raw) || { title: "", comment: "" };
  }

  return { title: raw, comment: "" };
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

function buildTopTenListMessage({ ctx, lang, section }) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const topTenEntries = getAiListItemsFromUser(ctx.user, section, "topTen");
  const title = messages[lang].aiTopTenTitle.replace("{section}", sectionLabel);
  const emptyText = messages[lang].aiTopTenEmpty.replace("{section}", sectionLabel);
  return withAiSectionTitle(lang, section, formatAiItemsList(title, topTenEntries, emptyText));
}

function formatTasteWithStoredEmoji(section, taste, labelTitle) {
  return `${taste?.emoji || getTasteLabelEmoji(section, taste?.labelKey)} ${labelTitle}`;
}

async function getTopTenManageEntryMessage(ctx, lang, section) {
  const topTenItems = getAiListItemsFromUser(ctx.user, section, "topTen");
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

function buildWatchlistMessage({ ctx, lang, section }) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const listLabel = getSectionListLabel(messages, lang, section);
  const entries = getAiListItemsFromUser(ctx.user, section, "watchlist");
  const topTenTitleSet = toTitleSet(getAiListItemsFromUser(ctx.user, section, "topTen"));
  const title = messages[lang].aiWatchlistTitle
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);
  const emptyText = messages[lang].aiWatchlistEmpty
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);
  return withAiSectionTitle(lang, section, formatAiItemsList(title, entries, emptyText, { topTenTitleSet }));
}

function getNeedTopTenMessage(lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  return messages[lang].aiSectionSuggestNeedTopTenItem.replace("{section}", sectionLabel);
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

function formatSuggestionResultMessage(lang, title, reason) {
  const cleanReason = reason || messages[lang].aiSuggestionFallbackTitle;
  return [
    messages[lang].aiSuggestionResultTitle.replace("{item}", title),
    messages[lang].aiSuggestionResultReason.replace("{reason}", cleanReason),
  ].join("\n\n");
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

  const savedText = messages[lang].aiTasteItemSaved
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
    return placeholder.finish(
      messages[lang].aiNoResponse || messages[lang].aiTemporaryUnavailable,
      aiSectionKeyboardForSection(lang, section),
    );
  }

  await addAiRecentSuggestion(ctx.userId, section, suggestionResult.title, AI_RECENT_SUGGESTIONS_LIMIT);
  setPendingSuggestion(ctx.userId, section, suggestionResult.title, suggestionResult.reason || "");
  return placeholder.finish(
    formatSuggestionResultMessage(lang, suggestionResult.title, suggestionResult.reason),
    aiSuggestionAddKeyboard(lang, section),
  );
}

async function notifyDiscussionUsers(ctx, userIds = [], text) {
  const targets = [...new Set((userIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0))];
  await Promise.all(targets.map((userId) => ctx.sendToUser?.(userId, text)));
}

function formatDiscussionLeftMessage(lang, discussionTitle = "") {
  return messages[lang].discussionLeft.replace("{title}", discussionTitle || "-");
}

async function replyWithDiscussionMenu(ctx, lang, text, { removeKeyboard = false } = {}) {
  await ctx.reply(text, removeKeyboard ? { reply_markup: { remove_keyboard: true } } : undefined);
  return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
}

function normalizeProfileCodeFromActionCommand(value) {
  const raw = String(value || "").trim().replace(/^\/?(remove|report|save|unsave)_/i, "");
  return normalizePublicProfileCode(raw.startsWith("u_") ? raw : `u_${raw}`);
}

async function clearSavedProfilesListMessage(ctx) {
  const messageId = Number(ctx.user?.savedProfilesLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || !ctx.deleteMessage) return false;
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
  }
  return deleted;
}

async function rememberSavedProfilesListMessage(ctx, message) {
  const messageId = getMessageId(message);
  if (!messageId) return;
  await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", messageId);
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

async function handleDiscussionBottomButton(ctx, lang, text) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");

  if (isDiscussionMembersText(text)) {
    if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

    const opened = await joinOrSwitchActiveDiscussion(ctx.userId, activeDiscussionId);
    if (!opened.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, opened.reason));
    const memberUsers = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName publicProfileCode")
      .lean();
    await Promise.all(memberUsers.map((entry) => ensurePublicProfileCode(entry.userId)));
    const refreshed = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName publicProfileCode")
      .lean();
    const rows = formatDiscussionMemberLines(messages, lang, refreshed, opened.discussion.creatorUserId, ctx.userId);
    return ctx.reply(
      `${messages[lang].discussionMembersTitle}\n\n${rows.join("\n")}`,
    );
  }

  if (isDiscussionMyListText(text)) {
    const result = await listMyDiscussions(ctx.userId, { limit: 20 });
    if (!result.ok) return ctx.reply(messages[lang].unknownAction);
    if (!result.discussions.length) return ctx.reply(messages[lang].discussionListMineEmpty);
    const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, true);
    const sent = await ctx.reply(buildDiscussionListText(messages, lang, messages[lang].discussionMyList, decorated));
    await rememberDiscussionListMessage(ctx, "mine", sent);
    return sent;
  }

  if (isDiscussionReturnToMenuText(text)) {
    const notice = await ctx.reply(messages[lang].discussionReturnedToMenu, {
      reply_markup: { remove_keyboard: true, selective: false },
    });
    await rememberDiscussionMenuNotice(ctx, notice);
    return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
  }

  if (isDiscussionLeaveText(text)) {
    if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

    const left = await leaveDiscussionAsMember(ctx.userId, activeDiscussionId);
    if (!left.ok) {
      if (left.reason === "owner_cannot_leave_open") return ctx.reply(messages[lang].discussionOwnerCannotLeave);
      return ctx.reply(messages[lang].discussionNotMember);
    }
    const discussionTitle = left?.discussionTitle || "";
    const ownerUserId = Number(left?.creatorUserId);
    const leaverName = String(ctx.user?.profileName || ctx.user?.firstName || "کاربر").trim();
    if (ownerUserId && ownerUserId !== ctx.userId && discussionTitle) {
      await notifyDiscussionUsers(
        ctx,
        [ownerUserId],
        messages[lang].discussionLeftNoticeToOwner
          .replace("{name}", leaverName || "کاربر")
          .replace("{title}", discussionTitle),
      );
    }
    await updateProfileField(ctx.userId, "activeDiscussionId", null);
    return replyWithDiscussionMenu(ctx, lang, formatDiscussionLeftMessage(lang, discussionTitle), { removeKeyboard: true });
  }

  if (isDiscussionCloseText(text)) {
    if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);
    const sent = await ctx.reply(messages[lang].discussionCloseConfirmPrompt, {
      reply_markup: {
        keyboard: [
          [{ text: messages[lang].discussionCloseConfirmCommand }],
          [{ text: messages[lang].discussionCloseCancelCommand }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
        selective: true,
      },
    });
    await updateUserState(ctx.userId, `discussion_close_confirm:${activeDiscussionId}:${getMessageId(sent) || ""}:room`);
    return sent;
  }

  return null;
}

function buildDiscussionPreviewForCurrentDraft(ctx, lang, description) {
  return buildDiscussionPreviewText(messages, lang, {
    ...toPlainUser(ctx.user),
    discussionDraftDescription: description,
  });
}

function buildDiscussionPreviewForCurrentUser(ctx, lang, overrides = {}) {
  return buildDiscussionPreviewText(messages, lang, {
    ...toPlainUser(ctx.user),
    ...overrides,
  });
}

async function sendDiscussionRoomFromText(ctx, lang, discussion) {
  await ctx.reply(formatDiscussionRoom(messages, lang, discussion));
  return ctx.reply(
    `${formatRecentDiscussionMessages(messages, lang, discussion)}\n\n${messages[lang].discussionRoomSendHint}`,
    discussionRoomKeyboard(lang, discussion.creatorUserId === ctx.userId),
  );
}

async function rememberDiscussionListMessage(ctx, listType, message) {
  const messageId = getMessageId(message);
  if (!messageId) return;
  await updateProfileField(ctx.userId, "discussionLastListMessageId", messageId);
  await updateProfileField(ctx.userId, "discussionLastListType", listType);
}

async function clearRememberedDiscussionListMessage(ctx) {
  const messageId = Number(ctx.user?.discussionLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "discussionLastListMessageId", null);
    await updateProfileField(ctx.userId, "discussionLastListType", "");
  }
  return deleted;
}

async function rememberDiscussionMenuNotice(ctx, message) {
  const messageId = getMessageId(message);
  if (!messageId) return;
  await updateProfileField(ctx.userId, "discussionMenuNoticeMessageId", messageId);
}

async function clearDiscussionMenuNotice(ctx) {
  const messageId = Number(ctx.user?.discussionMenuNoticeMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "discussionMenuNoticeMessageId", null);
  }
  return deleted;
}

async function sendDiscussionCreatePrompt(ctx, text, keyboard) {
  await clearDiscussionMenuNotice(ctx);
  const sent = await ctx.reply(text, keyboard);
  await rememberDiscussionMenuNotice(ctx, sent);
  return sent;
}

async function sendRememberedDiscussionList(ctx, lang, preferredType = "active") {
  const listType = preferredType === "mine" ? "mine" : "active";
  if (listType === "mine") {
    const result = await listMyDiscussions(ctx.userId, { limit: 20 });
    if (!result.ok || !result.discussions.length) {
      const sentEmpty = await ctx.reply(messages[lang].discussionListMineEmpty);
      return rememberDiscussionListMessage(ctx, "mine", sentEmpty);
    }
    const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, true);
    const paged = paginateDiscussions(decorated, 0);
    const sent = await ctx.reply(
      buildDiscussionListText(messages, lang, messages[lang].discussionMyList, paged.items, {
        startIndex: paged.startIndex,
      }),
      discussionListNavigationKeyboard(lang, {
        listType: "mine",
        page: paged.page,
        totalPages: paged.totalPages,
      }),
    );
    return rememberDiscussionListMessage(ctx, "mine", sent);
  }

  const result = await listActiveDiscussions({ limit: 100 });
  if (!result.discussions.length) {
    const sentEmpty = await ctx.reply(messages[lang].discussionListEmpty);
    return rememberDiscussionListMessage(ctx, "active", sentEmpty);
  }
  const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, false);
  const paged = paginateDiscussions(decorated, 0);
  const sent = await ctx.reply(
    buildDiscussionListText(messages, lang, messages[lang].discussionActiveList, paged.items, {
      startIndex: paged.startIndex,
    }),
    discussionListNavigationKeyboard(lang, {
      listType: "active",
      page: paged.page,
      totalPages: paged.totalPages,
      joinableOnly: false,
    }),
  );
  return rememberDiscussionListMessage(ctx, "active", sent);
}

async function refreshDiscussionListAfterFailedJoin(ctx, lang, reason) {
  await clearRememberedDiscussionListMessage(ctx);
  await ctx.reply(getDiscussionErrorMessage(messages, lang, reason));
  return sendRememberedDiscussionList(ctx, lang, ctx.user?.discussionLastListType || "active");
}

async function openDiscussionCommand(ctx, lang, code) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion) return ctx.reply(messages[lang].discussionErrMissingDiscussion);

  const joined = await joinOrSwitchActiveDiscussion(ctx.userId, discussion._id);
  if (!joined.ok) return refreshDiscussionListAfterFailedJoin(ctx, lang, joined.reason);

  await clearRememberedDiscussionListMessage(ctx);
  await ctx.reply(joined.joined ? messages[lang].discussionJoined : messages[lang].discussionSwitched);
  return sendDiscussionRoomFromText(ctx, lang, joined.discussion);
}

async function leaveDiscussionCommand(ctx, lang, code) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion) return ctx.reply(messages[lang].discussionErrMissingDiscussion);

  const left = await leaveDiscussionAsMember(ctx.userId, discussion._id);
  if (!left.ok) {
    if (left.reason === "owner_cannot_leave_open") return ctx.reply(messages[lang].discussionOwnerCannotLeave);
    return ctx.reply(getDiscussionErrorMessage(messages, lang, left.reason));
  }
  await clearRememberedDiscussionListMessage(ctx);
  await updateProfileField(ctx.userId, "activeDiscussionId", null);
  return replyWithDiscussionMenu(ctx, lang, formatDiscussionLeftMessage(lang, left.discussionTitle), { removeKeyboard: true });
}

async function closeDiscussionCommand(ctx, lang, code) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion) return ctx.reply(messages[lang].discussionErrMissingDiscussion);
  const sent = await ctx.reply(messages[lang].discussionCloseConfirmPrompt, {
    reply_markup: {
      keyboard: [
        [{ text: messages[lang].discussionCloseConfirmCommand }],
        [{ text: messages[lang].discussionCloseCancelCommand }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  });
  await updateUserState(ctx.userId, `discussion_close_confirm:${discussion._id}:${getMessageId(sent) || ""}:list`);
  return sent;
}

async function sendRemovedActiveMemberNotice(ctx, removed) {
  if (!removed?.wasActive || !ctx.sendToUser) return;
  const targetLang = messages[removed.memberLang] ? removed.memberLang : "fa";
  await ctx.sendToUser(
    removed.memberUserId,
    messages[targetLang].discussionRemovedNotice.replace("{title}", removed.discussionTitle || ""),
    { reply_markup: { remove_keyboard: true } },
  );
  await ctx.sendToUser(
    removed.memberUserId,
    messages[targetLang].discussionsMenu,
    discussionsMenuKeyboard(targetLang),
  );
}

async function removeDiscussionMemberCommand(ctx, lang, text) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
  if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

  const code = normalizeProfileCodeFromActionCommand(text);
  const member = code ? await User.findOne({ publicProfileCode: code }).select("userId").lean() : null;
  const memberUserId = Number(member?.userId);
  if (!Number.isInteger(memberUserId)) return ctx.reply(getDiscussionErrorMessage(messages, lang, "not_member"));

  const removed = await removeMemberAsOwner(ctx.userId, activeDiscussionId, memberUserId);
  if (!removed.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, removed.reason));

  await sendRemovedActiveMemberNotice(ctx, removed);
  return ctx.reply(messages[lang].discussionMemberRemoved);
}

async function reportDiscussionMemberCommand(ctx, lang, text) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
  if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

  const code = normalizeProfileCodeFromActionCommand(text);
  const member = code ? await User.findOne({ publicProfileCode: code }).select("userId").lean() : null;
  const memberUserId = Number(member?.userId);
  if (!Number.isInteger(memberUserId)) return ctx.reply(getDiscussionErrorMessage(messages, lang, "not_member"));

  const reported = await reportDiscussionMember(ctx.userId, activeDiscussionId, memberUserId);
  if (!reported.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, reported.reason));
  return ctx.reply(messages[lang].discussionReportSent);
}

async function saveProfileCommand(ctx, lang, text) {
  const code = normalizeProfileCodeFromActionCommand(text);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  const saved = await addSavedProfileCode(ctx.userId, code);
  if (!saved.ok) {
    if (saved.reason === "exists") return ctx.reply(messages[lang].savedProfileAlreadySaved);
    if (saved.reason === "saved_profiles_limit") return ctx.reply(messages[lang].savedProfilesLimit);
    return ctx.reply(messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", saved.items || []);
  return ctx.reply(messages[lang].savedProfileSaved);
}

async function unsaveProfileCommand(ctx, lang, text) {
  const code = normalizeProfileCodeFromActionCommand(text);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  const removed = await removeSavedProfileCode(ctx.userId, code);
  if (!removed.ok) {
    return ctx.reply(removed.reason === "not_found" ? messages[lang].savedProfilesEmpty : messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", removed.items || []);
  await clearSavedProfilesListMessage(ctx);
  await ctx.reply(messages[lang].savedProfileRemoved);
  return sendSavedProfilesList(ctx, lang, removed.items || []);
}

async function handleUpdate(ctx) {
  const text = (ctx.text || "").trim();
  const lang = detectLanguage(ctx);

  if (ctx.callbackData) {
    return handleCallback(ctx);
  }

  const userLang = ctx.user?.lang;
  const state = ctx.user?.state || "idle";
  const keyboardLang = userLang || lang;

  if (!(state && state.startsWith("discussion_close_confirm")) && text && isDiscussionBottomControlText(text)) {
    return handleDiscussionBottomButton(ctx, lang, text);
  }

  if (!(state && state.startsWith("discussion_close_confirm")) && state === "idle" && ctx.user?.activeDiscussionId && text) {
    const handledDiscussionButton = await handleDiscussionBottomButton(ctx, lang, text);
    if (handledDiscussionButton) {
      return handledDiscussionButton;
    }
  }

  if (state === "idle" && ctx.user?.activeDiscussionId && text && !text.startsWith("/")) {
    const senderName = String(ctx.user?.profileName || ctx.user?.firstName || "کاربر").trim();
    const added = await addRecentMessage({
      discussionId: ctx.user.activeDiscussionId,
      senderUserId: ctx.userId,
      senderDisplayName: senderName,
      text,
    });
    if (!added.ok) {
      if (added.reason === "message_rate_limit") {
        return ctx.reply(
          messages[lang].discussionMessageRateLimit,
          discussionRoomKeyboard(lang, added.discussion?.creatorUserId === ctx.userId),
        );
      }
      return ctx.reply(messages[lang].discussionMessageOnlyText);
    }

    const inboundText = messages[lang].discussionMessageInbound
      .replace("{title}", added.discussion.title)
      .replace("{sender}", senderName || "کاربر")
      .replace("{text}", String(text).trim());

    await Promise.all(
      (added.recipients || []).map((recipientUserId) => ctx.sendToUser?.(recipientUserId, inboundText)),
    );
    return true;
  }

  if (text === "/cancel") {
    const aiSection = getAiSectionFromState(state);
    await updateUserState(ctx.userId, "idle");
    if (aiSection) {
      await clearRememberedAiListMessage(ctx);
      await clearAiSectionPin({ ctx, updateProfileField });
      await ctx.reply(" ", {
        reply_markup: { remove_keyboard: true },
      });
      return ctx.reply(messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    if (state === "editing_location") {
      await ctx.reply(" ", {
        reply_markup: { remove_keyboard: true },
      });
    }
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_name" && text) {
    if (text.startsWith("/")) {
      return ctx.reply(messages[lang].profileEditHintName, cancelEditKeyboard(lang));
    }

    if (!isValidTextInput(text, FIELD_LIMITS.profileName)) {
      return ctx.reply(
        `${messages[lang].profileNameTooLong}\n${messages[lang].profileEditHintName}`,
        cancelEditKeyboard(lang)
      );
    }

    await updateProfileField(ctx.userId, "profileName", text);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.profileName = text;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_city" && text) {
    if (text.startsWith("/")) {
      return ctx.reply(messages[lang].profileEditHintCity, cancelEditKeyboard(lang));
    }

    if (!isValidTextInput(text, FIELD_LIMITS.city)) {
      return ctx.reply(
        `${messages[lang].profileCityTooLong}\n${messages[lang].profileEditHintCity}`,
        cancelEditKeyboard(lang)
      );
    }

    await updateProfileField(ctx.userId, "city", text);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.city = text;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_photo" && ctx.message?.photo?.length) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await updateProfileField(ctx.userId, "photoFileId", photo.file_id);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = photo.file_id;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_photo" && ctx.message?.document?.file_id) {
    await updateProfileField(ctx.userId, "photoFileId", ctx.message.document.file_id);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = ctx.message.document.file_id;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_location" && ctx.message?.location) {
    const location = await saveLocationProfile({
      userId: ctx.userId,
      locationMessage: ctx.message.location,
      updateProfileField,
      updateUserState,
      resolveCityByCoordinates,
    });

    await ctx.reply(messages[lang].profileUpdated, {
      reply_markup: { remove_keyboard: true },
    });
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.location = location;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_photo") {
    return ctx.reply(messages[lang].profileEditHintPhoto, cancelEditKeyboard(lang));
  }

  if (state === "discussion_create_title" || state === "discussion_create_title_edit") {
    const isEditingFromPreview = state === "discussion_create_title_edit";
    if (normalizeKeyboardText(text) === normalizeKeyboardText(messages[lang].discussionCreateCancel)) {
      await clearDiscussionMenuNotice(ctx);
      await updateProfileField(ctx.userId, "discussionDraftTitle", "");
      await updateProfileField(ctx.userId, "discussionDraftDescription", "");
      await updateProfileField(ctx.userId, "discussionDraftJoinRule", null);
      await updateProfileField(ctx.userId, "discussionDraftMaxMembers", 20);
      await updateUserState(ctx.userId, "idle");
      await ctx.reply(messages[lang].discussionCreateCanceled, {
        reply_markup: { remove_keyboard: true },
      });
      return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    }
    if (!text || text.startsWith("/")) {
      return sendDiscussionCreatePrompt(
        ctx,
        isEditingFromPreview ? messages[lang].discussionInvalidTitle : messages[lang].discussionCreateAskTitle,
        discussionCreateCancelKeyboard(
          lang,
          isEditingFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          isEditingFromPreview ? messages[lang].discussionCancelEdit : null,
        ),
      );
    }
    const normalized = String(text).trim().replace(/\s+/g, " ").slice(0, 80);
    if (!normalized) {
      return sendDiscussionCreatePrompt(
        ctx,
        messages[lang].discussionInvalidTitle,
        discussionCreateCancelKeyboard(
          lang,
          isEditingFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          isEditingFromPreview ? messages[lang].discussionCancelEdit : null,
        ),
      );
    }
    if (hasLink(normalized)) {
      return sendDiscussionCreatePrompt(
        ctx,
        messages[lang].discussionInvalidTitleLink,
        discussionCreateCancelKeyboard(
          lang,
          isEditingFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          isEditingFromPreview ? messages[lang].discussionCancelEdit : null,
        ),
      );
    }
    await clearDiscussionMenuNotice(ctx);
    await updateProfileField(ctx.userId, "discussionDraftTitle", normalized);
    if (isEditingFromPreview) {
      await updateUserState(ctx.userId, "discussion_create_preview");
      return ctx.reply(
        buildDiscussionPreviewForCurrentUser(ctx, lang, { discussionDraftTitle: normalized }),
        discussionCreateConfirmKeyboard(lang),
      );
    }
    await updateUserState(ctx.userId, "discussion_create_join_rule");
    return ctx.reply(
      messages[lang].discussionJoinRulePrompt,
      discussionJoinRuleKeyboard(lang, {
        cancelCallback: callBacks.discussionCreateCancel,
        backButton: {
          text: messages[lang].discussionBack,
          callback_data: callBacks.discussionCreateBackToTitle,
        },
      }),
    );
  }

  if (state === "discussion_create_description" || state === "discussion_create_description_edit") {
    const draftRule = ctx.user?.discussionDraftJoinRule || { type: "open" };
    const isOpenRule = draftRule.type === "open";
    const isEditingDescriptionFromPreview = state === "discussion_create_description_edit";
    const descriptionBackButton = isEditingDescriptionFromPreview
      ? {
        text: messages[lang].discussionBack,
        callback_data: callBacks.discussionCreatePreview,
      }
      : {
        text: messages[lang].discussionBack,
        callback_data: callBacks.discussionCreateBackToJoinRule,
      };
    if (normalizeKeyboardText(text) === normalizeKeyboardText(messages[lang].discussionCreateCancel)) {
      await clearDiscussionMenuNotice(ctx);
      await updateProfileField(ctx.userId, "discussionDraftTitle", "");
      await updateProfileField(ctx.userId, "discussionDraftDescription", "");
      await updateProfileField(ctx.userId, "discussionDraftJoinRule", null);
      await updateProfileField(ctx.userId, "discussionDraftMaxMembers", 20);
      await updateUserState(ctx.userId, "idle");
      await ctx.reply(messages[lang].discussionCreateCanceled, {
        reply_markup: { remove_keyboard: true },
      });
      return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    }
    if (normalizeKeyboardText(text) === normalizeKeyboardText(messages[lang].discussionSkipDescription)) {
      if (isOpenRule) {
        return sendDiscussionCreatePrompt(
          ctx,
          messages[lang].discussionOpenNeedsDescription,
          discussionCreateCancelKeyboard(
            lang,
            isEditingDescriptionFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
            isEditingDescriptionFromPreview ? messages[lang].discussionCancelEdit : null,
            descriptionBackButton,
          ),
        );
      }
      await clearDiscussionMenuNotice(ctx);
      await updateProfileField(ctx.userId, "discussionDraftDescription", "");
      await updateUserState(ctx.userId, "discussion_create_preview");
      return ctx.reply(
        buildDiscussionPreviewForCurrentDraft(ctx, lang, ""),
        discussionCreateConfirmKeyboard(lang),
      );
    }
    if (!text || text.startsWith("/")) {
      return sendDiscussionCreatePrompt(
        ctx,
        messages[lang].discussionCreateAskDescription,
        isOpenRule
          ? discussionCreateCancelKeyboard(
            lang,
            isEditingDescriptionFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
            isEditingDescriptionFromPreview ? messages[lang].discussionCancelEdit : null,
            descriptionBackButton,
          )
          : discussionCreateDescriptionKeyboard(lang, {
            cancelCallback: isEditingDescriptionFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
            cancelText: isEditingDescriptionFromPreview ? messages[lang].discussionCancelEdit : null,
            backButton: descriptionBackButton,
          }),
      );
    }
    const normalized = String(text).trim().replace(/\s+/g, " ").slice(0, 300);
    if (isOpenRule && !normalized) {
      return sendDiscussionCreatePrompt(
        ctx,
        messages[lang].discussionOpenNeedsDescription,
        discussionCreateCancelKeyboard(
          lang,
          isEditingDescriptionFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          isEditingDescriptionFromPreview ? messages[lang].discussionCancelEdit : null,
          descriptionBackButton,
        ),
      );
    }
    await clearDiscussionMenuNotice(ctx);
    await updateProfileField(ctx.userId, "discussionDraftDescription", normalized);
    await updateUserState(ctx.userId, "discussion_create_preview");
    return ctx.reply(
      buildDiscussionPreviewForCurrentDraft(ctx, lang, normalized),
      discussionCreateConfirmKeyboard(lang),
    );
  }

  if (state === "discussion_create_join_rule" || state === "discussion_create_join_rule_edit") {
    await ctx.reply(messages[lang].discussionSelectOptionPrompt);
    await clearDiscussionMenuNotice(ctx);
    const isEditingJoinRule = state === "discussion_create_join_rule_edit";
    const sent = await ctx.reply(
      messages[lang].discussionJoinRulePrompt,
      discussionJoinRuleKeyboard(lang, {
        cancelCallback: isEditingJoinRule ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
        cancelText: isEditingJoinRule ? messages[lang].discussionCancelEdit : null,
        backButton: isEditingJoinRule
          ? null
          : {
            text: messages[lang].discussionBack,
            callback_data: callBacks.discussionCreateBackToTitle,
          },
      }),
    );
    await rememberDiscussionMenuNotice(ctx, sent);
    return sent;
  }

  if (state && state.startsWith("discussion_close_confirm")) {
    const parsed = parseDiscussionCloseConfirmState(state);
    if (isDiscussionCloseCancelText(text)) {
      await updateUserState(ctx.userId, "idle");
      if (parsed.messageId && ctx.deleteMessage) {
        await ctx.deleteMessage(parsed.messageId);
      }
      if (parsed.source === "list") {
        const previousListType = ctx.user?.discussionLastListType || "active";
        await ctx.reply(messages[lang].discussionCloseCanceled, {
          reply_markup: { remove_keyboard: true },
        });
        return sendRememberedDiscussionList(ctx, lang, previousListType);
      }
      const opened = await joinOrSwitchActiveDiscussion(ctx.userId, parsed.discussionId || String(ctx.user?.activeDiscussionId || ""));
      if (!opened.ok) {
        return replyWithDiscussionMenu(ctx, lang, messages[lang].discussionReturnedToMenu, { removeKeyboard: true });
      }
      return ctx.reply(messages[lang].discussionCloseCanceled, discussionRoomKeyboard(lang, opened.discussion.creatorUserId === ctx.userId));
    }
    if (!isDiscussionCloseConfirmText(text)) {
      return ctx.reply(messages[lang].discussionSelectOptionPrompt);
    }
    const explicitId = parsed.discussionId || "";
    const discussionId = explicitId || String(ctx.user?.activeDiscussionId || "");
    if (!discussionId) {
      await updateUserState(ctx.userId, "idle");
      return replyWithDiscussionMenu(ctx, lang, messages[lang].discussionNotMember, { removeKeyboard: true });
    }
    const closed = await closeDiscussionAsOwner(ctx.userId, discussionId);
    if (!closed.ok) {
      await updateUserState(ctx.userId, "idle");
      return replyWithDiscussionMenu(ctx, lang, getDiscussionErrorMessage(messages, lang, closed.reason), { removeKeyboard: true });
    }
    if (parsed.messageId && ctx.deleteMessage) {
      await ctx.deleteMessage(parsed.messageId);
    }
    const notifyIds = (closed.affectedMemberIds || []).filter((id) => Number(id) !== Number(ctx.userId));
    await notifyDiscussionUsers(
      ctx,
      notifyIds,
      messages[lang].discussionClosedNotice.replace("{title}", closed.discussion?.title || ""),
    );
    const previousListType = ctx.user?.discussionLastListType || "active";
    await clearRememberedDiscussionListMessage(ctx);
    await updateProfileField(ctx.userId, "activeDiscussionId", null);
    await updateUserState(ctx.userId, "idle");
    if (parsed.source === "list") {
      await ctx.reply(messages[lang].discussionClosed, {
        reply_markup: { remove_keyboard: true },
      });
      return sendRememberedDiscussionList(ctx, lang, previousListType);
    }
    return replyWithDiscussionMenu(ctx, lang, messages[lang].discussionClosed, { removeKeyboard: true });
  }

  if (matchesMessageText(text, ["discussionCreateCancel"])) {
    await clearDiscussionMenuNotice(ctx);
    await updateProfileField(ctx.userId, "discussionDraftTitle", "");
    await updateProfileField(ctx.userId, "discussionDraftDescription", "");
    await updateProfileField(ctx.userId, "discussionDraftJoinRule", null);
    await updateProfileField(ctx.userId, "discussionDraftMaxMembers", 20);
    await updateUserState(ctx.userId, "idle");
    await ctx.reply(messages[lang].discussionCreateCanceled, {
      reply_markup: { remove_keyboard: true },
    });
    return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
  }

  const manageState = parseAiManageState(state);
  if (manageState) {
    if (isAiBackText(text)) {
      await updateUserState(ctx.userId, "idle");
      await clearRememberedAiListMessage(ctx);
      await clearAiSectionPin({ ctx, updateProfileField });
      await ctx.reply(" ", {
        reply_markup: { remove_keyboard: true },
      });
      return ctx.reply(messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const section = manageState.section;
    const sectionLabel = getSectionLabel(messages, lang, section);
    const listLabel = getSectionListLabel(messages, lang, section);
    const isWatchlist = manageState.isWatchlist;
    const listType = manageState.listType;
    const topTenItems = getAiListItemsFromUser(ctx.user, section, "topTen");
    const topTenTitles = topTenItems.map((entry) => entry.title);
    const watchlistItems = getAiListItemsFromUser(ctx.user, section, "watchlist");
    const tasteContext = await resolveSectionTasteContext({
      ctx,
      lang,
      section,
      topTenItems: topTenTitles,
    });
    const title = (isWatchlist ? messages[lang].aiWatchlistTitle : messages[lang].aiTopTenTitle)
      .replace("{section}", sectionLabel)
      .replace("{listName}", listLabel);
    const emptyText = (isWatchlist ? messages[lang].aiWatchlistEmpty : messages[lang].aiTopTenEmpty)
      .replace("{section}", sectionLabel)
      .replace("{listName}", listLabel);
    const currentItems = getAiListItemsFromUser(ctx.user, section, listType);

    if (isAiSectionListText(text, section)) {
      const nextState = `ai_manage_${section}_watchlist`;
      await updateUserState(ctx.userId, nextState);
      const listMessage = await ctx.reply(buildWatchlistMessage({ ctx, lang, section }));
      await rememberAiListMessage(ctx, section, "watchlist", listMessage);
      return ctx.reply(
        messages[lang].aiListManageInlineEntry.replace("{listName}", listLabel),
        aiListManageMenuKeyboard(lang, section, "watchlist")
      );
    }

    if (isAiSectionTopTenText(text)) {
      const nextState = `ai_manage_${section}_top_ten`;
      await updateUserState(ctx.userId, nextState);
      const listMessage = await ctx.reply(buildTopTenListMessage({ ctx, lang, section }));
      await rememberAiListMessage(ctx, section, "topTen", listMessage);
      return ctx.reply(
        await getTopTenManageEntryMessage(ctx, lang, section),
        aiListManageMenuKeyboard(lang, section, "topTen"),
      );
    }

    if (isAiSectionSuggestText(text)) {
      if (topTenTitles.length < 3) {
        return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));
      }

      return promptSuggestionMode(ctx, lang, section);
    }

    if (isAiListText(text) && !manageState.addInputMode) {
      const listOptions = isWatchlist ? { topTenTitleSet: toTitleSet(topTenItems) } : {};
      return ctx.reply(
        formatAiItemsList(title, currentItems, emptyText, listOptions),
        aiSectionKeyboardForSection(lang, section)
      );
    }

    if (manageState.addInputMode) {
      const item = normalizeAiListItem(text);
      const comment = normalizeAiListComment("");
      if (!item) {
        const isInterestTopTen = section === "random" && listType === "topTen";
        return ctx.reply(
          isInterestTopTen ? messages[lang].aiInterestTopTenAddPrompt : messages[lang].aiListManageAddPrompt,
          isInterestTopTen ? aiInterestTopTenChipKeyboard(lang) : aiListCancelAddKeyboard(lang, section, isWatchlist ? "watchlist" : "topTen"),
        );
      }

      const result = await addAiListItem(
        ctx.userId,
        section,
        listType,
        { title: item, comment },
        isWatchlist ? AI_WATCHLIST_LIMIT : AI_TOP_TEN_LIMIT
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
        return ctx.reply(messages[lang].aiListInvalidInput, aiListCancelAddKeyboard(lang, section, listType));
      }

      await updateUserState(ctx.userId, `ai_manage_${section}_${isWatchlist ? "watchlist" : "top_ten"}`);

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
        return placeholder.finish(savedMessage, aiListManageMenuKeyboard(lang, section, listType));
      }

      return ctx.reply(
        `${messages[lang].aiListSaved}\n${formatAiItemsList(title, result.items, emptyText, { topTenTitleSet: toTitleSet(topTenItems) })}`,
        aiListManageMenuKeyboard(lang, section, listType)
      );
    }

    if (manageState.commentInputMode) {
      const pendingItem = normalizeAiListItem(ctx.user?.aiSectionPendingCommentItem);
      const pendingListType = ctx.user?.aiSectionPendingCommentListType === "topTen" ? "topTen" : "watchlist";
      if (!pendingItem) {
        await updateUserState(ctx.userId, `ai_manage_${section}_${pendingListType === "topTen" ? "top_ten" : "watchlist"}`);
        await updateProfileField(ctx.userId, "aiSectionPendingCommentListType", null);
        return ctx.reply(
          pendingListType === "topTen" ? messages[lang].aiTopTenCommentCanceled : messages[lang].aiWatchlistCommentCanceled,
          aiListManageMenuKeyboard(lang, section, pendingListType),
        );
      }

      if (text.startsWith("/")) {
        return ctx.reply(
          pendingListType === "topTen" ? messages[lang].aiTopTenCommentAskText : messages[lang].aiWatchlistCommentAskText,
          aiListCancelCommentKeyboard(lang, section, pendingListType),
        );
      }

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

    return ctx.reply(messages[lang].aiListManageUseButtons, aiListManageMenuKeyboard(lang, section, listType));
  }

  const suggestContextSection = parseAiSuggestContextState(state);
  if (suggestContextSection) {
    if (isAiBackText(text)) {
      await updateUserState(ctx.userId, `ai_chat_${suggestContextSection}`);
      return ctx.reply(messages[lang].aiSectionUseButtonsOnly, aiSectionKeyboardForSection(lang, suggestContextSection));
    }

    const userText = String(text || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!userText || text.startsWith("/")) {
      return ctx.reply(messages[lang].aiSuggestionContextPrompt, aiSuggestionContextCancelKeyboard(lang, suggestContextSection));
    }

    const topTenItems = getAiListTitlesFromUser(ctx.user, suggestContextSection, "topTen");
    if (topTenItems.length < 3) {
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

  if (
    state === "ai_chat_movies" ||
    state === "ai_chat_music" ||
    state === "ai_chat_books" ||
    state === "ai_chat_random"
  ) {
    if (isAiBackText(text)) {
      await updateUserState(ctx.userId, "idle");
      await clearRememberedAiListMessage(ctx);
      await clearAiSectionPin({ ctx, updateProfileField });
      await ctx.reply(messages[lang].cancelMessage, {
        reply_markup: { remove_keyboard: true },
      });
      return ctx.reply(messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const section = getAiSectionFromState(state);
    const listLabel = getSectionListLabel(messages, lang, section);

    if (isAiSectionListText(text, section)) {
      const nextState = `ai_manage_${section}_watchlist`;
      await updateUserState(ctx.userId, nextState);
      const listMessage = await ctx.reply(buildWatchlistMessage({ ctx, lang, section }));
      await rememberAiListMessage(ctx, section, "watchlist", listMessage);
      return ctx.reply(
        messages[lang].aiListManageInlineEntry.replace("{listName}", listLabel),
        aiListManageMenuKeyboard(lang, section, "watchlist")
      );
    }

    if (isAiSectionTopTenText(text)) {
      const nextState = `ai_manage_${section}_top_ten`;
      await updateUserState(ctx.userId, nextState);
      const listMessage = await ctx.reply(buildTopTenListMessage({ ctx, lang, section }));
      await rememberAiListMessage(ctx, section, "topTen", listMessage);
      return ctx.reply(
        await getTopTenManageEntryMessage(ctx, lang, section),
        aiListManageMenuKeyboard(lang, section, "topTen"),
      );
    }

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    const watchlistItems = getAiListTitlesFromUser(ctx.user, section, "watchlist");

    if (isAiSectionSuggestText(text)) {
      if (topTenItems.length < 3) {
        return ctx.reply(getNeedTopTenMessage(lang, section), aiSectionKeyboardForSection(lang, section));
      }

      return promptSuggestionMode(ctx, lang, section);
    }

    return ctx.reply(messages[lang].aiSectionUseButtonsOnly, aiSectionKeyboardForSection(lang, section));
  }

  if (state === "editing_age") {
    return ctx.reply(messages[lang].profileEditHintAge, ageKeyboard(lang));
  }

  if (state === "editing_gender") {
    return ctx.reply(messages[lang].profileEditHintGender, genderKeyboard(lang));
  }

  if (state === "editing_pet_preference") {
    return ctx.reply(messages[lang].profileEditHintPetPreference, petPreferenceKeyboard(lang));
  }

  if (state === "editing_location") {
    if (text === messages[lang].cancelEdit) {
      await updateUserState(ctx.userId, "idle");
      await ctx.reply(" ", {
        reply_markup: { remove_keyboard: true },
      });
      const updatedUser = toPlainUser(ctx.user);
      updatedUser.state = "idle";
      return sendProfile(ctx, updatedUser, lang, keyboardLang);
    }

    return ctx.reply(messages[lang].profileEditHintLocation, locationKeyboard(lang));
  }

  if (state === "editing_bio" && text) {
    if (text.startsWith("/")) {
      return ctx.reply(messages[lang].profileEditHintBio, cancelEditKeyboard(lang));
    }

    if (!isValidTextInput(text, FIELD_LIMITS.bio)) {
      return ctx.reply(
        `${messages[lang].profileBioTooLong}\n${messages[lang].profileEditHintBio}`,
        cancelEditKeyboard(lang)
      );
    }

    await updateProfileField(ctx.userId, "bio", text);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.bio = text;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (text === "/start") {
    const rawUserName = ctx.user?.profileName || ctx.user?.firstName || "";
    const userName = rawUserName.trim().replace(/\s+/g, " ");
    const welcomeMessage = userName
      ? messages[lang].welcomeWithName.replace("{name}", userName)
      : messages[lang].welcome;

    await ctx.reply(welcomeMessage);

    if (!userLang) {
      return ctx.reply(messages["fa"].chooseLanguage, languageKeyboard());
    }

    return ctx.reply(messages[userLang].mainMenu, mainMenuKeyboard(userLang));
  }

  if (text === "/lang") {
    await clearDiscussionMenuNotice(ctx);
    return ctx.reply(messages[lang].chooseLanguage, languageKeyboard());
  }

  if (text === "/menu") {
    await clearDiscussionMenuNotice(ctx);
    if (!userLang) {
      return ctx.reply(messages["fa"].chooseLanguage, languageKeyboard());
    }

    return ctx.reply(messages[userLang].mainMenu, mainMenuKeyboard(userLang));
  }

  if (text === "/profile") {
    await clearDiscussionMenuNotice(ctx);
    return sendProfile(ctx, ctx.user || {}, lang, keyboardLang, { loading: true });
  }

  if (/^\/d_[a-z0-9]+$/i.test(text)) {
    return openDiscussionCommand(ctx, lang, text);
  }

  if (/^\/leave_[a-z0-9]+$/i.test(text)) {
    return leaveDiscussionCommand(ctx, lang, `d_${text.replace(/^\/leave_/i, "")}`);
  }

  if (/^\/close_[a-z0-9]+$/i.test(text)) {
    return closeDiscussionCommand(ctx, lang, `d_${text.replace(/^\/close_/i, "")}`);
  }

  if (/^\/remove_(u_)?[a-z0-9]+$/i.test(text)) {
    return removeDiscussionMemberCommand(ctx, lang, text);
  }

  if (/^\/report_(u_)?[a-z0-9]+$/i.test(text)) {
    return reportDiscussionMemberCommand(ctx, lang, text);
  }

  if (/^\/save_(u_)?[a-z0-9]+$/i.test(text)) {
    return saveProfileCommand(ctx, lang, text);
  }

  if (/^\/unsave_(u_)?[a-z0-9]+$/i.test(text)) {
    return unsaveProfileCommand(ctx, lang, text);
  }

  if (/^\/u_[a-z0-9]+$/i.test(text)) {
    const code = normalizePublicProfileCode(text);
    const target = await User.findOne({ publicProfileCode: code });
    if (!target) {
      return ctx.reply(messages[lang].profileCodeNotFound);
    }
    const current = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const isSaved = isCodeSaved(current, code);
    const fromSavedList = isSaved ? await clearSavedProfilesListMessage(ctx) : false;
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
      footerText: buildProfileSavedFooter(messages, lang, code, isSaved),
    });
  }

  if (text === "/resetphoto") {
    await updateProfileField(ctx.userId, "photoFileId", null);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = null;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  return ctx.reply(messages[lang].maintenance, mainMenuKeyboard(lang));
}

async function sendProfile(ctx, user, lang, keyboardLang, options = {}) {
  return sendProfileMessage({
    ctx,
    user,
    lang,
    keyboard: profileKeyboard(
      keyboardLang,
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

module.exports = {
  handleUpdate,
};
