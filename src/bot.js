const messages = require("./messages");
const path = require("path");
const { detectLanguage } = require("./lang");
const { handleCallback } = require("./callbacks");
const {
  mainMenuKeyboard,
  languageKeyboard,
  aiAssistantKeyboard,
  profileKeyboard,
  ageKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  cancelEditKeyboard,
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiListManageMenuKeyboard,
  aiListCancelAddKeyboard,
} = require("./keyboards");
const {
  updateProfileField,
  updateUserState,
  addAiListItem,
  removeAiListItem,
  normalizeAiListItem,
  normalizeAiListComment,
  getAiListItemsFromUser,
  getAiListTitlesFromUser,
  setAiListItemComment,
  inferTasteLabel,
  getAiTasteFromUser,
  getTasteProgressStatus,
  syncAiTasteForSection,
} = require("./services/users");
const { resolveCityByCoordinates } = require("./services/location");
const { getAiSingleSuggestion, getAiTasteItemFeedback } = require("./services/ai");
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
  getTasteLabelTitle,
  getTasteLabelStyleHint,
  clearAiSectionPin,
} = require("./services/ai-section");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");
const FIELD_LIMITS = {
  profileName: 30,
  city: 30,
  bio: 120,
};
const AI_WATCHLIST_LIMIT = 100;
const AI_TOP_TEN_LIMIT = 10;
const AI_MANAGE_STATE_PATTERN = /^ai_manage_(movies|music|books|random)_(watchlist|top_ten)(?:_(add_input|comment_input))?$/;

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

