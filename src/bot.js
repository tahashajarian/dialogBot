const messages = require("./messages");
const path = require("path");
const { detectLanguage } = require("./lang");
const { handleCallback } = require("./callbacks");
const {
  mainMenuKeyboard,
  languageKeyboard,
  onboardingLanguageKeyboard,
  aiAssistantKeyboard,
  discussionsMenuKeyboard,
  profileKeyboard,
  ageKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  cancelEditKeyboard,
  discussionRoomKeyboard,
  profileActiveDiscussionHelpKeyboard,
} = require("./keyboards");
const {
  updateProfileField,
  resetDiscussionDraft,
  updateUserFields,
  updateUserState,
} = require("./services/users");
const {
  getMessageId,
  removeBottomKeyboard,
  clearBottomKeyboardQuietly,
  replyWithRemovedKeyboardThenInline,
  leaveDiscussionAndClearKeyboardForNavigation,
} = require("./services/bot-navigation");
const { resolveCityByCoordinates } = require("./services/location");
const {
  saveLocationProfile,
  sendProfileMessage,
  isValidTextInput,
  validateProfileName,
  toPlainUser,
  ACTIVE_DISCUSSION_HELP_COMMAND,
} = require("./services/profile");
const {
  getAiSectionFromState,
  clearAiSectionPin,
} = require("./services/ai-section");
const {
  addRecentMessage,
  normalizePublicProfileCode,
} = require("./services/discussions");
const {
  findDiscussionDelivery,
  getReplyMessageIdForRecipient,
  rememberDiscussionDelivery,
} = require("./services/discussion-delivery-memory");
const {
  isDiscussionBottomControlText,
  handleDiscussionBottomButton,
  clearDiscussionMenuNotice,
  closeDiscussionFromTextConfirmation,
  openDiscussionCommand,
  showDiscussionInvitePreviewCommand,
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
  showDiscussionPickerForSavedProfile,
} = require("./flows/discussion-invitations");
const {
  clearDiscussionListMessage,
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
  clearSavedProfilesListMessage,
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

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");
const FIELD_LIMITS = {
  profileName: 30,
  city: 30,
  bio: 120,
};
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

function getReplyMessageId(message = {}) {
  const reply = message.reply_to_message || message.replyToMessage || {};
  const messageId = Number(getMessageId(reply));
  return Number.isInteger(messageId) && messageId > 0 ? messageId : null;
}

function formatDiscussionOutboundMessage(messages, lang, { senderDisplayName, text }) {
  return messages[lang].discussionMessageInbound
    .replace("{sender}", senderDisplayName || (lang === "fa" ? "کاربر" : "User"))
    .replace("{text}", String(text || "").trim());
}

function isUnsupportedDiscussionMessage(ctx, state, text) {
  const hasVoice = ctx.message?.voice;
  return Boolean(
    state === "idle"
    && ctx.user?.activeDiscussionId
    && ctx.message
    && !text
    && !hasVoice,
  );
}

async function replyToUnsupportedDiscussionMessage(ctx, text) {
  const messageId = getMessageId(ctx.message);
  if (messageId) {
    try {
      return await ctx.reply(text, { reply_to_message_id: messageId });
    } catch {
      // A normal reply still gives the user clear delivery feedback.
    }
  }
  return ctx.reply(text);
}

async function sendDiscussionMessageToRecipient(ctx, recipientUserId, payload, replyDelivery) {
  const replyMessageId = getReplyMessageIdForRecipient(replyDelivery, recipientUserId);
  
  // Handle voice messages
  if (payload?.voice) {
    if (!replyMessageId) {
      return ctx.telegram?.sendVoice(recipientUserId, payload.voice.file_id);
    }
    const sent = await ctx.telegram?.sendVoice(recipientUserId, payload.voice.file_id, {
      reply_to_message_id: replyMessageId,
    });
    if (sent) return sent;
    return ctx.telegram?.sendVoice(recipientUserId, payload.voice.file_id);
  }
  
  // Handle text messages
  const text = typeof payload === 'string' ? payload : payload?.text;
  if (!replyMessageId) {
    return ctx.sendToUser?.(recipientUserId, text);
  }

  const sent = await ctx.sendToUser?.(recipientUserId, text, {
    reply_to_message_id: replyMessageId,
  });
  if (sent) return sent;
  return ctx.sendToUser?.(recipientUserId, text);
}

async function handleDiscussionMessage(ctx, lang, messageType, payload) {
  const senderName = String(ctx.user?.profileName || ctx.user?.firstName || "کاربر").trim();
  const added = await addRecentMessage({
    discussionId: ctx.user.activeDiscussionId,
    senderUserId: ctx.userId,
    senderDisplayName: senderName,
    ...payload,
  });

  if (!added.ok) {
    if (added.reason === "message_burst_limit") {
      return ctx.reply(
        messages[lang].discussionMessageBurstLimit,
        discussionRoomKeyboard(lang, added.discussion?.creatorUserId === ctx.userId),
      );
    }
    if (added.reason === "message_rate_limit") {
      return ctx.reply(
        messages[lang].discussionMessageRateLimit,
        discussionRoomKeyboard(lang, added.discussion?.creatorUserId === ctx.userId),
      );
    }
    if (added.reason === "message_contains_link") {
      return replyToUnsupportedDiscussionMessage(ctx, messages[lang].discussionMessageNoLinks);
    }
    return ctx.reply(messages[lang].discussionMessageSendFailed);
  }

  const deliveriesByUserId = {
    [ctx.userId]: getMessageId(ctx.message),
  };

  await Promise.all((added.recipients || []).map(async (recipientUserId) => {
    const sent = await sendDiscussionMessageToRecipient(
      ctx,
      recipientUserId,
      messageType === "voice" 
        ? { voice: { file_id: payload.voiceFileId, duration: payload.voiceDuration || 0 } }
        : formatDiscussionOutboundMessage(messages, lang, { senderDisplayName: senderName, text: payload.text }),
      messageType === "text" ? findDiscussionDelivery({
        userId: ctx.userId,
        messageId: getReplyMessageId(ctx.message),
        discussionId: ctx.user.activeDiscussionId,
      }) : undefined
    );
    const sentMessageId = getMessageId(sent);
    if (sentMessageId) {
      deliveriesByUserId[recipientUserId] = sentMessageId;
    }
  }));

  rememberDiscussionDelivery({
    discussionId: ctx.user.activeDiscussionId,
    deliveriesByUserId,
  });

  return true;
}

async function handleUpdate(ctx) {
  const text = (ctx.text || "").trim();
  const lang = detectLanguage(ctx);

  if (ctx.callbackData) {
    return handleCallback(ctx);
  }

  const userLang = ctx.user?.lang;
  const state = ctx.user?.state || "idle";
  const keyboardLang = userLang || lang;
  const startInviteCode = getStartInviteCode(text);
  const repeatedStartInvite = startInviteCode && isRepeatedStartInvite(ctx.user, startInviteCode);

  if (startInviteCode && !repeatedStartInvite) {
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

  if (/^\/invite_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    await clearSavedProfilesListMessage(ctx);
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

  if (text === "/cancel") {
    await clearViewedPublicProfileMessage(ctx);
    const aiSection = getAiSectionFromState(state);
    await updateUserState(ctx.userId, "idle");
    if (aiSection) {
      await clearAiPendingInputPrompt(ctx);
      await clearRememberedAiListMessage(ctx);
      await clearAiSectionPin({ ctx, updateProfileField });
      return replyWithRemovedKeyboardThenInline(ctx, messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
    }

    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    if (state === "editing_location") {
      await clearBottomKeyboardQuietly(ctx);
    }
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_name" && text) {
    if (text.startsWith("/")) {
      return sendProfileEditPrompt(ctx, messages[lang].profileEditHintName, cancelEditKeyboard(lang));
    }

    const validation = validateProfileName(text, FIELD_LIMITS.profileName);
    if (!validation.ok) {
      const errorText = validation.reason === "emoji"
        ? messages[lang].profileNameNoEmoji
        : messages[lang].profileNameTooLong;
      return sendProfileEditPrompt(
        ctx,
        `${errorText}\n${messages[lang].profileEditHintName}`,
        cancelEditKeyboard(lang),
      );
    }

    await updateProfileField(ctx.userId, "profileName", validation.value);
    await updateUserState(ctx.userId, "idle");
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.profileName = validation.value;
    updatedUser.state = "idle";
    
    // Check if user was trying to view another profile
    const pendingCode = updatedUser.pendingProfileViewCode;
    if (pendingCode) {
      await updateProfileField(ctx.userId, "pendingProfileViewCode", "");
      return sendPublicProfileByCode(ctx, lang, pendingCode);
    }
    
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
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
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_photo" && ctx.message?.photo?.length) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await updateProfileField(ctx.userId, "photoFileId", photo.file_id);
    await updateUserState(ctx.userId, "idle");
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = photo.file_id;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_photo" && ctx.message?.document?.file_id) {
    await updateProfileField(ctx.userId, "photoFileId", ctx.message.document.file_id);
    await updateUserState(ctx.userId, "idle");
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = ctx.message.document.file_id;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_location" && ctx.message?.location) {
    const location = await saveLocationProfile({
      userId: ctx.userId,
      locationMessage: ctx.message.location,
      updateProfileField,
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
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
  }

  if (state === "editing_photo") {
    return sendProfileEditPrompt(ctx, messages[lang].profileEditHintPhoto, cancelEditKeyboard(lang));
  }

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
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
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

  if (/^\/unsave_(u_)?[a-z0-9]+$/i.test(text)) {
    return unsaveProfileCommand(ctx, lang, text);
  }

  if (/^\/discussions_(u_)?[a-z0-9]+$/i.test(text)) {
    const raw = text.replace(/^\/discussions_/i, "");
    const code = normalizePublicProfileCode(raw.startsWith("u_") ? raw : `u_${raw}`);
    await clearSavedProfilesListMessage(ctx);
    return renderSavedProfileDiscussions(ctx, lang, code);
  }

  if (/^\/u_[a-z0-9]+$/i.test(text)) {
    const code = normalizePublicProfileCode(text);
    const current = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const isSavedProfileCode = current.some((entry) => normalizePublicProfileCode(entry) === code);
    const hasSavedProfilesListContext = Number(ctx.user?.savedProfilesLastListMessageId) > 0;
    const fromSavedList = hasSavedProfilesListContext || (
      ctx.user?.discussionLastListType !== "invitations" && isSavedProfileCode
    );
    if (fromSavedList) {
      await clearSavedProfilesListMessage(ctx);
    }
    const fromInvitationList = !fromSavedList && ctx.user?.discussionLastListType === "invitations";
    if (fromInvitationList) {
      await clearDiscussionListMessage(ctx);
    }
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList, fromInvitationList });
  }

  if (text === "/resetphoto") {
    await updateProfileField(ctx.userId, "photoFileId", null);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = null;
    updatedUser.state = "idle";
    return sendProfile(ctx, updatedUser, lang, keyboardLang);
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
    defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
    loadingText: options.loading ? messages[lang].profileLoading : "",
    isOwnProfile: true,
  });
}

module.exports = {
  handleUpdate,
  getStartInviteCode,
  isRepeatedStartInvite,
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  isUnsupportedDiscussionMessage,
  replyToUnsupportedDiscussionMessage,
  sendDiscussionMessageToRecipient,
};
