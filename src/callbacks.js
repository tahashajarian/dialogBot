const messages = require("./messages");
const { setLanguage, detectLanguage, normalizeLang } = require("./lang");
const {
  inlineKeyboard,
  mainMenuKeyboard,
  helpKeyboard,
  helpRulesKeyboard,
  languageKeyboard,
  aiAssistantKeyboard,
  discussionsMenuKeyboard,
  discussionRoomKeyboard,
  discussionRemoveMembersKeyboard,
  onboardingWelcomeKeyboard,
} = require("./keyboards");
const { callBacks } = require("./constants");
const { formatOperationalLimitsText } = require("./services/operational-limits-ui");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
} = require("./services/stars-ui");
const {
  getMessageId,
  removeBottomKeyboard,
  replyWithRemovedKeyboardThenInline,
  leaveDiscussionAndClearKeyboardForNavigation,
} = require("./services/bot-navigation");
const {
  getDiscussionErrorMessage,
  getDiscussionDisplayTitle,
} = require("./services/discussion-ui");
const {
  formatDiscussionRoom,
  formatDiscussionRoomFollowup,
  formatDiscussionMemberLines,
} = require("./services/discussion-room-ui");
const User = require("./models/user");
const Discussion = require("./models/discussion");
const { updateUserState } = require("./services/users");
const {
  joinOrOpenDiscussion,
  ensurePublicProfileCode,
  ensurePublicDiscussionCode,
  normalizePublicProfileCode,
} = require("./services/discussions");
const {
  closeDiscussionAndNotify,
  joinDiscussionAndNotify,
  leaveDiscussionAndNotify,
  removeDiscussionMemberAndNotify,
} = require("./services/discussion-actions");
const {
  clearRememberedDiscussionRoomCards,
  rememberDiscussionRoomCards,
  rememberDiscussionMembersMessage,
  clearDiscussionMembersMessage,
  clearDiscussionListMessage,
  clearDiscussionMenuNotice,
  rememberDiscussionMenuNotice,
  shouldKeepDiscussionRoomCardsForCallback,
  handleDiscussionListCallback,
  isDiscussionCreateFlowCallback,
  isDiscussionCreateState,
  isDiscussionListCallback,
  renderActiveDiscussionList,
  sendDiscussionJoinErrorAck,
} = require("./flows/discussions-callbacks");
const {
  isDiscussionCreateCallback,
  handleDiscussionCreateCallback,
} = require("./flows/discussions-create-callbacks");
const {
  joinDiscussionFromInvite,
  showDiscussionInvitePreviewCommand,
  sendShareableInviteForActiveDiscussion,
} = require("./flows/discussions-text");
const {
  handleDiscussionInvitationCallback,
  getInvitationCount,
  isDiscussionInvitationCallback,
  renderInvitationsList,
} = require("./flows/discussion-invitations");
const {
  handleAiCallback,
  isAiCallback,
} = require("./flows/ai-callbacks");
const {
  clearAiPendingInputPrompt,
} = require("./flows/ai-input-prompts");
const {
  isAiTextState,
} = require("./flows/ai-text");
const {
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
  shouldKeepAiListTitleForCallback,
} = require("./flows/ai-cards");
const {
  handleProfileSettingsOrEditCallback,
  isProfileSettingsOrEditCallback,
  sendOwnProfile,
} = require("./flows/profile-callbacks");
const {
  handleDiscussionBoostCallback,
  isDiscussionBoostCallback,
} = require("./flows/discussion-boosts");
const { requireDiscussionProfileName } = require("./flows/discussion-name-gate");
const {
  clearViewedPublicProfileMessage,
  forgetPeopleListMessage,
  forgetSavedProfilesListMessage,
  handleSavedProfilesCallback,
  isSavedProfilesCallback,
  renderSavedProfileDiscussions,
  saveProfileByCode,
  sendPublicProfileByCode,
  sendSavedProfilesList,
  unsaveProfileByCode,
} = require("./flows/saved-profiles");
const {
  handleOnboardingCallback,
  isOnboardingCallback,
} = require("./flows/onboarding");

function discussionCloseConfirmKeyboard(lang, discussionId) {
  return inlineKeyboard([
    [{ text: messages[lang].discussionCloseConfirmYes, callback_data: `${callBacks.discussionCloseConfirm}${discussionId}` }],
    [{ text: messages[lang].discussionCloseConfirmNo, callback_data: `${callBacks.discussionCloseCancel}${discussionId}` }],
  ]);
}

