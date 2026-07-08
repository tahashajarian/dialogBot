const { callBacks } = require("../constants");
const { updateProfileField } = require("../services/users");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function updateAiCardField(ctx, field, value) {
  if (ctx.userId === undefined || ctx.userId === null) return null;
  return updateProfileField(ctx.userId, field, value);
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

async function deleteRememberedAiListMessage(ctx, section, listType, { waitForDelete = true } = {}) {
  const messageId = ctx.user?.aiLastListMessageId;
  if (
    !messageId ||
    ctx.user?.aiLastListSection !== section ||
    ctx.user?.aiLastListType !== listType ||
    !ctx.deleteMessage
  ) {
    return false;
  }

  let deleted = false;
  if (waitForDelete) {
    deleted = await ctx.deleteMessage(messageId);
  } else {
    Promise.resolve(ctx.deleteMessage(messageId)).catch(() => {});
    deleted = true;
  }
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

async function clearRememberedAiListMessage(ctx, { waitForDelete = true } = {}) {
  const messageId = ctx.user?.aiLastListMessageId;
  if (!messageId || !ctx.deleteMessage) {
    return false;
  }

  let deleted = false;
  if (waitForDelete) {
    deleted = await ctx.deleteMessage(messageId);
  } else {
    Promise.resolve(ctx.deleteMessage(messageId)).catch(() => {});
    deleted = true;
  }
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
  await updateAiCardField(ctx, "aiSectionEntryMessageId", messageId || null);
  if (ctx.user) ctx.user.aiSectionEntryMessageId = messageId || null;
}

async function clearAiSectionEntryMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.aiSectionEntryMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    if (ctx.user) {
      ctx.user.aiSectionEntryMessageId = null;
    }
    await updateAiCardField(ctx, "aiSectionEntryMessageId", null);
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

async function clearAiActionMessage(ctx, { waitForDelete = true, fallbackToEdit = true } = {}) {
  const messageId = Number(ctx.user?.aiActionMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return true;
  }
  let deleted = false;
  if (ctx.deleteMessage) {
    try {
      if (waitForDelete) {
        deleted = await ctx.deleteMessage(messageId);
      } else {
        Promise.resolve(ctx.deleteMessage(messageId)).catch(() => {});
        deleted = true;
      }
    } catch {
      deleted = false;
    }
  }
  const retiredInline = deleted ? false : (
    fallbackToEdit && ctx.editMessageReplyMarkup
      ? await ctx.editMessageReplyMarkup(messageId, { inline_keyboard: [] })
      : false
  );
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
  return data !== callBacks.aiAssistant && isAiCallback(data);
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
