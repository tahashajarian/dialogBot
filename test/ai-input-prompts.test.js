const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const {
  replaceAiPendingInputPrompt,
} = require("../src/flows/ai-input-prompts");

test("replacing an AI input prompt retains history before tracking the new one", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  const events = [];
  User.findOneAndUpdate = async (_filter, update) => {
    updates.push(update);
    return {};
  };

  const ctx = {
    userId: 42,
    user: { aiPendingInputMessageId: 10 },
    deleteMessage: async (messageId) => {
      events.push(`delete:${messageId}`);
      return true;
    },
    editMessageReplyMarkup: async () => false,
  };

  try {
    const prompt = await replaceAiPendingInputPrompt(ctx, async () => {
      events.push("send");
      return { message_id: 11 };
    });

    assert.deepEqual(prompt, { message_id: 11 });
    assert.deepEqual(events, ["send"]);
    assert.equal(ctx.user.aiPendingInputMessageId, 11);
    assert.deepEqual(updates, [
      { aiPendingInputMessageId: null },
      { aiPendingInputMessageId: 11 },
    ]);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("replacing an AI input prompt never deletes the retained prompt", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});
  const events = [];
  let deleteAttempts = 0;
  const ctx = {
    userId: 42,
    user: { aiPendingInputMessageId: 10 },
    deleteMessage: async (messageId) => {
      deleteAttempts += 1;
      events.push(`delete:${messageId}:${deleteAttempts}`);
      return deleteAttempts > 1;
    },
    editMessageReplyMarkup: async () => false,
  };

  try {
    await replaceAiPendingInputPrompt(ctx, async () => {
      events.push("send");
      return { message_id: 11 };
    });

    assert.deepEqual(events, ["send"]);
    assert.equal(ctx.user.aiPendingInputMessageId, 11);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
