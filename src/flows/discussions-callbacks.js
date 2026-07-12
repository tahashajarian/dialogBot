const { callBacks } = require("../constants");
const messages = require("../messages");
const {
  mainMenuKeyboard,
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionLanguagePickerKeyboard,
  discussionJoinErrorAckKeyboard,
} = require("../keyboards");
const { updateProfileField } = require("../services/users");
const { getEffectiveDiscussionLanguageFilter, normalizeDiscussionLanguageFilter } = require("../services/discussion-language");
const { sendNavigationFootprint } = require("../services/navigation-footprints");
const {
  buildDiscussionJoinLockedText,
  decorateDiscussionsForList,
  rankDiscussionsForDiscovery,
  paginateDiscussions,
  buildDiscussionListText,
} = require("../services/discussion-ui");
const {
  listActiveDiscussions,
  listMyDiscussions,
} = require("../services/discussions");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function clearRememberedDiscussionRoomCards(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const headerId = Number(ctx.user?.discussionLastRoomHeaderMessageId);
  const recentId = Number(ctx.user?.discussionLastRoomRecentMessageId);
  const hasTrackedCards = (Number.isInteger(headerId) && headerId > 0) || (Number.isInteger(recentId) && recentId > 0);
  if (!hasTrackedCards) {
    return;
  }

  const ids = [headerId, recentId].filter((id) => Number.isInteger(id) && id > 0 && !keep.has(id));

  await Promise.all(ids.map(async (id) => {
    const deleted = ctx.deleteMessage ? await ctx.deleteMessage(id) : false;
    if (!deleted && ctx.editMessageReplyMarkup) {
      await ctx.editMessageReplyMarkup(id, { inline_keyboard: [] });
    }
  }));

  if (ctx.user) {
    ctx.user.discussionLastRoomHeaderMessageId = null;
    ctx.user.discussionLastRoomRecentMessageId = null;
  }

  await Promise.all([
    updateProfileField(ctx.userId, "discussionLastRoomHeaderMessageId", null),
    updateProfileField(ctx.userId, "discussionLastRoomRecentMessageId", null),
  ]);
}

async function rememberDiscussionRoomCards(ctx, headerMessage, recentMessage) {
  await Promise.all([
    updateProfileField(ctx.userId, "discussionLastRoomHeaderMessageId", getMessageId(headerMessage) || null),
    updateProfileField(ctx.userId, "discussionLastRoomRecentMessageId", getMessageId(recentMessage) || null),
  ]);
}

async function rememberDiscussionListMessage(ctx, listType, messageOrId) {
  const messageId = Number(getMessageId(messageOrId) || messageOrId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return;
  }
  await Promise.all([
    updateProfileField(ctx.userId, "discussionLastListMessageId", messageId),
    updateProfileField(ctx.userId, "discussionLastListType", listType),
  ]);
}

async function rememberDiscussionMembersMessage(ctx, messageOrId) {
  const messageId = Number(getMessageId(messageOrId) || messageOrId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return;
  }
  await updateProfileField(ctx.userId, "discussionLastMembersMessageId", messageId);
}

async function clearDiscussionMembersMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.discussionLastMembersMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "discussionLastMembersMessageId", null);
  }
  return deleted;
}

async function clearDiscussionListMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.discussionLastListMessageId);
  if (
    !Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) ||
    (!ctx.deleteMessage && !ctx.editMessageReplyMarkup)
  ) {
    return false;
  }
  let deleted = false;
  try {
    deleted = ctx.deleteMessage ? await ctx.deleteMessage(messageId) : false;
  } catch {
    deleted = false;
  }
  const retired = deleted || (
    ctx.editMessageReplyMarkup
      ? await ctx.editMessageReplyMarkup(messageId, { inline_keyboard: [] })
      : false
  );
  if (!retired) {
    return false;
  }
  if (ctx.user) {
    ctx.user.discussionLastListMessageId = null;
    ctx.user.discussionLastListType = "";
  }
  await Promise.all([
    updateProfileField(ctx.userId, "discussionLastListMessageId", null),
    updateProfileField(ctx.userId, "discussionLastListType", ""),
  ]);
  return true;
}

