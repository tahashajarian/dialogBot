const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

let Fuse = null;
try {
  Fuse = require("fuse.js");
} catch {}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || process.env.MODEL_NAME || "gpt-4o-mini";
const MAX_OUTPUT_TOKENS = 50;
const MAX_INPUT_CHARS = 180;
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 8000);
const FEEDBACK_MAX_OUTPUT_TOKENS = 22;
const FEEDBACK_MAX_WORDS = 8;
const FEEDBACK_CACHE_PATH = path.join(__dirname, "..", "..", "data", "ai-feedback-cache.json");
const FEEDBACK_CACHE_MAX_ITEMS = Math.max(100, Number(process.env.AI_FEEDBACK_CACHE_MAX_ITEMS || 3000));
const FEEDBACK_FUSE_THRESHOLD = Math.max(0.05, Math.min(0.6, Number(process.env.AI_FEEDBACK_FUSE_THRESHOLD || 0.26)));

let client;
let feedbackCacheLoaded = false;
let feedbackCacheEntries = [];

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

function buildTrigrams(text) {
  const normalized = `  ${normalizeCacheItem(text)}  `;
  const grams = new Set();
  for (let index = 0; index < normalized.length - 2; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

function calcSimilarity(a, b) {
  const aNorm = normalizeCacheItem(a);
  const bNorm = normalizeCacheItem(b);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;

  const aGrams = buildTrigrams(aNorm);
  const bGrams = buildTrigrams(bNorm);
  let intersection = 0;

  for (const gram of aGrams) {
    if (bGrams.has(gram)) {
      intersection += 1;
    }
  }

  const union = aGrams.size + bGrams.size - intersection;
  if (!union) return 0;
  return intersection / union;
}

function ensureFeedbackCacheLoaded() {
  if (feedbackCacheLoaded) {
    return;
  }

  feedbackCacheLoaded = true;

  try {
    const raw = fs.readFileSync(FEEDBACK_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    let shouldPersist = false;
    if (Array.isArray(parsed?.entries)) {
      feedbackCacheEntries = parsed.entries
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => {
          const lang = String(entry.lang || "").trim();
          const originalText = String(entry.text || "").trim();
          const sanitizedText = sanitizeTasteFeedback(originalText, lang);
          const relevantText = isFeedbackRelevantToItem(
            sanitizedText,
            entry.itemNormalized || entry.item,
          ) ? sanitizedText : "";

          if (relevantText !== originalText) {
            shouldPersist = true;
          }

          return {
            section: String(entry.section || "").trim(),
            lang,
            itemNormalized: normalizeCacheItem(entry.itemNormalized || entry.item),
            labelKey: String(entry.labelKey || "").trim(),
            text: relevantText,
            createdAt: entry.createdAt || new Date().toISOString(),
            updatedAt: relevantText !== originalText
              ? new Date().toISOString()
              : (entry.updatedAt || new Date().toISOString()),
          };
        })
        .filter((entry) => entry.section && entry.lang && entry.itemNormalized && entry.text);

      if (feedbackCacheEntries.length > FEEDBACK_CACHE_MAX_ITEMS) {
        shouldPersist = true;
        feedbackCacheEntries = feedbackCacheEntries.slice(-FEEDBACK_CACHE_MAX_ITEMS);
      }

      if (shouldPersist) {
        persistFeedbackCache();
      }
    }
  } catch {}
}

function persistFeedbackCache() {
  try {
    const payload = JSON.stringify({ entries: feedbackCacheEntries }, null, 2);
    fs.mkdirSync(path.dirname(FEEDBACK_CACHE_PATH), { recursive: true });
    fs.writeFileSync(FEEDBACK_CACHE_PATH, payload, "utf8");
  } catch {}
}

function findCachedFeedback({ section, lang, item, labelKey }) {
  ensureFeedbackCacheLoaded();
  const itemNormalized = normalizeCacheItem(item);
  if (!itemNormalized) return null;

  const sameScope = feedbackCacheEntries.filter((entry) => (
    entry.section === section &&
    entry.lang === lang
  ));

  const exactLabelMatch = sameScope.find((entry) => (
    entry.itemNormalized === itemNormalized &&
    entry.labelKey === labelKey &&
    isFeedbackRelevantToItem(entry.text, itemNormalized)
  ));
  if (exactLabelMatch) {
    return exactLabelMatch.text;
  }

  const exactMatch = sameScope.find((entry) => (
    entry.itemNormalized === itemNormalized &&
    isFeedbackRelevantToItem(entry.text, itemNormalized)
  ));
  if (exactMatch) {
    return exactMatch.text;
  }

  if (!sameScope.length) {
    return null;
  }

  if (Fuse) {
    const fuse = new Fuse(sameScope, {
      keys: ["itemNormalized"],
      threshold: FEEDBACK_FUSE_THRESHOLD,
      ignoreLocation: true,
      includeScore: true,
    });

    const results = fuse.search(itemNormalized);
    if (!results.length) {
      return null;
    }

    const sameLabelResult = results.find((result) => result.item?.labelKey === labelKey);
    if (
      sameLabelResult?.item?.text &&
      isFeedbackRelevantToItem(sameLabelResult.item.text, itemNormalized)
    ) {
      return sameLabelResult.item.text;
    }

    if (
      results[0]?.item?.text &&
      isFeedbackRelevantToItem(results[0].item.text, itemNormalized)
    ) {
      return results[0].item.text;
    }
    return null;
  }

  let bestScore = 0;
  let bestAny = null;
  let bestSameLabel = null;

  for (const entry of sameScope) {
    const score = calcSimilarity(entry.itemNormalized, itemNormalized);
    if (score > bestScore) {
      bestScore = score;
      bestAny = entry;
    }
    if (entry.labelKey === labelKey && (!bestSameLabel || score > bestSameLabel.score)) {
      bestSameLabel = { score, entry };
    }
  }

  if (bestSameLabel && bestSameLabel.score >= 0.62) {
    if (isFeedbackRelevantToItem(bestSameLabel.entry.text, itemNormalized)) {
      return bestSameLabel.entry.text;
    }
  }
  if (bestAny && bestScore >= 0.72) {
    if (isFeedbackRelevantToItem(bestAny.text, itemNormalized)) {
      return bestAny.text;
    }
  }
  return null;
}

function storeFeedbackCacheEntry({ section, lang, item, labelKey, text }) {
  ensureFeedbackCacheLoaded();
  const itemNormalized = normalizeCacheItem(item);
  const cleanText = String(text || "").trim();
  if (!section || !lang || !itemNormalized || !cleanText) {
    return;
  }

  const existingIndex = feedbackCacheEntries.findIndex((entry) => (
    entry.section === section &&
    entry.lang === lang &&
    entry.itemNormalized === itemNormalized &&
    entry.labelKey === labelKey
  ));

  const now = new Date().toISOString();
  if (existingIndex >= 0) {
    feedbackCacheEntries[existingIndex] = {
      ...feedbackCacheEntries[existingIndex],
      text: cleanText,
      updatedAt: now,
    };
  } else {
    feedbackCacheEntries.push({
      section,
      lang,
      itemNormalized,
      labelKey: String(labelKey || "").trim(),
      text: cleanText,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (feedbackCacheEntries.length > FEEDBACK_CACHE_MAX_ITEMS) {
    feedbackCacheEntries = feedbackCacheEntries.slice(-FEEDBACK_CACHE_MAX_ITEMS);
  }

  persistFeedbackCache();
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
    return limitWords(`حس ${labelTitle} داری!`);
  }
  return limitWords(`${labelTitle} energy detected.`);
}

function buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item }) {
  const shortItem = shortenItemForFeedback(item);
  if (lang === "fa") {
    const title = labelTitle || "ترکیبی";
    return limitWords(`«${shortItem || "این مورد"}» حس ${title} میده.`);
  }

  const title = labelTitle || "eclectic";
  return limitWords(`"${shortItem || "That one"}" feels ${title}.`);
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

function buildUserContext({ personalized, topTenItems = [], watchlistItems = [] }) {
  if (!personalized) {
    return "";
  }

  const topTen = topTenItems.length
    ? topTenItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "None";
  const watchlist = watchlistItems.length
    ? watchlistItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "None";

  return `\nUser top 10:\n${topTen}\n\nUser watchlist:\n${watchlist}`;
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
            ? "Recommend items similar to the user's top 10 and avoid repeating exact watchlist items."
            : "",
          buildTasteStyleInstruction(tasteStyleHint, lang),
          getModeInstruction(mode, lang),
        ].join(" "),
        input: `Subject: ${mode}\nUser message: ${input}${buildUserContext({
          personalized,
          topTenItems,
          watchlistItems,
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

  const cachedText = findCachedFeedback({
    section,
    lang,
    item: normalizedItem,
    labelKey,
  });
  if (cachedText) {
    const sanitizedCached = sanitizeTasteFeedback(cachedText, lang);
    if (sanitizedCached) {
      return { ok: true, text: sanitizedCached, cached: true };
    }
  }

  const openai = getClient();
  if (!openai) {
    const fallback = buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item: normalizedItem });
    storeFeedbackCacheEntry({
      section,
      lang,
      item: normalizedItem,
      labelKey,
      text: fallback,
    });
    return { ok: true, text: fallback, cached: false, fallback: true };
  }

  const language = lang === "fa" ? "Persian" : "English";

  try {
    const response = await Promise.race([
      openai.responses.create({
        model: DEFAULT_MODEL,
        max_output_tokens: FEEDBACK_MAX_OUTPUT_TOKENS,
        instructions: [
          "You write one micro reaction for taste profiling.",
          `Respond only in ${language}.`,
          "Be playful and funny.",
          `Max ${FEEDBACK_MAX_WORDS} words.`,
          "Mention at least one word from the item title.",
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

    storeFeedbackCacheEntry({
      section,
      lang,
      item: normalizedItem,
      labelKey,
      text,
    });

    return { ok: true, text, cached: false };
  } catch (error) {
    console.warn("AI taste feedback failed:", error?.message || error);
    const fallback = buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item: normalizedItem });
    storeFeedbackCacheEntry({
      section,
      lang,
      item: normalizedItem,
      labelKey,
      text: fallback,
    });
    return { ok: true, text: fallback, cached: false, fallback: true };
  }
}

module.exports = {
  getAiSingleSuggestion,
  getAiTasteItemFeedback,
};
