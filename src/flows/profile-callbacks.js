const messages = require("../messages");
const crypto = require("crypto");
const { callBacks } = require("../constants");
const {
  profileKeyboard,
  helpKeyboard,
  mainMenuKeyboard,
  profileSettingsKeyboard,
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
const { MODES, setNavigationMode } = require("../services/reply-keyboard-navigation");
const {
  addAiListItem,
  getAiListItemsFromUser,
  removeAiListItem,
  updateProfileField,
  updateUserState,
} = require("../services/users");
const {
  buildProfileText,
  sendProfileMessage,
  toPlainUser,
} = require("../services/profile");
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
  setProfileEmojiWithStars,
} = require("../services/profile-emoji");

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
  if (ctx.callbackMessageId && ctx.editMessageText) {
    const edited = await ctx.editMessageText(ctx.callbackMessageId, text, keyboard);
    if (edited) return edited;
  }
  return ctx.reply(text, keyboard);
}

function isProfileSettingsOrEditCallback(data = "") {
  return data === callBacks.accountDelete ||
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

function parseProfileEmojiState(state = "") {
  const [, index, cost, nonce] = String(state || "").match(/^profile_emoji_confirm:(\d+):(\d+):([a-z0-9]+)$/) || [];
  if (!nonce) return null;
  return { index: Number(index), cost: Number(cost), nonce };
}

async function sendOwnProfile(ctx, lang, user = ctx.user, options = {}) {
  await sendNavigationFootprint(ctx, { lang, destination: "profile" });
  const sentProfile = await sendProfileMessage({
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
  await setNavigationMode(ctx, MODES.PROFILE);
  return sentProfile;
}

async function sendOwnProfileSettings(ctx, lang, user = ctx.user) {
  await sendNavigationFootprint(ctx, { lang, destination: "settings" });
  const settingsCard = await sendProfileMessage({
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
  await setNavigationMode(ctx, MODES.PROFILE_SETTINGS);
  return settingsCard;
}

async function beginProfileEdit(ctx, state, prompt, keyboard, { retireCallbackMessageIfPossible } = {}) {
  return startProfileEdit(ctx, state, prompt, keyboard, {
    deleteCurrentMessage: () => retireCallbackMessageIfPossible?.(ctx),
  });
}

async function handleProfileEditCompletion(ctx, lang, updatedUser, { returnToSettings = false } = {}) {
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
  if (returnToSettings) {
    if (starNotice) await ctx.reply(starNotice);
    return sendOwnProfileSettings(ctx, lang, updatedUser);
  }
  return sendOwnProfile(ctx, lang, updatedUser, { footerText: starNotice });
}

async function handleProfileSettingsOrEditCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  leaveDiscussionAndClearKeyboardForNavigation,
  renderActiveDiscussionList,
  renderMyDiscussionList,
  renderSavedProfileDiscussions,
  renderInvitationsList,
  retireCallbackMessageIfPossible,
  showDiscussionInvitePreviewCommand,
} = {}) {
  const data = ctx.callbackData || "";

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
    const edited = ctx.callbackMessageId && ctx.editMessageText
      ? await ctx.editMessageText(ctx.callbackMessageId, messages[lang].accountDeleteWarning, accountDeleteWarningKeyboard(lang)) : false;
    return edited || ctx.reply(messages[lang].accountDeleteWarning, accountDeleteWarningKeyboard(lang));
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
    const edited = ctx.callbackMessageId && ctx.editMessageText
      ? await ctx.editMessageText(ctx.callbackMessageId, messages[lang].accountDeleteFinalWarning, accountDeleteConfirmKeyboard(lang, nonce)) : false;
    return edited || ctx.reply(messages[lang].accountDeleteFinalWarning, accountDeleteConfirmKeyboard(lang, nonce));
  }

  if (data === callBacks.accountDeleteCancel) {
    await ctx.answerCb?.();
    const pending = String(ctx.user?.state || "").startsWith("account_delete_");
    if (pending) await updateUserState(ctx.userId, "idle");
    if (ctx.user) ctx.user.state = "idle";
    await retireCallbackMessageIfPossible?.(ctx);
    return sendOwnProfileSettings(ctx, lang, ctx.user || {});
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
    return sendOwnProfileSettings(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileSettingsBack) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendOwnProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileEmoji) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_profile_emoji");
    if (ctx.user) ctx.user.state = "editing_profile_emoji";
    await retireCallbackMessageIfPossible?.(ctx);
    return ctx.reply(
      formatProfileEmojiText(lang, "profileEmojiPickerText", {
        cost: getProfileEmojiCost(),
        balance: ctx.user?.starBalance || 0,
      }),
      profileEmojiKeyboard(lang, ctx.user?.profileEmoji || ""),
    );
  }

  if (data === callBacks.profileEmojiClose) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    if (ctx.user) ctx.user.state = "idle";
    return deleteCallbackMessageIfPossible?.(ctx);
  }

  if (data.startsWith(callBacks.profileEmojiPage)) {
    await ctx.answerCb?.();
    const page = Number(data.replace(callBacks.profileEmojiPage, ""));
    const text = formatProfileEmojiText(lang, "profileEmojiPickerText", {
      cost: getProfileEmojiCost(),
      balance: ctx.user?.starBalance || 0,
    });
    if (ctx.callbackMessageId && ctx.editMessageText) {
      const edited = await ctx.editMessageText(
        ctx.callbackMessageId,
        text,
        profileEmojiKeyboard(lang, ctx.user?.profileEmoji || "", page),
      );
      if (edited) return edited;
    }
    return ctx.reply(text, profileEmojiKeyboard(lang, ctx.user?.profileEmoji || "", page));
  }

  if (data.startsWith(callBacks.profileEmojiChoose)) {
    await ctx.answerCb?.();
    const index = Number(data.replace(callBacks.profileEmojiChoose, ""));
    const emoji = getProfileEmojiOption(index);
    if (!emoji) return ctx.reply(messages[lang].unknownAction);
    const nonce = Date.now().toString(36);
    const cost = getProfileEmojiCost();
    await updateUserState(ctx.userId, `profile_emoji_confirm:${index}:${cost}:${nonce}`);
    if (ctx.user) ctx.user.state = `profile_emoji_confirm:${index}:${cost}:${nonce}`;
    const text = formatProfileEmojiText(lang, "profileEmojiConfirmText", {
      emoji,
      cost,
      balance: ctx.user?.starBalance || 0,
    });
    if (ctx.callbackMessageId && ctx.editMessageText) {
      const edited = await ctx.editMessageText(
        ctx.callbackMessageId,
        text,
        profileEmojiConfirmKeyboard(lang, nonce, cost),
      );
      if (edited) return edited;
    }
    return ctx.reply(text, profileEmojiConfirmKeyboard(lang, nonce, cost));
  }

  if (data.startsWith(callBacks.profileEmojiConfirm)) {
    const nonce = data.replace(callBacks.profileEmojiConfirm, "");
    const pending = parseProfileEmojiState(ctx.user?.state);
    if (!pending || pending.nonce !== nonce || pending.cost !== getProfileEmojiCost()) {
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
        await retireCallbackMessageIfPossible?.(ctx);
        return ctx.reply(
          formatProfileEmojiText(lang, "profileEmojiInsufficient", result),
          profileEmojiInsufficientKeyboard(lang),
        );
      }
      await ctx.answerCb?.();
      return ctx.reply(messages[lang].profileEmojiUnavailable, profileEmojiKeyboard(lang, ctx.user?.profileEmoji || ""));
    }
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    if (ctx.user) {
      ctx.user.profileEmoji = emoji;
      ctx.user.starBalance = Number(result.balance) || 0;
      ctx.user.state = "idle";
    }
    await retireCallbackMessageIfPossible?.(ctx);
    await ctx.reply(formatProfileEmojiText(lang, "profileEmojiSaved", result));
    return sendOwnProfileSettings(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileEmojiCancel) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_profile_emoji");
    if (ctx.user) ctx.user.state = "editing_profile_emoji";
    await retireCallbackMessageIfPossible?.(ctx);
    return ctx.reply(
      formatProfileEmojiText(lang, "profileEmojiPickerText", {
        cost: getProfileEmojiCost(),
        balance: ctx.user?.starBalance || 0,
      }),
      profileEmojiKeyboard(lang, ctx.user?.profileEmoji || ""),
    );
  }

  if (data === callBacks.profileEmojiInsufficientDone) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    if (ctx.user) ctx.user.state = "idle";
    return deleteCallbackMessageIfPossible?.(ctx);
  }

  if (data === callBacks.profileStars) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    const claimedRewards = await claimExistingProfileAndListMilestones(ctx.user || {});
    applyStarRewardsToContext(ctx, claimedRewards);
    const rewardNotice = buildStarRewardNotice(messages, lang, claimedRewards);
    await setNavigationMode(ctx, "help_stars");
    return ctx.reply(
      [rewardNotice, buildStarsOverviewText(messages, lang, ctx.user || {})].filter(Boolean).join("\n\n"),
      profileStarsKeyboard(lang),
    );
  }

  if (data === callBacks.profileStarsBack) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    await setNavigationMode(ctx, MODES.HELP);
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
    const acknowledgedAt = new Date();
    await updateProfileField(ctx.userId, "activeDiscussionHelpAcknowledgedAt", acknowledgedAt);
    if (ctx.user) ctx.user.activeDiscussionHelpAcknowledgedAt = acknowledgedAt;
    return deleteCallbackMessageIfPossible?.(ctx);
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
    await setNavigationMode(ctx, "profile_age");
    return beginProfileEdit(ctx, "editing_age", messages[lang].profileAskAge, ageKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditGender) {
    await ctx.answerCb?.();
    await setNavigationMode(ctx, "profile_gender");
    return beginProfileEdit(ctx, "editing_gender", messages[lang].profileAskGender, genderKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditPetPreference) {
    await ctx.answerCb?.();
    await setNavigationMode(ctx, "profile_pet");
    return beginProfileEdit(ctx, "editing_pet_preference", messages[lang].profileAskPetPreference, petPreferenceKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditBio) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_bio", messages[lang].profileAskBio, cancelEditKeyboard(lang), { retireCallbackMessageIfPossible });
  }

  if (data === callBacks.profileEditInterests) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "editing_interests");
    await retireCallbackMessageIfPossible?.(ctx);
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
    await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    return handleProfileEditCompletion(ctx, lang, updatedUser);
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
    return handleProfileEditCompletion(ctx, lang, updatedUser, { returnToSettings: true });
  }

  if (data.startsWith(callBacks.profileAgeRangeSet)) {
    const startAge = Number(data.replace(callBacks.profileAgeRangeSet, ""));

    await ctx.answerCb?.();

    if (!isValidProfileAgeRangeStart(startAge)) {
      return ctx.reply(messages[lang].unknownAction);
    }
    await setNavigationMode(ctx, `profile_age_range:${startAge}`);

    const edited = ctx.callbackMessageId && ctx.editMessageText
      ? await ctx.editMessageText(ctx.callbackMessageId, messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge))
      : false;
    if (edited) return edited;
    return sendProfileEditPrompt(ctx, messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge));
  }

  if (data === callBacks.profileAgeRangeBack) {
    await ctx.answerCb?.();
    await setNavigationMode(ctx, "profile_age");
    const edited = ctx.callbackMessageId && ctx.editMessageText
      ? await ctx.editMessageText(ctx.callbackMessageId, messages[lang].profileAskAge, ageKeyboard(lang))
      : false;
    if (edited) return edited;
    return sendProfileEditPrompt(ctx, messages[lang].profileAskAge, ageKeyboard(lang));
  }

  if (data.startsWith(callBacks.profileAgeSet)) {
    const age = Number(data.replace(callBacks.profileAgeSet, ""));

    await ctx.answerCb?.();

    if (!isValidProfileAge(age)) {
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
        renderMyDiscussionList,
        renderSavedProfileDiscussions,
        renderInvitationsList,
        showDiscussionInvitePreviewCommand,
      });
    }
    await retireCallbackMessageIfPossible?.(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
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
