const messages = require("../messages");
const { updateProfileField } = require("./users");
const { leaveDiscussionAndNotify } = require("./discussion-actions");

const KEYBOARD_CLEANUP_TEXT = ".";

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function normalizeKeyboardRemovalText(text) {
  const value = String(text || "").trim();
  return value || KEYBOARD_CLEANUP_TEXT;
}

async function removeBottomKeyboard(ctx, text = KEYBOARD_CLEANUP_TEXT, { deleteSentMessage = true } = {}) {
  const sent = await ctx.reply(normalizeKeyboardRemovalText(text), { reply_markup: { remove_keyboard: true } });
  const messageId = getMessageId(sent);
  if (deleteSentMessage && messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }
  return sent;
}

async function replyWithRemovedKeyboardThenInline(ctx, text, inlineKeyboard) {
  await removeBottomKeyboard(ctx, KEYBOARD_CLEANUP_TEXT, { deleteSentMessage: true });
  return ctx.reply(text, inlineKeyboard);
}

async function clearBottomKeyboardQuietly(ctx) {
  return removeBottomKeyboard(ctx, KEYBOARD_CLEANUP_TEXT);
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
