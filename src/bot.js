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
} = require("./services/users");
const { resolveCityByCoordinates } = require("./services/location");
const { getAiAssistantReply } = require("./services/ai");
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
  clearAiSectionPin,
} = require("./services/ai-section");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");
const FIELD_LIMITS = {
  profileName: 30,
  city: 30,
  bio: 120,
};
const AI_WATCHLIST_LIMIT = 10;
const AI_TOP_TEN_LIMIT = 10;

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

  if (
    state === "ai_manage_movies_watchlist" ||
    state === "ai_manage_movies_top_ten" ||
    state === "ai_manage_music_watchlist" ||
    state === "ai_manage_music_top_ten" ||
    state === "ai_manage_books_watchlist" ||
    state === "ai_manage_books_top_ten" ||
    state === "ai_manage_random_watchlist" ||
    state === "ai_manage_random_top_ten"
  ) {
    if (isAiBackText(text)) {
      await updateUserState(ctx.userId, "idle");
      await clearAiSectionPin({ ctx, updateProfileField });
      return ctx.reply(messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const section = getAiSectionFromState(state);
    const sectionLabel = getSectionLabel(messages, lang, section);
    const listLabel = getSectionListLabel(messages, lang, section);
    const isWatchlist = state.endsWith("_watchlist");
    const listType = isWatchlist ? "watchlist" : "topTen";
    const topTenItems = getAiListItemsFromUser(ctx.user, section, "topTen");
    const watchlistItems = getAiListItemsFromUser(ctx.user, section, "watchlist");
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
        messages[lang].aiWatchlistManageReady
          .replace("{section}", sectionLabel)
          .replace("{listName}", listLabel),
        aiSectionKeyboardForSection(lang, section)
      );
    }

    if (isAiSectionTopTenText(text)) {
      const nextState = `ai_manage_${section}_top_ten`;
      await updateUserState(ctx.userId, nextState);
      return ctx.reply(
        messages[lang].aiTopTenManageReady.replace("{section}", sectionLabel),
        aiSectionKeyboardForSection(lang, section)
      );
    }

    if (isAiSectionSuggestText(text)) {
      if (topTenItems.length < AI_TOP_TEN_LIMIT) {
        return ctx.reply(
          messages[lang].aiSuggestNeedTopTen
            .replace("{section}", sectionLabel)
            .replace("{count}", String(topTenItems.length)),
          aiSectionKeyboardForSection(lang, section)
        );
      }

      const aiResult = await getAiAssistantReply({
        mode: section,
        lang,
        userText: section === "random" ? "Suggest for me" : `Suggest a new ${section}`,
        topTenItems: topTenItems.map((entry) => entry.title),
        watchlistItems: watchlistItems.map((entry) => entry.title),
        personalized: true,
      });

      if (aiResult.ok) {
        return ctx.reply(aiResult.text, aiSectionKeyboardForSection(lang, section));
      }

      return ctx.reply(messages[lang].aiTemporaryUnavailable, aiSectionKeyboardForSection(lang, section));
    }

    if (isAiListText(text)) {
      return ctx.reply(
        formatAiItemsList(title, currentItems, emptyText),
        aiSectionKeyboardForSection(lang, section)
      );
    }

    if (text.startsWith("+")) {
      const parsed = parseAiListInput(text);
      const item = normalizeAiListItem(parsed?.title);
      const comment = normalizeAiListComment(parsed?.comment);
      if (!item) {
        return ctx.reply(messages[lang].aiListInvalidInput, aiSectionKeyboardForSection(lang, section));
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
          return ctx.reply(messages[lang].aiTopTenLimitReached, aiSectionKeyboardForSection(lang, section));
        }
        return ctx.reply(messages[lang].aiListInvalidInput, aiSectionKeyboardForSection(lang, section));
      }

      return ctx.reply(
        `${messages[lang].aiListSaved}\n${formatAiItemsList(title, result.items, emptyText)}`,
        aiSectionKeyboardForSection(lang, section)
      );
    }

    if (text.startsWith("-")) {
      const item = normalizeAiListItem(text.slice(1));
      if (!item) {
        return ctx.reply(messages[lang].aiListInvalidInput, aiSectionKeyboardForSection(lang, section));
      }

      const result = await removeAiListItem(ctx.userId, section, listType, item);
      if (!result.ok) {
        if (result.reason === "not_found") {
          return ctx.reply(messages[lang].aiListNotFound, aiSectionKeyboardForSection(lang, section));
        }
        return ctx.reply(messages[lang].aiListInvalidInput, aiSectionKeyboardForSection(lang, section));
      }

      return ctx.reply(
        `${messages[lang].aiListRemoved}\n${formatAiItemsList(title, result.items, emptyText)}`,
        aiSectionKeyboardForSection(lang, section)
      );
    }

    return ctx.reply(messages[lang].aiListInvalidInput, aiSectionKeyboardForSection(lang, section));
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
      return ctx.reply(messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const section = getAiSectionFromState(state);
    const sectionLabel = getSectionLabel(messages, lang, section);
    const listLabel = getSectionListLabel(messages, lang, section);

    if (isAiSectionListText(text, section)) {
      const nextState = `ai_manage_${section}_watchlist`;
      await updateUserState(ctx.userId, nextState);
      return ctx.reply(
        messages[lang].aiWatchlistManageReady
          .replace("{section}", sectionLabel)
          .replace("{listName}", listLabel),
        aiSectionKeyboardForSection(lang, section)
      );
    }

    if (isAiSectionTopTenText(text)) {
      const nextState = `ai_manage_${section}_top_ten`;
      await updateUserState(ctx.userId, nextState);
      return ctx.reply(
        messages[lang].aiTopTenManageReady.replace("{section}", sectionLabel),
        aiSectionKeyboardForSection(lang, section)
      );
    }

    const topTenItems = getAiListTitlesFromUser(ctx.user, section, "topTen");
    const watchlistItems = getAiListTitlesFromUser(ctx.user, section, "watchlist");

    if (isAiSectionSuggestText(text)) {
      if (topTenItems.length < AI_TOP_TEN_LIMIT) {
        return ctx.reply(
          messages[lang].aiSuggestNeedTopTen
            .replace("{section}", sectionLabel)
            .replace("{count}", String(topTenItems.length)),
          aiSectionKeyboardForSection(lang, section)
        );
      }

      const aiResult = await getAiAssistantReply({
        mode: section,
        lang,
        userText: section === "random" ? "Suggest for me" : `Suggest a new ${section}`,
        topTenItems,
        watchlistItems,
        personalized: true,
      });

      if (aiResult.ok) {
        return ctx.reply(aiResult.text, aiSectionKeyboardForSection(lang, section));
      }

      return ctx.reply(messages[lang].aiTemporaryUnavailable, aiSectionKeyboardForSection(lang, section));
    }

    const mode = state === "ai_chat_movies"
      ? "movies"
      : state === "ai_chat_music"
        ? "music"
        : state === "ai_chat_books"
          ? "books"
            : "random";

    const aiResult = await getAiAssistantReply({
      mode,
      lang,
      userText: text,
      topTenItems: [],
      watchlistItems: [],
      personalized: false,
    });

    if (aiResult.ok) {
      return ctx.reply(aiResult.text, aiSectionKeyboardForSection(lang, section));
    }

    return ctx.reply(messages[lang].aiTemporaryUnavailable, aiSectionKeyboardForSection(lang, section));
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
