const messages = require("../messages");
const { updateProfileField } = require("./users");
const { leaveDiscussionAndNotify } = require("./discussion-actions");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function removeBottomKeyboard(ctx, text = " ", { deleteSentMessage = true } = {}) {
  const sent = await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
  const messageId = getMessageId(sent);
  if (deleteSentMessage && messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }
  return sent;
}

async function replyWithRemovedKeyboardThenInline(ctx, text, inlineKeyboard) {
  const sent = await removeBottomKeyboard(ctx, text, { deleteSentMessage: false });
  const messageId = getMessageId(sent);
  if (messageId && ctx.editMessageText) {
    const edited = await ctx.editMessageText(messageId, text, inlineKeyboard);
    if (edited) return edited;
  }
  return ctx.reply(text, inlineKeyboard);
}

async function clearBottomKeyboardQuietly(ctx) {
  return removeBottomKeyboard(ctx, " ");
}

async function leaveActiveDiscussionForNavigation(ctx) {
  const discussionId = String(ctx.user?.activeDiscussionId || "");
  if (!discussionId) return null;
  const left = await leaveDiscussionAndNotify({ ctx, messages, discussionId });
  if (!left.ok) {
    await updateProfileField(ctx.userId, "activeDiscussionId", null);
  }
  if (ctx.user) ctx.user.activeDiscussionId = null;
  return left;
}

async function leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard = true } = {}) {
  const left = await leaveActiveDiscussionForNavigation(ctx);
  if (left && clearKeyboard) {
    await clearBottomKeyboardQuietly(ctx);
  }
  return left;
}

module.exports = {
  getMessageId,
  removeBottomKeyboard,
  replyWithRemovedKeyboardThenInline,
  clearBottomKeyboardQuietly,
  leaveActiveDiscussionForNavigation,
  leaveDiscussionAndClearKeyboardForNavigation,
};
