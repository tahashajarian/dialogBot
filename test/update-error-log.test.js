const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildUpdateErrorLogDetails,
  getCallbackCategory,
  getCommandName,
} = require("../src/services/update-error-log");

test("update error log metadata includes command name without message text", () => {
  const error = new Error("boom");
  const details = buildUpdateErrorLogDetails({
    ctx: {
      from: { id: 123 },
      chat: { id: 456 },
      message: {
        text: "/start ref_secret_payload",
        from: { id: 123 },
        chat: { id: 456 },
      },
    },
    user: { userId: 123, state: "profile_bio" },
    durationMs: 12,
    error,
  });

  assert.equal(details.userId, 123);
  assert.equal(details.chatId, 456);
  assert.equal(details.updateType, "message");
  assert.equal(details.userState, "profile_bio");
  assert.equal(details.commandName, "/start");
  assert.equal(details.durationMs, 12);
  assert.equal(details.error.name, "Error");
  assert.equal(details.error.message, "boom");
  assert.equal(typeof details.error.stack, "string");
  assert.equal(JSON.stringify(details).includes("ref_secret_payload"), false);
});

test("update error log metadata includes callback category without full payload", () => {
  const details = buildUpdateErrorLogDetails({
    ctx: {
      callbackQuery: {
        data: "discussion_join_PRIVATE_CODE_123",
        from: { id: 234 },
        message: { chat: { id: 567 } },
      },
    },
    user: { userId: 234, state: "idle" },
    durationMs: 7,
    error: new TypeError("bad callback"),
  });

  assert.equal(details.userId, 234);
  assert.equal(details.chatId, 567);
  assert.equal(details.updateType, "callback_query");
  assert.equal(details.userState, "idle");
  assert.equal(details.callbackCategory, "discussion");
  assert.equal(details.durationMs, 7);
  assert.equal(details.error.name, "TypeError");
  assert.equal(details.error.message, "bad callback");
  assert.equal(JSON.stringify(details).includes("PRIVATE_CODE_123"), false);
});

test("command and callback sanitizers reject non-metadata payloads", () => {
  assert.equal(getCommandName("normal discussion text"), undefined);
  assert.equal(getCommandName("/profile@MuzeBot extra private text"), "/profile");
  assert.equal(getCommandName("/bad-command secret"), undefined);

  assert.equal(getCallbackCategory("profile:view:123"), "profile");
  assert.equal(getCallbackCategory("secret value with spaces"), "secret");
  assert.equal(getCallbackCategory(""), undefined);
});
