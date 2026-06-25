const { callBacks } = require("../constants");
const { updateProfileField } = require("../services/users");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function rememberAiListMessage(ctx, section, listType, message) {
  const messageId = getMessageId(message);
  if (!messageId) {
    return;
  }

  await updateProfileField(ctx.userId, "aiLastListMessageId", messageId);
  await updateProfileField(ctx.userId, "aiLastListSection", section);
  await updateProfileField(ctx.userId, "aiLastListType", listType);
  if (ctx.user) {
    ctx.user.aiLastListMessageId = messageId;
    ctx.user.aiLastListSection = section;
    ctx.user.aiLastListType = listType;
  }
}

async function replaceRememberedAiListMessage(ctx, section, listType, message) {
  const currentMessageId = ctx.user?.aiLastListMessageId;
  const currentSection = ctx.user?.aiLastListSection;
  const currentListType = ctx.user?.aiLastListType;
  const nextMessageId = getMessageId(message);

  if (
    currentMessageId &&
    ctx.deleteMessage &&
    (currentSection !== section || currentListType !== listType) &&
    Number(currentMessageId) !== Number(nextMessageId)
  ) {
    await ctx.deleteMessage(currentMessageId);
  }

  await rememberAiListMessage(ctx, section, listType, message);
}

async function deleteRememberedAiListMessage(ctx, section, listType) {
  const messageId = ctx.user?.aiLastListMessageId;
  if (
    !messageId ||
    ctx.user?.aiLastListSection !== section ||
    ctx.user?.aiLastListType !== listType ||
    !ctx.deleteMessage
  ) {
    return false;
  }

  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "aiLastListMessageId", null);
    await updateProfileField(ctx.userId, "aiLastListSection", "");
    await updateProfileField(ctx.userId, "aiLastListType", "");
    if (ctx.user) {
      ctx.user.aiLastListMessageId = null;
      ctx.user.aiLastListSection = "";
      ctx.user.aiLastListType = "";
    }
  }
  return deleted;
}

async function clearRememberedAiListMessage(ctx) {
  const messageId = ctx.user?.aiLastListMessageId;
  if (!messageId || !ctx.deleteMessage) {
    return false;
  }

  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "aiLastListMessageId", null);
    await updateProfileField(ctx.userId, "aiLastListSection", "");
    await updateProfileField(ctx.userId, "aiLastListType", "");
    if (ctx.user) {
      ctx.user.aiLastListMessageId = null;
      ctx.user.aiLastListSection = "";
      ctx.user.aiLastListType = "";
    }
  }
  return deleted;
}

async function rememberAiSectionEntryMessage(ctx, message) {
  const messageId = getMessageId(message);
  await updateProfileField(ctx.userId, "aiSectionEntryMessageId", messageId || null);
}

async function clearAiSectionEntryMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.aiSectionEntryMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "aiSectionEntryMessageId", null);
  }
  return deleted;
}

async function rememberAiActionMessage(ctx, context, message) {
  const messageId = Number(getMessageId(message));
  await updateProfileField(
    ctx.userId,
    "aiActionMessageId",
    Number.isInteger(messageId) && messageId > 0 ? messageId : null,
  );
  await updateProfileField(ctx.userId, "aiActionContext", String(context || ""));
  if (ctx.user) {
    ctx.user.aiActionMessageId = Number.isInteger(messageId) && messageId > 0 ? messageId : null;
    ctx.user.aiActionContext = String(context || "");
  }
}

async function clearAiActionMessage(ctx) {
  const messageId = Number(ctx.user?.aiActionMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return true;
  }
  const retiredInline = (
    ctx.editMessageReplyMarkup
      ? await ctx.editMessageReplyMarkup(messageId, { inline_keyboard: [] })
      : false
  );
  const deleted = retiredInline ? false : ctx.deleteMessage ? await ctx.deleteMessage(messageId) : false;
  const retired = retiredInline || deleted;
  await updateProfileField(ctx.userId, "aiActionMessageId", null);
  await updateProfileField(ctx.userId, "aiActionContext", "");
  if (ctx.user) {
    ctx.user.aiActionMessageId = null;
    ctx.user.aiActionContext = "";
  }
  return retired;
}

function shouldKeepAiListTitleForCallback(data = "", isAiCallback = () => false) {
  return (
    data.startsWith(callBacks.aiAssistant) ||
    isAiCallback(data)
  );
}

module.exports = {
  clearAiActionMessage,
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
  deleteRememberedAiListMessage,
  rememberAiListMessage,
  rememberAiActionMessage,
  rememberAiSectionEntryMessage,
  replaceRememberedAiListMessage,
  shouldKeepAiListTitleForCallback,
};
