const { callBacks } = require("../constants");
const { updateProfileField } = require("../services/users");

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
    data === callBacks.discussionCreateCancel ||
    data === callBacks.discussionCreateSkipDescription ||
    data === callBacks.discussionCreateRuleOpen ||
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
    data.startsWith(callBacks.discussionCreateSetCapacity) ||
    data.startsWith(callBacks.discussionOpen) ||
    data.startsWith(callBacks.discussionLeave) ||
    data.startsWith(callBacks.discussionCloseConfirm) ||
    data.startsWith(callBacks.discussionCloseCancel) ||
    data.startsWith(callBacks.discussionClose) ||
    data.startsWith(callBacks.discussionMembers) ||
    data.startsWith(callBacks.discussionRemoveMemberPicker) ||
    data.startsWith(callBacks.discussionRemoveMember)
  );
}

function isDiscussionCreateFlowCallback(data = "") {
  return (
    data === callBacks.discussionCreateCancel ||
    data === callBacks.discussionCreateSkipDescription ||
    data === callBacks.discussionCreateRuleOpen ||
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

module.exports = {
  clearRememberedDiscussionRoomCards,
  rememberDiscussionRoomCards,
  rememberDiscussionListMessage,
  clearDiscussionListMessage,
  clearDiscussionMenuNotice,
  rememberDiscussionMenuNotice,
  shouldKeepDiscussionRoomCardsForCallback,
  isDiscussionCreateFlowCallback,
  isDiscussionCreateState,
};
