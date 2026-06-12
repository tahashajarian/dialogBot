const messages = require("../messages");
const { updateProfileField } = require("./users");
const { leaveDiscussionAndNotify } = require("./discussion-actions");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function removeBottomKeyboard(ctx, text = " ") {
  const sent = await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
  const messageId = getMessageId(sent);
  if (messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }
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

async function leaveDiscussionAndClearKeyboardForNavigation(ctx) {
  const left = await leaveActiveDiscussionForNavigation(ctx);
  if (left) {
    await clearBottomKeyboardQuietly(ctx);
  }
  return left;
}

module.exports = {
  getMessageId,
  removeBottomKeyboard,
  clearBottomKeyboardQuietly,
  leaveActiveDiscussionForNavigation,
  leaveDiscussionAndClearKeyboardForNavigation,
};
