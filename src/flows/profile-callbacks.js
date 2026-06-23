const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  profileKeyboard,
  helpKeyboard,
  mainMenuKeyboard,
  profileSettingsKeyboard,
  profileActiveDiscussionHelpKeyboard,
  profileStarsKeyboard,
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
  applyStarRewardsToContext,
  buildStarRewardNotice,
  buildStarsOverviewText,
} = require("../services/stars-ui");
const {
  awardProfileCompletionMilestone,
  claimExistingProfileAndListMilestones,
} = require("../services/star-milestones");
const {
  clearProfileEditPrompt,
  sendProfileEditPrompt,
  startProfileEdit,
} = require("./profile-edit");
const {
  handleDiscussionNameCancel,
  isDiscussionNameState,
} = require("./discussion-name-gate");
const {
  sendPublicProfileByCode,
} = require("./saved-profiles");

function isProfileSettingsOrEditCallback(data = "") {
  return data === callBacks.profileEditName ||
    data === callBacks.profileSettings ||
    data === callBacks.profileSettingsBack ||
    data === callBacks.profileStars ||
    data === callBacks.profileStarsBack ||
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
    loadingText: options.loading ? messages[lang].profileLoading : "",
    isOwnProfile: true,
    footerText: options.footerText || "",
  });
}

async function sendOwnProfileSettings(ctx, lang, user = ctx.user) {
  return sendProfileMessage({
    ctx,
    user,
    lang,
    keyboard: profileSettingsKeyboard(
      lang,
      Boolean(user?.showActiveDiscussionOnProfile),
    ),
    messages,
    isOwnProfile: true,
  });
}

async function beginProfileEdit(ctx, state, prompt, keyboard, { retireCallbackMessageIfPossible } = {}) {
  return startProfileEdit(ctx, state, prompt, keyboard, {
    deleteCurrentMessage: () => retireCallbackMessageIfPossible?.(ctx),
  });
}

async function handleProfileEditCompletion(ctx, lang, updatedUser) {
  const milestone = await awardProfileCompletionMilestone(ctx.userId, updatedUser);
  applyStarRewardsToContext(ctx, milestone.rewards);
  if (ctx.user) updatedUser.starBalance = ctx.user.starBalance;
  const starNotice = buildStarRewardNotice(messages, lang, milestone.rewards);
  // Check if user was trying to view another profile
  const pendingCode = updatedUser.pendingProfileViewCode;
  if (pendingCode) {
    await updateProfileField(ctx.userId, "pendingProfileViewCode", "");
    if (starNotice) await ctx.reply(starNotice);
    return sendPublicProfileByCode(ctx, lang, pendingCode);
  }
  // Otherwise show their own profile
  return sendOwnProfile(ctx, lang, updatedUser, { footerText: starNotice });
}

async function handleProfileSettingsOrEditCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  leaveDiscussionAndClearKeyboardForNavigation,
  removeBottomKeyboard,
  renderActiveDiscussionList,
  renderInvitationsList,
  retireCallbackMessageIfPossible,
  showDiscussionInvitePreviewCommand,
} = {}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.profileEditName) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_name", messages[lang].profileAskName, cancelEditKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileSettings) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendOwnProfileSettings(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileSettingsBack) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendOwnProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileStars) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    const claimedRewards = await claimExistingProfileAndListMilestones(ctx.user || {});
    applyStarRewardsToContext(ctx, claimedRewards);
    const rewardNotice = buildStarRewardNotice(messages, lang, claimedRewards);
    return ctx.reply(
      [rewardNotice, buildStarsOverviewText(messages, lang, ctx.user || {})].filter(Boolean).join("\n\n"),
      profileStarsKeyboard(lang),
    );
  }

  if (data === callBacks.profileStarsBack) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return ctx.reply(messages[lang].helpText, helpKeyboard(lang));
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
    return sendOwnProfileSettings(ctx, lang, updatedUser);
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
    return handleProfileEditCompletion(ctx, lang, updatedUser);
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
    return handleProfileEditCompletion(ctx, lang, updatedUser);
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
    return handleProfileEditCompletion(ctx, lang, updatedUser);
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
    return handleProfileEditCompletion(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileCancelEdit) {
    await ctx.answerCb?.();
    if (isDiscussionNameState(ctx.user?.state)) {
      return handleDiscussionNameCancel(ctx, lang, {
        renderActiveDiscussionList,
        renderInvitationsList,
        showDiscussionInvitePreviewCommand,
      });
    }
    await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateUserState(ctx.userId, "idle");
    await removeBottomKeyboard?.(ctx, " ");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    return handleProfileEditCompletion(ctx, lang, updatedUser);
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
