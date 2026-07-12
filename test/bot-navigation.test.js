const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearBottomKeyboardQuietly,
  removeBottomKeyboard,
  replyWithRemovedKeyboardThenInline,
  replyWithKeyboardRemovalNoticeThenInline,
} = require("../src/services/bot-navigation");

test("quiet keyboard removal sends Telegram-valid non-empty text", async () => {
  const replies = [];
  const deletedIds = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 1 };
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
  };

  await clearBottomKeyboardQuietly(ctx);

  assert.equal(replies[0].text.length > 0, true);
  assert.notEqual(replies[0].text, ".");
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
  assert.deepEqual(deletedIds, [1]);
});

test("keyboard removal normalizes whitespace-only text", async () => {
  const replies = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 1 };
    },
  };

  await removeBottomKeyboard(ctx, "   ", { deleteSentMessage: false });

  assert.equal(replies[0].text.length > 0, true);
  assert.notEqual(replies[0].text, ".");
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
});

test("keyboard removal falls back to visible dot if invisible cleanup text is rejected", async () => {
  const replies = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      if (replies.length === 1) {
        const error = new Error("Bad Request: message text is empty");
        error.description = "Bad Request: message text is empty";
        throw error;
      }
      return { message_id: 1 };
    },
  };

  await removeBottomKeyboard(ctx, "   ", { deleteSentMessage: false });

  assert.equal(replies.length, 2);
  assert.equal(replies[1].text, ".");
  assert.equal(replies[1].extra.reply_markup.remove_keyboard, true);
});

test("inline navigation clears bottom keyboard on the menu message", async () => {
  const replies = [];
  const edits = [];
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "Go", callback_data: "go" }]] } };
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
  };

  await replyWithRemovedKeyboardThenInline(ctx, "Choose one", keyboard);

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, "Choose one");
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, 1);
  assert.equal(edits[0].text, "Choose one");
  assert.equal(edits[0].extra.reply_markup.inline_keyboard[0][0].text, "Go");
});

test("inline navigation can clear the bottom keyboard on a stable notice without duplicating the menu", async () => {
  const replies = [];
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "Go", callback_data: "go" }]] } };
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  await replyWithKeyboardRemovalNoticeThenInline(ctx, "Media", "Choose one", keyboard);

  assert.equal(replies.length, 2);
  assert.equal(replies[0].text, "Media");
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
  assert.equal(replies[1].text, "Choose one");
  assert.equal(replies[1].extra.reply_markup.inline_keyboard[0][0].text, "Go");
});

test("inline navigation falls back without waiting for cleanup deletion", async () => {
  const replies = [];
  let deleteStarted = false;
  let resolveDelete = null;
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "Go", callback_data: "go" }]] } };
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    editMessageText: async () => false,
    deleteMessage: async () => {
      deleteStarted = true;
      return new Promise((resolve) => {
        resolveDelete = resolve;
      });
    },
  };

  await replyWithRemovedKeyboardThenInline(ctx, "Choose one", keyboard);

  assert.equal(deleteStarted, true);
  assert.equal(replies.length, 2);
  assert.equal(replies[0].text, "Choose one");
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
  assert.equal(replies[1].text, "Choose one");
  assert.equal(replies[1].extra.reply_markup.inline_keyboard[0][0].text, "Go");

  resolveDelete(true);
});
