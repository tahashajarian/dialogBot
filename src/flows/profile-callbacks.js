const messages = require("../messages");
const { restoreGuideHubCard } = require("./guide-hub");
const crypto = require("crypto");
const { callBacks } = require("../constants");
const {
  profileKeyboard,
  mainMenuKeyboard,
  profileQuickActionsKeyboard,
  profileEmojiKeyboard,
  profileEmojiConfirmKeyboard,
  profileEmojiInsufficientKeyboard,
  profileActiveDiscussionHelpKeyboard,
  profileStarsKeyboard,
  profileInterestsKeyboard,
  getInterestTopTenChipTitle,
  ageKeyboard,
  ageRangeKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  cancelEditKeyboard,
  accountDeleteWarningKeyboard,
  accountDeleteConfirmKeyboard,
  startAgainKeyboard,
} = require("../keyboards");
const { deleteAccount } = require("../services/account-deletion");
const { MODES, setNavigationMode, setStableNavigationState } = require("../services/reply-keyboard-navigation");
const { starEconomy } = require("../services/star-settings");
const {
  addAiListItem,
  getAiListItemsFromUser,
  removeAiListItem,
  updateProfileField,
  updateUserState,
} = require("../services/users");
const {
  sendProfileMessage,
  buildProfileText,
  hasValidLocation,
  toPlainUser,
} = require("../services/profile");
const { hasShareableMediaFavorites } = require("../services/profile-sharing");
const {
  isValidProfileAge,
  isValidProfileAgeRangeStart,
} = require("../services/profile-age");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
  buildStarsOverviewText,
  formatStarNumber,
} = require("../services/stars-ui");
const { sendNavigationFootprint } = require("../services/navigation-footprints");
const { isKnownProfileNavigationLabel } = require("../services/reply-keyboard-navigation");
const {
  awardProfileCompletionMilestone,
  claimExistingProfileAndListMilestones,
} = require("../services/star-milestones");
const {
  clearProfileEditPrompt,
  rememberProfileEditPrompt,
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
const { operationalLimits } = require("../services/operational-limits");
const { localizeInterestChipTitle } = require("../services/interest-chips");
const {
  getProfileEmojiCost,
  getProfileEmojiOption,
  getProfileEmojiSelectionCost,
  isProfileEmojiAvailable,
  isProfileEmojiUnlocked,
  setProfileEmojiWithStars,
} = require("../services/profile-emoji");
const {
  handleProfilePrivacyCallback,
  isProfilePrivacyCallback,
  sendProfilePrivacySafety,
  sendProfilePrivacyStatus,
} = require("./profile-privacy");
const {
  createShareableProfileCard,
  returnFromShareableProfile,
} = require("./profile-sharing");

function formatProfileInterestMessage(lang, key) {
  return messages[lang][key]
    .replace("{limit}", String(operationalLimits.profileInterestItems))
    .replace("{maxLength}", String(operationalLimits.profileInterestCustomMaxLength));
}

function getProfileInterestItems(user) {
  return getAiListItemsFromUser(user, "random", "topTen");
}

function parseInterestCallbackPayload(data = "", prefix = "") {
  const [indexValue, pageValue] = String(data).replace(prefix, "").split(":");
  const index = Number(indexValue);
  const page = Number(pageValue);
  return {
    index: Number.isInteger(index) && index >= 0 ? index : -1,
    page: Number.isInteger(page) && page >= 0 ? page : 0,
  };
}

async function showProfileInterestsEditor(ctx, lang, user = ctx.user, page = 0, { notice = "" } = {}) {
  let items = getProfileInterestItems(user);
  const accidental = items.find((entry) => isKnownProfileNavigationLabel(entry?.title));
  if (accidental?.title) {
    const cleaned = await removeAiListItem(ctx.userId, "random", "topTen", accidental.title);
    if (cleaned.ok || Array.isArray(cleaned.items)) {
      items = cleaned.items || [];
      if (user?.aiLists?.random) user.aiLists.random.topTen = items;
    }
  }
  const prompt = messages[lang].profileInterestsEditPrompt
    .replace("{count}", String(items.length))
    .replace("{limit}", String(operationalLimits.profileInterestItems));
  const selected = items.length
    ? `${messages[lang].profileInterestsSelectedTitle}\n${items.map((entry) => `• ${localizeInterestChipTitle(entry.title, lang)}`).join("\n")}`
    : "";
  const text = [messages[lang].profileInterestsTitle, notice, prompt, selected].filter(Boolean).join("\n\n");
  const keyboard = profileInterestsKeyboard(lang, items, page);
  await setNavigationMode(ctx, `profile_interests:${Number(page) || 0}`);
  if (ctx.callbackMessageId && (ctx.editMessageText || ctx.editMessageCaption)) {
    const edited = await editProfileSurfaceCard(ctx, text, keyboard);
    if (edited) {
      await rememberProfileEditPrompt(ctx, edited === true ? ctx.callbackMessageId : edited);
      return edited;
    }
  }
  const sent = await ctx.reply(text, keyboard);
  await rememberProfileEditPrompt(ctx, sent);
  return sent;
}

function isProfileSettingsOrEditCallback(data = "") {
  return isProfilePrivacyCallback(data) ||
    data === callBacks.accountDelete ||
    data === callBacks.accountDeleteContinue ||
    data === callBacks.accountDeleteCancel ||
    data.startsWith(callBacks.accountDeleteConfirm) ||
    data === callBacks.profileEditName ||
    data === callBacks.profileSettings ||
    data === callBacks.profileSettingsBack ||
    data === callBacks.profileEmoji ||
    data.startsWith(callBacks.profileEmojiPage) ||
    data.startsWith(callBacks.profileEmojiChoose) ||
    data.startsWith(callBacks.profileEmojiConfirm) ||
    data === callBacks.profileEmojiCancel ||
    data === callBacks.profileEmojiClose ||
    data === callBacks.profileEmojiInsufficientDone ||
    data === callBacks.profileStars ||
    data === callBacks.profileStarsBack ||
    data === callBacks.profileShare ||
    data === callBacks.profileShareBack ||
    data === callBacks.profileActiveDiscussionHelp ||
    data === callBacks.profileActiveDiscussionHelpDone ||
    data === callBacks.profileToggleActiveDiscussionVisible ||
    data === callBacks.profileEditCity ||
    data === callBacks.profileEditAge ||
    data === callBacks.profileEditGender ||
    data === callBacks.profileEditPetPreference ||
    data === callBacks.profileEditBio ||
    data === callBacks.profileEditInterests ||
    data.startsWith(callBacks.profileInterestChip) ||
    data.startsWith(callBacks.profileInterestRemove) ||
    data.startsWith(callBacks.profileInterestMore) ||
    data === callBacks.profileInterestsDone ||
    data === callBacks.profilePickerClose ||
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

function formatProfileEmojiText(lang, key, values = {}) {
  return messages[lang][key]
    .replace("{emoji}", values.emoji || "")
    .replace("{cost}", formatStarNumber(values.cost ?? getProfileEmojiCost(), lang))
    .replace("{balance}", formatStarNumber(values.balance ?? 0, lang));
}

function getProfileEmojiPickerText(lang, user = {}) {
  const unlocked = isProfileEmojiUnlocked(user);
  return formatProfileEmojiText(
    lang,
    unlocked ? "profileEmojiPickerUnlockedText" : "profileEmojiPickerText",
    { cost: getProfileEmojiSelectionCost(user), balance: user?.starBalance || 0 },
  );
}

function parseProfileEmojiState(state = "") {
  const [, index, cost, nonce] = String(state || "").match(/^profile_emoji_confirm:(\d+):(\d+):([a-z0-9]+)$/) || [];
  if (!nonce) return null;
  return { index: Number(index), cost: Number(cost), nonce };
}

async function sendOwnProfile(ctx, lang, user = ctx.user, options = {}) {
  await setStableNavigationState(ctx, MODES.PROFILE);
  await sendNavigationFootprint(ctx, { lang, destination: "profile" });
  await ctx.reply(messages[lang].profileEditMenuText, profileKeyboard(
    lang,
    Boolean(user?.photoFileId),
  ));
  const sentProfile = await sendProfileMessage({
    ctx,
    user,
    lang,
    keyboard: profileQuickActionsKeyboard(lang, {
      canShareProfile: hasShareableMediaFavorites(user),
      user,
    }),
    messages,
    loadingText: options.loading ? messages[lang].profileLoading : "",
    isOwnProfile: true,
    footerText: options.footerText || "",
  });
  return sentProfile;
}

async function editProfileSurfaceCard(ctx, text, keyboard) {
  const messageId = Number(ctx.callbackMessageId || ctx.user?.profileEditPromptMessageId);
  if (Number.isInteger(messageId) && messageId > 0) {
    const isMedia = Boolean(
      ctx.callbackMessage?.photo
      || ctx.callbackMessage?.document
      || ctx.callbackMessage?.caption
      || (!ctx.callbackMessage && ctx.user?.photoFileId),
    );
    const edited = isMedia && ctx.editMessageCaption
      ? await ctx.editMessageCaption(messageId, text, keyboard)
      : ctx.editMessageText
        ? await ctx.editMessageText(messageId, text, keyboard)
        : false;
    if (edited) return edited;
  }
  return ctx.reply(text, keyboard);
}

async function restoreOwnProfileCard(ctx, lang, user = ctx.user, { footerText = "" } = {}) {
  const surfaceMessageId = Number(ctx.callbackMessageId || ctx.user?.profileEditPromptMessageId);
  const text = [
    buildProfileText(user, lang, messages, { isOwnProfile: true }),
    String(footerText || "").trim(),
  ].filter(Boolean).join("\n\n");
  const restored = await editProfileSurfaceCard(ctx, text, profileQuickActionsKeyboard(lang, {
    canShareProfile: hasShareableMediaFavorites(user),
    user,
  }));
  await clearProfileEditPrompt(ctx, [surfaceMessageId]);
  await setNavigationMode(ctx, MODES.PROFILE);
  return restored;
}

async function beginProfileEdit(ctx, state, prompt, keyboard, { retireCallbackMessageIfPossible } = {}) {
  return startProfileEdit(ctx, state, prompt, keyboard, {
    deleteCurrentMessage: () => retireCallbackMessageIfPossible?.(ctx),
  });
}

async function beginInlineProfilePicker(ctx, state, mode, prompt, keyboard, options = {}) {
  await updateUserState(ctx.userId, state);
  if (ctx.user) ctx.user.state = state;
  await setNavigationMode(ctx, mode);
  if (!ctx.isReplyKeyboardAction && ctx.callbackMessageId) {
    const edited = await editProfileSurfaceCard(ctx, prompt, keyboard);
    if (edited) await rememberProfileEditPrompt(ctx, ctx.callbackMessageId);
    return edited;
  }
  return beginProfileEdit(ctx, state, prompt, keyboard, options);
}

async function handleProfileEditCompletion(ctx, lang, updatedUser, { restoreCard = false } = {}) {
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
  if (restoreCard) return restoreOwnProfileCard(ctx, lang, updatedUser, { footerText: starNotice });
  return sendOwnProfile(ctx, lang, updatedUser, { footerText: starNotice });
}

async function handleProfileSettingsOrEditCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
  leaveDiscussionAndClearKeyboardForNavigation,
  renderActiveDiscussionList,
  renderMyDiscussionList,
  renderSavedProfileDiscussions,
  renderInvitationsList,
  retireCallbackMessageIfPossible,
  showDiscussionInvitePreviewCommand,
} = {}) {
  const data = ctx.callbackData || "";

  if (isProfilePrivacyCallback(data)) {
    return handleProfilePrivacyCallback(ctx, lang, {
      editCallbackMessageOrReply,
      editProfileSurfaceCard,
      restoreOwnProfileCard,
    });
  }

  const isProfileEmojiFlowCallback = data === callBacks.profileEmoji ||
    data.startsWith(callBacks.profileEmojiPage) ||
    data.startsWith(callBacks.profileEmojiChoose) ||
    data.startsWith(callBacks.profileEmojiConfirm) ||
    data === callBacks.profileEmojiCancel ||
    data === callBacks.profileEmojiClose ||
    data === callBacks.profileEmojiInsufficientDone;
  if (ctx.user?.state === "editing_profile_emoji" && !isProfileEmojiFlowCallback) {
    await updateUserState(ctx.userId, "idle");
    ctx.user.state = "idle";
  }

  if (!data.startsWith("account:delete") && String(ctx.user?.state || "").startsWith("account_delete_")) {
    await updateUserState(ctx.userId, "idle");
    if (ctx.user) ctx.user.state = "idle";
  }

  if (data === callBacks.accountDelete) {
    await ctx.answerCb?.();
    const warningState = `account_delete_warning:${Date.now()}`;
    await updateUserState(ctx.userId, warningState);
    if (ctx.user) ctx.user.state = warningState;
    return editProfileSurfaceCard(ctx, messages[lang].accountDeleteWarning, accountDeleteWarningKeyboard(lang));
  }

  if (data === callBacks.accountDeleteContinue) {
    if (!String(ctx.user?.state || "").startsWith("account_delete_warning:")) {
      await ctx.answerCb?.(messages[lang].accountDeleteExpired);
      return false;
    }
    const nonce = crypto.randomBytes(9).toString("base64url");
    const expiresAt = Date.now() + 5 * 60 * 1000;
    await updateUserState(ctx.userId, `account_delete_confirm:${nonce}:${expiresAt}`);
    if (ctx.user) ctx.user.state = `account_delete_confirm:${nonce}:${expiresAt}`;
    await ctx.answerCb?.();
    return editProfileSurfaceCard(ctx, messages[lang].accountDeleteFinalWarning, accountDeleteConfirmKeyboard(lang, nonce));
  }

  if (data === callBacks.accountDeleteCancel) {
    await ctx.answerCb?.();
    const pending = String(ctx.user?.state || "").startsWith("account_delete_");
    if (pending) await updateUserState(ctx.userId, "idle");
    if (ctx.user) ctx.user.state = "idle";
    return sendProfilePrivacySafety(ctx, lang, ctx.user || {}, {
      editCallbackMessageOrReply: editProfileSurfaceCard,
    });
  }

  if (data.startsWith(callBacks.accountDeleteConfirm)) {
    const nonce = data.slice(callBacks.accountDeleteConfirm.length);
    const match = String(ctx.user?.state || "").match(/^account_delete_confirm:([^:]+):(\d+)$/);
    if (!match || match[1] !== nonce || Number(match[2]) < Date.now()) {
      await ctx.answerCb?.(messages[lang].accountDeleteExpired);
      return false;
    }
    await updateUserState(ctx.userId, `account_delete_running:${nonce}`);
    if (ctx.user) ctx.user.state = `account_delete_running:${nonce}`;
    await ctx.answerCb?.();
    const result = await deleteAccount({ userId: ctx.userId });
    if (!result.ok) return ctx.reply(messages[lang].accountDeleteFailed);
    await retireCallbackMessageIfPossible?.(ctx);
    return ctx.reply(messages[lang].accountDeleteSuccess, startAgainKeyboard(lang));
  }

  if (data === callBacks.profileEditName) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_name", messages[lang].profileAskName, cancelEditKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileSettings) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendOwnProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileSettingsBack) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendOwnProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileEmoji) {
    if (!isProfileEmojiAvailable(ctx.user)) {
      await ctx.answerCb?.(messages[lang].profileEmojiUnavailable);
      return restoreOwnProfileCard(ctx, lang, ctx.user || {});
    }
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_profile_emoji");
    if (ctx.user) ctx.user.state = "editing_profile_emoji";
    await setNavigationMode(ctx, "profile_emoji");
    const edited = await editProfileSurfaceCard(
      ctx,
      getProfileEmojiPickerText(lang, ctx.user),
      profileEmojiKeyboard(lang, ctx.user?.profileEmoji || ""),
    );
    if (edited && ctx.callbackMessageId) await rememberProfileEditPrompt(ctx, ctx.callbackMessageId);
    return edited;
  }

  if (data === callBacks.profileEmojiClose) {
    if (ctx.user?.state !== "editing_profile_emoji") {
      await ctx.answerCb?.();
      return false;
    }
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    if (ctx.user) ctx.user.state = "idle";
    return restoreOwnProfileCard(ctx, lang, ctx.user || {});
  }

  if (data.startsWith(callBacks.profileEmojiPage)) {
    if (ctx.user?.state !== "editing_profile_emoji") {
      await ctx.answerCb?.();
      return false;
    }
    await ctx.answerCb?.();
    const page = Number(data.replace(callBacks.profileEmojiPage, ""));
    const text = getProfileEmojiPickerText(lang, ctx.user);
    return editProfileSurfaceCard(ctx, text, profileEmojiKeyboard(lang, ctx.user?.profileEmoji || "", page));
  }

  if (data.startsWith(callBacks.profileEmojiChoose)) {
    if (ctx.user?.state !== "editing_profile_emoji") {
      await ctx.answerCb?.();
      return false;
    }
    await ctx.answerCb?.();
    const index = Number(data.replace(callBacks.profileEmojiChoose, ""));
    const emoji = getProfileEmojiOption(index);
    if (!emoji) return ctx.reply(messages[lang].unknownAction);
    const nonce = Date.now().toString(36);
    const cost = getProfileEmojiSelectionCost(ctx.user);
    await updateUserState(ctx.userId, `profile_emoji_confirm:${index}:${cost}:${nonce}`);
    if (ctx.user) ctx.user.state = `profile_emoji_confirm:${index}:${cost}:${nonce}`;
    const text = formatProfileEmojiText(lang, cost > 0 ? "profileEmojiConfirmText" : "profileEmojiConfirmUnlockedText", {
      emoji,
      cost,
      balance: ctx.user?.starBalance || 0,
    });
    return editProfileSurfaceCard(ctx, text, profileEmojiConfirmKeyboard(lang, nonce, cost));
  }

  if (data.startsWith(callBacks.profileEmojiConfirm)) {
    const nonce = data.replace(callBacks.profileEmojiConfirm, "");
    const pending = parseProfileEmojiState(ctx.user?.state);
    if (!pending || pending.nonce !== nonce || pending.cost !== getProfileEmojiSelectionCost(ctx.user)) {
      await ctx.answerCb?.(messages[lang].profileEmojiStale);
      return ctx.reply(messages[lang].profileEmojiStale);
    }
    const emoji = getProfileEmojiOption(pending.index);
    if (!emoji) return ctx.reply(messages[lang].unknownAction);
    const result = await setProfileEmojiWithStars({ userId: ctx.userId, emoji, nonce });
    if (!result.ok) {
      if (result.reason === "insufficient_balance") {
        await ctx.answerCb?.();
        await updateUserState(ctx.userId, "editing_profile_emoji");
        if (ctx.user) ctx.user.state = "editing_profile_emoji";
        return editProfileSurfaceCard(
          ctx,
          formatProfileEmojiText(lang, "profileEmojiInsufficient", result),
          profileEmojiInsufficientKeyboard(lang),
        );
      }
      await ctx.answerCb?.();
      await updateUserState(ctx.userId, "idle");
      if (ctx.user) ctx.user.state = "idle";
      return restoreOwnProfileCard(ctx, lang, ctx.user || {}, {
        footerText: messages[lang].profileEmojiUnavailable,
      });
    }
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    if (ctx.user) {
      ctx.user.profileEmoji = emoji;
      ctx.user.profileEmojiUnlockedAt = ctx.user.profileEmojiUnlockedAt || new Date();
      ctx.user.starBalance = Number(result.balance) || 0;
      ctx.user.state = "idle";
    }
    return restoreOwnProfileCard(ctx, lang, ctx.user || {}, {
      footerText: formatProfileEmojiText(
        lang,
        result.cost > 0 ? "profileEmojiUnlocked" : "profileEmojiSaved",
        result,
      ),
    });
  }

  if (data === callBacks.profileEmojiCancel) {
    if (!parseProfileEmojiState(ctx.user?.state)) {
      await ctx.answerCb?.();
      return false;
    }
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_profile_emoji");
    if (ctx.user) ctx.user.state = "editing_profile_emoji";
    return editProfileSurfaceCard(
      ctx,
      getProfileEmojiPickerText(lang, ctx.user),
      profileEmojiKeyboard(lang, ctx.user?.profileEmoji || ""),
    );
  }

  if (data === callBacks.profileEmojiInsufficientDone) {
    if (ctx.user?.state !== "editing_profile_emoji") {
      await ctx.answerCb?.();
      return false;
    }
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    if (ctx.user) ctx.user.state = "idle";
    return restoreOwnProfileCard(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileStars) {
    await ctx.answerCb?.();
    const claimedRewards = await claimExistingProfileAndListMilestones(ctx.user || {});
    applyStarRewardsToContext(ctx, claimedRewards);
    const rewardNotice = buildStarRewardNotice(messages, lang, claimedRewards);
    const text = [rewardNotice, buildStarsOverviewText(messages, lang, ctx.user || {})].filter(Boolean).join("\n\n");
    return editProfileSurfaceCard(ctx, text, profileStarsKeyboard(lang));
  }

  if (data === callBacks.profileStarsBack) {
    await ctx.answerCb?.();
    return restoreGuideHubCard(ctx, lang);
  }

  if (data === callBacks.profileShare) {
    await ctx.answerCb?.();
    return createShareableProfileCard(ctx, lang);
  }

  if (data === callBacks.profileShareBack) {
    await ctx.answerCb?.();
    return returnFromShareableProfile(ctx, lang, { sendOwnProfile });
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
    const acknowledgedAt = new Date();
    await updateProfileField(ctx.userId, "activeDiscussionHelpAcknowledgedAt", acknowledgedAt);
    if (ctx.user) ctx.user.activeDiscussionHelpAcknowledgedAt = acknowledgedAt;
    return deleteCallbackMessageIfPossible?.(ctx);
  }

  if (data === callBacks.profileToggleActiveDiscussionVisible) {
    const nextValue = ctx.user?.showActiveDiscussionOnProfile === false;
    await ctx.answerCb?.();
    const persistedUser = await updateProfileField(ctx.userId, "showActiveDiscussionOnProfile", nextValue);
    if (ctx.user) ctx.user.showActiveDiscussionOnProfile = nextValue;
    const updatedUser = toPlainUser(persistedUser || ctx.user);
    updatedUser.showActiveDiscussionOnProfile = nextValue;
    return sendProfilePrivacyStatus(
      ctx,
      lang,
      updatedUser,
      nextValue
        ? messages[lang].profileActiveDiscussionVisibleOn
        : messages[lang].profileActiveDiscussionVisibleOff,
      { editCallbackMessageOrReply: editProfileSurfaceCard },
    );
  }

  if (data === callBacks.profileEditCity) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_city", messages[lang].profileAskCity, cancelEditKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditAge) {
    await ctx.answerCb?.();
    return beginInlineProfilePicker(ctx, "editing_age", "profile_age", messages[lang].profileAskAge, ageKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditGender) {
    await ctx.answerCb?.();
    return beginInlineProfilePicker(ctx, "editing_gender", "profile_gender", messages[lang].profileAskGender, genderKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditPetPreference) {
    await ctx.answerCb?.();
    if (!starEconomy.profilePetPreferenceEnabled) {
      return restoreOwnProfileCard(ctx, lang, ctx.user || {});
    }
    return beginInlineProfilePicker(ctx, "editing_pet_preference", "profile_pet", messages[lang].profileAskPetPreference, petPreferenceKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditBio) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_bio", messages[lang].profileAskBio, cancelEditKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditInterests) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_interests");
    if (ctx.user) ctx.user.state = "editing_interests";
    return showProfileInterestsEditor(ctx, lang, ctx.user || {});
  }

  if (data.startsWith(callBacks.profileInterestMore)) {
    await ctx.answerCb?.();
    if (ctx.user?.state !== "editing_interests") return ctx.reply(messages[lang].unknownAction);
    const page = Number(data.replace(callBacks.profileInterestMore, "")) || 0;
    return showProfileInterestsEditor(ctx, lang, ctx.user || {}, page);
  }

  if (data.startsWith(callBacks.profileInterestRemove)) {
    await ctx.answerCb?.();
    if (ctx.user?.state !== "editing_interests") return ctx.reply(messages[lang].unknownAction);
    const { index, page } = parseInterestCallbackPayload(data, callBacks.profileInterestRemove);
    const items = getProfileInterestItems(ctx.user);
    const item = items[index]?.title;
    if (!item) return ctx.reply(messages[lang].unknownAction);
    const result = await removeAiListItem(ctx.userId, "random", "topTen", item);
    if (ctx.user?.aiLists?.random) ctx.user.aiLists.random.topTen = result.items || [];
    return showProfileInterestsEditor(ctx, lang, ctx.user || {}, page, {
      notice: messages[lang].profileInterestRemovedNamed.replace("{item}", localizeInterestChipTitle(item, lang)),
    });
  }

  if (data.startsWith(callBacks.profileInterestChip)) {
    if (ctx.user?.state !== "editing_interests") return ctx.reply(messages[lang].unknownAction);
    const { index: chipIndex, page } = parseInterestCallbackPayload(data, callBacks.profileInterestChip);
    const item = getInterestTopTenChipTitle(chipIndex, lang);
    if (!item) return ctx.reply(messages[lang].unknownAction);
    if (getProfileInterestItems(ctx.user).length >= operationalLimits.profileInterestItems) {
      const limitText = formatProfileInterestMessage(lang, "profileInterestsLimitReached");
      if (!ctx.isReplyKeyboardAction) return ctx.answerCb?.(limitText, { show_alert: true });
      return showProfileInterestsEditor(ctx, lang, ctx.user || {}, page, { notice: limitText });
    }
    // Stop Telegram's button spinner before the database mutation. The loaded
    // profile check above preserves the normal limit alert without delaying taps.
    await ctx.answerCb?.();
    const result = await addAiListItem(ctx.userId, "random", "topTen", { title: item, comment: "" }, operationalLimits.profileInterestItems);
    if (!result.ok && result.reason === "limit") {
      return showProfileInterestsEditor(ctx, lang, ctx.user || {}, page, {
        notice: formatProfileInterestMessage(lang, "profileInterestsLimitReached"),
      });
    }
    if (!result.ok && result.reason !== "exists") return ctx.reply(formatProfileInterestMessage(lang, "profileInterestsInvalid"));
    if (ctx.user) {
      if (!ctx.user.aiLists) ctx.user.aiLists = {};
      if (!ctx.user.aiLists.random) ctx.user.aiLists.random = {};
      ctx.user.aiLists.random.topTen = result.items || getProfileInterestItems(ctx.user);
    }
    return showProfileInterestsEditor(ctx, lang, ctx.user || {}, page, {
      notice: messages[lang].profileInterestAddedNamed.replace("{item}", localizeInterestChipTitle(item, lang)),
    });
  }

  if (data === callBacks.profileInterestsDone) {
    await ctx.answerCb?.();
    const restoresProfileCard = !ctx.isReplyKeyboardAction && Boolean(ctx.callbackMessageId);
    if (!restoresProfileCard) await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    return handleProfileEditCompletion(ctx, lang, updatedUser, { restoreCard: restoresProfileCard });
  }

  if (data === callBacks.profilePickerClose) {
    await ctx.answerCb?.();
    const restoresProfileCard = ["editing_age", "editing_gender", "editing_pet_preference", "editing_interests"]
      .includes(ctx.user?.state) && !ctx.isReplyKeyboardAction;
    if (!restoresProfileCard) await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateUserState(ctx.userId, "idle");
    if (ctx.user) ctx.user.state = "idle";
    await setNavigationMode(ctx, MODES.PROFILE);
    if (restoresProfileCard) return restoreOwnProfileCard(ctx, lang, ctx.user || {});
    return true;
  }

  if (data === callBacks.profileEditLocation) {
    await ctx.answerCb?.();
    if (!starEconomy.profileLocationEnabled && !starEconomy.nearbyPeopleEnabled && !starEconomy.localDiscussionsEnabled) {
      await retireCallbackMessageIfPossible?.(ctx);
      return sendOwnProfile(ctx, lang, ctx.user || {});
    }
    return beginProfileEdit(
      ctx,
      "editing_location",
      hasValidLocation(ctx.user?.location)
        ? messages[lang].profileAskLocationExisting
        : messages[lang].profileAskLocation,
      locationKeyboard(lang, { canRemove: hasValidLocation(ctx.user?.location) }),
      { retireCallbackMessageIfPossible },
    );
  }

  if (data.startsWith(callBacks.profileGenderSet)) {
    if (ctx.user?.state !== "editing_gender") {
      await ctx.answerCb?.();
      return false;
    }
    const gender = data.replace(callBacks.profileGenderSet, "");
    const allowedGenders = new Set(["female", "male", "other"]);

    await ctx.answerCb?.();

    if (!allowedGenders.has(gender)) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "gender", gender);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.gender = gender;
    updatedUser.state = "idle";
    return handleProfileEditCompletion(ctx, lang, updatedUser, { restoreCard: !ctx.isReplyKeyboardAction });
  }

  if (data.startsWith(callBacks.profilePetSet)) {
    if (ctx.user?.state !== "editing_pet_preference") {
      await ctx.answerCb?.();
      return false;
    }
    if (!starEconomy.profilePetPreferenceEnabled) {
      await ctx.answerCb?.();
      await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
      await updateUserState(ctx.userId, "idle");
      if (ctx.user) ctx.user.state = "idle";
      return restoreOwnProfileCard(ctx, lang, ctx.user || {});
    }
    const petPreference = data.replace(callBacks.profilePetSet, "");
    const allowedPetPreferences = new Set(["any", "none", "cat", "dog", "bird", "small_pets"]);

    await ctx.answerCb?.();

    if (!allowedPetPreferences.has(petPreference)) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "petPreference", petPreference);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.petPreference = petPreference;
    updatedUser.state = "idle";
    return handleProfileEditCompletion(ctx, lang, updatedUser, { restoreCard: !ctx.isReplyKeyboardAction });
  }

  if (data.startsWith(callBacks.profileAgeRangeSet)) {
    if (ctx.user?.state !== "editing_age") {
      await ctx.answerCb?.();
      return false;
    }
    const startAge = Number(data.replace(callBacks.profileAgeRangeSet, ""));

    await ctx.answerCb?.();

    if (!isValidProfileAgeRangeStart(startAge)) {
      return ctx.reply(messages[lang].unknownAction);
    }
    await setNavigationMode(ctx, `profile_age_range:${startAge}`);

    if (!ctx.isReplyKeyboardAction && ctx.callbackMessageId) {
      return editProfileSurfaceCard(ctx, messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge));
    }
    return sendProfileEditPrompt(ctx, messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge));
  }

  if (data === callBacks.profileAgeRangeBack) {
    if (ctx.user?.state !== "editing_age") {
      await ctx.answerCb?.();
      return false;
    }
    await ctx.answerCb?.();
    await setNavigationMode(ctx, "profile_age");
    if (!ctx.isReplyKeyboardAction && ctx.callbackMessageId) {
      return editProfileSurfaceCard(ctx, messages[lang].profileAskAge, ageKeyboard(lang));
    }
    return sendProfileEditPrompt(ctx, messages[lang].profileAskAge, ageKeyboard(lang));
  }

  if (data.startsWith(callBacks.profileAgeSet)) {
    if (ctx.user?.state !== "editing_age") {
      await ctx.answerCb?.();
      return false;
    }
    const age = Number(data.replace(callBacks.profileAgeSet, ""));

    await ctx.answerCb?.();

    if (!isValidProfileAge(age)) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "age", age);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.age = age;
    updatedUser.state = "idle";
    return handleProfileEditCompletion(ctx, lang, updatedUser, { restoreCard: !ctx.isReplyKeyboardAction });
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
        renderMyDiscussionList,
        renderSavedProfileDiscussions,
        renderInvitationsList,
        showDiscussionInvitePreviewCommand,
      });
    }
    const rememberedPickerId = Number(ctx.user?.profileEditPromptMessageId);
    await retireCallbackMessageIfPossible?.(ctx);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    if (ctx.isReplyKeyboardAction && Number.isInteger(rememberedPickerId) && rememberedPickerId > 0) {
      if (ctx.user) ctx.user.state = "idle";
      return restoreOwnProfileCard(ctx, lang, updatedUser);
    }
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    return handleProfileEditCompletion(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileBack) {
    await ctx.answerCb?.();
    await leaveDiscussionAndClearKeyboardForNavigation?.(ctx);
    await updateUserState(ctx.userId, "idle");
    await deleteCallbackMessageIfPossible?.(ctx);
    await sendNavigationFootprint(ctx, { lang, destination: "menu" });
    await setNavigationMode(ctx, MODES.GLOBAL);
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  return false;
}

module.exports = {
  handleProfileSettingsOrEditCallback,
  isProfileSettingsOrEditCallback,
  sendOwnProfile,
};
