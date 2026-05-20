const messages = require("./messages");
const path = require("path");
const { detectLanguage } = require("./lang");
const { handleCallback } = require("./callbacks");
const { mainMenuKeyboard, languageKeyboard, profileKeyboard, ageKeyboard, cancelEditKeyboard } = require("./keyboards");
const { updateProfileField, updateUserState } = require("./services/users");
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

  if (state === "editing_photo") {
    return ctx.reply(messages[lang].profileEditHintPhoto, cancelEditKeyboard(lang));
  }

  if (state === "editing_age") {
    return ctx.reply(messages[lang].profileEditHintAge, ageKeyboard(lang));
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
  const age = Number.isFinite(user?.age) ? String(user.age) : "—";

  if (lang === "fa") {
    return [
      `🌸 ${messages[lang].profileTitle}`,
      `━━━━━━━━━━━━━━`,
      `👤 نام: ${displayName}`,
      `🏙 شهر: ${city}`,
      `🎂 سن: ${age}`,
    ].join("\n");
  }

  return [
    `👤 ${messages[lang].profileTitle}`,
    `━━━━━━━━━━━━━━`,
    `👤 ${messages[lang].profileName}: ${displayName}`,
    `🏙 ${messages[lang].profileCity}: ${city}`,
    `🎂 ${messages[lang].profileAge}: ${age}`,
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
