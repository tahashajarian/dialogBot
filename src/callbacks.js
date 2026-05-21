const messages = require("./messages");
const path = require("path");
const { setLanguage, detectLanguage, normalizeLang } = require("./lang");
const {
  mainMenuKeyboard,
  languageKeyboard,
  aiAssistantKeyboard,
  aiSectionKeyboardForSection,
  profileKeyboard,
  ageKeyboard,
  ageRangeKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  cancelEditKeyboard,
} = require("./keyboards");
const { callBacks } = require("./constances");
const { updateProfileField, updateUserState } = require("./services/users");
const { sendProfileMessage, toPlainUser } = require("./services/profile");
const { clearAiSectionPin, pinAiSectionTitle } = require("./services/ai-section");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");

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
    return ctx.reply(messages[lang].aiMoviesChatReady, aiSectionKeyboardForSection(lang, "movies"));
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
    return ctx.reply(messages[lang].aiMusicChatReady, aiSectionKeyboardForSection(lang, "music"));
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
    return ctx.reply(messages[lang].aiBooksChatReady, aiSectionKeyboardForSection(lang, "books"));
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
    return ctx.reply(messages[lang].aiRandomChatReady, aiSectionKeyboardForSection(lang, "random"));
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
