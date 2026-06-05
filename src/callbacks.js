const messages = require("./messages");
const path = require("path");
const { setLanguage, detectLanguage, normalizeLang } = require("./lang");
const {
  inlineKeyboard,
  mainMenuKeyboard,
  languageKeyboard,
  aiAssistantKeyboard,
  profileKeyboard,
  profileSettingsKeyboard,
  profileActiveDiscussionHelpKeyboard,
  ageKeyboard,
  ageRangeKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  cancelEditKeyboard,
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionRoomKeyboard,
  discussionRemoveMembersKeyboard,
  discussionJoinErrorAckKeyboard,
  savedProfilesListKeyboard,
} = require("./keyboards");
const { callBacks } = require("./constants");
const {
  updateProfileField,
  updateUserState,
} = require("./services/users");
const { sendProfileMessage, toPlainUser } = require("./services/profile");
const {
  getDiscussionErrorMessage,
  decorateDiscussionsForList,
  paginateDiscussions,
  buildDiscussionListText,
} = require("./services/discussion-ui");
const {
  buildSavedProfilesListText,
} = require("./services/saved-profiles-ui");
const {
  formatDiscussionRoom,
  formatRecentDiscussionMessages,
  formatDiscussionMemberLines,
} = require("./services/discussion-room-ui");
const User = require("./models/user");
const {
  listActiveDiscussions,
  listMyDiscussions,
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
  rememberDiscussionListMessage,
  rememberDiscussionMembersMessage,
  clearDiscussionMembersMessage,
  clearDiscussionListMessage,
  clearDiscussionMenuNotice,
  rememberDiscussionMenuNotice,
  shouldKeepDiscussionRoomCardsForCallback,
  isDiscussionCreateFlowCallback,
  isDiscussionCreateState,
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
  clearProfileEditPrompt,
  sendProfileEditPrompt,
  startProfileEdit,
} = require("./flows/profile-edit");
const {
  buildSavedProfilePage,
  clearSavedProfilesListMessage,
  clearViewedPublicProfileMessage,
  forgetSavedProfilesListMessage,
  rememberSavedProfilesListMessage,
  renderSavedProfileDiscussions,
  saveProfileByCode,
  sendPublicProfileByCode,
  sendSavedProfilesList,
  unsaveProfileByCode,
} = require("./flows/saved-profiles");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "assets", "default_profile.png");

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

async function sendDiscussionJoinErrorAck(ctx, lang, reason, listType = "active") {
  const errorText = getDiscussionErrorMessage(messages, lang, reason);
  await retireCallbackMessageIfPossible(ctx);
  await clearDiscussionListMessage(ctx);
  const errorNotice = await ctx.reply(errorText, discussionJoinErrorAckKeyboard(lang, listType));
  await rememberDiscussionMenuNotice(ctx, errorNotice);
  return errorNotice;
}

async function renderActiveDiscussionList(ctx, lang, page = 0, joinableOnly = false) {
  const result = await listActiveDiscussions({ limit: 100 });
  if (!result.discussions.length) {
    await ctx.answerCb?.(messages[lang].discussionListEmpty.replace(/^🤖\s*/, ""));
    return editCallbackMessageOrReply(ctx, messages[lang].discussionListEmpty, discussionsMenuKeyboard(lang));
  }
  await ctx.answerCb?.();
  const decorated = await decorateDiscussionsForList(ctx.user, result.discussions);
  const filtered = joinableOnly ? decorated.filter((entry) => entry.isJoinable) : decorated;
  if (!filtered.length) {
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionListJoinableEmpty,
      discussionListNavigationKeyboard(lang, {
        listType: "active",
        page: 0,
        totalPages: 1,
        joinableOnly,
      }),
    );
    await rememberDiscussionListMessage(ctx, "active", ctx.callbackMessageId || listMessage);
    return listMessage;
  }
  const paged = paginateDiscussions(filtered, page);
  const listMessage = await editCallbackMessageOrReply(
    ctx,
    buildDiscussionListText(messages, lang, messages[lang].discussionActiveList, paged.items, {
      startIndex: paged.startIndex,
    }),
    discussionListNavigationKeyboard(lang, {
      listType: "active",
      page: paged.page,
      totalPages: paged.totalPages,
      joinableOnly,
    }),
  );
  await rememberDiscussionListMessage(ctx, "active", ctx.callbackMessageId || listMessage);
  return listMessage;
}

