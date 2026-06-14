const test = require("node:test");
const assert = require("node:assert/strict");

const { editPlaceholder } = require("../src/services/ai-placeholder");

test("editPlaceholder preserves original message when edit returns true", async () => {
  const placeholder = { message_id: 42 };
  const editedCalls = [];
  const ctx = {
    editMessageText: async (messageId, text, extra) => {
      editedCalls.push({ messageId, text, extra });
      return true;
    },
  };

  const result = await editPlaceholder(ctx, placeholder, "next", { reply_markup: { inline_keyboard: [] } });

  assert.equal(result, placeholder);
  assert.deepEqual(editedCalls, [{
    messageId: 42,
    text: "next",
    extra: { reply_markup: { inline_keyboard: [] } },
  }]);
});

test("editPlaceholder preserves original message when edit response has no message id", async () => {
  const placeholder = { message_id: 42 };
  const ctx = {
    editMessageText: async () => ({ ok: true }),
  };

  const result = await editPlaceholder(ctx, placeholder, "next");

  assert.equal(result, placeholder);
});
