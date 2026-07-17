const test = require("node:test");
const assert = require("node:assert/strict");

const { createAppContext } = require("../src/services/app-context");
const { logger } = require("../src/services/logger");

test("editMessageText treats missing edit targets as stale without warning", async () => {
  const originalWarn = logger.warn;
  const warnings = [];
  logger.warn = (message, details) => {
    warnings.push({ message, details });
  };

  const ctx = {
    chat: { id: 123 },
    telegram: {
      callApi: async () => {
        const error = new Error("400: Bad Request: message to edit not found");
        error.code = 400;
        error.description = "Bad Request: message to edit not found";
        throw error;
      },
    },
  };

  try {
    const appCtx = createAppContext(ctx, { userId: 1 }, { operationTimeoutMs: 100 });
    const edited = await appCtx.editMessageText(99, "Fresh card");

    assert.equal(edited, false);
    assert.deepEqual(warnings, []);
  } finally {
    logger.warn = originalWarn;
  }
});

test("editMessageText suppresses duplicate fallback when an edit times out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalWarn = logger.warn;
  const warnings = [];
  logger.warn = (message, details) => warnings.push({ message, details });

  const ctx = {
    chat: { id: 123 },
    telegram: {
      callApi: () => new Promise(() => {}),
    },
  };

  try {
    const appCtx = createAppContext(ctx, { userId: 1 }, { operationTimeoutMs: 10000 });
    const editPromise = appCtx.editMessageText(99, "Fresh card");
    t.mock.timers.tick(10000);
    const edited = await editPromise;

    assert.equal(edited, true);
    assert.equal(warnings[0]?.message, "Telegram message edit result was uncertain; suppressing fallback");
  } finally {
    logger.warn = originalWarn;
  }
});

test("editMessageCaption updates photo cards with inline controls", async () => {
  const calls = [];
  const ctx = {
    chat: { id: 123 },
    telegram: {
      callApi: async (method, payload) => {
        calls.push({ method, payload });
        return true;
      },
    },
  };
  const appCtx = createAppContext(ctx, { userId: 1 }, { operationTimeoutMs: 100 });
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back" }]] } };

  assert.equal(await appCtx.editMessageCaption(99, "Discussion", keyboard), true);
  assert.equal(calls[0].method, "editMessageCaption");
  assert.equal(calls[0].payload.message_id, 99);
  assert.equal(calls[0].payload.caption, "Discussion");
  assert.deepEqual(calls[0].payload.reply_markup, keyboard.reply_markup);
});
