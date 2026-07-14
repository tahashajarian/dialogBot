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

async function startProfileEdit(ctx, state, prompt, keyboard, { deleteCurrentMessage = null } = {}) {
  await deleteCurrentMessage?.();
  await updateUserState(ctx.userId, state);
  return sendProfileEditPrompt(ctx, prompt, keyboard);
}

module.exports = {
  clearProfileEditPrompt,
  sendProfileEditPrompt,
  startProfileEdit,
};
