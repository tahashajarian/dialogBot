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

test("Persian app context localizes visible digits without changing machine tokens", async () => {
  const replies = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return true;
    },
  };
  const appCtx = createAppContext(ctx, { userId: 1, lang: "fa" });

  await appCtx.reply(
    "Page 12 — /u_A1B2 — https://example.com/12 — d_A1B2",
    {
      reply_markup: {
        inline_keyboard: [[{
          text: "Page 12",
          callback_data: "page:12",
          copy_text: { text: "Count 12 /u_A1B2" },
        }]],
      },
    },
  );

  assert.equal(replies[0].text, "Page ۱۲ — /u_A1B2 — https://example.com/12 — d_A1B2");
  const button = replies[0].extra.reply_markup.inline_keyboard[0][0];
  assert.equal(button.text, "Page ۱۲");
  assert.equal(button.callback_data, "page:12");
  assert.equal(button.copy_text.text, "Count ۱۲ /u_A1B2");
});

test("English app context normalizes Persian and Arabic-Indic digits to Latin", async () => {
  const replies = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return true;
    },
  };
  const appCtx = createAppContext(ctx, { userId: 1, lang: "en" });

  await appCtx.reply("Count ۱۲ and ١٢", {
    reply_markup: { keyboard: [[{ text: "Page ۱۲" }]] },
  });

  assert.equal(replies[0].text, "Count 12 and 12");
  assert.equal(replies[0].extra.reply_markup.keyboard[0][0].text, "Page 12");
});
