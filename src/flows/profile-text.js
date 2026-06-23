const messages = require("../messages");
const {
  ageKeyboard,
  cancelEditKeyboard,
  genderKeyboard,
  locationKeyboard,
  petPreferenceKeyboard,
} = require("../keyboards");
const {
  updateLocationCityForSharedAt,
  updateProfileField,
  updateUserFields,
  updateUserState,
} = require("../services/users");
const {
  clearBottomKeyboardQuietly,
} = require("../services/bot-navigation");
const { resolveCityByCoordinates } = require("../services/location");
const {
  isValidTextInput,
  saveLocationProfile,
  toPlainUser,
  validateProfileName,
} = require("../services/profile");
const {
  clearProfileEditPrompt,
  sendProfileEditPrompt,
} = require("./profile-edit");
const { awardProfileCompletionMilestone } = require("../services/star-milestones");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
} = require("../services/stars-ui");

async function buildProfileMilestoneNotice(ctx, updatedUser, lang) {
  const milestone = await awardProfileCompletionMilestone(ctx.userId, updatedUser);
  applyStarRewardsToContext(ctx, milestone.rewards);
  if (ctx.user) updatedUser.starBalance = ctx.user.starBalance;
  return buildStarRewardNotice(messages, lang, milestone.rewards);
}

async function sendProfileAfterMilestone(ctx, updatedUser, lang, keyboardLang, sendProfile) {
  const footerText = await buildProfileMilestoneNotice(ctx, updatedUser, lang);
  return sendProfile(ctx, updatedUser, lang, keyboardLang, { footerText });
}
const {
  getProfileNameErrorMessage,
} = require("./discussion-name-gate");
const {
  sendPublicProfileByCode,
} = require("./saved-profiles");

const FIELD_LIMITS = {
  profileName: 30,
  city: 30,
  bio: 120,
};

function isProfileTextState(state = "") {
  return [
    "editing_name",
    "editing_city",
    "editing_photo",
    "editing_location",
    "editing_age",
    "editing_gender",
    "editing_pet_preference",
    "editing_bio",
  ].includes(state);
}

async function handleProfileCancelText(ctx, lang, state, { sendProfile, keyboardLang }) {
  if (!isProfileTextState(state)) return false;

  await updateUserState(ctx.userId, "idle");
  const updatedUser = toPlainUser(ctx.user);
  updatedUser.state = "idle";
  if (state === "editing_location") {
    await clearBottomKeyboardQuietly(ctx);
  }
  return sendProfile(ctx, updatedUser, lang, keyboardLang);
}

