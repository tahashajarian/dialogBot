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

async function clearAiPendingInputPrompt(ctx, {
  waitForDelete: _waitForDelete = true,
  fallbackToEdit: _fallbackToEdit = true,
} = {}) {
  if (!ctx?.userId) {
    return true;
  }
  const messageId = Number(ctx.user?.aiPendingInputMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return true;
  }
  await updateProfileField(ctx.userId, "aiPendingInputMessageId", null);
  if (ctx.user) {
    ctx.user.aiPendingInputMessageId = null;
  }
  return true;
}

async function replaceAiPendingInputPrompt(ctx, sendPrompt) {
  await clearAiPendingInputPrompt(ctx);
  const prompt = await sendPrompt();

  await rememberAiPendingInputPrompt(ctx, prompt);
  return prompt;
}

module.exports = {
  rememberAiPendingInputPrompt,
  clearAiPendingInputPrompt,
  replaceAiPendingInputPrompt,
};