function formatAiItemsList(title, items, emptyText) {
  if (!items.length) {
    return emptyText;
  }

  const lines = items.map((item, index) => {
    if (item?.comment) {
      return `${index + 1}. ${item.title} — ${item.comment}`;
    }
    return `${index + 1}. ${item.title}`;
  });
  return `${title}\n${lines.join("\n")}`;
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

async function sendSingleSectionSuggestion({
  ctx,
  lang,
  section,
  topTenItems,
  watchlistItems,
  tasteStyleHint,
  userText = "",
}) {
  const suggestionResult = await getAiSingleSuggestion({
    mode: section,
    lang,
    userText: userText || (section === "random" ? "Suggest one thing for me" : `Suggest one ${section} item`),
    topTenItems,
    watchlistItems,
    personalized: true,
    tasteStyleHint,
  });

  if (!suggestionResult.ok || !suggestionResult.title) {
    return ctx.reply(messages[lang].aiTemporaryUnavailable, aiSectionKeyboardForSection(lang, section));
  }

  setPendingSuggestion(ctx.userId, section, suggestionResult.title, suggestionResult.reason || "");
  return ctx.reply(
    `${suggestionResult.title}\n${suggestionResult.reason || messages[lang].aiSuggestionFallbackTitle}`,
    aiSuggestionAddKeyboard(lang, section),
  );
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

  if (text === "/cancel") {
    const aiSection = getAiSectionFromState(state);
    await updateUserState(ctx.userId, "idle");
    if (aiSection) {
      await clearAiSectionPin({ ctx, updateProfileField });
      await ctx.reply(messages[lang].cancelMessage, {
        reply_markup: { remove_keyboard: true },
      });
      return ctx.reply(messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    if (state === "editing_location") {
      await ctx.reply(messages[lang].cancelMessage, {
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

  const manageState = parseAiManageState(state);
  if (manageState) {
    if (isAiBackText(text)) {
      await updateUserState(ctx.userId, "idle");
      await clearAiSectionPin({ ctx, updateProfileField });
      await ctx.reply(messages[lang].aiSectionBackToChat, {
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
      return ctx.reply(
        messages[lang].aiListManageInlineEntry.replace("{listName}", listLabel),
        aiListManageMenuKeyboard(lang, section, "watchlist")
      );
    }

    if (isAiSectionTopTenText(text)) {
      const nextState = `ai_manage_${section}_top_ten`;
      await updateUserState(ctx.userId, nextState);
      return ctx.reply(
        messages[lang].aiListManageInlineEntry.replace("{listName}", messages[lang].aiSectionTopTenButton),
        aiListManageMenuKeyboard(lang, section, "topTen")
      );
    }

    if (isAiSectionSuggestText(text)) {
      return sendSingleSectionSuggestion({
        ctx,
        lang,
        section,
        topTenItems: topTenTitles,
        watchlistItems: watchlistItems.map((entry) => entry.title),
        tasteStyleHint: tasteContext.styleHint,
      });
    }

    if (isAiListText(text) && !manageState.addInputMode) {
      return ctx.reply(
        formatAiItemsList(title, currentItems, emptyText),
        aiSectionKeyboardForSection(lang, section)
      );
    }

    if (manageState.addInputMode) {
      const item = normalizeAiListItem(text);
      const comment = normalizeAiListComment("");
      if (!item) {
        return ctx.reply(
          messages[lang].aiListManageAddPrompt,
          aiListCancelAddKeyboard(lang, section, isWatchlist ? "watchlist" : "topTen"),
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
          return ctx.reply(messages[lang].aiListAlreadyExists, aiSectionKeyboardForSection(lang, section));
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

      let tasteUnlockedNote = "";
      if (!isWatchlist && result.items.length >= AI_TOP_TEN_LIMIT) {
        const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
        const resolvedTaste = syncedTaste.ok
          ? syncedTaste.taste
          : inferTasteLabel(section, result.items.map((entry) => entry.title));
        const finalLabel = getTasteLabelTitle(messages, lang, section, resolvedTaste.labelKey);
        tasteUnlockedNote = `\n${messages[lang].aiTasteLabelUnlocked
          .replace("{section}", sectionLabel)
          .replace("{label}", finalLabel)}`;
      }

      return ctx.reply(
        `${messages[lang].aiListSaved}\n${formatAiItemsList(title, result.items, emptyText)}${tasteUnlockedNote}`,
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
          aiListCancelAddKeyboard(lang, section, pendingListType),
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
      }
      return ctx.reply(
        pendingListType === "topTen" ? messages[lang].aiTopTenCommentSaved : messages[lang].aiWatchlistCommentSaved,
        aiListManageMenuKeyboard(lang, section, pendingListType),
      );
    }

    return ctx.reply(messages[lang].aiListManageUseButtons, aiListManageMenuKeyboard(lang, section, listType));
  }

  if (
    state === "ai_chat_movies" ||
    state === "ai_chat_music" ||
    state === "ai_chat_books" ||
    state === "ai_chat_random"
  ) {
    if (isAiBackText(text)) {
      await updateUserState(ctx.userId, "idle");
      await clearAiSectionPin({ ctx, updateProfileField });
      await ctx.reply(messages[lang].aiSectionBackToChat, {
        reply_markup: { remove_keyboard: true },
      });
      return ctx.reply(messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const section = getAiSectionFromState(state);
    const sectionLabel = getSectionLabel(messages, lang, section);
    const listLabel = getSectionListLabel(messages, lang, section);

    if (isAiSectionListText(text, section)) {
      const nextState = `ai_manage_${section}_watchlist`;
      await updateUserState(ctx.userId, nextState);
      return ctx.reply(
        messages[lang].aiListManageInlineEntry.replace("{listName}", listLabel),
        aiListManageMenuKeyboard(lang, section, "watchlist")
      );
    }

    if (isAiSectionTopTenText(text)) {
      const nextState = `ai_manage_${section}_top_ten`;
      await updateUserState(ctx.userId, nextState);
      return ctx.reply(
        messages[lang].aiListManageInlineEntry.replace("{listName}", messages[lang].aiSectionTopTenButton),
        aiListManageMenuKeyboard(lang, section, "topTen")
      );
    }

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    const watchlistItems = getAiListTitlesFromUser(ctx.user, section, "watchlist");
    const tasteContext = await resolveSectionTasteContext({
      ctx,
      lang,
      section,
      topTenItems,
    });
    const { progress } = tasteContext;

    if (isAiSectionSuggestText(text)) {
      return sendSingleSectionSuggestion({
        ctx,
        lang,
        section,
        topTenItems,
        watchlistItems,
        tasteStyleHint: tasteContext.styleHint,
      });
    }

    if (isAiListText(text)) {
      const topTenTitle = messages[lang].aiTopTenTitle.replace("{section}", sectionLabel);
      const topTenEmpty = messages[lang].aiTopTenEmpty.replace("{section}", sectionLabel);
      const topTenEntries = getAiListItemsFromUser(ctx.user, section, "topTen");
      return ctx.reply(
        formatAiItemsList(topTenTitle, topTenEntries, topTenEmpty),
        aiSectionKeyboardForSection(lang, section)
      );
    }

    const isTopTenCollectorCommand = text.startsWith("+") || text.startsWith("-");
    if (!progress.labelReady && isTopTenCollectorCommand) {
      if (text.startsWith("-")) {
        const itemToRemove = normalizeAiListItem(text.slice(1));
        if (!itemToRemove) {
          return ctx.reply(
            messages[lang].aiSectionCollectTopTenPrompt
              .replace("{section}", sectionLabel)
              .replace("{count}", String(progress.count))
              .replace("{goal}", String(progress.goal)),
            aiSectionKeyboardForSection(lang, section)
          );
        }

        const removed = await removeAiListItem(ctx.userId, section, "topTen", itemToRemove);
        if (!removed.ok) {
          return ctx.reply(messages[lang].aiListNotFound, aiSectionKeyboardForSection(lang, section));
        }

        await syncAiTasteForSection(ctx.userId, section);
        const nextProgress = getTasteProgressStatus(section, removed.items.length);
        return ctx.reply(
          messages[lang].aiTasteTopTenProgress
            .replace("{section}", sectionLabel)
            .replace("{count}", String(nextProgress.count))
            .replace("{goal}", String(nextProgress.goal)),
          aiSectionKeyboardForSection(lang, section)
        );
      }

      const parsedInput = parseAiTopTenCollectorInput(text);
      const item = normalizeAiListItem(parsedInput?.title);
      const comment = normalizeAiListComment(parsedInput?.comment);

      if (!item || text.startsWith("/")) {
        return ctx.reply(
          messages[lang].aiSectionCollectTopTenPrompt
            .replace("{section}", sectionLabel)
            .replace("{count}", String(progress.count))
            .replace("{goal}", String(progress.goal)),
          aiSectionKeyboardForSection(lang, section)
        );
      }

      const addResult = await addAiListItem(
        ctx.userId,
        section,
        "topTen",
        { title: item, comment },
        AI_TOP_TEN_LIMIT
      );

      if (!addResult.ok) {
        if (addResult.reason === "exists") {
          return ctx.reply(
            messages[lang].aiTasteItemAlreadySent
              .replace("{count}", String(progress.count))
              .replace("{goal}", String(progress.goal)),
            aiSectionKeyboardForSection(lang, section)
          );
        }

        if (addResult.reason === "limit") {
          const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
          const resolvedTaste = syncedTaste.ok
            ? syncedTaste.taste
            : inferTasteLabel(section, topTenItems);
          const labelTitle = getTasteLabelTitle(messages, lang, section, resolvedTaste.labelKey);
          return ctx.reply(
            messages[lang].aiTasteLabelKnownIntro
              .replace("{section}", sectionLabel)
              .replace("{label}", labelTitle),
            aiSectionKeyboardForSection(lang, section)
          );
        }

        return ctx.reply(messages[lang].aiListInvalidInput, aiSectionKeyboardForSection(lang, section));
      }

      const nextItems = addResult.items.map((entry) => entry.title);
      const nextProgress = getTasteProgressStatus(section, nextItems.length);
      const provisionalTaste = inferTasteLabel(section, nextItems);
      const provisionalLabel = getTasteLabelTitle(messages, lang, section, provisionalTaste.labelKey);

      if (!nextProgress.labelReady) {
        const feedbackResult = await getAiTasteItemFeedback({
          mode: section,
          lang,
          item,
          labelKey: provisionalTaste.labelKey,
          labelTitle: provisionalLabel,
        });
        const feedbackLine = feedbackResult.ok
          ? feedbackResult.text
          : messages[lang].aiTasteItemFeedbackFallback
            .replace("{label}", provisionalLabel)
            .replace("{item}", item);

        return ctx.reply(
          messages[lang].aiTasteItemFeedback
            .replace("{item}", item)
            .replace("{count}", String(nextProgress.count))
            .replace("{goal}", String(nextProgress.goal))
            .replace("{label}", provisionalLabel)
            .replace("{feedback}", `${feedbackLine}\n${messages[lang].aiTasteAskNext}`),
          aiSectionKeyboardForSection(lang, section)
        );
      }

      const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
      const finalTaste = syncedTaste.ok ? syncedTaste.taste : provisionalTaste;
      const finalLabel = getTasteLabelTitle(messages, lang, section, finalTaste.labelKey);
      const finalStyle = getTasteLabelStyleHint(messages, lang, section, finalTaste.labelKey);

      return ctx.reply(
        messages[lang].aiTasteLabelUnlockedDetailed
          .replace("{section}", sectionLabel)
          .replace("{label}", finalLabel)
          .replace("{style}", finalStyle)
          .replace("{count}", String(nextProgress.count))
          .replace("{goal}", String(nextProgress.goal)),
        aiSectionKeyboardForSection(lang, section)
      );
    }

    return sendSingleSectionSuggestion({
      ctx,
      lang,
      section,
      topTenItems,
      watchlistItems,
      tasteStyleHint: tasteContext.styleHint,
      userText: text,
    });
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
      await ctx.reply(messages[lang].cancelMessage, {
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
    return ctx.reply(messages[lang].chooseLanguage, languageKeyboard());
  }

  if (text === "/menu") {
    if (!userLang) {
      return ctx.reply(messages["fa"].chooseLanguage, languageKeyboard());
    }

    return ctx.reply(messages[userLang].mainMenu, mainMenuKeyboard(userLang));
  }

  if (text === "/profile") {
    return sendProfile(ctx, ctx.user || {}, lang, keyboardLang);
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

async function sendProfile(ctx, user, lang, keyboardLang) {
  return sendProfileMessage({
    ctx,
    user,
    lang,
    keyboard: profileKeyboard(keyboardLang, Boolean(user?.photoFileId)),
    messages,
    defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
  });
}

module.exports = {
  handleUpdate,
};