async function clearDiscussionMenuNotice(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.discussionMenuNoticeMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "discussionMenuNoticeMessageId", null);
  }
  return deleted;
}

async function rememberDiscussionMenuNotice(ctx, message) {
  const messageId = Number(getMessageId(message));
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return;
  }
  await updateProfileField(ctx.userId, "discussionMenuNoticeMessageId", messageId);
}

function shouldKeepDiscussionRoomCardsForCallback(data = "") {
  return (
    data === callBacks.discussions ||
    data === callBacks.discussionListActive ||
    data === callBacks.discussionListMine ||
    data.startsWith(callBacks.discussionListActivePage) ||
    data.startsWith(callBacks.discussionListLanguageOpen) ||
    data.startsWith(callBacks.discussionListLanguageSet) ||
    data.startsWith(callBacks.discussionListMinePage) ||
    data === callBacks.discussionCreateStart ||
    isDiscussionCreateFlowCallback(data) ||
    data.startsWith(callBacks.discussionOpen) ||
    data.startsWith(callBacks.discussionLeave) ||
    data.startsWith(callBacks.discussionCloseConfirm) ||
    data.startsWith(callBacks.discussionCloseCancel) ||
    data.startsWith(callBacks.discussionClose) ||
    data.startsWith(callBacks.discussionMembers) ||
    data.startsWith(callBacks.discussionInviteJoin) ||
    data.startsWith(callBacks.discussionInviteSwitchJoin) ||
    data.startsWith(callBacks.discussionInviteCancel) ||
    data.startsWith(callBacks.discussionRemoveMemberPicker) ||
    data.startsWith(callBacks.discussionRemoveMember)
  );
}

function isDiscussionCreateFlowCallback(data = "") {
  return (
    data === callBacks.discussionCreateCancel ||
    data === callBacks.discussionCreateSkipDescription ||
    data === callBacks.discussionCreateRuleOpen ||
    data === callBacks.discussionCreateRuleTopTen ||
    data === callBacks.discussionCreateRuleTaste ||
    data === callBacks.discussionCreateRuleItem ||
    data === callBacks.discussionCreateConfirm ||
    data === callBacks.discussionCreateToggleLanguage ||
    data === callBacks.discussionCreateLanguageBack ||
    data.startsWith(callBacks.discussionCreateSetLanguage) ||
    data === callBacks.discussionCreatePreview ||
    data === callBacks.discussionCreateEditTitle ||
    data === callBacks.discussionCreateEditDescription ||
    data === callBacks.discussionCreateEditRule ||
    data === callBacks.discussionCreateEditCapacity ||
    data === callBacks.discussionCreateCancelEdit ||
    data === callBacks.discussionCreateBackToTitle ||
    data === callBacks.discussionCreateBackToJoinRule ||
    data === callBacks.discussionCreateBackToSection ||
    data === callBacks.discussionCreateGuidanceAck ||
    data === callBacks.discussionCreatePaidCapacityCancel ||
    data === callBacks.discussionCreatePaidCapacityAck ||
    data.startsWith(callBacks.discussionCreateRuleSection) ||
    data.startsWith(callBacks.discussionCreateSelectTaste) ||
    data.startsWith(callBacks.discussionCreateSelectItem) ||
    data.startsWith(callBacks.discussionCreatePaidCapacityConfirm) ||
    data.startsWith(callBacks.discussionCreateSetCapacity)
  );
}

function isDiscussionCreateState(state = "") {
  return (
    state === "discussion_create_title" ||
    state === "discussion_create_title_edit" ||
    state === "discussion_create_join_rule" ||
    state === "discussion_create_join_rule_edit" ||
    state === "discussion_create_description" ||
    state === "discussion_create_description_edit" ||
    state === "discussion_create_preview"
  );
}

