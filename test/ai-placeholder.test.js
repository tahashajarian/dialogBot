const test = require("node:test");
const assert = require("node:assert/strict");

const { editPlaceholder, startAiPlaceholder } = require("../src/services/ai-placeholder");

test("long-running suggestion copy includes a genuine still-thinking step", () => {
  const messages = require("../src/messages");
  assert.equal(messages.fa.aiThinkingLonger, "👩‍🦳 هنوز دارم فکر می‌کنم...");
  assert.equal(messages.en.aiThinkingLonger, "👩‍🦳 Still thinking...");
});

test("taste-label waiting copy reports waiting without claiming guessed progress", () => {
  const messages = require("../src/messages");
  assert.equal(messages.fa.aiTasteWaitingStill, "👩‍🦳 بررسی هنوز ادامه داره؛ یکم دیگه منتظر بمون…");
  assert.equal(messages.fa.aiTasteWaitingLonger, "👩‍🦳 این بررسی کمی بیشتر طول کشیده؛ هنوز منتظر نتیجه‌ام…");
  assert.doesNotMatch(`${messages.fa.aiTasteWaitingStill} ${messages.fa.aiTasteWaitingLonger}`, /تقریباً|نزدیک/);
});

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

test("AI progress replaces its placeholder with a visible final result when editing fails", async () => {
  const replies = [];
  const deletedIds = [];
  const ctx = {
    reply: async (text) => {
      replies.push(text);
      return { message_id: 80 + replies.length };
    },
    editMessageText: async () => false,
    deleteMessage: async (messageId) => deletedIds.push(messageId),
  };

  const placeholder = await startAiPlaceholder(ctx, ["Thinking", "Still thinking"], {
    stepDelays: [5],
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  await placeholder.finish("Final result");

  assert.deepEqual(deletedIds, [81]);
  assert.deepEqual(replies, ["Thinking", "Final result"]);
});

test("AI placeholder always ends in a visible fallback when work never finishes", async () => {
  const edits = [];
  const ctx = {
    reply: async () => ({ message_id: 77 }),
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
  };
  const fallbackExtra = { reply_markup: { inline_keyboard: [[{ text: "Retry" }]] } };

  const placeholder = await startAiPlaceholder(ctx, ["Thinking"], {
    fallbackText: "Please try again",
    fallbackExtra,
    timeoutMs: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(edits.at(-1), {
    messageId: 77,
    text: "Please try again",
    extra: fallbackExtra,
  });
  assert.equal(await placeholder.finish("Late result"), null);
});

test("final AI result is queued after an in-flight loading edit", async () => {
  const edits = [];
  let releaseLoadingEdit;
  const loadingEdit = new Promise((resolve) => { releaseLoadingEdit = resolve; });
  const ctx = {
    reply: async () => ({ message_id: 88 }),
    editMessageText: async (messageId, text) => {
      edits.push(text);
      if (text === "Still thinking") await loadingEdit;
      return true;
    },
  };

  const placeholder = await startAiPlaceholder(ctx, ["Thinking", "Still thinking"], { stepDelays: [10] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const finished = placeholder.finish("Final suggestion");
  releaseLoadingEdit();
  await finished;

  assert.deepEqual(edits, ["Still thinking", "Final suggestion"]);
});

test("AI placeholders replace progress with a new message when restoring a reply keyboard", async () => {
  const replies = [];
  const edits = [];
  const deletedIds = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    deleteMessage: async (messageId) => deletedIds.push(messageId),
  };

  const placeholder = await startAiPlaceholder(ctx, ["Thinking", "Still thinking"], {
    initialExtra: { reply_markup: { remove_keyboard: true } },
    stepDelays: [5],
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  await placeholder.finish("Final result", { reply_markup: { keyboard: [[{ text: "Save" }]] } });

  assert.deepEqual(replies.map((entry) => entry.text), ["Thinking", "Final result"]);
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
  assert.deepEqual(edits.map((entry) => entry.text), ["Still thinking"]);
  assert.equal(edits[0].messageId, 1);
  assert.deepEqual(deletedIds, [1]);
  assert.equal(replies[1].extra.reply_markup.keyboard[0][0].text, "Save");
});

test("terminal AI results replace an uncertain placeholder edit before actions continue", async () => {
  const replies = [];
  const deletedIds = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 + replies.length };
    },
    editMessageText: async (messageId) => ({
      message_id: messageId,
      edit_uncertain: true,
    }),
    deleteMessage: async (messageId) => deletedIds.push(messageId),
  };

  const placeholder = await startAiPlaceholder(ctx, ["Thinking"]);
  const result = await placeholder.finish("Dark (2017, Creator: Baran bo Odar)");

  assert.deepEqual(deletedIds, [101]);
  assert.deepEqual(replies.map((entry) => entry.text), [
    "Thinking",
    "Dark (2017, Creator: Baran bo Odar)",
  ]);
  assert.equal(result.message_id, 102);
});

test("AI placeholder runs refund work before showing a paid timeout", async () => {
  const events = [];
  const ctx = {
    reply: async (text) => {
      events.push(`reply:${text}`);
      return { message_id: events.length };
    },
  };

  const placeholder = await startAiPlaceholder(ctx, ["Thinking"], {
    fallbackText: "Refunded",
    timeoutMs: 10,
    onFallback: async () => events.push("refund"),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(events, ["reply:Thinking", "refund", "reply:Refunded"]);
  assert.equal(placeholder.isSettled(), true);
  assert.equal(await placeholder.finish("Late success"), null);
});
