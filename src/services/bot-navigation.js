const messages = require("../messages");
const { updateProfileField } = require("./users");
const { leaveDiscussionAndNotify } = require("./discussion-actions");

const KEYBOARD_CLEANUP_TEXT = "\u2063";
const KEYBOARD_CLEANUP_FALLBACK_TEXT = ".";

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function normalizeKeyboardRemovalText(text) {
  const value = String(text || "").trim();
  return value || KEYBOARD_CLEANUP_TEXT;
}

function isEmptyCleanupTextError(error) {
  const description = String(error?.description || error?.message || "");
  return /message text is empty|text must be non-empty/i.test(description);
}

async function sendKeyboardRemovalMessage(ctx, text) {
  const normalizedText = normalizeKeyboardRemovalText(text);
  try {
    return await ctx.reply(normalizedText, { reply_markup: { remove_keyboard: true } });
  } catch (error) {
    if (normalizedText !== KEYBOARD_CLEANUP_FALLBACK_TEXT && isEmptyCleanupTextError(error)) {
      return ctx.reply(KEYBOARD_CLEANUP_FALLBACK_TEXT, { reply_markup: { remove_keyboard: true } });
    }
    throw error;
  }
}

async function removeBottomKeyboard(ctx, text = KEYBOARD_CLEANUP_TEXT, { deleteSentMessage = true } = {}) {
  const sent = await sendKeyboardRemovalMessage(ctx, text);
  const messageId = getMessageId(sent);
  if (deleteSentMessage && messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }
  return sent;
}

async function removeBottomKeyboardWithoutWaitingForDelete(ctx, text = KEYBOARD_CLEANUP_TEXT) {
  const sent = await sendKeyboardRemovalMessage(ctx, text);
  const messageId = getMessageId(sent);
  if (messageId && ctx.deleteMessage) {
    Promise.resolve(ctx.deleteMessage(messageId)).catch(() => {});
  }
  return sent;
}

async function replyWithRemovedKeyboardThenInline(ctx, text, inlineKeyboard) {
  const sent = await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
  const messageId = getMessageId(sent);
  if (messageId && ctx.editMessageText) {
    const edited = await ctx.editMessageText(messageId, text, inlineKeyboard);
    if (edited) {
      return edited;
    }
  }
  if (messageId && ctx.deleteMessage) {
    Promise.resolve(ctx.deleteMessage(messageId)).catch(() => {});
  }
  return ctx.reply(text, inlineKeyboard);
}

async function replyWithKeyboardRemovalNoticeThenInline(ctx, noticeText, text, inlineKeyboard) {
  await removeBottomKeyboard(ctx);
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
  removeBottomKeyboardWithoutWaitingForDelete,
  replyWithRemovedKeyboardThenInline,
  replyWithKeyboardRemovalNoticeThenInline,
  clearBottomKeyboardQuietly,
  leaveActiveDiscussionForNavigation,
  leaveDiscussionAndClearKeyboardForNavigation,
};
