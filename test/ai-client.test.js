const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS,
  classifyAiProviderError,
  extractAiResponseText,
  extractAiTokenUsage,
  requestSuggestionText,
  withAiTimeout,
} = require("../src/services/ai-client");

test("AI provider errors distinguish billing, auth, rate limits, and timeouts", () => {
  assert.equal(classifyAiProviderError({ status: 402 }).category, "payment_required");
  assert.equal(classifyAiProviderError({ status: 429, code: "insufficient_quota" }).category, "quota_exhausted");
  assert.equal(classifyAiProviderError({ status: 429 }).category, "rate_limited");
  assert.equal(classifyAiProviderError({ status: 401 }).category, "authentication_failed");
  assert.equal(classifyAiProviderError(new Error("ai_chat_completion_timeout")).category, "timeout");
});

test("suggestion output stays within the compact two-line budget", () => {
  assert.equal(DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS, 60);
});

test("AI timeout aborts the provider request without waiting in real time", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const request = withAiTimeout((requestSignal) => {
    signal = requestSignal;
    return new Promise(() => {});
  }, "ai_test_timeout", 10000);

  await Promise.resolve();
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(10000);
  await assert.rejects(request, /ai_test_timeout/);
  assert.equal(signal.aborted, true);
});

test("suggestion requests pass an AbortSignal through SDK request options", async () => {
  const signals = [];
  const openai = {
    chat: {
      completions: {
        create: async (_body, options) => {
          signals.push(options?.signal);
          return { choices: [{ message: { content: "Suggestion" } }] };
        },
      },
    },
  };

  await requestSuggestionText(openai, {
    config: { model: "test-model", timeoutMs: 1000, suggestionProvider: "chat" },
    instructions: "test",
    input: "input",
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0] instanceof AbortSignal, true);
});

test("extractAiTokenUsage supports both provider usage shapes", () => {
  assert.deepEqual(
    extractAiTokenUsage({ usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } }),
    { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
  );
  assert.deepEqual(
    extractAiTokenUsage({ usage: { input_tokens: 18, output_tokens: 7, total_tokens: 25 } }),
    { inputTokens: 18, outputTokens: 7, totalTokens: 25 },
  );
  assert.equal(extractAiTokenUsage({}), undefined);
});

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

test("requestSuggestionText records provider health without changing result", async () => {
  const events = [];
  const openai = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: "" } }] }),
      },
    },
    responses: {
      create: async () => ({
        output_text: "Useful suggestion",
        usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
      }),
    },
  };

  const result = await requestSuggestionText(openai, {
    config: { model: "test-model", timeoutMs: 1000 },
    instructions: "test",
    input: "input",
    recordEvent: (event) => events.push(event),
  });

  assert.deepEqual(result, { text: "Useful suggestion", api: "responses" });
  assert.equal(events.length, 2);
  assert.equal(events[0].ok, false);
  assert.equal(events[0].provider, "chat_completions");
  assert.equal(events[0].reason, "empty_output");
  assert.equal(events[1].ok, true);
  assert.equal(events[1].provider, "responses");
  assert.deepEqual(events[1].metadata, { inputTokens: 12, outputTokens: 4, totalTokens: 16 });
});

test("requestSuggestionText can use only chat completions", async () => {
  const calls = [];
  const openai = {
    chat: {
      completions: {
        create: async () => {
          calls.push("chat");
          return { choices: [{ message: { content: "Chat suggestion" } }] };
        },
      },
    },
    responses: {
      create: async () => {
        calls.push("responses");
        return { output_text: "Responses suggestion" };
      },
    },
  };

  const result = await requestSuggestionText(openai, {
    config: { model: "test-model", timeoutMs: 1000, suggestionProvider: "chat" },
    instructions: "test",
    input: "input",
  });

  assert.deepEqual(calls, ["chat"]);
  assert.deepEqual(result, { text: "Chat suggestion", api: "chat_completions" });
});

test("requestSuggestionText can use only responses", async () => {
  const calls = [];
  const openai = {
    chat: {
      completions: {
        create: async () => {
          calls.push("chat");
          return { choices: [{ message: { content: "Chat suggestion" } }] };
        },
      },
    },
    responses: {
      create: async () => {
        calls.push("responses");
        return { output_text: "Responses suggestion" };
      },
    },
  };

  const result = await requestSuggestionText(openai, {
    config: { model: "test-model", timeoutMs: 1000, suggestionProvider: "responses" },
    instructions: "test",
    input: "input",
  });

  assert.deepEqual(calls, ["responses"]);
  assert.deepEqual(result, { text: "Responses suggestion", api: "responses" });
});
