const { callBacks } = require("../constants");
const { updateProfileField, updateUserFields } = require("../services/users");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function updateAiCardField(ctx, field, value) {
  if (ctx.userId === undefined || ctx.userId === null) return null;
  return updateProfileField(ctx.userId, field, value);
}

async function rememberAiListMessage(ctx, section, listType, message, {
  navigationMode = `ai_list:${section}:${listType === "watchlist" ? "watchlist" : "topTen"}`,
  page = 0,
  filter = "all",
} = {}) {
  const messageId = getMessageId(message);
  const fields = {
    ...(messageId ? { aiLastListMessageId: messageId } : {}),
    aiLastListSection: section,
    aiLastListType: listType,
    aiLastListPage: Math.max(0, Number(page) || 0),
    aiLastListFilter: filter,
    navigationMode,
  };
  await updateUserFields(ctx.userId, fields);
  if (ctx.user) {
    if (messageId) ctx.user.aiLastListMessageId = messageId;
    ctx.user.aiLastListSection = section;
    ctx.user.aiLastListType = listType;
    ctx.user.aiLastListPage = fields.aiLastListPage;
    ctx.user.aiLastListFilter = filter;
    ctx.user.navigationMode = navigationMode;
  }
}

async function replaceRememberedAiListMessage(ctx, section, listType, message, options) {
  await rememberAiListMessage(ctx, section, listType, message, options);
}

async function deleteRememberedAiListMessage(ctx, section, listType, { waitForDelete: _waitForDelete = true } = {}) {
  const messageId = ctx.user?.aiLastListMessageId;
  if (
    !messageId ||
    ctx.user?.aiLastListSection !== section ||
    ctx.user?.aiLastListType !== listType
  ) {
    return false;
  }
  await updateUserFields(ctx.userId, {
    aiLastListMessageId: null,
    aiLastListSection: "",
    aiLastListType: "",
  });
  if (ctx.user) {
    ctx.user.aiLastListMessageId = null;
    ctx.user.aiLastListSection = "";
    ctx.user.aiLastListType = "";
  }
  return true;
}

async function clearRememberedAiListMessage(ctx, { waitForDelete: _waitForDelete = true } = {}) {
  const messageId = ctx.user?.aiLastListMessageId;
  if (!messageId) {
    return false;
  }
  await updateUserFields(ctx.userId, {
    aiLastListMessageId: null,
    aiLastListSection: "",
    aiLastListType: "",
  });
  if (ctx.user) {
    ctx.user.aiLastListMessageId = null;
    ctx.user.aiLastListSection = "";
    ctx.user.aiLastListType = "";
  }
  return true;
}

async function forgetRememberedAiListMessage(ctx) {
  await updateUserFields(ctx.userId, {
    aiLastListMessageId: null,
    aiLastListSection: "",
    aiLastListType: "",
  });
  if (ctx.user) {
    ctx.user.aiLastListMessageId = null;
    ctx.user.aiLastListSection = "";
    ctx.user.aiLastListType = "";
  }
}

async function rememberAiSectionEntryMessage(ctx, message) {
  const messageId = getMessageId(message);
  await updateAiCardField(ctx, "aiSectionEntryMessageId", messageId || null);
  if (ctx.user) ctx.user.aiSectionEntryMessageId = messageId || null;
}

async function clearAiSectionEntryMessage(ctx, exceptMessageIds = [], { waitForDelete: _waitForDelete = true } = {}) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.aiSectionEntryMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId)) {
    return false;
  }
  if (ctx.user) {
    ctx.user.aiSectionEntryMessageId = null;
  }
  await updateAiCardField(ctx, "aiSectionEntryMessageId", null);
  return true;
}

async function rememberAiActionMessage(ctx, context, message) {
  const messageId = Number(getMessageId(message));
  await updateUserFields(ctx.userId, {
    aiActionMessageId: Number.isInteger(messageId) && messageId > 0 ? messageId : null,
    aiActionContext: String(context || ""),
  });
  if (ctx.user) {
    ctx.user.aiActionMessageId = Number.isInteger(messageId) && messageId > 0 ? messageId : null;
    ctx.user.aiActionContext = String(context || "");
  }
}

async function clearAiActionMessage(ctx, {
  waitForDelete: _waitForDelete = true,
  fallbackToEdit: _fallbackToEdit = true,
} = {}) {
  const messageId = Number(ctx.user?.aiActionMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return true;
  }
  await updateUserFields(ctx.userId, {
    aiActionMessageId: null,
    aiActionContext: "",
  });
  if (ctx.user) {
    ctx.user.aiActionMessageId = null;
    ctx.user.aiActionContext = "";
  }
  return true;
}

function shouldKeepAiListTitleForCallback(data = "", isAiCallback = () => false) {
  return data !== callBacks.aiAssistant && isAiCallback(data);
}

module.exports = {
  clearAiActionMessage,
  clearAiSectionEntryMessage,
  clearRememberedAiListMessage,
  deleteRememberedAiListMessage,
  forgetRememberedAiListMessage,
  rememberAiListMessage,
  rememberAiActionMessage,
  rememberAiSectionEntryMessage,
  replaceRememberedAiListMessage,
  shouldKeepAiListTitleForCallback,
};
