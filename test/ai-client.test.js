const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractAiResponseText,
  requestSuggestionText,
} = require("../src/services/ai-client");

test("extractAiResponseText supports responses and chat completion shapes", () => {
  assert.equal(extractAiResponseText({ output_text: " direct " }), "direct");
  assert.equal(
    extractAiResponseText({ choices: [{ message: { content: " chat " } }] }),
    "chat",
  );
  assert.equal(
    extractAiResponseText({
      output: [
        { content: [{ text: " first " }, { text: "second" }] },
      ],
    }),
    "first\nsecond",
  );
});

test("requestSuggestionText falls back from empty chat response to responses API", async () => {
  const calls = [];
  const openai = {
    chat: {
      completions: {
        create: async () => {
          calls.push("chat");
          return { choices: [{ message: { content: "" } }] };
        },
      },
    },
    responses: {
      create: async () => {
        calls.push("responses");
        return { output_text: "Fallback suggestion" };
      },
    },
  };

  const result = await requestSuggestionText(openai, {
    config: { model: "test-model", timeoutMs: 1000 },
    instructions: "test",
    input: "input",
    maxOutputTokens: 12,
  });

  assert.deepEqual(calls, ["chat", "responses"]);
  assert.deepEqual(result, { text: "Fallback suggestion", api: "responses" });
});