async function sendDiscussionJoinErrorAck(ctx, lang, reason, listType = "active", {
  discussion = null,
  retireCallbackMessageIfPossible,
} = {}) {
  const errorText = buildDiscussionJoinLockedText(messages, lang, reason, discussion);
  await retireCallbackMessageIfPossible?.(ctx);
  await clearDiscussionListMessage(ctx);
  const errorNotice = await ctx.reply(errorText, discussionJoinErrorAckKeyboard(lang, listType));
  await rememberDiscussionMenuNotice(ctx, errorNotice);
  return errorNotice;
}

async function editCallbackMessageOrReplyFallback(ctx, text, keyboard) {
  if (ctx.callbackMessageId && ctx.editMessageText) {
    const edited = await ctx.editMessageText(ctx.callbackMessageId, text, keyboard);
    if (edited) {
      return edited;
    }
  }

  return ctx.reply(text, keyboard);
}

async function renderActiveDiscussionList(ctx, lang, page = 0, joinableOnly = false, languageFilter = null, {
  editCallbackMessageOrReply = editCallbackMessageOrReplyFallback,
  freshDestination = false,
} = {}) {
  if (freshDestination) await sendNavigationFootprint(ctx, { lang, destination: "activeDiscussions" });
  const effectiveLanguage = normalizeDiscussionLanguageFilter(languageFilter) || getEffectiveDiscussionLanguageFilter(ctx.user);
  const result = await listActiveDiscussions({ userId: ctx.userId, limit: 100, languageFilter: effectiveLanguage });
  if (!result.discussions.length) {
    await ctx.answerCb?.(messages[lang].discussionListEmpty.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
    return editCallbackMessageOrReply(ctx, messages[lang].discussionListEmpty, discussionsMenuKeyboard(lang));
  }
  await ctx.answerCb?.();
  const decorated = await decorateDiscussionsForList(ctx.user, result.discussions);
  const ranked = await rankDiscussionsForDiscovery(ctx.user, decorated);
  const filtered = joinableOnly ? ranked.filter((entry) => entry.isJoinable) : ranked;
  if (!filtered.length) {
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionListJoinableEmpty,
      discussionListNavigationKeyboard(lang, {
        listType: "active",
        page: 0,
        totalPages: 1,
        joinableOnly,
        languageFilter: effectiveLanguage,
      }),
    );
    await rememberDiscussionListMessage(ctx, "active", freshDestination ? listMessage : (ctx.callbackMessageId || listMessage));
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
      languageFilter: effectiveLanguage,
    }),
  );
  await rememberDiscussionListMessage(ctx, "active", freshDestination ? listMessage : (ctx.callbackMessageId || listMessage));
  return listMessage;
}

async function renderMyDiscussionList(ctx, lang, page = 0, {
  editCallbackMessageOrReply = editCallbackMessageOrReplyFallback,
  freshDestination = false,
} = {}) {
  if (freshDestination) await sendNavigationFootprint(ctx, { lang, destination: "myDiscussions" });
  const result = await listMyDiscussions(ctx.userId, { limit: 100 });
  if (!result.ok) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
  }
  if (!result.discussions.length) {
    await ctx.answerCb?.();
    const emptyNotice = await editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionListMineEmpty,
      discussionJoinErrorAckKeyboard(lang, "discussions"),
    );
    await rememberDiscussionMenuNotice(ctx, freshDestination ? emptyNotice : (ctx.callbackMessageId || emptyNotice));
    return emptyNotice;
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
  await rememberDiscussionListMessage(ctx, "mine", freshDestination ? listMessage : (ctx.callbackMessageId || listMessage));
  return listMessage;
}

function isDiscussionListCallback(data = "") {
  return data === callBacks.discussionListActive ||
    data.startsWith(callBacks.discussionListActivePage) ||
    data.startsWith(callBacks.discussionListLanguageOpen) ||
    data.startsWith(callBacks.discussionListLanguageSet) ||
    data === callBacks.discussionListMine ||
    data.startsWith(callBacks.discussionListMinePage) ||
    data.startsWith(callBacks.discussionJoinErrorAck);
}

