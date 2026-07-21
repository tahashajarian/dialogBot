const { updateProfileField, updateUserFields } = require("../services/users");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function canPersistUserMessageState(ctx) {
  return Boolean(ctx?.user && typeof ctx.user.toObject === "function");
}

function keepMessageIds(values = []) {
  return new Set((values || []).map(Number).filter((id) => Number.isInteger(id) && id > 0));
}

function isProfileDiscussionListType(value = "") {
  return /^(?:saved|people|shared|direct|discussion_members|invitations|restrictions):/.test(String(value || ""));
}

async function rememberSavedProfilesListMessage(ctx, messageOrId) {
  if (typeof messageOrId === "boolean") return;
  const messageId = Number(getMessageId(messageOrId) || messageOrId);
  if (!Number.isInteger(messageId) || messageId <= 0) return;
  if (ctx.user) ctx.user.savedProfilesLastListMessageId = messageId;
  if (canPersistUserMessageState(ctx)) await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", messageId);
}

async function clearSavedProfilesListMessage(ctx, exceptMessageIds = []) {
  const messageId = Number(ctx.user?.savedProfilesLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keepMessageIds(exceptMessageIds).has(messageId)) return false;
  if (ctx.user) ctx.user.savedProfilesLastListMessageId = null;
  if (canPersistUserMessageState(ctx)) await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
  return true;
}

async function forgetSavedProfilesListMessage(ctx) {
  if (!ctx.user?.savedProfilesLastListMessageId) return;
  if (ctx.user) ctx.user.savedProfilesLastListMessageId = null;
  if (canPersistUserMessageState(ctx)) await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
}

async function rememberPeopleListMessage(ctx, messageOrId, page = 0) {
  if (typeof messageOrId === "boolean") return;
  const messageId = Number(getMessageId(messageOrId) || messageOrId);
  if (!Number.isInteger(messageId) || messageId <= 0) return;
  const normalizedPage = Math.max(0, Number(page) || 0);
  if (ctx.user) {
    ctx.user.peopleLastListMessageId = messageId;
    ctx.user.peopleLastListPage = normalizedPage;
    ctx.user.peopleLastListMode = "browse";
  }
  if (canPersistUserMessageState(ctx)) {
    await updateUserFields(ctx.userId, {
      peopleLastListMessageId: messageId,
      peopleLastListPage: normalizedPage,
      peopleLastListMode: "browse",
    });
  }
}

async function clearPeopleListMessage(ctx, exceptMessageIds = []) {
  const messageId = Number(ctx.user?.peopleLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keepMessageIds(exceptMessageIds).has(messageId)) return false;
  if (ctx.user) {
    ctx.user.peopleLastListMessageId = null;
    ctx.user.peopleLastListMode = "";
  }
  if (canPersistUserMessageState(ctx)) {
    await updateUserFields(ctx.userId, { peopleLastListMessageId: null, peopleLastListMode: "" });
  }
  return true;
}

async function forgetPeopleListMessage(ctx) {
  if (!ctx.user?.peopleLastListMessageId && !ctx.user?.peopleLastListMode) return;
  if (ctx.user) {
    ctx.user.peopleLastListMessageId = null;
    ctx.user.peopleLastListMode = "";
  }
  if (canPersistUserMessageState(ctx)) {
    await updateUserFields(ctx.userId, { peopleLastListMessageId: null, peopleLastListMode: "" });
  }
}

async function clearViewedPublicProfileMessage(ctx, exceptMessageIds = []) {
  const messageId = Number(ctx.user?.publicProfileLastMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keepMessageIds(exceptMessageIds).has(messageId)) return false;
  const canLeaveSafeProfileCard = /^(?:public_profile:|profile_discussions:|profile_unsave_confirm:)/
    .test(String(ctx.user?.navigationMode || ""));
  if (canLeaveSafeProfileCard) {
    if (ctx.user) ctx.user.publicProfileLastMessageId = null;
    if (canPersistUserMessageState(ctx)) await updateProfileField(ctx.userId, "publicProfileLastMessageId", null);
    return true;
  }
  if (!ctx.deleteMessage && !ctx.editMessageReplyMarkup) return false;
  const deleted = ctx.deleteMessage ? await ctx.deleteMessage(messageId) : false;
  const retired = deleted || (ctx.editMessageReplyMarkup
    ? await ctx.editMessageReplyMarkup(messageId, { inline_keyboard: [] })
    : false);
  if (ctx.user) ctx.user.publicProfileLastMessageId = null;
  if (canPersistUserMessageState(ctx)) await updateProfileField(ctx.userId, "publicProfileLastMessageId", null);
  return retired;
}

async function clearSavedProfileDiscussionMessage(ctx, exceptMessageIds = []) {
  if (!isProfileDiscussionListType(ctx.user?.discussionLastListType)) return false;
  const messageId = Number(ctx.user?.discussionLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keepMessageIds(exceptMessageIds).has(messageId)) return false;
  if (ctx.user) {
    ctx.user.discussionLastListMessageId = null;
    ctx.user.discussionLastListType = "";
  }
  if (canPersistUserMessageState(ctx)) {
    await updateUserFields(ctx.userId, { discussionLastListMessageId: null, discussionLastListType: "" });
  }
  return true;
}

async function clearSavedProfileSurfaceMessages(ctx, exceptMessageIds = []) {
  await Promise.all([
    clearSavedProfilesListMessage(ctx, exceptMessageIds),
    clearPeopleListMessage(ctx, exceptMessageIds),
    clearViewedPublicProfileMessage(ctx, exceptMessageIds),
    clearSavedProfileDiscussionMessage(ctx, exceptMessageIds),
  ]);
}

async function rememberViewedPublicProfileMessage(ctx, message) {
  const messageId = getMessageId(message);
  if (!messageId) return;
  if (ctx.user) ctx.user.publicProfileLastMessageId = messageId;
  if (canPersistUserMessageState(ctx)) await updateProfileField(ctx.userId, "publicProfileLastMessageId", messageId);
}

module.exports = {
  clearPeopleListMessage,
  clearSavedProfileDiscussionMessage,
  clearSavedProfileSurfaceMessages,
  clearSavedProfilesListMessage,
  clearViewedPublicProfileMessage,
  forgetPeopleListMessage,
  forgetSavedProfilesListMessage,
  rememberPeopleListMessage,
  rememberSavedProfilesListMessage,
  rememberViewedPublicProfileMessage,
};
