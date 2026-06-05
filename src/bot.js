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
  profileViewBackKeyboard,
  savedProfilesListKeyboard,
  profileActiveDiscussionHelpKeyboard,
} = require("./keyboards");
const {
  updateProfileField,
  updateUserState,
  removeAiListItem,
} = require("./services/users");
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
  addSavedProfileCode,
  removeSavedProfileCode,
} = require("./services/discussions");
const {
  leaveDiscussionAndNotify,
} = require("./services/discussion-actions");
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
  isCodeSaved,
  buildSavedProfileListItems,
  paginateSavedProfiles,
  buildSavedProfilesListText,
  buildProfileSavedFooter,
} = require("./services/saved-profiles-ui");
const User = require("./models/user");

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

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function clearBottomKeyboardQuietly(ctx) {
  const sent = await ctx.reply(" ", {
    reply_markup: { remove_keyboard: true },
  });
  const messageId = getMessageId(sent);
  if (messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }
}

async function leaveActiveDiscussionForNavigation(ctx) {
  const discussionId = String(ctx.user?.activeDiscussionId || "");
  if (!discussionId) return null;
  const left = await leaveDiscussionAndNotify({ ctx, messages, discussionId });
  if (!left.ok) {
    await updateProfileField(ctx.userId, "activeDiscussionId", null);
  }
  if (ctx.user) ctx.user.activeDiscussionId = null;
  return left;
}

async function leaveDiscussionAndClearKeyboardForNavigation(ctx) {
  const left = await leaveActiveDiscussionForNavigation(ctx);
  if (left) {
    await clearBottomKeyboardQuietly(ctx);
  }
  return left;
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

function normalizeProfileCodeFromActionCommand(value) {
  const raw = String(value || "").trim().replace(/^\/?(remove|report|save|unsave)_/i, "");
  return normalizePublicProfileCode(raw.startsWith("u_") ? raw : `u_${raw}`);
}

function getStartInviteCode(text = "") {
  const value = String(text || "").trim();
  const match = value.match(/^\/start(?:@\w+)?(?:\s+|[?=])(?:join_|d_)([a-z0-9]+)$/i);
  return match ? `d_${match[1].toUpperCase()}` : "";
}

async function clearSavedProfilesListMessage(ctx) {
  const messageId = Number(ctx.user?.savedProfilesLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || !ctx.deleteMessage) return false;
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
  }
  return deleted;
}

async function rememberSavedProfilesListMessage(ctx, message) {
  const messageId = getMessageId(message);
  if (!messageId) return;
  await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", messageId);
}

async function sendSavedProfilesList(ctx, lang, codes = [], page = 0) {
  const items = await buildSavedProfileListItems({
    codes,
    normalizePublicProfileCode,
    findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
      .select("publicProfileCode profileName firstName")
      .lean(),
  });
  const paged = paginateSavedProfiles(items, page);
  const sent = await ctx.reply(
    buildSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex }),
    savedProfilesListKeyboard(lang, {
      page: paged.page,
      totalPages: paged.totalPages,
    }),
  );
  await rememberSavedProfilesListMessage(ctx, sent);
  return sent;
}