async function renderMyDiscussionList(ctx, lang, page = 0) {
  const result = await listMyDiscussions(ctx.userId, { limit: 100 });
  if (!result.ok) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
  }
  if (!result.discussions.length) {
    await ctx.answerCb?.(messages[lang].discussionListMineEmpty.replace(/^🤖\s*/, ""));
    return editCallbackMessageOrReply(ctx, messages[lang].discussionListMineEmpty, discussionsMenuKeyboard(lang));
  }
  await ctx.answerCb?.();
  const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, true);
  const paged = paginateDiscussions(decorated, page);
  const listMessage = await editCallbackMessageOrReply(
    ctx,
    buildDiscussionListText(messages, lang, messages[lang].discussionMyList, paged.items, {
      startIndex: paged.startIndex,
    }),
    discussionListNavigationKeyboard(lang, {
      listType: "mine",
      page: paged.page,
      totalPages: paged.totalPages,
    }),
  );
  await rememberDiscussionListMessage(ctx, "mine", ctx.callbackMessageId || listMessage);
  return listMessage;
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

async function beginProfileEdit(ctx, state, prompt, keyboard) {
  return startProfileEdit(ctx, state, prompt, keyboard, {
    deleteCurrentMessage: () => retireCallbackMessageIfPossible(ctx),
  });
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
    return sendProfile(ctx, lang, ctx.user || {}, { loading: true });
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

  if (data === callBacks.savedProfiles) {
    await ctx.answerCb?.();
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    await clearRememberedAiListMessage(ctx);
    if (isProfileCallbackMessage(ctx)) {
      const cleared = await clearViewedPublicProfileMessage(ctx);
      if (!cleared) await deleteCallbackMessageIfPossible(ctx);
    } else {
      await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
      await deleteCallbackMessageIfPossible(ctx);
      await removeBottomKeyboard(ctx, messages[lang].savedProfilesTitle);
    }
    await forgetSavedProfilesListMessage(ctx);
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    return sendSavedProfilesList(ctx, lang, codes, 0);
  }

  if (data === "saved:back") {
    await ctx.answerCb?.();
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible(ctx);
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    return sendSavedProfilesList(ctx, lang, codes, 0);
  }

  if (data.startsWith(callBacks.savedProfilesPage)) {
    await ctx.answerCb?.();
    const pageRaw = data.replace(callBacks.savedProfilesPage, "");
    const page = Number(pageRaw);
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const paged = await buildSavedProfilePage(codes, page);
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      buildSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex }),
      savedProfilesListKeyboard(lang, {
        page: paged.page,
        totalPages: paged.totalPages,
      }),
    );
    await rememberSavedProfilesListMessage(ctx, ctx.callbackMessageId || listMessage);
    return listMessage;
  }

  if (data.startsWith(callBacks.savedProfilesOpen)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesOpen, "");
    await deleteCallbackMessageIfPossible(ctx);
    await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList: true });
  }

  if (data.startsWith(callBacks.savedProfilesDiscussions)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesDiscussions, "");
    return renderSavedProfileDiscussions(ctx, lang, code);
  }

  if (data.startsWith(callBacks.savedProfilesRemove)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesRemove, "");
    const removed = await unsaveProfileByCode(ctx, lang, code, { notify: false });
    if (removed !== true) return removed;
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const paged = await buildSavedProfilePage(codes, 0);
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      paged.items.length
        ? `${messages[lang].savedProfileRemoved}\n\n${buildSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex })}`
        : messages[lang].savedProfileRemoved,
      savedProfilesListKeyboard(lang, {
        page: paged.page,
        totalPages: paged.totalPages,
      }),
    );
    await rememberSavedProfilesListMessage(ctx, ctx.callbackMessageId || listMessage);
    return listMessage;
  }

  if (data === callBacks.discussionListActive) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    return renderActiveDiscussionList(ctx, lang, 0, false);
  }

  if (data.startsWith(callBacks.discussionListActivePage)) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    const payload = data.replace(callBacks.discussionListActivePage, "");
    const [pageRaw = "0", filter = "all"] = payload.split(":");
    return renderActiveDiscussionList(ctx, lang, Number(pageRaw), filter === "joinable");
  }

  if (data === callBacks.discussionListMine) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    return renderMyDiscussionList(ctx, lang, 0);
  }

  if (data.startsWith(callBacks.discussionListMinePage)) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    const pageRaw = data.replace(callBacks.discussionListMinePage, "");
    return renderMyDiscussionList(ctx, lang, Number(pageRaw));
  }

  if (data.startsWith(callBacks.discussionJoinErrorAck)) {
    await ctx.answerCb?.();
    const destination = data.replace(callBacks.discussionJoinErrorAck, "");
    await deleteCallbackMessageIfPossible(ctx);
    await clearDiscussionMenuNotice(ctx);
    
    if (destination === "main") {
      return editCallbackMessageOrReply(ctx, messages[lang].mainMenu, mainMenuKeyboard(lang));
    }
    if (destination === "discussions") {
      return editCallbackMessageOrReply(ctx, messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    }
    if (destination === "mine") {
      return renderMyDiscussionList(ctx, lang, 0);
    }
    return renderActiveDiscussionList(ctx, lang, 0, false);
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
      return sendDiscussionJoinErrorAck(ctx, lang, joined.reason, "active");
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

  if (data === callBacks.profileEditName) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_name", messages[lang].profileAskName, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileSettings) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible(ctx);
    return ctx.reply(
      messages[lang].profileSettingsTitle,
      profileSettingsKeyboard(lang, Boolean(ctx.user?.showActiveDiscussionOnProfile)),
    );
  }

  if (data === callBacks.profileSettingsBack) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible(ctx);
    return sendProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileActiveDiscussionHelp) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible(ctx);
    return ctx.reply(
      messages[lang].profileActiveDiscussionHelpText,
      profileActiveDiscussionHelpKeyboard(lang),
    );
  }

  if (data === callBacks.profileActiveDiscussionHelpDone) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible(ctx);
    return sendProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profileToggleActiveDiscussionVisible) {
    const nextValue = !ctx.user?.showActiveDiscussionOnProfile;
    await ctx.answerCb?.(
      nextValue
        ? messages[lang].profileActiveDiscussionVisibleOn
        : messages[lang].profileActiveDiscussionVisibleOff,
    );
    await retireCallbackMessageIfPossible(ctx);
    await updateProfileField(ctx.userId, "showActiveDiscussionOnProfile", nextValue);
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.showActiveDiscussionOnProfile = nextValue;
    return ctx.reply(messages[lang].profileSettingsTitle, profileSettingsKeyboard(lang, nextValue));
  }

  if (data === callBacks.profileEditCity) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_city", messages[lang].profileAskCity, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileEditAge) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_age", messages[lang].profileAskAge, ageKeyboard(lang));
  }

  if (data === callBacks.profileEditGender) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_gender", messages[lang].profileAskGender, genderKeyboard(lang));
  }

  if (data === callBacks.profileEditPetPreference) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_pet_preference", messages[lang].profileAskPetPreference, petPreferenceKeyboard(lang));
  }

  if (data === callBacks.profileEditBio) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_bio", messages[lang].profileAskBio, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileEditLocation) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_location", messages[lang].profileAskLocation, locationKeyboard(lang));
  }

  if (data.startsWith(callBacks.profileGenderSet)) {
    const gender = data.replace(callBacks.profileGenderSet, "");
    const allowedGenders = new Set([
      "female",
      "male",
      "other",
    ]);

    await ctx.answerCb?.();

    if (!allowedGenders.has(gender)) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await retireCallbackMessageIfPossible(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "gender", gender);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.gender = gender;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data.startsWith(callBacks.profilePetSet)) {
    const petPreference = data.replace(callBacks.profilePetSet, "");
    const allowedPetPreferences = new Set([
      "any",
      "none",
      "cat",
      "dog",
      "bird",
      "small_pets",
    ]);

    await ctx.answerCb?.();

    if (!allowedPetPreferences.has(petPreference)) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await retireCallbackMessageIfPossible(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "petPreference", petPreference);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.petPreference = petPreference;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data.startsWith(callBacks.profileAgeRangeSet)) {
    const startAge = Number(data.replace(callBacks.profileAgeRangeSet, ""));

    await ctx.answerCb?.();

    if (
      !Number.isInteger(startAge) ||
      startAge < 10 ||
      startAge > 79 ||
      startAge % 10 !== 0
    ) {
      return ctx.reply(messages[lang].unknownAction);
    }

    const edited = ctx.callbackMessageId && ctx.editMessageText
      ? await ctx.editMessageText(ctx.callbackMessageId, messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge))
      : false;
    if (edited) return edited;
    return sendProfileEditPrompt(ctx, messages[lang].profileAskAge, ageRangeKeyboard(lang, startAge));
  }

  if (data === callBacks.profileAgeRangeBack) {
    await ctx.answerCb?.();
    const edited = ctx.callbackMessageId && ctx.editMessageText
      ? await ctx.editMessageText(ctx.callbackMessageId, messages[lang].profileAskAge, ageKeyboard(lang))
      : false;
    if (edited) return edited;
    return sendProfileEditPrompt(ctx, messages[lang].profileAskAge, ageKeyboard(lang));
  }

  if (data.startsWith(callBacks.profileAgeSet)) {
    const age = Number(data.replace(callBacks.profileAgeSet, ""));

    await ctx.answerCb?.();

    if (!Number.isInteger(age) || age < 10 || age > 79) {
      return ctx.reply(messages[lang].unknownAction);
    }

    await retireCallbackMessageIfPossible(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "age", age);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.age = age;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileEditPhoto) {
    await ctx.answerCb?.();
    return beginProfileEdit(ctx, "editing_photo", messages[lang].profileAskPhoto, cancelEditKeyboard(lang));
  }

  if (data === callBacks.profileResetPhoto) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateProfileField(ctx.userId, "photoFileId", null);
    await updateUserState(ctx.userId, "idle");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.photoFileId = null;
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileCancelEdit) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible(ctx);
    await clearProfileEditPrompt(ctx, [ctx.callbackMessageId]);
    await updateUserState(ctx.userId, "idle");
    await removeBottomKeyboard(ctx, " ");
    const updatedUser = toPlainUser(ctx.user);
    updatedUser.state = "idle";
    return sendProfile(ctx, lang, updatedUser);
  }

  if (data === callBacks.profileBack) {
    await ctx.answerCb?.();
    await leaveDiscussionAndClearKeyboardForNavigation(ctx);
    await updateUserState(ctx.userId, "idle");
    await deleteCallbackMessageIfPossible(ctx);
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
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

async function sendProfile(ctx, lang, user = ctx.user, options = {}) {
  return sendProfileMessage({
    ctx,
    user,
    lang,
    keyboard: profileKeyboard(
      lang,
      Boolean(user?.photoFileId),
    ),
    messages,
    defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
    loadingText: options.loading ? messages[lang].profileLoading : "",
    isOwnProfile: true,
  });
}

module.exports = { handleCallback };
