const { callBacks } = require("../constants");
const { MODES } = require("../services/reply-keyboard-navigation");
const { isAiCallback } = require("./ai-callbacks");
const { clearAiPendingInputPrompt } = require("./ai-input-prompts");
const { isAiTextState } = require("./ai-text");
const {
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
  shouldKeepAiListTitleForCallback,
} = require("./ai-cards");
const { isProfileSettingsOrEditCallback } = require("./profile-callbacks");
const { isProfileFavoritesCallback } = require("./profile-favorites");
const { isSavedProfilesCallback } = require("./saved-profiles");
const {
  clearDiscussionMenuNotice,
  isDiscussionCreateFlowCallback,
  isDiscussionListCallback,
  shouldKeepDiscussionRoomCardsForCallback,
} = require("./discussions-callbacks");
const { isDiscussionInvitationCallback } = require("./discussion-invitations");
const { trackOnboardingCompletionDestination } = require("./onboarding");

async function editCallbackMessageOrReply(ctx, text, keyboard) {
  if (ctx.callbackMessageId && ctx.editMessageText) {
    const edited = await ctx.editMessageText(ctx.callbackMessageId, text, keyboard);
    if (edited) return edited;
  }
  return ctx.reply(text, keyboard);
}

async function removeCallbackInlineKeyboardIfPossible(ctx) {
  if (!ctx.callbackMessageId || !ctx.editMessageReplyMarkup) return false;
  return ctx.editMessageReplyMarkup(ctx.callbackMessageId, { inline_keyboard: [] });
}

async function deleteCallbackMessageIfPossible(ctx) {
  // Reply-keyboard actions are user messages, never disposable bot callback cards.
  if (ctx.isReplyKeyboardAction || !ctx.callbackMessageId) return false;
  if (ctx.deleteMessage && await ctx.deleteMessage(ctx.callbackMessageId)) return true;
  return removeCallbackInlineKeyboardIfPossible(ctx);
}

async function retireCallbackMessageIfPossible(ctx) {
  if (!ctx.callbackMessageId) return false;
  return deleteCallbackMessageIfPossible(ctx);
}

function isProfileCallbackMessage(ctx) {
  const message = ctx.callbackMessage || {};
  return Boolean(message.caption || message.photo || message.document);
}

function hasTemporaryReplyKeyboard(ctx) {
  const state = String(ctx.user?.state || "");
  return Boolean(isAiTextState(state) || state === "editing_location" || ctx.user?.activeDiscussionId);
}

function isOwnProfileNavigationMode(mode = "") {
  const normalized = String(mode || "");
  if (!normalized) return true;
  if ([MODES.PROFILE, MODES.PROFILE_SETTINGS, MODES.PROFILE_PRIVACY].includes(normalized)) return true;
  return /^profile_(?:age(?:_range:\d+)?|gender|pet|emoji|interests:\d+|invitation_restrictions:\d+:\d+)$/.test(normalized);
}

function isProfileCallbackActiveInMode(ctx, data = "") {
  if (!isProfileSettingsOrEditCallback(data)) return true;
  const mode = String(ctx.user?.navigationMode || "");
  if (
    mode.startsWith("public_profile:restrictions:")
    && (
      data === callBacks.profileInvitationRestrictions
      || data.startsWith(callBacks.profileInvitationAllow)
    )
  ) {
    return true;
  }
  if (data === callBacks.profileStars || data === callBacks.profileStarsBack) {
    return true;
  }
  return isOwnProfileNavigationMode(mode);
}

function isGuideOverlayCallback(data = "") {
  return [
    callBacks.help,
    callBacks.helpRules,
    callBacks.helpCardClose,
    callBacks.helpReferral,
    callBacks.helpReferralBack,
    callBacks.profileStars,
    callBacks.profileStarsBack,
  ].includes(data);
}

async function retireInactiveOwnProfileCardIfNeeded(ctx, data = "") {
  if (ctx.isReplyKeyboardAction || isProfileCallbackActiveInMode(ctx, data)) return false;
  await ctx.answerCb?.();
  await retireCallbackMessageIfPossible(ctx);
  return true;
}

function positiveMessageId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getLatestRememberedMessageId(ctx, fields = []) {
  return fields
    .map((field) => positiveMessageId(ctx.user?.[field]))
    .filter(Boolean)
    .reduce((latest, id) => Math.max(latest, id), 0);
}

function isCurrentRememberedMessage(ctx, messageId, fields = []) {
  return fields.some((field) => positiveMessageId(ctx.user?.[field]) === messageId);
}

