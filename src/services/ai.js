const OpenAI = require("openai");

const DEFAULT_MODEL = process.env.OPENAI_MODEL || process.env.MODEL_NAME || "gpt-4o-mini";
const MAX_OUTPUT_TOKENS = 50;
const MAX_INPUT_CHARS = 180;
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 8000);

let client;

function getClient() {
  if (client) return client;

  const apiKey = (process.env.OPENAI_API_KEY || process.env.API_KEY || "").trim();
  if (!apiKey) return null;
  const baseURL = (process.env.API_BASE_URL || process.env.api_base_url || "").trim();

  client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  return client;
}

function normalizeInput(text) {
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, MAX_INPUT_CHARS);
}

function getModeInstruction(mode, lang) {
  const language = lang === "fa" ? "Persian" : "English";

  if (mode === "movies") {
    return `Subject is movies. Reply in ${language}. Keep it short and useful.`;
  }

  if (mode === "music") {
    return `Subject is music. Reply in ${language}. Keep it short and useful.`;
  }

  if (mode === "books") {
    return `Subject is books. Reply in ${language}. Keep it short and useful.`;
  }

  return `Subject is random lifestyle suggestions. Reply in ${language}. Keep it short and useful.`;
}

async function getAiAssistantReply({ mode, lang, userText }) {
  const input = normalizeInput(userText);
  if (!input) {
    return { ok: false, reason: "empty_input" };
  }

  const openai = getClient();
  if (!openai) {
    return { ok: false, reason: "missing_key" };
  }

  try {
    const response = await Promise.race([
      openai.responses.create({
        model: DEFAULT_MODEL,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions: [
          "You are a Bale chat assistant.",
          "Keep responses very short and cheap.",
          "Use plain text only.",
          "Do not exceed 30 words.",
          getModeInstruction(mode, lang),
        ].join(" "),
        input: `Subject: ${mode}\nUser message: ${input}`,
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("ai_timeout")), REQUEST_TIMEOUT_MS);
      }),
    ]);

    const text = (response.output_text || "").trim();
    if (!text) {
      return { ok: false, reason: "empty_output" };
    }

    return { ok: true, text };
  } catch (error) {
    console.warn("AI request failed:", error?.message || error);
    return { ok: false, reason: "api_error" };
  }
}

module.exports = {
  getAiAssistantReply,
};
