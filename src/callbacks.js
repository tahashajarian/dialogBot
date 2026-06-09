const messages = require("./messages");
const { setLanguage, detectLanguage, normalizeLang } = require("./lang");
const {
  inlineKeyboard,
  mainMenuKeyboard,
  languageKeyboard,
  aiAssistantKeyboard,
  discussionsMenuKeyboard,
  discussionRoomKeyboard,
  discussionRemoveMembersKeyboard,
} = require("./keyboards");
const { callBacks } = require("./constants");
const {
  updateProfileField,
} = require("./services/users");
const {
  getDiscussionErrorMessage,
} = require("./services/discussion-ui");
const {
  formatDiscussionRoom,
  formatRecentDiscussionMessages,
  formatDiscussionMemberLines,
} = require("./services/discussion-room-ui");
const User = require("./models/user");
const {
  joinOrSwitchActiveDiscussion,
  ensurePublicProfileCode,
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
  sendDiscussionJoinErrorAck,
} = require("./flows/discussions-callbacks");
const {
  isDiscussionCreateCallback,
  handleDiscussionCreateCallback,
} = require("./flows/discussions-create-callbacks");
const {
  joinDiscussionFromInvite,
} = require("./flows/discussions-text");
const {
  handleAiCallback,
  isAiCallback,
} = require("./flows/ai-callbacks");
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
  clearViewedPublicProfileMessage,
  forgetSavedProfilesListMessage,
  handleSavedProfilesCallback,
  isSavedProfilesCallback,
  renderSavedProfileDiscussions,
  saveProfileByCode,
  sendPublicProfileByCode,
  unsaveProfileByCode,
} = require("./flows/saved-profiles");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function removeBottomKeyboard(ctx, text) {
  const sent = await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
  const messageId = getMessageId(sent);
  if (messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }
}

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

async function sendDiscussionRoom(ctx, lang, discussion) {
  const headerMessage = await ctx.reply(formatDiscussionRoom(messages, lang, discussion));
  const recentMessage = await ctx.reply(
    `${formatRecentDiscussionMessages(messages, lang, discussion)}\n\n${messages[lang].discussionRoomSendHint}`,
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
    await removeBottomKeyboard(ctx, " ");
  }
  return left;
}

function formatDiscussionLeftMessage(lang, discussionTitle = "") {
  return messages[lang].discussionLeft.replace("{title}", discussionTitle || "-");
}

function formatDiscussionClosedMessage(lang, discussionTitle = "") {
  return messages[lang].discussionClosed.replace("{title}", discussionTitle || "-");
}

async function handleCallback(ctx) {
  const data = ctx.callbackData || "";
  const lang = detectLanguage(ctx);

  if (!data) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
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
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    if (isAiTextState(ctx.user?.state)) {
      await removeBottomKeyboard(ctx, " ");
    }
    await forgetSavedProfilesListMessage(ctx);
    return editCallbackMessageOrReply(ctx, messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === callBacks.language) {
    await ctx.answerCb?.();
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    return editCallbackMessageOrReply(ctx, messages[lang].chooseLanguage, languageKeyboard());
  }

  if (data === callBacks.profile) {
    await ctx.answerCb?.();
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    if (isAiTextState(ctx.user?.state)) {
      await removeBottomKeyboard(ctx, " ");
    }
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    await deleteCallbackMessageIfPossible(ctx);
    return sendOwnProfile(ctx, lang, ctx.user || {}, { loading: true });
  }

  if (data === callBacks.aiAssistant) {
    await ctx.answerCb?.(messages[lang].aiAssistant);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    await forgetSavedProfilesListMessage(ctx);
    return editCallbackMessageOrReply(
      ctx,
      `${messages[lang].aiAssistant}\n\n${messages[lang].aiAssistantMenu}`,
      aiAssistantKeyboard(lang),
    );
  }

  if (data === callBacks.discussions) {
    await ctx.answerCb?.();
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    if (isAiTextState(ctx.user?.state)) {
      await removeBottomKeyboard(ctx, " ");
    }
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionsMenu,
      discussionsMenuKeyboard(lang),
    );
  }

  if (isDiscussionCreateFlowCallback(data) && !isDiscussionCreateState(ctx.user?.state || "")) {
    await ctx.answerCb?.(messages[lang].unknownAction.replace(/^🤖\s*/, ""));
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
    });
  }

  if (isDiscussionListCallback(data)) {
    return handleDiscussionListCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      renderSavedProfileDiscussions,
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
    const joined = await joinDiscussionAndNotify({
      ctx,
      messages,
      discussionId,
    });
    if (!joined.ok) {
      await ctx.answerCb?.();
      return sendDiscussionJoinErrorAck(ctx, lang, joined.reason, "active", {
        retireCallbackMessageIfPossible,
      });
    }
    await ctx.reply(joined.joined ? messages[lang].discussionJoined : messages[lang].discussionSwitched);
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
    const discussionTitle = left?.discussionTitle || "";
    return editCallbackMessageOrReply(
      ctx,
      `${formatDiscussionLeftMessage(lang, discussionTitle)}\n\n${messages[lang].discussionsMenu}`,
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
      `${formatDiscussionClosedMessage(lang, closed.discussionTitle)}\n\n${messages[lang].discussionsMenu}`,
      discussionsMenuKeyboard(lang),
    );
  }

  if (data.startsWith(callBacks.discussionCloseCancel)) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible(ctx);
    const discussionId = data.replace(callBacks.discussionCloseCancel, "");
    const opened = await joinOrSwitchActiveDiscussion(ctx.userId, discussionId);
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^🤖\s*/, ""));
      return ctx.reply(errorText);
    }
    return sendDiscussionRoom(ctx, lang, opened.discussion);
  }

  if (data.startsWith(callBacks.discussionMembers)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionMembers, "");
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    const opened = await joinOrSwitchActiveDiscussion(ctx.userId, discussionId);
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^🤖\s*/, ""));
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
    const opened = await joinOrSwitchActiveDiscussion(ctx.userId, discussionId);
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^🤖\s*/, ""));
      return ctx.reply(errorText);
    }
    if (opened.discussion.creatorUserId !== ctx.userId) {
      const errorText = getDiscussionErrorMessage(messages, lang, "not_owner");
      await ctx.answerCb?.(errorText.replace(/^🤖\s*/, ""));
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
    });
  }

  if (isProfileSettingsOrEditCallback(data)) {
    return handleProfileSettingsOrEditCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      leaveDiscussionAndClearKeyboardForNavigation,
      removeBottomKeyboard,
      retireCallbackMessageIfPossible,
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