function getStaleCallbackFields(data = "") {
  if (isAiCallback(data)) {
    return ["aiActionMessageId", "aiLastListMessageId", "aiSectionEntryMessageId"];
  }
  if (
    isSavedProfilesCallback(data)
    || isProfileFavoritesCallback(data)
    || data.startsWith(callBacks.profileSaveByCode)
    || data.startsWith(callBacks.profileUnsaveByCode)
  ) {
    return [
      "savedProfilesLastListMessageId",
      "peopleLastListMessageId",
      "publicProfileLastMessageId",
      "discussionLastListMessageId",
    ];
  }
  if (
    isDiscussionListCallback(data)
    || isDiscussionCreateFlowCallback(data)
    || isDiscussionInvitationCallback(data)
    || data === callBacks.discussions
    || data.startsWith(callBacks.discussionOpen)
    || data.startsWith(callBacks.discussionInviteJoin)
    || data.startsWith(callBacks.discussionInviteSwitchJoin)
    || data.startsWith(callBacks.discussionInviteCancel)
    || data.startsWith(callBacks.discussionLeave)
    || data.startsWith(callBacks.discussionClose)
    || data.startsWith(callBacks.discussionMembers)
    || data.startsWith(callBacks.discussionRemoveMemberConfirm)
    || data === callBacks.discussionRemoveMemberCancel
  ) {
    return [
      "discussionLastListMessageId",
      "discussionMenuNoticeMessageId",
      "discussionLastMembersMessageId",
    ];
  }
  if (
    data === callBacks.profile
    || isProfileSettingsOrEditCallback(data)
    || data.startsWith(callBacks.profileViewByCode)
    || data === callBacks.profileCloseDiscussionMember
  ) {
    return ["publicProfileLastMessageId"];
  }
  return [];
}

function isHistorySafeListCallback(data = "") {
  return isDiscussionListCallback(data)
    || data === callBacks.discussionInvitations
    || data.startsWith(callBacks.discussionInvitationsPage)
    || data.startsWith(callBacks.discussionInvitationPreview)
    || data.startsWith(callBacks.discussionInvitationPreviewAccept)
    || data.startsWith(callBacks.discussionInvitationSwitchJoin)
    || data.startsWith(callBacks.discussionInvitationPreviewProfile)
    || data.startsWith(callBacks.discussionInvitationPreviewRemove)
    || data === callBacks.peopleDiscover
    || data.startsWith(callBacks.peopleDiscoverPage)
    || data.startsWith(callBacks.peopleTasteMatchesPage)
    || data === callBacks.savedProfiles
    || data.startsWith(callBacks.savedProfilesPage)
    || data.startsWith(callBacks.discussionOpen)
    || data.startsWith(callBacks.discussionInviteJoin)
    || data.startsWith(callBacks.discussionInviteSwitchJoin)
    || data.startsWith(callBacks.aiTasteConfirm)
    || data.startsWith(callBacks.aiTasteSkip)
    || data.startsWith(callBacks.aiTasteReview)
    || data.startsWith(callBacks.aiTasteChoose);
}

async function retireStaleCallbackCardIfNeeded(ctx, data = "") {
  const callbackMessageId = positiveMessageId(ctx.callbackMessageId);
  if (!callbackMessageId) return false;
  const fields = getStaleCallbackFields(data);
  if (!fields.length || isCurrentRememberedMessage(ctx, callbackMessageId, fields)) return false;
  if (getLatestRememberedMessageId(ctx, fields) <= callbackMessageId) return false;
  if (isHistorySafeListCallback(data)) return false;
  await ctx.answerCb?.();
  await retireCallbackMessageIfPossible(ctx);
  return true;
}

async function retireObsoleteCallbackIfNeeded(ctx, data = "") {
  if (await retireInactiveOwnProfileCardIfNeeded(ctx, data)) return true;
  return !ctx.isReplyKeyboardAction && retireStaleCallbackCardIfNeeded(ctx, data);
}

async function prepareCallbackDispatch(ctx, data = "") {
  if (isGuideOverlayCallback(data)) return;
  const isProfileReplyAction = Boolean(
    ctx.isReplyKeyboardAction && isProfileSettingsOrEditCallback(data),
  );
  if (!isProfileReplyAction && !isAiCallback(data)) await clearAiPendingInputPrompt(ctx);
  trackOnboardingCompletionDestination(ctx, data);

  const keepAiCards = shouldKeepAiListTitleForCallback(data, isAiCallback);
  if (!isProfileReplyAction && !keepAiCards) {
    await clearRememberedAiListMessage(ctx);
    await clearAiSectionEntryMessage(ctx, [ctx.callbackMessageId]);
  }

  const keepDiscussionCards = shouldKeepDiscussionRoomCardsForCallback(data);
  if (!isProfileReplyAction && !keepDiscussionCards) {
    await clearDiscussionMenuNotice(ctx, [ctx.callbackMessageId]);
  }
}

module.exports = {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
  getStaleCallbackFields,
  hasTemporaryReplyKeyboard,
  isHistorySafeListCallback,
  isOwnProfileNavigationMode,
  isProfileCallbackMessage,
  prepareCallbackDispatch,
  retireCallbackMessageIfPossible,
  retireObsoleteCallbackIfNeeded,
  retireStaleCallbackCardIfNeeded,
};
