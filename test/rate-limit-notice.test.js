const test = require("node:test");
const assert = require("node:assert/strict");
const { sendRateLimitNotice } = require("../src/services/rate-limit-notice");
const messages = require("../src/messages");

test("rate-limit text notice preserves state and reply keyboard", async () => {
  const calls = [];
  const user = { state: "editing_bio", navigationMode: "profile" };
  const before = { ...user };
  const sent = await sendRateLimitNotice({
    from: { id: 1, language_code: "en" },
    reply: async (...args) => calls.push(args),
  }, {
    userId: 1,
    messages,
    claim: () => true,
  });

  assert.equal(sent, true);
  assert.deepEqual(user, before);
  assert.deepEqual(calls, [[messages.en.tooManyRequests]]);
});

test("rate-limit callback notice uses an alert without editing its card", async () => {
  const calls = [];
  await sendRateLimitNotice({
    from: { id: 2, language_code: "fa" },
    callbackQuery: { from: { id: 2, language_code: "fa" } },
    answerCbQuery: async (...args) => calls.push(["answer", ...args]),
    reply: async (...args) => calls.push(["reply", ...args]),
  }, {
    userId: 2,
    messages,
    claim: () => true,
  });

  assert.deepEqual(calls, [[
    "answer",
    messages.fa.tooManyRequests,
    { show_alert: true },
  ]]);
});
