const { updateProfileField } = require("../services/users");

function getMessageId(messageOrId) {
  if (messageOrId && typeof messageOrId === "object") {
    return messageOrId.message_id || messageOrId.messageId;
  }
  if (typeof messageOrId === "number" || typeof messageOrId === "string") {
    return messageOrId;
  }
  return null;
}

async function rememberAiPendingInputPrompt(ctx, messageOrId) {
  if (!ctx?.userId) {
    return;
  }
  const messageId = Number(getMessageId(messageOrId));
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return;
  }
  await updateProfileField(ctx.userId, "aiPendingInputMessageId", messageId);
  if (ctx.user) {
    ctx.user.aiPendingInputMessageId = messageId;
  }
}

async function clearAiPendingInputPrompt(ctx) {
  if (!ctx?.userId) {
    return;
  }
  const messageId = Number(ctx.user?.aiPendingInputMessageId);
  if (Number.isInteger(messageId) && messageId > 0) {
    const deleted = ctx.deleteMessage ? await ctx.deleteMessage(messageId) : false;
    if (!deleted && ctx.editMessageReplyMarkup) {
      await ctx.editMessageReplyMarkup(messageId, { inline_keyboard: [] });
    }
  }
  await updateProfileField(ctx.userId, "aiPendingInputMessageId", null);
  if (ctx.user) {
    ctx.user.aiPendingInputMessageId = null;
  }
}

module.exports = {
  rememberAiPendingInputPrompt,
  clearAiPendingInputPrompt,
};
