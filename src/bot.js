const messages = require("./messages");
const { callBacks } = require("./constants");
const { detectLanguage } = require("./lang");
const { handleCallback } = require("./callbacks");
const {
  mainMenuKeyboard,
  aiAssistantKeyboard,
  discussionsMenuKeyboard,
  helpKeyboard,
  languageKeyboard,
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
  replyWithKeyboardRemovalNoticeThenInline,
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
} = require("./services/ai-section");
const {
  buildAiAssistantMenuMessage,
} = require("./services/ai-list-ui");
const {
  normalizePublicProfileCode,
} = require("./services/discussions");
const { getDiscussionDisplayTitle } = require("./services/discussion-ui");
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
  boostDiscussionCommand,
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
  clearRememberedDiscussionRoomCards,
  clearDiscussionMembersMessage,
  clearDiscussionListMessage,
  renderActiveDiscussionList,
  renderMyDiscussionList,
  rememberDiscussionMenuNotice,
} = require("./flows/discussions-callbacks");
const {
  isDiscussionCreateTextState,
  handleDiscussionCreateText,
} = require("./flows/discussions-create-text");
const {
  startDiscussionCreateFlow,
} = require("./flows/discussions-create-callbacks");
const {
  clearAiPendingInputPrompt,
} = require("./flows/ai-input-prompts");
const {
  handleAiText,
  isAiTextState,
} = require("./flows/ai-text");
const {
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
} = require("./flows/ai-cards");
const {
  clearProfileEditPrompt,
  sendProfileEditPrompt,
} = require("./flows/profile-edit");
const {
  DISCUSSION_PROFILE_NAME_MAX_LENGTH,
  getProfileNameErrorMessage,
  getDiscussionOpenCodeFromNameState,
  handleDiscussionNameCancel,
  isDiscussionNameCancelText,
  isDiscussionNameState,
  parseDiscussionNameState,
} = require("./flows/discussion-name-gate");
const {
  clearSavedProfilesListMessage,
  clearSavedProfileSurfaceMessages,
  clearViewedPublicProfileMessage,
  clearPeopleListMessage,
  renderSavedProfileDiscussions,
  saveProfileCommand,
  sendPublicProfileByCode,
  unsaveProfileCommand,
  sendPeopleHub,
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
} = require("./flows/profile-text");
const { EVENT_NAMES, trackEvent } = require("./services/analytics-events");
const { claimReferral } = require("./services/star-referrals");
const { sendNavigationFootprint } = require("./services/navigation-footprints");
const { MODES, resolveReplyKeyboardAction, setNavigationMode } = require("./services/reply-keyboard-navigation");
const { starEconomy } = require("./services/star-settings");

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
    source: ["list", "active", "mine"].includes(source) ? source : "room",
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

function hasTemporaryReplyKeyboard(ctx, state = "") {
  return Boolean(
    ctx.user?.activeDiscussionId ||
    isAiTextState(state) ||
    state === "editing_location"
  );
}

function isAllowedDiscussionCommandLink(text = "") {
  const value = String(text || "").trim();
  return (
    /^\/start(?:@\w+)?(?:$|[\s?=])/i.test(value) ||
    /^\/join_[a-z0-9]+$/i.test(value) ||
    /^\/(?:invite|iv)_[a-z0-9]+$/i.test(value) ||
    /^\/accept_inv_[a-z0-9]+$/i.test(value) ||
    /^\/remove_inv_[a-z0-9]+$/i.test(value) ||
    /^\/d_[a-z0-9]+$/i.test(value) ||
    /^\/leave_[a-z0-9]+$/i.test(value) ||
    /^\/close_[a-z0-9]+$/i.test(value) ||
    /^\/boost_[a-z0-9]+$/i.test(value) ||
    /^\/remove_(u_)?[a-z0-9]+$/i.test(value) ||
    /^\/report_(u_)?[a-z0-9]+$/i.test(value) ||
    /^\/save_(u_)?[a-z0-9]+$/i.test(value) ||
    /^\/(?:unsave|rm)_(u_)?[a-z0-9]+$/i.test(value) ||
    /^\/(?:discussions|ds)_(u_)?[a-z0-9]+$/i.test(value) ||
    /^\/u_[a-z0-9]+$/i.test(value)
  );
}

function shouldRejectDiscussionSlashCommand(ctx, state = "", text = "") {
  return Boolean(
    state === "idle" &&
    ctx.user?.activeDiscussionId &&
    String(text || "").trim().startsWith("/") &&
    !isAllowedDiscussionCommandLink(text)
  );
}

function getNavigationCommand(text = "") {
  const match = String(text || "").trim().match(/^\/(menu|profile|lang|taste|discussions|people|help)(?:@\w+)?$/i);
  return match ? match[1].toLowerCase() : "";
}

