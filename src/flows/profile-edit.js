const { updateProfileField, updateUserState } = require("../services/users");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function clearProfileEditPrompt(ctx, exceptMessageIds = []) {
  const promptMessageId = Number(ctx.user?.profileEditPromptMessageId);
  const keep = new Set((exceptMessageIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0));

  if (Number.isInteger(promptMessageId) && promptMessageId > 0 && !keep.has(promptMessageId) && ctx.deleteMessage) {
    await ctx.deleteMessage(promptMessageId);
  }

  await updateProfileField(ctx.userId, "profileEditPromptMessageId", null);
  if (ctx.user) ctx.user.profileEditPromptMessageId = null;
}

async function sendProfileEditPrompt(ctx, text, keyboard) {
  await clearProfileEditPrompt(ctx);
  const sent = await ctx.reply(text, keyboard);
  // Reply-keyboard prompts are authorized by durable flow state and remain safe
  // in chat history. Track only inline prompts whose old controls must retire.
  if (keyboard?.reply_markup?.keyboard) return sent;
  const messageId = getMessageId(sent) || null;
  await updateProfileField(ctx.userId, "profileEditPromptMessageId", messageId);
  if (ctx.user) ctx.user.profileEditPromptMessageId = messageId;
  return sent;
}

async function rememberProfileEditPrompt(ctx, messageOrId) {
  const messageId = Number(getMessageId(messageOrId) || messageOrId);
  if (!Number.isInteger(messageId) || messageId <= 0) return false;
  await updateProfileField(ctx.userId, "profileEditPromptMessageId", messageId);
  if (ctx.user) ctx.user.profileEditPromptMessageId = messageId;
  return true;
}

async function updateRememberedProfileEditPrompt(ctx, text, keyboard) {
  const messageId = Number(ctx.user?.profileEditPromptMessageId);
  if (Number.isInteger(messageId) && messageId > 0) {
    const editors = ctx.user?.photoFileId
      ? [ctx.editMessageCaption, ctx.editMessageText]
      : [ctx.editMessageText, ctx.editMessageCaption];
    for (const edit of editors) {
      if (!edit) continue;
      const edited = await edit(messageId, text, keyboard);
      if (edited) return edited;
    }
  }
  return sendProfileEditPrompt(ctx, text, keyboard);
}

async function startProfileEdit(ctx, state, prompt, keyboard, { deleteCurrentMessage = null } = {}) {
  await deleteCurrentMessage?.();
  await updateUserState(ctx.userId, state);
  return sendProfileEditPrompt(ctx, prompt, keyboard);
}

module.exports = {
  clearProfileEditPrompt,
  rememberProfileEditPrompt,
  sendProfileEditPrompt,
  startProfileEdit,
  updateRememberedProfileEditPrompt,
};