async function editCallbackMessageOrReply(ctx, text, keyboard) {
  if (ctx.callbackMessageId && ctx.editMessageText) {
    const edited = await ctx.editMessageText(ctx.callbackMessageId, text, keyboard);
    if (edited) {
      return edited;
    }
  }

  return ctx.reply(text, keyboard);
}

async function clearDiscussionCardsAfterVisibleReply(ctx, exceptMessageIds = []) {
  try {
    await clearDiscussionListMessage(ctx, exceptMessageIds);
    await clearDiscussionMenuNotice(ctx, exceptMessageIds);
    await retireCallbackMessageIfPossible(ctx);
  } catch {
    // Cleanup is best-effort; visible user feedback must not depend on it.
  }
}

async function deleteCallbackMessageIfPossible(ctx) {
  if (!ctx.callbackMessageId || !ctx.deleteMessage) {
    return false;
  }

  return ctx.deleteMessage(ctx.callbackMessageId);
}

async function removeCallbackInlineKeyboardIfPossible(ctx) {
  if (!ctx.callbackMessageId || !ctx.editMessageReplyMarkup) {
    return false;
  }
  return ctx.editMessageReplyMarkup(ctx.callbackMessageId, { inline_keyboard: [] });
}

async function retireCallbackMessageIfPossible(ctx) {
  if (!ctx.callbackMessageId) {
    return false;
  }
  const deleted = await deleteCallbackMessageIfPossible(ctx);
  if (deleted) {
    return true;
  }
  return removeCallbackInlineKeyboardIfPossible(ctx);
}

function isProfileCallbackMessage(ctx) {
  const message = ctx.callbackMessage || {};
  return Boolean(message.caption || message.photo || message.document);
}

function hasTemporaryReplyKeyboard(ctx) {
  const state = String(ctx.user?.state || "");
  return Boolean(
    isAiTextState(state)
    || state === "editing_location"
    || ctx.user?.activeDiscussionId,
  );
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
    return [
      "aiActionMessageId",
      "aiLastListMessageId",
      "aiSectionEntryMessageId",
    ];
  }

  if (isSavedProfilesCallback(data) || data.startsWith(callBacks.profileSaveByCode) || data.startsWith(callBacks.profileUnsaveByCode)) {
    return [
      "savedProfilesLastListMessageId",
      "peopleLastListMessageId",
      "publicProfileLastMessageId",
      "discussionLastListMessageId",
    ];
  }

  if (
    isDiscussionListCallback(data) ||
    isDiscussionCreateFlowCallback(data) ||
    isDiscussionInvitationCallback(data) ||
    data === callBacks.discussions ||
    data.startsWith(callBacks.discussionOpen) ||
    data.startsWith(callBacks.discussionInviteJoin) ||
    data.startsWith(callBacks.discussionLeave) ||
    data.startsWith(callBacks.discussionClose) ||
    data.startsWith(callBacks.discussionMembers) ||
    data.startsWith(callBacks.discussionRemoveMemberPicker) ||
    data.startsWith(callBacks.discussionRemoveMember)
  ) {
    return [
      "discussionLastListMessageId",
      "discussionMenuNoticeMessageId",
      "discussionLastMembersMessageId",
      "discussionLastRoomHeaderMessageId",
      "discussionLastRoomRecentMessageId",
    ];
  }

  if (
    data === callBacks.profile ||
    isProfileSettingsOrEditCallback(data) ||
    data.startsWith(callBacks.profileViewByCode)
  ) {
    return ["publicProfileLastMessageId"];
  }

  return [];
}

async function retireStaleCallbackCardIfNeeded(ctx, data = "") {
  const callbackMessageId = positiveMessageId(ctx.callbackMessageId);
  if (!callbackMessageId) return false;

  const fields = getStaleCallbackFields(data);
  if (!fields.length || isCurrentRememberedMessage(ctx, callbackMessageId, fields)) {
    return false;
  }

  const latestMessageId = getLatestRememberedMessageId(ctx, fields);
  if (latestMessageId <= callbackMessageId) {
    return false;
  }

  await ctx.answerCb?.();
  await retireCallbackMessageIfPossible(ctx);
  return true;
}

