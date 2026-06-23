const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const messages = require("../src/messages");
const { handleCallback } = require("../src/callbacks");
const { callBacks } = require("../src/constants");
const {
  clearAiActionMessage,
  rememberAiActionMessage,
} = require("../src/flows/ai-cards");

test("AI action cards remember context and retire the tracked inline card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});
  const deleted = [];
  const ctx = {
    userId: 42,
    user: {},
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
  };

  try {
    await rememberAiActionMessage(ctx, "manage:music:topTen", { message_id: 55 });
    assert.equal(ctx.user.aiActionMessageId, 55);
    assert.equal(ctx.user.aiActionContext, "manage:music:topTen");

    const cleared = await clearAiActionMessage(ctx);
    assert.equal(cleared, true);
    assert.deepEqual(deleted, [55]);
    assert.equal(ctx.user.aiActionMessageId, null);
    assert.equal(ctx.user.aiActionContext, "");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("AI button guidance is concise, bot-authored, and distinguishes control types", () => {
  for (const lang of ["fa", "en"]) {
    assert.match(messages[lang].aiSectionUseButtonsOnly, /^👩‍🦳/);
    assert.match(messages[lang].aiSectionUseButtonsOnly, /💡/);
    assert.match(messages[lang].aiListManageUseButtonsTip, /^💡/);
    assert.match(messages[lang].aiSuggestionUseButtons, /^👩‍🦳/);
    assert.match(messages[lang].aiSuggestionUseButtons, /💡/);
  }
});

test("old suggestion action cards are retired without running the stale action", async () => {
  const deleted = [];
  const replies = [];
  let answered = false;
  const ctx = {
    callbackData: `${callBacks.aiSectionAddSuggestionDone}books`,
    callbackMessageId: 10,
    userId: 42,
    user: {
      userId: 42,
      lang: "en",
      state: "ai_chat_books",
      aiActionMessageId: 20,
      aiActionContext: "suggest_result:books",
    },
    answerCb: async () => {
      answered = true;
      return true;
    },
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
    reply: async (text) => {
      replies.push(text);
      return { message_id: 1 };
    },
  };

  await handleCallback(ctx);

  assert.equal(answered, true);
  assert.deepEqual(deleted, [10]);
  assert.deepEqual(replies, []);
});
