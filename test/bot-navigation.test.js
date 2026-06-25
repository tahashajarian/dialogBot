const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearBottomKeyboardQuietly,
  removeBottomKeyboard,
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

  assert.equal(replies[0].text, ".");
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

  assert.equal(replies[0].text, ".");
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
});
