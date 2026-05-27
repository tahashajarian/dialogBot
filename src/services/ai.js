const OpenAI = require("openai");
const {
  createAiResponseCache,
  getAiResponseCacheStats,
  normalizeCategory,
} = require("./ai-response-cache");

const DEFAULT_MODEL = process.env.OPENAI_MODEL || process.env.MODEL_NAME || "gpt-4o-mini";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const MAX_OUTPUT_TOKENS = 50;
const MAX_INPUT_CHARS = 180;
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 8000);
const FEEDBACK_MAX_OUTPUT_TOKENS = 22;
const FEEDBACK_MAX_WORDS = 8;
const FEEDBACK_CACHE_PURPOSE = "taste_item_feedback_v2";

let client;
let aiFeedbackResponseCache = null;

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

function getAiFeedbackResponseCache() {
  if (!aiFeedbackResponseCache) {
    aiFeedbackResponseCache = createAiResponseCache();
  }
  return aiFeedbackResponseCache;
}

function normalizeCacheItem(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function tokenizeSignalWords(text) {
  return normalizeCacheItem(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => {
      const isAscii = /^[a-z0-9]+$/i.test(token);
      return isAscii ? token.length >= 3 : token.length >= 2;
    });
}

function isFeedbackRelevantToItem(feedback, item) {
  const feedbackNorm = normalizeCacheItem(feedback);
  if (!feedbackNorm) return false;

  const itemSignals = tokenizeSignalWords(item).slice(0, 6);
  if (!itemSignals.length) return true;

  return itemSignals.some((token) => feedbackNorm.includes(token));
}

function shortenItemForFeedback(item) {
  const words = String(item || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words.slice(0, 3).join(" ");
}

function limitWords(text, maxWords = FEEDBACK_MAX_WORDS) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ").trim();
}

function sanitizeTasteFeedback(text, lang) {
  let clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const enPatterns = [
    /\b(send|give|drop|show|tell)\b[^.!?]*\bnext\b[^.!?]*[.!?]?/gi,
    /\bnext\b[^.!?]*[.!?]?/gi,
  ];
  const faPatterns = [
    /بعدی[^.!؟\n]*[.!؟]?/gi,
    /مورد بعد[^.!؟\n]*[.!؟]?/gi,
  ];
  const patterns = lang === "fa" ? faPatterns : enPatterns;

  for (const pattern of patterns) {
    clean = clean.replace(pattern, " ").replace(/\s+/g, " ").trim();
  }

  return limitWords(clean, FEEDBACK_MAX_WORDS);
}

function buildTasteFeedbackFallback({ lang, labelTitle }) {
  if (lang === "fa") {
    return limitWords(`سلیقه‌ات خوبه؛ ${labelTitle} هم معلومه.`);
  }
  return limitWords(`Great taste; ${labelTitle} energy detected.`);
}

function buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item }) {
  const shortItem = shortenItemForFeedback(item);
  if (lang === "fa") {
    return limitWords(`انتخاب خوش‌سلیقه‌ایه؛ «${shortItem || "این مورد"}» عالیه.`);
  }

  return limitWords(`Great pick; "${shortItem || "that one"}" has taste.`);
}

async function getEmbedding(openai, input) {
  if (!openai?.embeddings?.create || !input) {
    return null;
  }

  try {
    const response = await Promise.race([
      openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input,
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("ai_embedding_timeout")), REQUEST_TIMEOUT_MS);
      }),
    ]);
    const embedding = response?.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch (error) {
    console.warn("AI embedding failed:", error?.message || error);
    return null;
  }
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

  return `Subject is other interests such as games, chess, travel, food, sports, hobbies, and lifestyle. Reply in ${language}. Keep it short and useful.`;
}

