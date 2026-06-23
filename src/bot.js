const messages = require("./messages");
const { detectLanguage } = require("./lang");
const { handleCallback } = require("./callbacks");
const {
  mainMenuKeyboard,
  languageKeyboard,
  onboardingLanguageKeyboard,
  aiAssistantKeyboard,
  discussionsMenuKeyboard,
  profileKeyboard,
  cancelEditKeyboard,
  profileActiveDiscussionHelpKeyboard,
} = require("./keyboards");
const {
  updateProfileField,
  resetDiscussionDraft,
  updateUserFields,
  updateUserState,
} = require("./services/users");
const {
  removeBottomKeyboard,
  clearBottomKeyboardQuietly,
  replyWithRemovedKeyboardThenInline,
  leaveDiscussionAndClearKeyboardForNavigation,
} = require("./services/bot-navigation");
const {
  sendProfileMessage,
  validateProfileName,
  toPlainUser,
  ACTIVE_DISCUSSION_HELP_COMMAND,
} = require("./services/profile");
const {
  getAiSectionFromState,
  clearAiSectionPin,
} = require("./services/ai-section");
const {
  normalizePublicProfileCode,
} = require("./services/discussions");
const {
  isDiscussionBottomControlText,
  handleDiscussionBottomButton,
  clearDiscussionMenuNotice,
  closeDiscussionFromTextConfirmation,
  openDiscussionCommand,
  showDiscussionInvitePreviewCommand,
  joinDiscussionFromInvite,
  leaveDiscussionCommand,
  closeDiscussionCommand,
  removeDiscussionMemberCommand,
  reportDiscussionMemberCommand,
  sendDiscussionRoomFromText,
} = require("./flows/discussions-text");
const {
  acceptInvitationCommand,
  normalizeProfileCodeFromInviteCommand,
  removeInvitationCommand,
  renderInvitationsList,
  showDiscussionPickerForSavedProfile,
} = require("./flows/discussion-invitations");
const {
  clearDiscussionMembersMessage,
  clearDiscussionListMessage,
  renderActiveDiscussionList,
} = require("./flows/discussions-callbacks");
const {
  isDiscussionCreateTextState,
  handleDiscussionCreateText,
} = require("./flows/discussions-create-text");
const {
  clearAiPendingInputPrompt,
} = require("./flows/ai-input-prompts");
const {
  handleAiText,
  isAiTextState,
} = require("./flows/ai-text");
const {
  clearRememberedAiListMessage,
} = require("./flows/ai-cards");
const {
  clearProfileEditPrompt,
  sendProfileEditPrompt,
} = require("./flows/profile-edit");
const {
  DISCUSSION_PROFILE_NAME_MAX_LENGTH,
  getProfileNameErrorMessage,
  handleDiscussionNameCancel,
  isDiscussionNameState,
  parseDiscussionNameState,
} = require("./flows/discussion-name-gate");
const {
  clearSavedProfilesListMessage,
  clearSavedProfileSurfaceMessages,
  clearViewedPublicProfileMessage,
  renderSavedProfileDiscussions,
  saveProfileCommand,
  sendPublicProfileByCode,
  unsaveProfileCommand,
} = require("./flows/saved-profiles");
const {
  handleOnboardingText,
  shouldOfferOnboarding,
  startOnboardingLanguage,
} = require("./flows/onboarding");
const {
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  handleDiscussionMessage,
  isUnsupportedDiscussionMessage,
  replyToUnsupportedDiscussionMessage,
  sendDiscussionMessageToRecipient,
} = require("./flows/discussion-messages");
const {
  handleProfileCancelText,
  handleProfileText,
  resetProfilePhotoCommand,
} = require("./flows/profile-text");
const { EVENT_NAMES, trackEvent } = require("./services/analytics-events");
const { claimReferral } = require("./services/star-referrals");

const START_INVITE_HISTORY_LIMIT = 20;
function normalizeKeyboardText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\uFE0F/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

function matchesMessageText(text, keys) {
  const normalizedText = normalizeKeyboardText(text);
  return keys
    .flatMap((key) => [messages.fa[key], messages.en[key]])
    .map(normalizeKeyboardText)
    .includes(normalizedText);
}

