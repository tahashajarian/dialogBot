const path = require("path");
const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  profileKeyboard,
  mainMenuKeyboard,
  profileSettingsKeyboard,
  profileActiveDiscussionHelpKeyboard,
  ageKeyboard,
  ageRangeKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  cancelEditKeyboard,
} = require("../keyboards");
const {
  updateProfileField,
  updateUserState,
} = require("../services/users");
const {
  sendProfileMessage,
  toPlainUser,
} = require("../services/profile");
const {
  clearProfileEditPrompt,
  sendProfileEditPrompt,
  startProfileEdit,
} = require("./profile-edit");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "..", "assets", "default_profile.png");

function isProfileSettingsOrEditCallback(data = "") {
  return data === callBacks.profileEditName ||
    data === callBacks.profileSettings ||
    data === callBacks.profileSettingsBack ||
    data === callBacks.profileActiveDiscussionHelp ||
    data === callBacks.profileActiveDiscussionHelpDone ||
    data === callBacks.profileToggleActiveDiscussionVisible ||
    data === callBacks.profileEditCity ||
    data === callBacks.profileEditAge ||
    data === callBacks.profileEditGender ||
    data === callBacks.profileEditPetPreference ||
    data === callBacks.profileEditBio ||
    data === callBacks.profileEditLocation ||
    data.startsWith(callBacks.profileGenderSet) ||
    data.startsWith(callBacks.profilePetSet) ||
    data.startsWith(callBacks.profileAgeRangeSet) ||
    data === callBacks.profileAgeRangeBack ||
    data.startsWith(callBacks.profileAgeSet) ||
    data === callBacks.profileEditPhoto ||
    data === callBacks.profileResetPhoto ||
    data === callBacks.profileCancelEdit ||
    data === callBacks.profileBack;
}

async function sendOwnProfile(ctx, lang, user = ctx.user, options = {}) {
  return sendProfileMessage({
    ctx,
    user,
    lang,
    keyboard: profileKeyboard(
      lang,
      Boolean(user?.photoFileId),
    ),
    messages,
    defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
    loadingText: options.loading ? messages[lang].profileLoading : "",
    isOwnProfile: true,
  });
}

async function beginProfileEdit(ctx, state, prompt, keyboard, { retireCallbackMessageIfPossible } = {}) {
  return startProfileEdit(ctx, state, prompt, keyboard, {
    deleteCurrentMessage: () => retireCallbackMessageIfPossible?.(ctx),
  });
}

async function handleProfileSettingsOrEditCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  leaveDiscussionAndClearKeyboardForNavigation,
  removeBottomKeyboard,
  retireCallbackMessageIfPossible,
} = {}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.profileEditName) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_name", messages[lang].profileAskName, cancelEditKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileSettings) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return ctx.reply(
      messages[lang].profileSettingsTitle,
      profileSettingsKeyboard(lang, Boolean(ctx.user?.showActiveDiscussionOnProfile)),
    );
  }

  if (data === callBacks.profileSettingsBack) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendOwnProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileActiveDiscussionHelp) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return ctx.reply(
      messages[lang].profileActiveDiscussionHelpText,
      profileActiveDiscussionHelpKeyboard(lang),
    );
  }

  if (data === callBacks.profileActiveDiscussionHelpDone) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendOwnProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileToggleActiveDiscussionVisible) {
    const nextValue = !ctx.user?.showActiveDiscussionOnProfile;
    await ctx.answerCb?.(
      nextValue
        ? messages[lang].profileActiveDiscussionVisibleOn
        : messages[lang].profileActiveDiscussionVisibleOff,
    );
    await retireCallbackMessageIfPossible?.(ctx);
    await updateProfileField(ctx.userId, "showActiveDiscussionOnProfile", nextValue);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.showActiveDiscussionOnProfile = nextValue;
    return ctx.reply(messages[lang].profileSettingsTitle, profileSettingsKeyboard(lang, nextValue));
  }

  if (data === callBacks.profileEditCity) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_city", messages[lang].profileAskCity, cancelEditKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditAge) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_age", messages[lang].profileAskAge, ageKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditGender) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_gender", messages[lang].profileAskGender, genderKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditPetPreference) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_pet_preference", messages[lang].profileAskPetPreference, petPreferenceKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditBio) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_bio", messages[lang].profileAskBio, cancelEditKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditLocation) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_location", messages[lang].profileAskLocation, locationKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data.startsWith(callBacks.profileGenderSet)) {
    const gender = data.replace(callBacks.profileGenderSet, "");
    const allowedGenders = new Set(["female", "male", "other"]);

    await ctx.answerCb?.();

    if (!allowedGenders.has(gender)) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "gender", gender);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.gender = gender;
    updatedUser.state = "idle";
    return sendOwnProfile(ctx, lang, updatedUser);
  }

  if (data.startsWith(callBacks.profilePetSet)) {
    const petPreference = data.replace(callBacks.profilePetSet, "");
    const allowedPetPreferences = new Set(["any", "none", "cat", "dog", "bird", "small_pets"]);

    await ctx.answerCb?.();

    if (!allowedPetPreferences.has(petPreference)) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "petPreference", petPreference);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.petPreference = petPreference;
    updatedUser.state = "idle";
    return sendOwnProfile(ctx, lang, updatedUser);
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

    const edited = ctx.callbackMessageId && ctx.editMessageText
      ? await ctx.editMessageText(ctx.callbackMessageId, messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge))
      : false;
    if (edited) return edited;
    return sendProfileEditPrompt(ctx, messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge));
  }

  if (data === callBacks.profileAgeRangeBack) {
    await ctx.answerCb?.();
    const edited = ctx.callbackMessageId && ctx.editMessageText
      ? await ctx.editMessageText(ctx.callbackMessageId, messages[lang].profileAskAge, ageKeyboard(lang))
      : false;
    if (edited) return edited;
    return sendProfileEditPrompt(ctx, messages[lang].profileAskAge, ageKeyboard(lang));
  }

  if (data.startsWith(callBacks.profileAgeSet)) {
    const age = Number(data.replace(callBacks.profileAgeSet, ""));

    await ctx.answerCb?.();

    if (!Number.isInteger(age) || age < 10 || age > 79) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "age", age);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.age = age;
    updatedUser.state = "idle";
    return sendOwnProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileEditPhoto) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_photo", messages[lang].profileAskPhoto, cancelEditKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileResetPhoto) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "photoFileId", null);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = null;
    updatedUser.state = "idle";
    return sendOwnProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileCancelEdit) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateUserState(ctx.userId, "idle");
    await removeBottomKeyboard?.(ctx, " ");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    return sendOwnProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileBack) {
    await ctx.answerCb?.();
    await leaveDiscussionAndClearKeyboardForNavigation?.(ctx);
    await updateUserState(ctx.userId, "idle");
    await deleteCallbackMessageIfPossible?.(ctx);
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  return false;
}

module.exports = {
  handleProfileSettingsOrEditCallback,
  isProfileSettingsOrEditCallback,
  sendOwnProfile,
};
