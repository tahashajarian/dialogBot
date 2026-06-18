const { callBacks } = require("../constants");
const messages = require("../messages");
const {
  mainMenuKeyboard,
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionJoinErrorAckKeyboard,
} = require("../keyboards");
const { updateProfileField } = require("../services/users");
const {
  getDiscussionErrorMessage,
  decorateDiscussionsForList,
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

  if (ctx.deleteMessage) {
    await Promise.all(ids.map((id) => ctx.deleteMessage(id)));
  }

  await updateProfileField(ctx.userId, "discussionLastRoomHeaderMessageId", null);
  await updateProfileField(ctx.userId, "discussionLastRoomRecentMessageId", null);
}

async function rememberDiscussionRoomCards(ctx, headerMessage, recentMessage) {
  await updateProfileField(ctx.userId, "discussionLastRoomHeaderMessageId", getMessageId(headerMessage) || null);
  await updateProfileField(ctx.userId, "discussionLastRoomRecentMessageId", getMessageId(recentMessage) || null);
}

async function rememberDiscussionListMessage(ctx, listType, messageOrId) {
  const messageId = Number(getMessageId(messageOrId) || messageOrId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return;
  }
  await updateProfileField(ctx.userId, "discussionLastListMessageId", messageId);
  await updateProfileField(ctx.userId, "discussionLastListType", listType);
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
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "discussionLastListMessageId", null);
    await updateProfileField(ctx.userId, "discussionLastListType", "");
  }
  return deleted;
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
    data === callBacks.discussionCreatePreview ||
    data === callBacks.discussionCreateEditTitle ||
    data === callBacks.discussionCreateEditDescription ||
    data === callBacks.discussionCreateEditRule ||
    data === callBacks.discussionCreateEditCapacity ||
    data === callBacks.discussionCreateCancelEdit ||
    data === callBacks.discussionCreateBackToTitle ||
    data === callBacks.discussionCreateBackToJoinRule ||
    data === callBacks.discussionCreateBackToSection ||
    data.startsWith(callBacks.discussionCreateRuleSection) ||
    data.startsWith(callBacks.discussionCreateSelectTaste) ||
    data.startsWith(callBacks.discussionCreateSelectItem) ||
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
  retireCallbackMessageIfPossible,
} = {}) {
  const errorText = getDiscussionErrorMessage(messages, lang, reason);
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

async function renderActiveDiscussionList(ctx, lang, page = 0, joinableOnly = false, {
  editCallbackMessageOrReply = editCallbackMessageOrReplyFallback,
} = {}) {
  const result = await listActiveDiscussions({ userId: ctx.userId, limit: 100 });
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

async function renderMyDiscussionList(ctx, lang, page = 0, {
  editCallbackMessageOrReply = editCallbackMessageOrReplyFallback,
} = {}) {
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

function isDiscussionListCallback(data = "") {
  return data === callBacks.discussionListActive ||
    data.startsWith(callBacks.discussionListActivePage) ||
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
    return renderActiveDiscussionList(ctx, lang, 0, false, { editCallbackMessageOrReply });
  }

  if (data.startsWith(callBacks.discussionListActivePage)) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    const payload = data.replace(callBacks.discussionListActivePage, "");
    const [pageRaw = "0", filter = "all"] = payload.split(":");
    return renderActiveDiscussionList(ctx, lang, Number(pageRaw), filter === "joinable", { editCallbackMessageOrReply });
  }

  if (data === callBacks.discussionListMine) {
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    return renderMyDiscussionList(ctx, lang, 0, { editCallbackMessageOrReply });
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
      return editCallbackMessageOrReply(ctx, messages[lang].mainMenu, mainMenuKeyboard(lang));
    }
    if (destination === "discussions") {
      return editCallbackMessageOrReply(ctx, messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    }
    if (destination === "invitations" && renderInvitationsList) {
      return renderInvitationsList(ctx, lang, 0, { editCallbackMessageOrReply });
    }
    if (destination === "mine") {
      return renderMyDiscussionList(ctx, lang, 0, { editCallbackMessageOrReply });
    }
    return renderActiveDiscussionList(ctx, lang, 0, false, { editCallbackMessageOrReply });
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