async function showInlineMenuAfterNavigation(ctx, text, keyboard, { forceClearKeyboard = false } = {}) {
  if (forceClearKeyboard || hasTemporaryReplyKeyboard(ctx)) {
    await deleteCallbackMessageIfPossible(ctx);
    return replyWithRemovedKeyboardThenInline(ctx, text, keyboard);
  }
  return editCallbackMessageOrReply(ctx, text, keyboard);
}

async function sendDiscussionRoom(ctx, lang, discussion) {
  const headerMessage = await ctx.reply(formatDiscussionRoom(messages, lang, discussion));
  const recentMessage = await ctx.reply(
    formatDiscussionRoomFollowup(messages, lang, discussion),
    discussionRoomKeyboard(lang, discussion.creatorUserId === ctx.userId),
  );
  await clearRememberedDiscussionRoomCards(ctx, [
    ctx.callbackMessageId,
    getMessageId(headerMessage),
    getMessageId(recentMessage),
  ]);
  await retireCallbackMessageIfPossible(ctx);
  await rememberDiscussionRoomCards(ctx, headerMessage, recentMessage);
  return recentMessage;
}

function formatDiscussionLeftMessage(lang, discussion = {}) {
  return messages[lang].discussionLeft.replace(
    "{title}",
    getDiscussionDisplayTitle(messages, lang, discussion) || "-",
  );
}

function formatDiscussionClosedMessage(lang, discussion = {}) {
  return messages[lang].discussionClosed.replace(
    "{title}",
    getDiscussionDisplayTitle(messages, lang, discussion) || "-",
  );
}