async function prepareForCommandNavigation(ctx, state) {
  const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx, state);
  const cleanup = Promise.all([
    clearViewedPublicProfileMessage(ctx),
    clearSavedProfilesListMessage(ctx),
    clearPeopleListMessage(ctx),
    clearOwnProfileMessage(ctx),
    clearAiPendingInputPrompt(ctx),
    clearRememberedAiListMessage(ctx),
    clearAiSectionEntryMessage(ctx),
    clearProfileEditPrompt(ctx),
    clearRememberedDiscussionRoomCards(ctx),
    clearDiscussionMembersMessage(ctx),
    clearDiscussionListMessage(ctx),
    clearDiscussionMenuNotice(ctx),
  ]);
  const [, left] = await Promise.all([
    cleanup,
    leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false }),
  ]);
  await updateUserState(ctx.userId, "idle");
  if (ctx.user) ctx.user.state = "idle";
  return { shouldClearKeyboard, left };
}

function formatCommandNavigationExit(lang, left) {
  if (!left?.ok || !left.discussion) return "";
  const title = getDiscussionDisplayTitle(messages, lang, left.discussion) || "-";
  return messages[lang].discussionLeft.replace("{title}", title);
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

function normalizeIncomingText(value = "") {
  return String(value || "").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim();
}

async function handleUpdate(ctx) {
  const incomingText = normalizeIncomingText(ctx.text);
  const isStartAgain = incomingText === messages.fa.accountStartAgainButton
    || incomingText === messages.en.accountStartAgainButton;
  const text = isStartAgain && (ctx.wasUserCreated || ctx.canRestartAfterDeletion) ? "/start" : incomingText;
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
  let shareInviterUserId = null;
  if (startReferralCode) {
    const referral = await claimReferral({
      code: startReferralCode,
      inviteeUserId: ctx.userId,
      wasUserCreated: ctx.wasUserCreated,
    });
    if (referral.link?.discussionPublicCode) {
      startInviteCode = referral.link.discussionPublicCode;
      shareInviterUserId = Number(referral.link.inviterUserId) || null;
    } else if (!referral.ok && !["existing_user", "already_claimed"].includes(referral.reason)) {
      await ctx.reply(messages[keyboardLang].discussionInviteUnavailable);
    }
  }

  const navigationCommand = getNavigationCommand(text);
  if (navigationCommand) {
    const { shouldClearKeyboard, left } = await prepareForCommandNavigation(ctx, state);
    const exitNotice = formatCommandNavigationExit(keyboardLang, left);
    if (exitNotice) await ctx.reply(exitNotice);
    await sendNavigationFootprint(ctx, {
      lang: keyboardLang,
      destination: navigationCommand === "lang" ? "language" : navigationCommand,
      removeKeyboard: shouldClearKeyboard,
    });
    if (navigationCommand === "menu") {
      await setNavigationMode(ctx, MODES.GLOBAL);
      return ctx.reply(messages[keyboardLang].mainMenu, mainMenuKeyboard(keyboardLang));
    }
    if (navigationCommand === "profile") {
      return sendProfile(ctx, toPlainUser(ctx.user), lang, keyboardLang, { loading: true });
    }
    if (navigationCommand === "lang") {
      await setNavigationMode(ctx, MODES.LANGUAGE);
      return ctx.reply(messages[keyboardLang].chooseLanguage, languageKeyboard(keyboardLang));
    }
    if (navigationCommand === "taste") {
      await setNavigationMode(ctx, MODES.FAVORITES);
      return ctx.reply(buildAiAssistantMenuMessage(lang), aiAssistantKeyboard(lang));
    }
    if (navigationCommand === "discussions") {
      await setNavigationMode(ctx, MODES.DISCUSSIONS);
      return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    }
    if (navigationCommand === "people") {
      return sendPeopleHub(ctx, lang);
    }
    await setNavigationMode(ctx, MODES.HELP);
    return ctx.reply(messages[lang].helpText, helpKeyboard(lang));
  }

  if (shouldRejectDiscussionSlashCommand(ctx, state, text)) {
    return replyToUnsupportedDiscussionMessage(ctx, messages[lang].discussionMessageNoCommands);
  }

  if (startInviteCode) {
    void trackEvent({
      name: EVENT_NAMES.userStarted,
      userId: ctx.userId,
      source: "invite",
    });
    if (shareInviterUserId && shareInviterUserId !== Number(ctx.userId)) {
      const pendingShare = {
        pendingDiscussionShareInviterUserId: shareInviterUserId,
        pendingDiscussionShareCode: startInviteCode,
        pendingDiscussionShareAt: new Date(),
      };
      Object.assign(ctx.user || {}, pendingShare);
      await updateUserFields(ctx.userId, pendingShare);
    }
    await clearViewedPublicProfileMessage(ctx);
    await clearSavedProfilesListMessage(ctx);

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
    if (ctx.wasUserCreated) {
      await ctx.reply(welcomeMessage);
    }
    return showDiscussionInvitePreviewCommand(ctx, userLang || lang, startInviteCode);
  }

  if (/^\/join_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    await clearSavedProfilesListMessage(ctx);
    const inviteCode = `d_${text.replace(/^\/join_/i, "")}`;
    if (shouldOfferOnboarding(ctx.user)) {
      return startOnboardingLanguage(ctx, keyboardLang, inviteCode);
    }
    await updateUserState(ctx.userId, "idle");
    return showDiscussionInvitePreviewCommand(ctx, lang, inviteCode);
  }

  if (/^\/(?:invite|iv)_[a-z0-9]+$/i.test(text)) {
    await clearSavedProfileSurfaceMessages(ctx);
    await removeBottomKeyboard(ctx);
    await updateUserState(ctx.userId, "idle");
    return showDiscussionPickerForSavedProfile(ctx, lang, normalizeProfileCodeFromInviteCommand(text));
  }

  if (/^\/accept_inv_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionListMessage(ctx);
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

  if (text === "/start" || startReferralCode) {
    void trackEvent({
      name: EVENT_NAMES.userStarted,
      userId: ctx.userId,
      source: startReferralCode ? "referral" : "direct",
    });
    await clearViewedPublicProfileMessage(ctx);
    await clearSavedProfilesListMessage(ctx);
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx, state);
    const rawUserName = ctx.user?.profileName || ctx.user?.firstName || "";
    const userName = rawUserName.trim().replace(/\s+/g, " ");
    const welcomeMessage = userName
      ? messages[lang].welcomeWithName.replace("{name}", userName)
      : messages[lang].welcome;

    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });

    if (shouldOfferOnboarding(ctx.user)) {
      return startOnboardingLanguage(ctx, keyboardLang, "", { removeReplyKeyboard: isStartAgain });
    }

    await updateUserState(ctx.userId, "idle");
    if (shouldClearKeyboard) {
      await removeBottomKeyboard(ctx, welcomeMessage, { deleteSentMessage: false });
    } else {
      await ctx.reply(welcomeMessage);
    }
    await sendNavigationFootprint(ctx, { lang: keyboardLang, destination: "menu" });
    return ctx.reply(messages[keyboardLang].mainMenu, mainMenuKeyboard(keyboardLang));
  }

  if (state.startsWith("onboarding_")) {
    const onboardingAction = resolveReplyKeyboardAction(text, {
      mode: ctx.user?.navigationMode,
      state,
      user: ctx.user,
    });
    if (onboardingAction) {
      ctx.isReplyKeyboardAction = true;
      ctx.callbackData = onboardingAction.callbackData;
      return handleCallback(ctx);
    }
    if (
      state === "onboarding_interests"
      || state === "onboarding_taste_setup_interests"
      || state.startsWith("onboarding_custom_interest:")
      || state.startsWith("onboarding_taste_setup_custom_interest:")
    ) {
      return handleOnboardingText(ctx, userLang || lang);
    }
    return undefined;
  }

  if (state === "editing_interests" && matchesMessageText(text, ["profileInterestsDone"])) {
    ctx.isReplyKeyboardAction = true;
    ctx.callbackData = callBacks.profileInterestsDone;
    return handleCallback(ctx);
  }

  if (isDiscussionNameState(state) && isDiscussionNameCancelText(text)) {
    return handleDiscussionNameCancel(ctx, lang, {
      renderActiveDiscussionList,
      renderMyDiscussionList,
      renderSavedProfileDiscussions,
      renderInvitationsList,
      showDiscussionInvitePreviewCommand,
    });
  }

  if (matchesMessageText(text, ["cancelEdit"])) {
    const canceledProfileInput = await handleProfileCancelText(ctx, lang, state, { sendProfile, keyboardLang });
    if (canceledProfileInput) return canceledProfileInput;
  }

  if (
    !(state && state.startsWith("discussion_close_confirm"))
    && ctx.user?.activeDiscussionId
    && text
    && isDiscussionBottomControlText(text)
  ) {
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

  // A user can browse discussion lists while still belonging to an active room.
  // Resolve only the server-authorized browsing keyboard before treating text as a room message.
  if (/^discussions$|^discussion_(?:list|invitations|language|join_error):/.test(String(ctx.user?.navigationMode || ""))) {
    const discussionNavigationAction = resolveReplyKeyboardAction(text, {
      mode: ctx.user.navigationMode, state, activeDiscussionId: ctx.user.activeDiscussionId,
      advancedSearchEnabled: starEconomy.advancedSearchPreviewEnabled, user: ctx.user,
    });
    if (discussionNavigationAction) {
      ctx.isReplyKeyboardAction = true;
      ctx.callbackData = discussionNavigationAction.callbackData;
      return handleCallback(ctx);
    }
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

  const replyAction = resolveReplyKeyboardAction(text, {
    mode: ctx.user?.navigationMode, state, activeDiscussionId: ctx.user?.activeDiscussionId,
    advancedSearchEnabled: starEconomy.advancedSearchPreviewEnabled, user: ctx.user,
  });
  if (replyAction) {
    ctx.isReplyKeyboardAction = true;
    ctx.callbackData = replyAction.callbackData;
    return handleCallback(ctx);
  }

  if (isDiscussionNameState(state) && text) {
    const pendingEntry = parseDiscussionNameState(state);
    if (isDiscussionNameCancelText(text)) {
      return handleDiscussionNameCancel(ctx, lang, {
        renderActiveDiscussionList,
        renderMyDiscussionList,
        renderSavedProfileDiscussions,
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

    if (
      pendingEntry?.source === "open" ||
      pendingEntry?.source === "open_active" ||
      pendingEntry?.source === "open_mine" ||
      pendingEntry?.source === "open_saved"
    ) {
      return openDiscussionCommand(ctx, lang, getDiscussionOpenCodeFromNameState(pendingEntry));
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
    if (pendingEntry?.source === "create") {
      return startDiscussionCreateFlow(ctx, lang, {
        editCallbackMessageOrReply: (_ctx, textToSend, keyboard) => _ctx.reply(textToSend, keyboard),
        rememberDiscussionMenuNotice,
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
      await clearAiSectionEntryMessage(ctx);
      return replyWithKeyboardRemovalNoticeThenInline(
        ctx,
        messages[lang].navigationFootprintTaste,
        buildAiAssistantMenuMessage(lang),
        aiAssistantKeyboard(lang),
      );
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

  if (text === ACTIVE_DISCUSSION_HELP_COMMAND) {
    await clearViewedPublicProfileMessage(ctx);
    await clearOwnProfileMessage(ctx);
    await clearDiscussionMenuNotice(ctx);
    const shouldClearKeyboard = Boolean(ctx.user?.activeDiscussionId || isAiTextState(state) || state === "editing_location");
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    if (shouldClearKeyboard) {
      return replyWithKeyboardRemovalNoticeThenInline(
        ctx,
        messages[lang].navigationFootprintHelp,
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
    await updateProfileField(ctx.userId, "publicProfileLastMessageId", null);
    if (ctx.user) ctx.user.publicProfileLastMessageId = null;
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

  if (/^\/boost_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    return boostDiscussionCommand(ctx, lang, `d_${text.replace(/^\/boost_/i, "")}`);
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
    const hasPeopleListContext = Number(ctx.user?.peopleLastListMessageId) > 0 ||
      ["browse", "taste"].includes(String(ctx.user?.peopleLastListMode || ""));
    const fromSavedList = hasSavedProfilesListContext;
    const fromPeopleList = !fromSavedList && hasPeopleListContext;
    const fromDiscussionMembers = !fromSavedList && !fromPeopleList && Number(ctx.user?.discussionLastMembersMessageId) > 0;
    const fromInvitationList = !fromSavedList && !fromPeopleList && !fromDiscussionMembers && ctx.user?.discussionLastListType === "invitations";
    if (fromInvitationList) {
      await clearDiscussionListMessage(ctx);
    }
    if (!fromSavedList && !fromPeopleList && !fromInvitationList && !fromDiscussionMembers) {
      await clearDiscussionMembersMessage(ctx);
    }
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList, fromInvitationList, fromPeopleList, fromDiscussionMembers });
  }

  // A delayed duplicate reply-keyboard tap can arrive after the first tap has
  // already changed the server-side mode. Otherwise-unrecognized idle text is
  // a quiet no-op so stale client keyboards cannot reset the user's context.
  return null;
}

async function clearOwnProfileMessage(ctx) {
  const messageId = Number(ctx.user?.profileLastMessageId);
  if (Number.isInteger(messageId) && messageId > 0 && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }
  if (messageId || ctx.user?.profileLastMessageId) {
    await updateProfileField(ctx.userId, "profileLastMessageId", null);
    if (ctx.user) ctx.user.profileLastMessageId = null;
  }
}

async function sendProfile(ctx, user, lang, keyboardLang, options = {}) {
  await sendNavigationFootprint(ctx, { lang: keyboardLang, destination: "profile" });
  const sentProfile = await sendProfileMessage({
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
  await setNavigationMode(ctx, MODES.PROFILE);
  return sentProfile;
}

module.exports = {
  handleUpdate,
  getNavigationCommand,
  getStartInviteCode,
  getStartReferralCode,
  normalizeIncomingText,
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  isUnsupportedDiscussionMessage,
  replyToUnsupportedDiscussionMessage,
  sendDiscussionMessageToRecipient,
};
