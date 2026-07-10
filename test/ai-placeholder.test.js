const test = require("node:test");
const assert = require("node:assert/strict");

const { editPlaceholder, startAiPlaceholder } = require("../src/services/ai-placeholder");

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
