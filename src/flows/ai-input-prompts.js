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

async function clearAiPendingInputPrompt(ctx, { waitForDelete = true, fallbackToEdit = true } = {}) {
  if (!ctx?.userId) {
    return true;
  }
  const messageId = Number(ctx.user?.aiPendingInputMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return true;
  }
  let deleted = false;
  if (ctx.deleteMessage) {
    if (waitForDelete) {
      deleted = await ctx.deleteMessage(messageId);
    } else {
      Promise.resolve(ctx.deleteMessage(messageId)).catch(() => {});
      deleted = true;
    }
  }
  const retired = deleted || (
    fallbackToEdit && ctx.editMessageReplyMarkup
      ? await ctx.editMessageReplyMarkup(messageId, { inline_keyboard: [] })
      : false
  );
  if (!retired) {
    return false;
  }
  await updateProfileField(ctx.userId, "aiPendingInputMessageId", null);
  if (ctx.user) {
    ctx.user.aiPendingInputMessageId = null;
  }
  return true;
}

async function replaceAiPendingInputPrompt(ctx, sendPrompt) {
  const previousMessageId = Number(ctx.user?.aiPendingInputMessageId);
  const retired = await clearAiPendingInputPrompt(ctx);
  const prompt = await sendPrompt();

  if (
    !retired
    && Number.isInteger(previousMessageId)
    && previousMessageId > 0
    && ctx.deleteMessage
  ) {
    await ctx.deleteMessage(previousMessageId);
  }

  await rememberAiPendingInputPrompt(ctx, prompt);
  return prompt;
}

module.exports = {
  rememberAiPendingInputPrompt,
  clearAiPendingInputPrompt,
  replaceAiPendingInputPrompt,
};