function normalizeSuggestionTitle(text) {
  return String(text || "")
    .replace(/^[\s\-•*#\d.)]+/g, "")
    .replace(/^(title|item|suggestion|عنوان|پیشنهاد)\s*[:：-]\s*/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function normalizeSuggestionReason(text, lang) {
  const cleaned = String(text || "")
    .replace(/^(reason|why|comment|دلیل|توضیح)\s*[:：-]\s*/i, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return lang === "fa" ? "برای سلیقه‌ات گزینه خوبیه." : "Good match for your taste.";
  }
  return limitWords(cleaned, 14);
}

function parseSingleSuggestionResponse(raw, lang) {
  const lines = String(raw || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { title: "", reason: "" };
  }

  const titleLine = lines[0] || "";
  const reasonLine = lines[1] || "";

  let title = normalizeSuggestionTitle(titleLine);
  let reason = normalizeSuggestionReason(reasonLine, lang);

  if (!title && lines.length === 1) {
    const single = lines[0];
    const [left = "", right = ""] = single.split(/\s[-—|]\s/, 2);
    title = normalizeSuggestionTitle(left);
    reason = normalizeSuggestionReason(right, lang);
  }

  return { title, reason };
}

function getSingleSuggestionDetailInstruction(mode) {
  if (mode === "movies") {
    return "Line 1 must include movie title + year + director in parentheses. Example: Interstellar (2014, Dir. Christopher Nolan).";
  }

  if (mode === "music") {
    return "Line 1 must include track/album title + artist/band (and year if known) in parentheses.";
  }

  if (mode === "books") {
    return "Line 1 must include book title + author (and year if known) in parentheses.";
  }

  return "Line 1 should include one concrete qualifier in parentheses when possible.";
}

function buildUserContext({
  personalized,
  topTenItems = [],
  watchlistItems = [],
  recentSuggestionItems = [],
}) {
  if (!personalized) {
    return "";
  }

  const topTen = topTenItems.length
    ? topTenItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "None";
  const watchlist = watchlistItems.length
    ? watchlistItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "None";
  const recentSuggestions = recentSuggestionItems.length
    ? recentSuggestionItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "None";

  return `\nUser top 10:\n${topTen}\n\nUser watchlist:\n${watchlist}\n\nRecently suggested:\n${recentSuggestions}`;
}

function buildTasteStyleInstruction(tasteStyleHint, lang) {
  const cleanHint = String(tasteStyleHint || "").trim();
  if (!cleanHint) {
    return "";
  }

  if (lang === "fa") {
    return `لحن پاسخ را نزدیک به این سلیقه نگه دار: ${cleanHint}.`;
  }

  return `Match tone and references to this taste style: ${cleanHint}.`;
}

async function getAiSingleSuggestion({
  mode,
  lang,
  userText,
  topTenItems = [],
  watchlistItems = [],
  recentSuggestionItems = [],
  personalized = false,
  tasteStyleHint = "",
}) {
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
          "Recommend exactly one item only.",
          "Reply in exactly 2 short lines in plain text.",
          "Line 1: item name (include metadata in name as requested).",
          "Line 2: very short why only (max 12 words).",
          getSingleSuggestionDetailInstruction(mode),
          "No numbering, no markdown, no emojis.",
          personalized
            ? "Recommend items similar to the user's top 10. Avoid repeating top 10, watchlist, or recently suggested items."
            : "",
          buildTasteStyleInstruction(tasteStyleHint, lang),
          getModeInstruction(mode, lang),
        ].join(" "),
        input: `Subject: ${mode}\nUser message: ${input}${buildUserContext({
          personalized,
          topTenItems,
          watchlistItems,
          recentSuggestionItems,
        })}`,
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("ai_timeout")), REQUEST_TIMEOUT_MS);
      }),
    ]);

    const rawText = (response.output_text || "").trim();
    if (!rawText) {
      return { ok: false, reason: "empty_output" };
    }

    const parsed = parseSingleSuggestionResponse(rawText, lang);
    if (!parsed.title) {
      return { ok: false, reason: "invalid_output" };
    }

    return {
      ok: true,
      title: parsed.title,
      reason: parsed.reason,
      text: `${parsed.title}\n${parsed.reason}`.trim(),
    };
  } catch (error) {
    console.warn("AI single suggestion failed:", error?.message || error);
    return { ok: false, reason: "api_error" };
  }
}

async function getAiTasteItemFeedback({
  mode,
  lang,
  item,
  labelKey = "",
  labelTitle = "",
}) {
  const section = String(mode || "").trim();
  const normalizedItem = normalizeInput(item);
  if (!section || !normalizedItem) {
    return { ok: false, reason: "empty_input" };
  }

  const openai = getClient();
  const language = lang === "fa" ? "Persian" : "English";
  const category = normalizeCategory(section);

  return getAiFeedbackResponseCache().getOrCreate({
    originalInput: normalizedItem,
    category,
    purpose: FEEDBACK_CACHE_PURPOSE,
    lang,
    metadata: {
      section,
      labelKey,
      labelTitle,
      model: DEFAULT_MODEL,
      embeddingModel: EMBEDDING_MODEL,
    },
    generateEmbedding: openai
      ? (input) => getEmbedding(openai, input)
      : null,
    generateResponse: async () => {
      if (!openai) {
        return {
          ok: true,
          text: buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item: normalizedItem }),
          fallback: true,
        };
      }

      try {
        const response = await Promise.race([
          openai.responses.create({
            model: DEFAULT_MODEL,
            max_output_tokens: FEEDBACK_MAX_OUTPUT_TOKENS,
            instructions: [
              "You write one micro reaction for taste profiling.",
              `Respond only in ${language}.`,
              "Mostly compliment the user's taste.",
              "If the item is recognizable, react to its title, artist, genre, author, or vibe.",
              "Be playful and funny.",
              `Max ${FEEDBACK_MAX_WORDS} words.`,
              "Mention at least one word from the item title.",
              "Do not ask for another item.",
              "Do not invent unrelated entities, animals, or characters.",
              "Use plain text only.",
            ].join(" "),
            input: `Section: ${section}\nItem: ${normalizedItem}\nDetected label: ${labelTitle || labelKey || "eclectic"}`,
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("ai_feedback_timeout")), REQUEST_TIMEOUT_MS);
          }),
        ]);

        const generated = sanitizeTasteFeedback((response.output_text || "").trim(), lang);
        const text = (
          generated &&
          isFeedbackRelevantToItem(generated, normalizedItem)
        )
          ? generated
          : buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item: normalizedItem });

        return { ok: true, text };
      } catch (error) {
        console.warn("AI taste feedback failed:", error?.message || error);
        return {
          ok: true,
          text: buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item: normalizedItem }),
          fallback: true,
        };
      }
    },
  });
}

module.exports = {
  getAiSingleSuggestion,
  getAiTasteItemFeedback,
  getAiFeedbackCacheStats: getAiResponseCacheStats,
};
