const OpenAI = require("openai");
const { getAiConfig } = require("../config");
const { logger } = require("./logger");

const DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS = 90;

let client = null;

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

async function withAiTimeout(promise, timeoutLabel, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutLabel)), timeoutMs);
    }),
  ]);
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

async function getEmbedding(openai, input, {
  config = getAiConfig(),
  log = logger,
} = {}) {
  if (!openai?.embeddings?.create || !input) {
    return null;
  }

  try {
    const response = await withAiTimeout(
      openai.embeddings.create({
        model: config.embeddingModel,
        input,
      }),
      "ai_embedding_timeout",
      config.timeoutMs,
    );
    const embedding = response?.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch (error) {
    log.warn("AI embedding failed", error);
    return null;
  }
}

async function requestSuggestionText(openai, {
  instructions,
  input,
  config = getAiConfig(),
  maxOutputTokens = DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS,
}) {
  const errors = [];

  if (openai?.chat?.completions?.create) {
    try {
      const response = await withAiTimeout(
        openai.chat.completions.create({
          model: config.model,
          max_tokens: maxOutputTokens,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: input },
          ],
        }),
        "ai_chat_completion_timeout",
        config.timeoutMs,
      );
      const text = extractAiResponseText(response);
      if (text) return { text, api: "chat_completions" };
      errors.push("chat_completions_empty");
    } catch (error) {
      errors.push(error?.message || "chat_completions_error");
    }
  }

  if (openai?.responses?.create) {
    try {
      const response = await withAiTimeout(
        openai.responses.create({
          model: config.model,
          max_output_tokens: maxOutputTokens,
          instructions,
          input,
        }),
        "ai_responses_timeout",
        config.timeoutMs,
      );
      const text = extractAiResponseText(response);
      if (text) return { text, api: "responses" };
      errors.push("responses_empty");
    } catch (error) {
      errors.push(error?.message || "responses_error");
    }
  }

  return { text: "", api: "", errors };
}

module.exports = {
  DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS,
  extractAiResponseText,
  getClient,
  getEmbedding,
  requestSuggestionText,
  withAiTimeout,
};
