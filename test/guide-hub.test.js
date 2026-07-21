const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const { restoreGuideHubCard, sendGuideHub } = require("../src/flows/guide-hub");

test("Guide preserves the current reply keyboard and sends one closable inline text card", async () => {
  const replies = [];
  const ctx = {
    user: { userId: 1, state: "idle", navigationMode: "global" },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  await sendGuideHub(ctx, "fa");

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.fa.helpText);
  assert.deepEqual(
    replies[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data),
    [callBacks.profileStars, callBacks.helpReferral, callBacks.helpRules, callBacks.helpCardClose],
  );
  assert.equal(ctx.user.navigationMode, "global");
});

test("Guide detail Back restores the same text card in place", async () => {
  const edits = [];
  const replies = [];
  const ctx = {
    callbackMessageId: 42,
    user: { userId: 1, state: "idle", navigationMode: "global" },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    reply: async (...args) => replies.push(args),
  };

  await restoreGuideHubCard(ctx, "en");

  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, 42);
  assert.equal(edits[0].text, messages.en.helpText);
  assert.deepEqual(
    edits[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data),
    [callBacks.profileStars, callBacks.helpReferral, callBacks.helpRules, callBacks.helpCardClose],
  );
  assert.deepEqual(replies, []);
  assert.equal(ctx.user.navigationMode, "global");
});