async function saveProfileCommand(ctx, lang, text) {
  const code = normalizeProfileCodeFromActionCommand(text);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  const saved = await addSavedProfileCode(ctx.userId, code);
  if (!saved.ok) {
    if (saved.reason === "exists") return ctx.reply(messages[lang].savedProfileAlreadySaved);
    if (saved.reason === "saved_profiles_limit") return ctx.reply(messages[lang].savedProfilesLimit);
    return ctx.reply(messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", saved.items || []);
  return ctx.reply(messages[lang].savedProfileSaved);
}

async function unsaveProfileCommand(ctx, lang, text) {
  const code = normalizeProfileCodeFromActionCommand(text);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  const removed = await removeSavedProfileCode(ctx.userId, code);
  if (!removed.ok) {
    return ctx.reply(removed.reason === "not_found" ? messages[lang].savedProfilesEmpty : messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", removed.items || []);
  await clearSavedProfilesListMessage(ctx);
  await ctx.reply(messages[lang].savedProfileRemoved);
  return sendSavedProfilesList(ctx, lang, removed.items || []);
}

async function showSavedProfileDiscussions(ctx, lang, code) {
  const Discussion = require("./models/discussion");
  const { decorateDiscussionsForList, buildDiscussionListText } = require("./services/discussion-ui");
  const { inlineKeyboard } = require("./keyboards");
  const { callBacks } = require("./constants");
  
  const target = await User.findOne({ publicProfileCode: code });
  if (!target) return ctx.reply(messages[lang].profileCodeNotFound);
  
  const name = target.profileName || target.firstName || "کاربر";
  const titleText = messages[lang].savedProfileDiscussionsTitle.replace("{name}", name);
  
  let textParts = [titleText, ""];
  let hasAny = false;
  
  // Check active discussion
  if (target.activeDiscussionId) {
    const activeDiscussion = await Discussion.findOne({ 
      _id: target.activeDiscussionId, 
      status: "open" 
    }).lean();
    if (activeDiscussion && target.showActiveDiscussionOnProfile) {
      hasAny = true;
      const decorated = await decorateDiscussionsForList(ctx.user, [activeDiscussion]);
      textParts.push(buildDiscussionListText(messages, lang, messages[lang].savedProfileActiveDiscussionTitle, decorated));
      textParts.push("");
    }
  }
  
  // Get created discussions
  const createdDiscussions = await Discussion.find({ 
    creatorUserId: target.userId, 
    status: "open" 
  }).limit(10).lean();
  
  if (createdDiscussions.length > 0) {
    hasAny = true;
    const decorated = await decorateDiscussionsForList(ctx.user, createdDiscussions);
    textParts.push(buildDiscussionListText(messages, lang, messages[lang].savedProfileCreatedDiscussionsTitle, decorated));
  }
  
  if (!hasAny) {
    const noDiscussionsText = messages[lang].savedProfileNoDiscussions.replace("{name}", name);
    const keyboard = inlineKeyboard([[{ text: messages[lang].acknowledgeButton, callback_data: "saved:back" }]]);
    return ctx.reply(noDiscussionsText, keyboard);
  }
  
  const text = textParts.join("\n");
  const keyboard = inlineKeyboard([[{ text: messages[lang].profileBackToSaved, callback_data: callBacks.savedProfiles }]]);
  return ctx.reply(text, keyboard);
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
    await clearBottomKeyboardQuietly(ctx);
    await updateUserState(ctx.userId, "idle");
    return showDiscussionInvitePreviewCommand(ctx, lang, `d_${text.replace(/^\/join_/i, "")}`);
  }

  if (text === "/start") {
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

    const inboundText = messages[lang].discussionMessageInbound
      .replace("{title}", added.discussion.title)
      .replace("{sender}", senderName || "کاربر")
      .replace("{text}", String(text).trim());

    await Promise.all(
      (added.recipients || []).map((recipientUserId) => ctx.sendToUser?.(recipientUserId, inboundText)),
    );
    return true;
  }

  if (text === "/cancel") {
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
    await clearDiscussionMenuNotice(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    return ctx.reply(messages[lang].chooseLanguage, languageKeyboard());
  }

  if (text === "/menu") {
    await clearDiscussionMenuNotice(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    if (!userLang) {
      return ctx.reply(messages["fa"].chooseLanguage, languageKeyboard());
    }

    return ctx.reply(messages[userLang].mainMenu, mainMenuKeyboard(userLang));
  }

  if (text === "/profile") {
    await clearDiscussionMenuNotice(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    return sendProfile(ctx, ctx.user || {}, lang, keyboardLang, { loading: true });
  }

  if (text === ACTIVE_DISCUSSION_HELP_COMMAND) {
    await clearDiscussionMenuNotice(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    return ctx.reply(
      messages[lang].profileActiveDiscussionHelpText,
      profileActiveDiscussionHelpKeyboard(lang),
    );
  }

  if (/^\/d_[a-z0-9]+$/i.test(text)) {
    return openDiscussionCommand(ctx, lang, text);
  }

  if (/^\/leave_[a-z0-9]+$/i.test(text)) {
    return leaveDiscussionCommand(ctx, lang, `d_${text.replace(/^\/leave_/i, "")}`);
  }

  if (/^\/close_[a-z0-9]+$/i.test(text)) {
    return closeDiscussionCommand(ctx, lang, `d_${text.replace(/^\/close_/i, "")}`);
  }

  if (/^\/remove_(u_)?[a-z0-9]+$/i.test(text)) {
    return removeDiscussionMemberCommand(ctx, lang, text);
  }

  if (/^\/report_(u_)?[a-z0-9]+$/i.test(text)) {
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
    return showSavedProfileDiscussions(ctx, lang, code);
  }

  if (/^\/u_[a-z0-9]+$/i.test(text)) {
    const code = normalizePublicProfileCode(text);
    
    // Send loading message
    const loadingMsg = await ctx.reply(messages[lang].profileLoading);
    
    const target = await User.findOne({ publicProfileCode: code });
    if (!target) {
      await ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
      return ctx.reply(messages[lang].profileCodeNotFound);
    }
    const current = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const isSaved = isCodeSaved(current, code);
    const fromSavedList = isSaved ? await clearSavedProfilesListMessage(ctx) : false;
    
    // Only show footer if NOT from saved list AND viewer has active discussion
    let footerText;
    if (!fromSavedList && ctx.user?.activeDiscussionId) {
      footerText = buildProfileSavedFooter(messages, lang, code, isSaved);
    }
    
    const result = await sendProfileMessage({
      ctx,
      user: target,
      lang,
      keyboard: fromSavedList ? profileViewBackKeyboard(lang) : undefined,
      messages,
      defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
      isOwnProfile: false,
      footerText,
    });
    
    await ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
    return result;
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
};