async function handleCallback(ctx) {
  const data = ctx.callbackData || "";
  const lang = detectLanguage(ctx);

  if (!data) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
  }

  if (await retireStaleCallbackCardIfNeeded(ctx, data)) {
    return null;
  }

  if (isOnboardingCallback(data)) {
    return handleOnboardingCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
    });
  }

  if (!isAiCallback(data)) {
    await clearAiPendingInputPrompt(ctx);
  }

  if (!shouldKeepAiListTitleForCallback(data, isAiCallback)) {
    await clearRememberedAiListMessage(ctx);
  }
  if (!shouldKeepAiListTitleForCallback(data, isAiCallback)) {
    await clearAiSectionEntryMessage(ctx, [ctx.callbackMessageId]);
  }
  if (!shouldKeepDiscussionRoomCardsForCallback(data)) {
    await clearRememberedDiscussionRoomCards(ctx, [ctx.callbackMessageId]);
  }
  if (!shouldKeepDiscussionRoomCardsForCallback(data)) {
    await clearDiscussionMenuNotice(ctx, [ctx.callbackMessageId]);
  }

  // menu routes
  if (data === callBacks.menuMain) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    await forgetSavedProfilesListMessage(ctx);
    await forgetPeopleListMessage(ctx);
    return showInlineMenuAfterNavigation(ctx, messages[lang].mainMenu, mainMenuKeyboard(lang), {
      forceClearKeyboard: shouldClearKeyboard,
    });
  }

  if (data === callBacks.help) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    await forgetPeopleListMessage(ctx);
    return showInlineMenuAfterNavigation(ctx, messages[lang].helpText, helpKeyboard(lang), {
      forceClearKeyboard: shouldClearKeyboard,
    });
  }

  if (data === callBacks.helpRules) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    await forgetPeopleListMessage(ctx);
    return showInlineMenuAfterNavigation(ctx, formatOperationalLimitsText(messages[lang].helpRulesText), helpRulesKeyboard(lang), {
      forceClearKeyboard: shouldClearKeyboard,
    });
  }

  if (data === callBacks.language) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    await forgetPeopleListMessage(ctx);
    return showInlineMenuAfterNavigation(ctx, messages[lang].chooseLanguage, languageKeyboard(), {
      forceClearKeyboard: shouldClearKeyboard,
    });
  }

  if (data === callBacks.profile) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    await forgetPeopleListMessage(ctx);
    await deleteCallbackMessageIfPossible(ctx);
    if (shouldClearKeyboard) {
      await removeBottomKeyboard(ctx, messages[lang].profile);
    }
    return sendOwnProfile(ctx, lang, ctx.user || {}, { loading: true });
  }

  if (data === callBacks.aiAssistant) {
    await ctx.answerCb?.(messages[lang].aiAssistant);
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    await forgetSavedProfilesListMessage(ctx);
    await forgetPeopleListMessage(ctx);
    return showInlineMenuAfterNavigation(
      ctx,
      `${messages[lang].aiAssistant}\n\n${messages[lang].aiAssistantMenu}`,
      aiAssistantKeyboard(lang),
      { forceClearKeyboard: shouldClearKeyboard },
    );
  }

  if (data === callBacks.discussions) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    await forgetPeopleListMessage(ctx);
    const invitationCount = await getInvitationCount(ctx.userId);
    return showInlineMenuAfterNavigation(
      ctx,
      messages[lang].discussionsMenu,
      discussionsMenuKeyboard(lang, { invitationCount: Number(invitationCount) || 0 }),
      { forceClearKeyboard: shouldClearKeyboard },
    );
  }

  if (isDiscussionCreateFlowCallback(data) && !isDiscussionCreateState(ctx.user?.state || "")) {
    await ctx.answerCb?.(messages[lang].unknownAction.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
    return deleteCallbackMessageIfPossible(ctx);
  }

  if (isSavedProfilesCallback(data)) {
    return handleSavedProfilesCallback(ctx, lang, {
      clearRememberedAiListMessage,
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      isProfileCallbackMessage,
      leaveDiscussionAndClearKeyboardForNavigation,
      removeBottomKeyboard,
      replyWithRemovedKeyboardThenInline,
    });
  }

  if (isDiscussionListCallback(data)) {
    return handleDiscussionListCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      renderSavedProfileDiscussions,
      renderInvitationsList,
    });
  }

  if (isDiscussionInvitationCallback(data)) {
    return handleDiscussionInvitationCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      sendShareableInviteForActiveDiscussion,
      sendSavedProfilesList,
    });
  }

  if (isDiscussionBoostCallback(data)) {
    return handleDiscussionBoostCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
    });
  }

  if (isDiscussionCreateCallback(data)) {
    return handleDiscussionCreateCallback(ctx, lang, {
      editCallbackMessageOrReply,
      deleteCallbackMessageIfPossible,
      clearDiscussionMenuNotice,
      rememberDiscussionMenuNotice,
      sendDiscussionRoom,
    });
  }

  if (data.startsWith(callBacks.discussionOpen)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionOpen, "");
    const discussion = await Discussion.findById(discussionId);
    if (!discussion) {
      return sendDiscussionJoinErrorAck(ctx, lang, "missing_discussion", "active", {
        retireCallbackMessageIfPossible,
      });
    }
    const codeResult = await ensurePublicDiscussionCode(discussion);
    if (!codeResult.ok) {
      return ctx.reply(messages[lang].unknownAction);
    }
    const hasName = await requireDiscussionProfileName(ctx, lang, {
      source: "open",
      token: codeResult.code,
      beforePrompt: () => clearDiscussionListMessage(ctx),
    });
    if (!hasName) return true;
    const joined = await joinDiscussionAndNotify({
      ctx,
      messages,
      discussionId,
    });
    if (!joined.ok) {
      await ctx.answerCb?.();
      return sendDiscussionJoinErrorAck(ctx, lang, joined.reason, "active", {
        discussion,
        retireCallbackMessageIfPossible,
      });
    }
    applyStarRewardsToContext(ctx, joined.starRewards);
    const starNotice = buildStarRewardNotice(messages, lang, joined.starRewards);
    await ctx.reply([
      joined.joined ? messages[lang].discussionJoined : messages[lang].discussionOpened,
      starNotice,
    ].filter(Boolean).join("\n\n"));
    const roomMessage = await sendDiscussionRoom(ctx, lang, joined.discussion);
    await clearDiscussionCardsAfterVisibleReply(ctx, [getMessageId(roomMessage)]);
    return roomMessage;
  }

  if (data.startsWith(callBacks.discussionInviteJoin)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.discussionInviteJoin, "");
    return joinDiscussionFromInvite(ctx, lang, code, {
      editMessage: (text, keyboard) => editCallbackMessageOrReply(ctx, text, keyboard),
      clearListMessage: () => {},
      clearMenuNotice: () => {},
      sendRoom: (roomCtx, roomLang, discussion) => sendDiscussionRoom(roomCtx, roomLang, discussion),
    });
  }

  if (data === callBacks.discussionLeave || data.startsWith(callBacks.discussionLeave)) {
    await ctx.answerCb?.();
    const explicitId = data.startsWith(callBacks.discussionLeave)
      ? data.replace(callBacks.discussionLeave, "")
      : "";
    const discussionId = explicitId || String(ctx.user?.activeDiscussionId || "");
    if (!discussionId) {
      return ctx.reply(messages[lang].discussionNotMember);
    }
    const left = await leaveDiscussionAndNotify({
      ctx,
      messages,
      discussionId,
    });
    if (!left.ok) {
      return ctx.reply(messages[lang].discussionNotMember);
    }
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    await clearDiscussionListMessage(ctx, [ctx.callbackMessageId]);
    return editCallbackMessageOrReply(
      ctx,
      `${formatDiscussionLeftMessage(lang, left?.discussion)}\n\n${messages[lang].discussionsMenu}`,
      discussionsMenuKeyboard(lang),
    );
  }

  if (
    data.startsWith(callBacks.discussionClose) &&
    !data.startsWith(callBacks.discussionCloseConfirm) &&
    !data.startsWith(callBacks.discussionCloseCancel)
  ) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionClose, "");
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionCloseConfirmPrompt,
      discussionCloseConfirmKeyboard(lang, discussionId),
    );
  }

  if (data.startsWith(callBacks.discussionCloseConfirm)) {
    await ctx.answerCb?.();
    await clearDiscussionMenuNotice(ctx);
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    await clearRememberedDiscussionRoomCards(ctx);
    await clearDiscussionListMessage(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible(ctx);
    const discussionId = data.replace(callBacks.discussionCloseConfirm, "");
    
    const closed = await closeDiscussionAndNotify({
      ctx,
      messages,
      discussionId,
      discussionsMenuKeyboard,
    });
    if (!closed.ok) {
      return ctx.reply(getDiscussionErrorMessage(messages, lang, closed.reason));
    }

    return editCallbackMessageOrReply(
      ctx,
      `${formatDiscussionClosedMessage(lang, closed.discussion)}\n\n${messages[lang].discussionsMenu}`,
      discussionsMenuKeyboard(lang),
    );
  }

  if (data.startsWith(callBacks.discussionCloseCancel)) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible(ctx);
    const discussionId = data.replace(callBacks.discussionCloseCancel, "");
    const opened = await joinOrOpenDiscussion(ctx.userId, discussionId);
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
      return ctx.reply(errorText);
    }
    return sendDiscussionRoom(ctx, lang, opened.discussion);
  }

  if (data.startsWith(callBacks.discussionMembers)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionMembers, "");
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    const opened = await joinOrOpenDiscussion(ctx.userId, discussionId);
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
      return ctx.reply(errorText);
    }
    const memberUsers = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName publicProfileCode")
      .lean();
    await Promise.all(memberUsers.map((entry) => ensurePublicProfileCode(entry.userId)));
    const refreshed = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName publicProfileCode")
      .lean();
    const rows = formatDiscussionMemberLines(messages, lang, refreshed, opened.discussion.creatorUserId, ctx.userId, opened.discussion._id);
    const membersMessage = await editCallbackMessageOrReply(
      ctx,
      `${messages[lang].discussionMembersTitle}\n\n${rows.join("\n")}`,
      { reply_markup: { inline_keyboard: [] } },
    );
    await rememberDiscussionMembersMessage(ctx, ctx.callbackMessageId || membersMessage);
    return membersMessage;
  }

  if (data.startsWith(callBacks.discussionRemoveMemberPicker)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionRemoveMemberPicker, "");
    const opened = await joinOrOpenDiscussion(ctx.userId, discussionId);
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
      return ctx.reply(errorText);
    }
    if (opened.discussion.creatorUserId !== ctx.userId) {
      const errorText = getDiscussionErrorMessage(messages, lang, "not_owner");
      await ctx.answerCb?.(errorText.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
      return ctx.reply(errorText);
    }
    const memberUsers = await User.find({
      userId: {
        $in: opened.discussion.memberUserIds.filter((id) => id !== ctx.userId),
      },
    }).select("userId profileName firstName publicProfileCode").lean();
    await Promise.all(memberUsers.map((entry) => ensurePublicProfileCode(entry.userId)));
    const refreshed = await User.find({
      userId: {
        $in: opened.discussion.memberUserIds.filter((id) => id !== ctx.userId),
      },
    }).select("userId profileName firstName publicProfileCode").lean();
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionRemoveMember,
      discussionRemoveMembersKeyboard(lang, String(opened.discussion._id), refreshed),
    );
  }

  if (data.startsWith(callBacks.discussionRemoveMember)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.discussionRemoveMember, "");
    const [discussionId = "", memberCodeRaw = ""] = payload.split(":");
    const memberCode = normalizePublicProfileCode(memberCodeRaw);
    const member = memberCode
      ? await User.findOne({ publicProfileCode: memberCode }).select("userId").lean()
      : null;
    const memberUserId = Number(member?.userId);
    if (!discussionId || !Number.isInteger(memberUserId)) return ctx.reply(getDiscussionErrorMessage(messages, lang, "not_member"));
    const removed = await removeDiscussionMemberAndNotify({
      ctx,
      messages,
      discussionId,
      memberUserId,
      discussionsMenuKeyboard,
    });
    if (!removed.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, removed.reason));
    await deleteCallbackMessageIfPossible(ctx);

    return ctx.reply(messages[lang].discussionMemberRemoved.replace("{name}", removed.removedMemberName || "عضو"));
  }

  if (data.startsWith(callBacks.profileViewByCode)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.profileViewByCode, "");
    await deleteCallbackMessageIfPossible(ctx);
    await clearDiscussionMembersMessage(ctx);
    return sendPublicProfileByCode(ctx, lang, code);
  }

  if (data.startsWith(callBacks.profileSaveByCode)) {
    const code = data.replace(callBacks.profileSaveByCode, "");
    await deleteCallbackMessageIfPossible(ctx);
    await ctx.answerCb?.(messages[lang].savedProfileSaved);
    return saveProfileByCode(ctx, lang, code);
  }

  if (data.startsWith(callBacks.profileUnsaveByCode)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.profileUnsaveByCode, "");
    await deleteCallbackMessageIfPossible(ctx);
    return unsaveProfileByCode(ctx, lang, code, { refreshProfile: true });
  }

  if (isAiCallback(data)) {
    return handleAiCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      removeBottomKeyboard,
      replyWithRemovedKeyboardThenInline,
    });
  }

  if (isProfileSettingsOrEditCallback(data)) {
    return handleProfileSettingsOrEditCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      leaveDiscussionAndClearKeyboardForNavigation,
      removeBottomKeyboard,
      renderActiveDiscussionList,
      renderInvitationsList,
      retireCallbackMessageIfPossible,
      showDiscussionInvitePreviewCommand,
    });
  }

  // language routes
  if (data.startsWith(callBacks.langSet)) {
    const raw = data.split(":")[2];
    const selected = normalizeLang(raw); // fa/en

    await ctx.answerCb?.();

    if (!selected) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const userId = ctx.user?.userId;
    if (!userId) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const ok = await setLanguage(userId, selected); // DB update + normalize inside too
    if (!ok) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const newLang = selected;
    const onboardingState = String(ctx.user?.state || "");

    if (onboardingState === "onboarding_language") {
      const rawUserName = ctx.user?.profileName || ctx.user?.firstName || "";
      const userName = rawUserName.trim().replace(/\s+/g, " ");
      const welcomeMessage = userName
        ? messages[newLang].onboardingWelcomeWithName.replace("{name}", userName)
        : messages[newLang].onboardingWelcome;
      await updateUserState(ctx.userId, "onboarding_welcome");
      return editCallbackMessageOrReply(
        ctx,
        welcomeMessage,
        onboardingWelcomeKeyboard(newLang),
      );
    }

    if (onboardingState.startsWith("onboarding_invite_language:")) {
      const inviteCode = onboardingState.slice("onboarding_invite_language:".length);
      const rawUserName = ctx.user?.profileName || ctx.user?.firstName || "";
      const userName = rawUserName.trim().replace(/\s+/g, " ");
      const welcomeMessage = userName
        ? messages[newLang].discussionInviteWelcomeWithName.replace("{name}", userName)
        : messages[newLang].discussionInviteWelcome;
      await updateUserState(ctx.userId, "idle");
      await editCallbackMessageOrReply(ctx, welcomeMessage);
      return showDiscussionInvitePreviewCommand(ctx, newLang, inviteCode);
    }

    try {
      // Telegraf editMessageText: (text, extra)
      return await ctx.editMessage(
        messages[newLang].languageChanged,
        mainMenuKeyboard(newLang)
      );
    } catch {
      return await ctx.reply(
        messages[newLang].languageChanged,
        mainMenuKeyboard(newLang)
      );
    }
  }

  await ctx.answerCb?.();
  return ctx.reply(messages[lang].unknownAction);
}

module.exports = { handleCallback };
