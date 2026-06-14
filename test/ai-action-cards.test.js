const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const messages = require("../src/messages");
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
    assert.match(messages[lang].aiSectionUseButtonsOnly, /^🤖/);
    assert.match(messages[lang].aiSectionUseButtonsOnly, /💡/);
    assert.match(messages[lang].aiListManageUseButtonsTip, /^💡/);
    assert.match(messages[lang].aiSuggestionUseButtons, /^🤖/);
    assert.match(messages[lang].aiSuggestionUseButtons, /💡/);
  }
});