async function handleProfileText(ctx, lang, text, state, { sendProfile, keyboardLang }) {
  if (state === "editing_name" && text) {
    if (text.startsWith("/")) {
      return sendProfileEditPrompt(ctx, messages[lang].profileEditHintName, cancelEditKeyboard(lang));
    }

    const validation = validateProfileName(text, FIELD_LIMITS.profileName);
    if (!validation.ok) {
      const errorText = getProfileNameErrorMessage(lang, validation.reason);
      return sendProfileEditPrompt(
        ctx,
        `${errorText}\n${messages[lang].profileEditHintName}`,
        cancelEditKeyboard(lang),
      );
    }

    const confirmedAt = new Date();
    await updateUserFields(ctx.userId, {
      profileName: validation.value,
      profileNameConfirmedAt: confirmedAt,
    });
    await updateUserState(ctx.userId, "idle");
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.profileName = validation.value;
    updatedUser.profileNameConfirmedAt = confirmedAt;
    updatedUser.state = "idle";

    const pendingCode = updatedUser.pendingProfileViewCode;
    if (pendingCode) {
      await updateProfileField(ctx.userId, "pendingProfileViewCode", "");
      const starNotice = await buildProfileMilestoneNotice(ctx, updatedUser, lang);
      if (starNotice) await ctx.reply(starNotice);
      return sendPublicProfileByCode(ctx, lang, pendingCode);
    }

    return sendProfileAfterMilestone(ctx, updatedUser, lang, keyboardLang, sendProfile);
  }

  if (state === "editing_city" && text) {
    if (text.startsWith("/")) {
      return sendProfileEditPrompt(ctx, messages[lang].profileEditHintCity, cancelEditKeyboard(lang));
    }

    if (!isValidTextInput(text, FIELD_LIMITS.city)) {
      return sendProfileEditPrompt(
        ctx,
        `${messages[lang].profileCityTooLong}\n${messages[lang].profileEditHintCity}`,
        cancelEditKeyboard(lang),
      );
    }

    await updateProfileField(ctx.userId, "city", text);
    await updateUserState(ctx.userId, "idle");
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.city = text;
    updatedUser.state = "idle";
    return sendProfileAfterMilestone(ctx, updatedUser, lang, keyboardLang, sendProfile);
  }

  if (state === "editing_photo" && ctx.message?.photo?.length) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await updateProfileField(ctx.userId, "photoFileId", photo.file_id);
    await updateUserState(ctx.userId, "idle");
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = photo.file_id;
    updatedUser.state = "idle";
    return sendProfileAfterMilestone(ctx, updatedUser, lang, keyboardLang, sendProfile);
  }

  if (state === "editing_photo" && ctx.message?.document?.file_id) {
    await updateProfileField(ctx.userId, "photoFileId", ctx.message.document.file_id);
    await updateUserState(ctx.userId, "idle");
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = ctx.message.document.file_id;
    updatedUser.state = "idle";
    return sendProfileAfterMilestone(ctx, updatedUser, lang, keyboardLang, sendProfile);
  }

  if (state === "editing_location" && ctx.message?.location) {
    const location = await saveLocationProfile({
      userId: ctx.userId,
      locationMessage: ctx.message.location,
      updateProfileField,
      updateLocationCityForSharedAt,
      updateUserState,
      resolveCityByCoordinates,
    });

    await ctx.reply(messages[lang].profileUpdated, {
      reply_markup: { remove_keyboard: true },
    });
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.location = location;
    updatedUser.state = "idle";
    return sendProfileAfterMilestone(ctx, updatedUser, lang, keyboardLang, sendProfile);
  }

  if (state === "editing_photo") {
    return sendProfileEditPrompt(ctx, messages[lang].profileEditHintPhoto, cancelEditKeyboard(lang));
  }

  if (state === "editing_age") {
    return sendProfileEditPrompt(ctx, messages[lang].profileEditHintAge, ageKeyboard(lang));
  }

  if (state === "editing_gender") {
    return sendProfileEditPrompt(ctx, messages[lang].profileEditHintGender, genderKeyboard(lang));
  }

  if (state === "editing_pet_preference") {
    return sendProfileEditPrompt(ctx, messages[lang].profileEditHintPetPreference, petPreferenceKeyboard(lang));
  }

  if (state === "editing_location") {
    if (text === messages[lang].cancelEdit) {
      await updateUserState(ctx.userId, "idle");
      await clearProfileEditPrompt(ctx);
      await clearBottomKeyboardQuietly(ctx);
      const updatedUser = toPlainUser(ctx.user);
      updatedUser.state = "idle";
      return sendProfile(ctx, updatedUser, lang, keyboardLang);
    }

    return sendProfileEditPrompt(ctx, messages[lang].profileEditHintLocation, locationKeyboard(lang));
  }

  if (state === "editing_bio" && text) {
    if (text.startsWith("/")) {
      return sendProfileEditPrompt(ctx, messages[lang].profileEditHintBio, cancelEditKeyboard(lang));
    }

    if (!isValidTextInput(text, FIELD_LIMITS.bio)) {
      return sendProfileEditPrompt(
        ctx,
        `${messages[lang].profileBioTooLong}\n${messages[lang].profileEditHintBio}`,
        cancelEditKeyboard(lang),
      );
    }

    await updateProfileField(ctx.userId, "bio", text);
    await updateUserState(ctx.userId, "idle");
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.bio = text;
    updatedUser.state = "idle";
    return sendProfileAfterMilestone(ctx, updatedUser, lang, keyboardLang, sendProfile);
  }

  return false;
}

async function resetProfilePhotoCommand(ctx, lang, { sendProfile, keyboardLang }) {
  await updateProfileField(ctx.userId, "photoFileId", null);
  await updateUserState(ctx.userId, "idle");
  const updatedUser = toPlainUser(ctx.user);
  updatedUser.photoFileId = null;
  updatedUser.state = "idle";
  return sendProfile(ctx, updatedUser, lang, keyboardLang);
}

module.exports = {
  handleProfileCancelText,
  handleProfileText,
  isProfileTextState,
  resetProfilePhotoCommand,
};