function parseDiscussionCloseConfirmState(state = "") {
  if (!state.startsWith("discussion_close_confirm")) return {};
  const [, discussionId = "", messageIdRaw = "", source = "room"] = state.split(":");
  const messageId = Number(messageIdRaw);
  return {
    discussionId,
    messageId: Number.isInteger(messageId) && messageId > 0 ? messageId : null,
    source: source === "list" ? "list" : "room",
  };
}

function getStartInviteCode(text = "") {
  const value = String(text || "").trim();
  const match = value.match(/^\/start(?:@\w+)?(?:\s+|[?=])(?:join_|d_)([a-z0-9]+)$/i);
  return match ? `d_${match[1].toUpperCase()}` : "";
}

function getStartReferralCode(text = "") {
  const value = String(text || "").trim();
  const match = value.match(/^\/start(?:@\w+)?(?:\s+|[?=])ref_([a-f0-9]{12})$/i);
  return match ? match[1].toUpperCase() : "";
}

function isRepeatedStartInvite(user, inviteCode) {
  const lastCode = String(user?.lastStartInviteCode || "");
  const handledCodes = Array.isArray(user?.handledStartInviteCodes)
    ? user.handledStartInviteCodes.map((code) => String(code || "")).filter(Boolean)
    : [];

  if (inviteCode && handledCodes.includes(inviteCode)) return true;
  return Boolean(inviteCode && lastCode === inviteCode);
}

function addHandledStartInviteCode(user, inviteCode) {
  const existing = Array.isArray(user?.handledStartInviteCodes)
    ? user.handledStartInviteCodes.map((code) => String(code || "")).filter(Boolean)
    : [];
  const next = [inviteCode, ...existing.filter((code) => code !== inviteCode)];
  return next.slice(0, START_INVITE_HISTORY_LIMIT);
}

async function rememberStartInvite(ctx, inviteCode, now = new Date()) {
  if (!inviteCode) return;
  const handledStartInviteCodes = addHandledStartInviteCode(ctx.user, inviteCode);
  if (ctx.user) {
    ctx.user.lastStartInviteCode = inviteCode;
    ctx.user.lastStartInviteAt = now;
    ctx.user.handledStartInviteCodes = handledStartInviteCodes;
  }
  await updateUserFields(ctx.userId, {
    lastStartInviteCode: inviteCode,
    lastStartInviteAt: now,
    handledStartInviteCodes,
  });
}

