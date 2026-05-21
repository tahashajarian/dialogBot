const messages = require("./messages");
const path = require("path");
const { setLanguage, detectLanguage, normalizeLang } = require("./lang");
const { mainMenuKeyboard, languageKeyboard, profileKeyboard, ageKeyboard, ageRangeKeyboard, genderKeyboard, petPreferenceKeyboard, locationKeyboard, cancelEditKeyboard } = require("./keyboards");
const { callBacks } = require("./constances");
const { updateProfileField, updateUserState } = require("./services/users");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");
const FIELD_LIMITS = {
  profileName: 30,
  city: 30,
  bio: 120,
};

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
    const allowedGenders = new Set(["female", "male", "other"]);

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
    const allowedPetPreferences = new Set(["any", "none", "cat", "dog", "bird", "small_pets"]);

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

    if (!Number.isInteger(startAge) || startAge < 10 || startAge > 70 || startAge % 10 !== 0) {
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

    if (!Number.isInteger(age) || age < 10 || age > 70) {
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

function getProfileText(user, lang) {
  const displayName = user?.profileName || user?.firstName || "—";
  const city = user?.city || "—";
  const age = Number.isFinite(user?.age) ? `\u2066${String(user.age)}\u2069` : "—";
  const genderMap = {
    female: messages[lang].genderOptionFemaleDisplay,
    male: messages[lang].genderOptionMaleDisplay,
    other: messages[lang].genderOptionOtherDisplay,
  };
  const gender = genderMap[user?.gender] || messages[lang].genderMissing;
  const petPreferenceMap = {
    any: messages[lang].petOptionAnyDisplay,
    none: messages[lang].petOptionNoneDisplay,
    cat: messages[lang].petOptionCatDisplay,
    dog: messages[lang].petOptionDogDisplay,
    bird: messages[lang].petOptionBirdDisplay,
    small_pets: messages[lang].petOptionSmallPetsDisplay,
  };
  const petPreference = petPreferenceMap[user?.petPreference] || "—";
  const bio = user?.bio || messages[lang].bioMissing;
  const locationText = user?.location
    ? (user.location.city || messages[lang].locationSet)
    : messages[lang].locationMissing;

  const titleIcon = user?.gender === "female" ? "🌸" : user?.gender === "male" ? "💙" : "🪞";
  const genderIcon = "⚧️";

  return [
    `${titleIcon} ${messages[lang].profileTitle}`,
    `━━━━━━━━━━━━━━`,
    lang === "fa" ? `👤 نام: ${displayName}` : `👤 ${messages[lang].profileName}: ${displayName}`,
    lang === "fa" ? `🏙 شهر: ${city}` : `🏙 ${messages[lang].profileCity}: ${city}`,
    lang === "fa" ? `🎂 سن: ${age}` : `🎂 ${messages[lang].profileAge}: ${age}`,
    `${genderIcon} ${messages[lang].profileGender}: ${gender}`,
    `🐾 ${messages[lang].profilePetPreference}: ${petPreference}`,
    `📍 ${messages[lang].profileLocation}: ${locationText}`,
    `📝 ${messages[lang].profileBio}: ${bio}`,
  ].join("\n");
}

async function sendProfile(ctx, lang, user = ctx.user) {
  const hasCustomPhoto = user?.photoFileId;

  if (hasCustomPhoto) {
    try {
      return await ctx.replyWithPhoto(user.photoFileId, {
        caption: getProfileText(user, lang),
        ...profileKeyboard(lang, hasCustomPhoto),
      });
    } catch {
      return ctx.reply(getProfileText(user, lang), profileKeyboard(lang, hasCustomPhoto));
    }
  }

  try {
    return await ctx.replyWithPhoto(
      { source: DEFAULT_PROFILE_PHOTO },
      {
        caption: getProfileText(user, lang),
        ...profileKeyboard(lang, hasCustomPhoto),
      }
    );
  } catch {
    return ctx.reply(getProfileText(user, lang), profileKeyboard(lang, hasCustomPhoto));
  }
}

module.exports = { handleCallback };

function toPlainUser(user) {
  if (!user) return {};
  if (typeof user.toObject === "function") {
    return user.toObject();
  }
  return { ...user };
}
