const messages = require("./messages");
const path = require("path");
const { detectLanguage } = require("./lang");
const { handleCallback } = require("./callbacks");
const {
  mainMenuKeyboard,
  languageKeyboard,
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
  updateUserState,
} = require("./services/users");
const {
  getMessageId,
  clearBottomKeyboardQuietly,
  leaveDiscussionAndClearKeyboardForNavigation,
} = require("./services/bot-navigation");
const { resolveCityByCoordinates } = require("./services/location");
const {
  saveLocationProfile,
  sendProfileMessage,
  isValidTextInput,
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
} = require("./flows/discussions-text");
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

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");
const FIELD_LIMITS = {
  profileName: 30,
  city: 30,
  bio: 120,
};
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

async function sendDiscussionMessageToRecipient(ctx, recipientUserId, text, replyDelivery) {
  const replyMessageId = getReplyMessageIdForRecipient(replyDelivery, recipientUserId);
  if (!replyMessageId) {
    return ctx.sendToUser?.(recipientUserId, text);
  }

  const sent = await ctx.sendToUser?.(recipientUserId, text, {
    reply_to_message_id: replyMessageId,
  });
  if (sent) return sent;
  return ctx.sendToUser?.(recipientUserId, text);
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

  if (startInviteCode) {
    await clearViewedPublicProfileMessage(ctx);
    const rawUserName = ctx.user?.profileName || ctx.user?.firstName || "";
    const userName = rawUserName.trim().replace(/\s+/g, " ");
    const welcomeMessage = userName
      ? messages[lang].welcomeWithName.replace("{name}", userName)
      : messages[lang].welcome;

    await clearBottomKeyboardQuietly(ctx);
    await updateUserState(ctx.userId, "idle");
    await ctx.reply(welcomeMessage);
    return showDiscussionInvitePreviewCommand(ctx, userLang || lang, startInviteCode);
  }

  if (/^\/join_[a-z0-9]+$/i.test(text)) {
    await clearViewedPublicProfileMessage(ctx);
    await clearBottomKeyboardQuietly(ctx);
    await updateUserState(ctx.userId, "idle");
    return showDiscussionInvitePreviewCommand(ctx, lang, `d_${text.replace(/^\/join_/i, "")}`);
  }

  if (text === "/start") {
    await clearViewedPublicProfileMessage(ctx);
    const rawUserName = ctx.user?.profileName || ctx.user?.firstName || "";
    const userName = rawUserName.trim().replace(/\s+/g, " ");
    const welcomeMessage = userName
      ? messages[lang].welcomeWithName.replace("{name}", userName)
      : messages[lang].welcome;

    await updateUserState(ctx.userId, "idle");
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    await ctx.reply(welcomeMessage);

    if (!userLang) {
      return ctx.reply(messages["fa"].chooseLanguage, languageKeyboard());
    }

    return ctx.reply(messages[userLang].mainMenu, mainMenuKeyboard(userLang));
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

  if (state === "idle" && ctx.user?.activeDiscussionId && text && !text.startsWith("/")) {
    const senderName = String(ctx.user?.profileName || ctx.user?.firstName || "کاربر").trim();
    const replyDelivery = findDiscussionDelivery({
      userId: ctx.userId,
      messageId: getReplyMessageId(ctx.message),
      discussionId: ctx.user.activeDiscussionId,
    });
    const added = await addRecentMessage({
      discussionId: ctx.user.activeDiscussionId,
      senderUserId: ctx.userId,
      senderDisplayName: senderName,
      text,
    });
    if (!added.ok) {
      if (added.reason === "message_rate_limit") {
        return ctx.reply(
          messages[lang].discussionMessageRateLimit,
          discussionRoomKeyboard(lang, added.discussion?.creatorUserId === ctx.userId),
        );
      }
      return ctx.reply(messages[lang].discussionMessageOnlyText);
    }

    const inboundText = formatDiscussionOutboundMessage(messages, lang, {
      senderDisplayName: senderName,
      text,
    });

    const deliveriesByUserId = {
      [ctx.userId]: getMessageId(ctx.message),
    };
    await Promise.all((added.recipients || []).map(async (recipientUserId) => {
      const sent = await sendDiscussionMessageToRecipient(ctx, recipientUserId, inboundText, replyDelivery);
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

  if (text === "/cancel") {
    await clearViewedPublicProfileMessage(ctx);
    const aiSection = getAiSectionFromState(state);
    await updateUserState(ctx.userId, "idle");
    if (aiSection) {
      await clearAiPendingInputPrompt(ctx);
      await clearRememberedAiListMessage(ctx);
      await clearAiSectionPin({ ctx, updateProfileField });
      await clearBottomKeyboardQuietly(ctx);
      return ctx.reply(messages[lang].aiAssistantMenu, aiAssistantKeyboard(lang));
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

    if (!isValidTextInput(text, FIELD_LIMITS.profileName)) {
      return sendProfileEditPrompt(
        ctx,
        `${messages[lang].profileNameTooLong}\n${messages[lang].profileEditHintName}`,
        cancelEditKeyboard(lang),
      );
    }

    await updateProfileField(ctx.userId, "profileName", text);
    await updateUserState(ctx.userId, "idle");
    await clearProfileEditPrompt(ctx);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.profileName = text;
    updatedUser.state = "idle";
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
    await updateProfileField(ctx.userId, "discussionDraftTitle", "");
    await updateProfileField(ctx.userId, "discussionDraftDescription", "");
    await updateProfileField(ctx.userId, "discussionDraftJoinRule", null);
    await updateProfileField(ctx.userId, "discussionDraftMaxMembers", 20);
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
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    return ctx.reply(messages[lang].chooseLanguage, languageKeyboard());
  }

  if (text === "/menu") {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionMenuNotice(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    if (!userLang) {
      return ctx.reply(messages["fa"].chooseLanguage, languageKeyboard());
    }

    return ctx.reply(messages[userLang].mainMenu, mainMenuKeyboard(userLang));
  }

  if (text === "/profile") {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionMenuNotice(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    return sendProfile(ctx, ctx.user || {}, lang, keyboardLang, { loading: true });
  }

  if (text === ACTIVE_DISCUSSION_HELP_COMMAND) {
    await clearViewedPublicProfileMessage(ctx);
    await clearDiscussionMenuNotice(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
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
    return renderSavedProfileDiscussions(ctx, lang, code);
  }

  if (/^\/u_[a-z0-9]+$/i.test(text)) {
    const code = normalizePublicProfileCode(text);
    const current = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const fromSavedList = current.some((entry) => normalizePublicProfileCode(entry) === code)
      ? await clearSavedProfilesListMessage(ctx)
      : false;
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList });
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
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  sendDiscussionMessageToRecipient,
};
