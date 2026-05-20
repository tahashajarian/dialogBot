const messages = require("./messages");
const path = require("path");
const { detectLanguage } = require("./lang");
const { handleCallback } = require("./callbacks");
const { mainMenuKeyboard, languageKeyboard, profileKeyboard, ageKeyboard, petPreferenceKeyboard, locationKeyboard, cancelEditKeyboard } = require("./keyboards");
const { updateProfileField, updateUserState } = require("./services/users");
const { resolveCityByCoordinates } = require("./services/location");
const { callBacks } = require("./constances");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");

async function handleUpdate(ctx) {
  const text = (ctx.text || "").trim();
  const lang = detectLanguage(ctx);

  if (ctx.callbackData) {
    return handleCallback(ctx);
  }

  const userLang = ctx.user?.lang;
  const state = ctx.user?.state || "idle";

  if (text === "/cancel") {
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    if (state === "editing_location") {
      await ctx.reply(messages[lang].cancelMessage, {
        reply_markup: { remove_keyboard: true },
      });
    }
    return sendProfile(ctx, updatedUser, lang, userLang || lang);
  }

  if (state === "editing_name" && text) {
    if (text.startsWith("/")) {
      return ctx.reply(messages[lang].profileEditHintName, cancelEditKeyboard(lang));
    }

    await updateProfileField(ctx.userId, "profileName", text);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.profileName = text;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, userLang || lang);
  }

  if (state === "editing_city" && text) {
    if (text.startsWith("/")) {
      return ctx.reply(messages[lang].profileEditHintCity, cancelEditKeyboard(lang));
    }

    await updateProfileField(ctx.userId, "city", text);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.city = text;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, userLang || lang);
  }

  if (state === "editing_photo" && ctx.message?.photo?.length) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await updateProfileField(ctx.userId, "photoFileId", photo.file_id);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = photo.file_id;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, userLang || lang);
  }

  if (state === "editing_photo" && ctx.message?.document?.file_id) {
    await updateProfileField(ctx.userId, "photoFileId", ctx.message.document.file_id);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = ctx.message.document.file_id;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, userLang || lang);
  }

  if (state === "editing_location" && ctx.message?.location) {
    const location = {
      latitude: ctx.message.location.latitude,
      longitude: ctx.message.location.longitude,
      accuracy: ctx.message.location.horizontal_accuracy || null,
      city: null,
      sharedAt: new Date(),
    };

    await updateProfileField(ctx.userId, "location", location);
    await updateUserState(ctx.userId, "idle");
    enrichUserLocationCityInBackground(ctx.userId, location);
    await ctx.reply(messages[lang].profileUpdated, {
      reply_markup: { remove_keyboard: true },
    });
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.location = location;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, userLang || lang);
  }

  if (state === "editing_photo") {
    return ctx.reply(messages[lang].profileEditHintPhoto, cancelEditKeyboard(lang));
  }

  if (state === "editing_age") {
    return ctx.reply(messages[lang].profileEditHintAge, ageKeyboard(lang));
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
      return sendProfile(ctx, updatedUser, lang, userLang || lang);
    }

    return ctx.reply(messages[lang].profileEditHintLocation, locationKeyboard(lang));
  }

  if (text === "/start") {
    await ctx.reply(messages[lang].welcome);

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
    return sendProfile(ctx, ctx.user || {}, lang, userLang || lang);
  }

  if (text === "/resetphoto") {
    await updateProfileField(ctx.userId, "photoFileId", null);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = null;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, userLang || lang);
  }

  return ctx.reply(messages[lang].maintenance, mainMenuKeyboard(lang));
}

function getProfileText(user, lang) {
  const displayName = user?.profileName || user?.firstName || "—";
  const city = user?.city || "—";
  const age = Number.isFinite(user?.age) ? `\u2066${String(user.age)}\u2069` : "—";
  const petPreferenceMap = {
    any: messages[lang].petOptionAnyDisplay,
    none: messages[lang].petOptionNoneDisplay,
    cat: messages[lang].petOptionCatDisplay,
    dog: messages[lang].petOptionDogDisplay,
    bird: messages[lang].petOptionBirdDisplay,
    small_pets: messages[lang].petOptionSmallPetsDisplay,
  };
  const petPreference = petPreferenceMap[user?.petPreference] || "—";
  const locationText = user?.location
    ? (user.location.city || messages[lang].locationSet)
    : messages[lang].locationMissing;

  if (lang === "fa") {
    return [
      `🌸 ${messages[lang].profileTitle}`,
      `━━━━━━━━━━━━━━`,
      `👤 نام: ${displayName}`,
      `🏙 شهر: ${city}`,
      `🎂 سن: ${age}`,
      `🐾 ${messages[lang].profilePetPreference}: ${petPreference}`,
      `📍 ${messages[lang].profileLocation}: ${locationText}`,
    ].join("\n");
  }

  return [
    `👤 ${messages[lang].profileTitle}`,
    `━━━━━━━━━━━━━━`,
    `👤 ${messages[lang].profileName}: ${displayName}`,
    `🏙 ${messages[lang].profileCity}: ${city}`,
    `🎂 ${messages[lang].profileAge}: ${age}`,
    `🐾 ${messages[lang].profilePetPreference}: ${petPreference}`,
    `📍 ${messages[lang].profileLocation}: ${locationText}`,
  ].join("\n");
}

async function sendProfile(ctx, user, lang, keyboardLang) {
  const hasCustomPhoto = user?.photoFileId;

  if (hasCustomPhoto) {
    try {
      return await ctx.replyWithPhoto(user.photoFileId, {
        caption: getProfileText(user, lang),
        ...profileKeyboard(keyboardLang, hasCustomPhoto),
      });
    } catch {
      return ctx.reply(getProfileText(user, lang), profileKeyboard(keyboardLang, hasCustomPhoto));
    }
  }

  try {
    return await ctx.replyWithPhoto(
      { source: DEFAULT_PROFILE_PHOTO },
      {
        caption: getProfileText(user, lang),
        ...profileKeyboard(keyboardLang, hasCustomPhoto),
      }
    );
  } catch {
    return ctx.reply(getProfileText(user, lang), profileKeyboard(keyboardLang, hasCustomPhoto));
  }
}

module.exports = {
  handleUpdate
};

function toPlainUser(user) {
  if (!user) return {};
  if (typeof user.toObject === "function") {
    return user.toObject();
  }
  return { ...user };
}

async function enrichUserLocationCityInBackground(userId, location) {
  try {
    const resolvedCity = await resolveCityByCoordinates(location.latitude, location.longitude);
    if (!resolvedCity) return;

    await updateProfileField(userId, "location", {
      ...location,
      city: resolvedCity,
    });
  } catch {
    // keep fast path stable; silently ignore background failures
  }
}