async function handleUpdate(ctx) {
  const text = (ctx.text || "").trim();
  const lang = detectLanguage(ctx);
  const userLang = ctx.user?.lang;
  const keyboardLang = userLang || lang;

  if (ctx.user?.bannedAt) {
    const bannedText = messages[keyboardLang].userBannedAccessDenied;
    if (ctx.callbackData) {
      await ctx.answerCb?.(bannedText, { show_alert: true });
    }
    return ctx.reply(bannedText, { reply_markup: { remove_keyboard: true, selective: false } });
  }

  if (ctx.callbackData) {
    return handleCallback(ctx);
  }

  const state = ctx.user?.state || "idle";
  const startReferralCode = getStartReferralCode(text);
  let startInviteCode = getStartInviteCode(text);
  if (startReferralCode) {
    const referral = await claimReferral({
      code: startReferralCode,
      inviteeUserId: ctx.userId,
      wasUserCreated: ctx.wasUserCreated,
    });
    if (referral.link?.discussionPublicCode) {
      startInviteCode = referral.link.discussionPublicCode;
    } else if (!referral.ok) {
      await ctx.reply(messages[keyboardLang].discussionInviteUnavailable);
    }
  }
  const repeatedStartInvite = startInviteCode && isRepeatedStartInvite(ctx.user, startInviteCode);

  if (startInviteCode && !repeatedStartInvite) {
    void trackEvent({
      name: EVENT_NAMES.userStarted,
      userId: ctx.userId,
      source: "invite",
    });
    await clearViewedPublicProfileMessage(ctx);
    await clearSavedProfilesListMessage(ctx);
    await clearBottomKeyboardQuietly(ctx);

    if (shouldOfferOnboarding(ctx.user)) {
      return startOnboardingLanguage(ctx, keyboardLang, startInviteCode);
    }

    const rawUserName = ctx.user?.profileName || ctx.user?.firstName || "";
    const userName = rawUserName.trim().replace(/\s+/g, " ");
    const welcomeMessage = userName
      ? messages[keyboardLang].discussionInviteWelcomeWithName.replace("{name}", userName)
      : messages[keyboardLang].discussionInviteWelcome;

    await updateUserState(ctx.userId, "idle");
    await rememberStartInvite(ctx, startInviteCode);
    await ctx.reply(welcomeMessage);
    return showDiscussionInvitePreviewCommand(ctx, userLang || lang, startInviteCode);
  }

  if (/^\/join_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    await clearSavedProfilesListMessage(ctx);
    await clearBottomKeyboardQuietly(ctx);
    const inviteCode = `d_${text.replace(/^\/join_/i, "")}`;
    if (shouldOfferOnboarding(ctx.user)) {
      return startOnboardingLanguage(ctx, keyboardLang, inviteCode);
    }
    await updateUserState(ctx.userId, "idle");
    return showDiscussionInvitePreviewCommand(ctx, lang, inviteCode);
  }

  if (/^\/(?:invite|iv)_[a-z0-9]+$/i.test(text)) {
    await clearSavedProfileSurfaceMessages(ctx);
    await clearBottomKeyboardQuietly(ctx);
    await updateUserState(ctx.userId, "idle");
    return showDiscussionPickerForSavedProfile(ctx, lang, normalizeProfileCodeFromInviteCommand(text));
  }

  if (/^\/accept_inv_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionListMessage(ctx);
    await clearBottomKeyboardQuietly(ctx);
    await updateUserState(ctx.userId, "idle");
    return acceptInvitationCommand(ctx, lang, text, {
      sendRoom: sendDiscussionRoomFromText,
    });
  }

  if (/^\/remove_inv_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionListMessage(ctx);
    await updateUserState(ctx.userId, "idle");
    return removeInvitationCommand(ctx, lang, text);
  }

  if (text === "/start" || repeatedStartInvite) {
    void trackEvent({
      name: EVENT_NAMES.userStarted,
      userId: ctx.userId,
      source: repeatedStartInvite ? "repeat_invite" : "direct",
    });
    await clearViewedPublicProfileMessage(ctx);
    await clearSavedProfilesListMessage(ctx);
    const shouldClearKeyboard = Boolean(ctx.user?.activeDiscussionId || isAiTextState(state) || state === "editing_location");
    const rawUserName = ctx.user?.profileName || ctx.user?.firstName || "";
    const userName = rawUserName.trim().replace(/\s+/g, " ");
    const welcomeMessage = userName
      ? messages[lang].welcomeWithName.replace("{name}", userName)
      : messages[lang].welcome;

    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });

    if (shouldOfferOnboarding(ctx.user)) {
      return startOnboardingLanguage(ctx, keyboardLang);
    }

    await updateUserState(ctx.userId, "idle");
    if (shouldClearKeyboard) {
      await removeBottomKeyboard(ctx, welcomeMessage, { deleteSentMessage: false });
    } else {
      await ctx.reply(welcomeMessage);
    }
    return ctx.reply(messages[keyboardLang].mainMenu, mainMenuKeyboard(keyboardLang));
  }

  if (state.startsWith("onboarding_")) {
    if (
      state === "onboarding_language"
      || state.startsWith("onboarding_invite_language:")
    ) {
      return ctx.reply(
        messages[keyboardLang].chooseLanguage,
        onboardingLanguageKeyboard(),
      );
    }
    return handleOnboardingText(ctx, userLang || lang);
  }

  if (!(state && state.startsWith("discussion_close_confirm")) && text && isDiscussionBottomControlText(text)) {
    return handleDiscussionBottomButton(ctx, lang, text);
  }

  if (!(state && state.startsWith("discussion_close_confirm")) && state === "idle" && ctx.user?.activeDiscussionId && text) {
    const handledDiscussionButton = await handleDiscussionBottomButton(ctx, lang, text);
    if (handledDiscussionButton) {
      return handledDiscussionButton;
    }
  }

  if (isUnsupportedDiscussionMessage(ctx, state, text)) {
    return replyToUnsupportedDiscussionMessage(ctx, messages[lang].discussionMessageOnlyTextOrVoice);
  }

  // Handle voice messages in discussions
  if (state === "idle" && ctx.user?.activeDiscussionId && ctx.message?.voice && !text) {
    const voice = ctx.message.voice;
    return handleDiscussionMessage(ctx, lang, "voice", {
      voiceFileId: voice.file_id,
      voiceDuration: voice.duration || 0,
    });
  }

  // Handle text messages in discussions
  if (state === "idle" && ctx.user?.activeDiscussionId && text && !text.startsWith("/")) {
    return handleDiscussionMessage(ctx, lang, "text", {
      text,
    });
  }

  if (isDiscussionNameState(state) && text) {
    const pendingEntry = parseDiscussionNameState(state);
    if (text === "/cancel") {
      return handleDiscussionNameCancel(ctx, lang, {
        renderActiveDiscussionList,
        renderInvitationsList,
        showDiscussionInvitePreviewCommand,
      });
    }
    if (text.startsWith("/")) {
      return sendProfileEditPrompt(ctx, messages[lang].discussionNameRequired, cancelEditKeyboard(lang));
    }

    const validation = validateProfileName(text, DISCUSSION_PROFILE_NAME_MAX_LENGTH);
    if (!validation.ok) {
      return sendProfileEditPrompt(
        ctx,
        `${getProfileNameErrorMessage(lang, validation.reason)}\n${messages[lang].discussionNameRequired}`,
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
    if (ctx.user) {
      ctx.user.profileName = validation.value;
      ctx.user.profileNameConfirmedAt = confirmedAt;
      ctx.user.state = "idle";
    }

    if (pendingEntry?.source === "open") {
      return openDiscussionCommand(ctx, lang, pendingEntry.token);
    }
    if (pendingEntry?.source === "join") {
      return joinDiscussionFromInvite(ctx, lang, pendingEntry.token, {
        sendRoom: sendDiscussionRoomFromText,
      });
    }
    if (pendingEntry?.source === "accept") {
      return acceptInvitationCommand(ctx, lang, `/accept_inv_${pendingEntry.token}`, {
        sendRoom: sendDiscussionRoomFromText,
      });
    }
    return true;
  }

  if (text === "/cancel") {
    await clearViewedPublicProfileMessage(ctx);
    const aiSection = getAiSectionFromState(state);
    if (aiSection) {
      await updateUserState(ctx.userId, "idle");
      await clearAiPendingInputPrompt(ctx);
      await clearRememberedAiListMessage(ctx);
      await clearAiSectionPin({ ctx, updateProfileField });
      return replyWithRemovedKeyboardThenInline(ctx, messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const handledProfileCancel = await handleProfileCancelText(ctx, lang, state, {
      sendProfile,
      keyboardLang,
    });
    if (handledProfileCancel) return handledProfileCancel;

    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  const handledProfileText = await handleProfileText(ctx, lang, text, state, {
    sendProfile,
    keyboardLang,
  });
  if (handledProfileText) return handledProfileText;

  if (isDiscussionCreateTextState(state)) {
    return handleDiscussionCreateText(ctx, lang, text, state);
  }

  if (state && state.startsWith("discussion_close_confirm")) {
    const parsed = parseDiscussionCloseConfirmState(state);
    return closeDiscussionFromTextConfirmation({ ctx, lang, parsed });
  }

  if (matchesMessageText(text, ["discussionCreateCancel"])) {
    await clearDiscussionMenuNotice(ctx);
    await resetDiscussionDraft(ctx.userId);
    await updateUserState(ctx.userId, "idle");
    await ctx.reply(messages[lang].discussionCreateCanceled, {
      reply_markup: { remove_keyboard: true },
    });
    return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
  }

  if (isAiTextState(state)) {
    return handleAiText(ctx, lang, text, state);
  }

  if (text === "/lang") {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionMenuNotice(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    return replyWithRemovedKeyboardThenInline(ctx, messages[lang].chooseLanguage, languageKeyboard());
  }

  if (text === "/menu") {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionMenuNotice(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    if (!userLang) {
      return replyWithRemovedKeyboardThenInline(ctx, messages["fa"].chooseLanguage, languageKeyboard());
    }

    return replyWithRemovedKeyboardThenInline(ctx, messages[userLang].mainMenu, mainMenuKeyboard(userLang));
  }

  if (text === "/profile") {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionMenuNotice(ctx);
    const shouldClearKeyboard = Boolean(ctx.user?.activeDiscussionId || isAiTextState(state) || state === "editing_location");
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    if (shouldClearKeyboard) {
      await removeBottomKeyboard(ctx, messages[lang].profile, { deleteSentMessage: false });
    }
    return sendProfile(ctx, ctx.user || {}, lang, keyboardLang, { loading: true });
  }

  if (text === ACTIVE_DISCUSSION_HELP_COMMAND) {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionMenuNotice(ctx);
    const shouldClearKeyboard = Boolean(ctx.user?.activeDiscussionId || isAiTextState(state) || state === "editing_location");
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    if (shouldClearKeyboard) {
      return replyWithRemovedKeyboardThenInline(
        ctx,
        messages[lang].profileActiveDiscussionHelpText,
        profileActiveDiscussionHelpKeyboard(lang),
      );
    }
    return ctx.reply(
      messages[lang].profileActiveDiscussionHelpText,
      profileActiveDiscussionHelpKeyboard(lang),
    );
  }

  if (/^\/d_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    return openDiscussionCommand(ctx, lang, text);
  }

  if (/^\/leave_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    return leaveDiscussionCommand(ctx, lang, `d_${text.replace(/^\/leave_/i, "")}`);
  }

  if (/^\/close_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    return closeDiscussionCommand(ctx, lang, `d_${text.replace(/^\/close_/i, "")}`);
  }

  if (/^\/remove_(u_)?[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    return removeDiscussionMemberCommand(ctx, lang, text);
  }

  if (/^\/report_(u_)?[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    return reportDiscussionMemberCommand(ctx, lang, text);
  }

  if (/^\/save_(u_)?[a-z0-9]+$/i.test(text)) {
    return saveProfileCommand(ctx, lang, text);
  }

  if (/^\/(?:unsave|rm)_(u_)?[a-z0-9]+$/i.test(text)) {
    return unsaveProfileCommand(ctx, lang, text);
  }

  if (/^\/(?:discussions|ds)_(u_)?[a-z0-9]+$/i.test(text)) {
    const raw = text.replace(/^\/(?:discussions|ds)_/i, "");
    const code = normalizePublicProfileCode(raw.startsWith("u_") ? raw : `u_${raw}`);
    return renderSavedProfileDiscussions(ctx, lang, code);
  }

  if (/^\/u_[a-z0-9]+$/i.test(text)) {
    const code = normalizePublicProfileCode(text);
    const hasSavedProfilesListContext = Number(ctx.user?.savedProfilesLastListMessageId) > 0;
    const hasPeopleListContext = Number(ctx.user?.peopleLastListMessageId) > 0;
    const fromSavedList = hasSavedProfilesListContext;
    const fromPeopleList = !fromSavedList && hasPeopleListContext;
    const fromInvitationList = !fromSavedList && !fromPeopleList && ctx.user?.discussionLastListType === "invitations";
    if (fromInvitationList) {
      await clearDiscussionListMessage(ctx);
    }
    if (!fromSavedList && !fromPeopleList && !fromInvitationList) {
      await clearDiscussionMembersMessage(ctx);
    }
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList, fromInvitationList, fromPeopleList });
  }

  if (text === "/resetphoto") {
    return resetProfilePhotoCommand(ctx, lang, {
      sendProfile,
      keyboardLang,
    });
  }

  return ctx.reply(messages[lang].maintenance, mainMenuKeyboard(lang));
}

async function sendProfile(ctx, user, lang, keyboardLang, options = {}) {
  return sendProfileMessage({
    ctx,
    user,
    lang,
    keyboard: profileKeyboard(
      keyboardLang,
      Boolean(user?.photoFileId),
    ),
    messages,
    loadingText: options.loading ? messages[lang].profileLoading : "",
    isOwnProfile: true,
    footerText: options.footerText || "",
  });
}

module.exports = {
  handleUpdate,
  getStartInviteCode,
  getStartReferralCode,
  isRepeatedStartInvite,
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  isUnsupportedDiscussionMessage,
  replyToUnsupportedDiscussionMessage,
  sendDiscussionMessageToRecipient,
};
