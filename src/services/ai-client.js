const OpenAI = require("openai");
const { getAiConfig } = require("../config");
const { logger } = require("./logger");
const { recordAiApiEvent } = require("./operational-health");

const DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS = 60;

let client = null;

function classifyAiProviderError(error) {
  const status = Number(error?.status || error?.response?.status) || 0;
  const code = String(error?.code || error?.error?.code || error?.type || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  const signal = `${code} ${message}`;
  let category = "provider_error";
  if (signal.includes("timeout")) category = "timeout";
  else if (status === 401 || signal.includes("invalid_api_key") || signal.includes("authentication")) category = "authentication_failed";
  else if (status === 402) category = "payment_required";
  else if (/insufficient[_ -]?quota|credit|balance|billing|hard[_ -]?limit/.test(signal)) category = "quota_exhausted";
  else if (status === 429) category = "rate_limited";
  else if (status === 403) category = "access_forbidden";
  else if (status >= 500) category = "provider_unavailable";
  return {
    category,
    metadata: {
      ...(status ? { status } : {}),
      ...(code ? { code: code.slice(0, 80) } : {}),
    },
  };
}

function getClient(config = getAiConfig()) {
  if (client) return client;

  const apiKey = config.apiKey;
  if (!apiKey) return null;
  const baseURL = config.baseUrl;

  client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  return client;
}

async function withAiTimeout(request, timeoutLabel, timeoutMs) {
  const abortController = typeof AbortController === "undefined" ? null : new AbortController();
  const promise = typeof request === "function"
    ? Promise.resolve().then(() => request(abortController?.signal))
    : request;
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController?.abort();
          reject(new Error(timeoutLabel));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractAiResponseText(response) {
  const outputText = String(response?.output_text || "").trim();
  if (outputText) return outputText;

  const messageContent = response?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") {
    return messageContent.trim();
  }
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => String(part?.text || part?.content || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  const responseOutput = Array.isArray(response?.output) ? response.output : [];
  return responseOutput
    .flatMap((entry) => Array.isArray(entry?.content) ? entry.content : [])
    .map((part) => String(part?.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractAiTokenUsage(response) {
  const usage = response?.usage || {};
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = Number(usage.total_tokens);
  const metadata = {};
  if (Number.isFinite(inputTokens)) metadata.inputTokens = Math.max(0, inputTokens);
  if (Number.isFinite(outputTokens)) metadata.outputTokens = Math.max(0, outputTokens);
  if (Number.isFinite(totalTokens)) metadata.totalTokens = Math.max(0, totalTokens);
  return Object.keys(metadata).length ? metadata : undefined;
}

async function getEmbedding(openai, input, {
  config = getAiConfig(),
  log = logger,
  recordEvent = recordAiApiEvent,
} = {}) {
  if (!openai?.embeddings?.create || !input) {
    return null;
  }

  try {
    const startedAt = Date.now();
    const response = await withAiTimeout(
      (signal) => openai.embeddings.create(
        {
          model: config.embeddingModel,
          input,
        },
        { signal },
      ),
      "ai_embedding_timeout",
      config.timeoutMs,
    );
    void recordEvent({
      ok: true,
      operation: "embedding",
      provider: "embeddings",
      durationMs: Date.now() - startedAt,
    });
    const embedding = response?.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch (error) {
    void recordEvent({
      ok: false,
      operation: "embedding",
      provider: "embeddings",
      reason: error?.message || "embedding_error",
    });
    log.warn("AI embedding failed", error);
    return null;
  }
}

async function requestSuggestionText(openai, {
  instructions,
  input,
  config = getAiConfig(),
  maxOutputTokens = DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS,
  recordEvent = recordAiApiEvent,
}) {
  const errors = [];
  const provider = config.suggestionProvider || "auto";
  const useChatCompletions = provider !== "responses";
  const useResponses = provider !== "chat";

  if (useChatCompletions && openai?.chat?.completions?.create) {
    const startedAt = Date.now();
    try {
      const response = await withAiTimeout(
        (signal) => openai.chat.completions.create(
          {
            model: config.model,
            max_tokens: maxOutputTokens,
            messages: [
              { role: "system", content: instructions },
              { role: "user", content: input },
            ],
          },
          { signal },
        ),
        "ai_chat_completion_timeout",
        config.timeoutMs,
      );
      const text = extractAiResponseText(response);
      if (text) {
        void recordEvent({
          ok: true,
          operation: "suggestion",
          provider: "chat_completions",
          durationMs: Date.now() - startedAt,
          metadata: extractAiTokenUsage(response),
        });
        return { text, api: "chat_completions" };
      }
      void recordEvent({
        ok: false,
        operation: "suggestion",
        provider: "chat_completions",
        reason: "empty_output",
        durationMs: Date.now() - startedAt,
      });
      errors.push("chat_completions_empty");
    } catch (error) {
      const classified = classifyAiProviderError(error);
      void recordEvent({
        ok: false,
        operation: "suggestion",
        provider: "chat_completions",
        reason: classified.category,
        durationMs: Date.now() - startedAt,
        metadata: classified.metadata,
      });
      errors.push(classified.category);
    }
  }

  if (useResponses && openai?.responses?.create) {
    const startedAt = Date.now();
    try {
      const response = await withAiTimeout(
        (signal) => openai.responses.create(
          {
            model: config.model,
            max_output_tokens: maxOutputTokens,
            instructions,
            input,
          },
          { signal },
        ),
        "ai_responses_timeout",
        config.timeoutMs,
      );
      const text = extractAiResponseText(response);
      if (text) {
        void recordEvent({
          ok: true,
          operation: "suggestion",
          provider: "responses",
          durationMs: Date.now() - startedAt,
          metadata: extractAiTokenUsage(response),
        });
        return { text, api: "responses" };
      }
      void recordEvent({
        ok: false,
        operation: "suggestion",
        provider: "responses",
        reason: "empty_output",
        durationMs: Date.now() - startedAt,
      });
      errors.push("responses_empty");
    } catch (error) {
      const classified = classifyAiProviderError(error);
      void recordEvent({
        ok: false,
        operation: "suggestion",
        provider: "responses",
        reason: classified.category,
        durationMs: Date.now() - startedAt,
        metadata: classified.metadata,
      });
      errors.push(classified.category);
    }
  }

  return { text: "", api: "", errors };
}

module.exports = {
  DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS,
  classifyAiProviderError,
  extractAiResponseText,
  extractAiTokenUsage,
  getClient,
  getEmbedding,
  requestSuggestionText,
  withAiTimeout,
};