async function handleDiscussionListCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply = editCallbackMessageOrReplyFallback,
  renderSavedProfileDiscussions,
  renderInvitationsList,
} = {}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.discussionListActive) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible?.(ctx);
    return renderActiveDiscussionList(ctx, lang, 0, false, null, {
      editCallbackMessageOrReply: (_ctx, text, keyboard) => _ctx.reply(text, keyboard),
      freshDestination: true,
    });
  }

  if (data.startsWith(callBacks.discussionListLanguageOpen)) {
    await ctx.answerCb?.();
    const [joinability = "all", languageRaw = ""] = data.replace(callBacks.discussionListLanguageOpen, "").split(":");
    const joinableOnly = joinability === "joinable";
    const languageFilter = normalizeDiscussionLanguageFilter(languageRaw) || getEffectiveDiscussionLanguageFilter(ctx.user);
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionLanguagePickerTitle,
      discussionLanguagePickerKeyboard(lang, { joinableOnly, languageFilter }),
    );
  }

  if (data.startsWith(callBacks.discussionListLanguageSet)) {
    const [joinability = "all", languageRaw = ""] = data.replace(callBacks.discussionListLanguageSet, "").split(":");
    const languageFilter = normalizeDiscussionLanguageFilter(languageRaw);
    if (!languageFilter) return renderActiveDiscussionList(ctx, lang, 0, joinability === "joinable", null, { editCallbackMessageOrReply });
    await updateProfileField(ctx.userId, "discussionLanguageFilter", languageFilter);
    if (ctx.user) ctx.user.discussionLanguageFilter = languageFilter;
    return renderActiveDiscussionList(ctx, lang, 0, joinability === "joinable", languageFilter, { editCallbackMessageOrReply });
  }

  if (data.startsWith(callBacks.discussionListActivePage)) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    const payload = data.replace(callBacks.discussionListActivePage, "");
    const [pageRaw = "0", filter = "all", languageRaw = ""] = payload.split(":");
    const safePage = /^\d+$/.test(pageRaw) ? Number(pageRaw) : 0;
    const joinableOnly = filter === "joinable";
    const languageFilter = normalizeDiscussionLanguageFilter(languageRaw) || getEffectiveDiscussionLanguageFilter(ctx.user);
    return renderActiveDiscussionList(ctx, lang, safePage, joinableOnly, languageFilter, { editCallbackMessageOrReply });
  }

  if (data === callBacks.discussionListMine) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible?.(ctx);
    return renderMyDiscussionList(ctx, lang, 0, {
      editCallbackMessageOrReply: (_ctx, text, keyboard) => _ctx.reply(text, keyboard),
      freshDestination: true,
    });
  }

  if (data.startsWith(callBacks.discussionListMinePage)) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    const pageRaw = data.replace(callBacks.discussionListMinePage, "");
    return renderMyDiscussionList(ctx, lang, Number(pageRaw), { editCallbackMessageOrReply });
  }

  if (data.startsWith(callBacks.discussionJoinErrorAck)) {
    await ctx.answerCb?.();
    const destination = data.replace(callBacks.discussionJoinErrorAck, "");
    await deleteCallbackMessageIfPossible?.(ctx);
    await clearDiscussionMenuNotice(ctx);

    if (destination.startsWith("saved:u_") && renderSavedProfileDiscussions) {
      return renderSavedProfileDiscussions(ctx, lang, destination.replace(/^saved:/, ""));
    }
    if (destination === "main") {
      await sendNavigationFootprint(ctx, { lang, destination: "menu" });
      return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
    }
    if (destination === "discussions") {
      await sendNavigationFootprint(ctx, { lang, destination: "discussions" });
      return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    }
    if (destination === "invitations" && renderInvitationsList) {
      return renderInvitationsList(ctx, lang, 0, { editCallbackMessageOrReply });
    }
    if (destination === "mine") {
      return renderMyDiscussionList(ctx, lang, 0, { editCallbackMessageOrReply });
    }
    return renderActiveDiscussionList(ctx, lang, 0, false, null, { editCallbackMessageOrReply });
  }

  return false;
}

module.exports = {
  clearRememberedDiscussionRoomCards,
  rememberDiscussionRoomCards,
  rememberDiscussionListMessage,
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
  renderMyDiscussionList,
  sendDiscussionJoinErrorAck,
};
