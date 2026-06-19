const OpenAI = require("openai");
const {
  createAiResponseCache,
  getAiResponseCacheStats,
  normalizeCategory,
} = require("./ai-response-cache");
const { getAiConfig } = require("../config");
const { isLowQualityAiListItem } = require("./ai-input-quality");
const { logger } = require("./logger");

const aiConfig = getAiConfig();
const MAX_OUTPUT_TOKENS = 90;
const MAX_INPUT_CHARS = 180;
const FEEDBACK_MAX_OUTPUT_TOKENS = 48;
const FEEDBACK_MAX_WORDS = 18;
const FEEDBACK_CACHE_PURPOSE = "taste_item_feedback_v5";
const FEEDBACK_TITLE_STOPWORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with",
  "از", "با", "به", "برای", "تا", "در", "را", "و",
]);
const PREDEFINED_TASTE_FEEDBACK = {
  movies: {
    "آفیس": {
      fa: "آفیس با سکوت‌های معذب‌کننده و موقعیت‌های خشک‌وخنده‌دارش هنوز خیلی می‌چسبه.",
      en: "The Office is painfully awkward in the funniest way.",
    },
    "سریال آفیس": {
      fa: "آفیس با سکوت‌های معذب‌کننده و موقعیت‌های خشک‌وخنده‌دارش هنوز خیلی می‌چسبه.",
      en: "The Office is painfully awkward in the funniest way.",
    },
    "the office": {
      fa: "آفیس با سکوت‌های معذب‌کننده و موقعیت‌های خشک‌وخنده‌دارش هنوز خیلی می‌چسبه.",
      en: "The Office is painfully awkward in the funniest way.",
    },
    office: {
      fa: "آفیس با سکوت‌های معذب‌کننده و موقعیت‌های خشک‌وخنده‌دارش هنوز خیلی می‌چسبه.",
      en: "The Office is painfully awkward in the funniest way.",
    },
  },
  random: {
    "شطرنج": {
      fa: "شطرنج یعنی ذهن دقیق و خوش‌حوصله.",
      en: "Chess says calm, sharp thinking.",
    },
    chess: {
      fa: "شطرنج یعنی ذهن دقیق و خوش‌حوصله.",
      en: "Chess says calm, sharp thinking.",
    },
    "کدنویسی": {
      fa: "کدنویسی یعنی ذهنت اهل ساختنه.",
      en: "Coding means you like building things.",
    },
    coding: {
      fa: "کدنویسی یعنی ذهنت اهل ساختنه.",
      en: "Coding means you like building things.",
    },
    "قهوه": {
      fa: "قهوه انتخاب آدم‌های اهل مکثه.",
      en: "Coffee has thoughtful, focused energy.",
    },
    coffee: {
      fa: "قهوه انتخاب آدم‌های اهل مکثه.",
      en: "Coffee has thoughtful, focused energy.",
    },
    "کافه گردی": {
      fa: "کافه‌گردی یعنی سلیقه‌ات فضا رو می‌فهمه.",
      en: "Cafes mean you notice good atmosphere.",
    },
    cafes: {
      fa: "کافه‌گردی یعنی سلیقه‌ات فضا رو می‌فهمه.",
      en: "Cafes mean you notice good atmosphere.",
    },
    "گیم": {
      fa: "گیم یعنی دنبال تجربه و چالشی.",
      en: "Gaming says you enjoy challenge and flow.",
    },
    game: {
      fa: "گیم یعنی دنبال تجربه و چالشی.",
      en: "Gaming says you enjoy challenge and flow.",
    },
    gaming: {
      fa: "گیم یعنی دنبال تجربه و چالشی.",
      en: "Gaming says you enjoy challenge and flow.",
    },
    "فیلم": {
      fa: "فیلم یعنی داستان و تصویر برات مهمه.",
      en: "Movies mean stories and images stay with you.",
    },
    movies: {
      fa: "فیلم یعنی داستان و تصویر برات مهمه.",
      en: "Movies mean stories and images stay with you.",
    },
    film: {
      fa: "فیلم یعنی داستان و تصویر برات مهمه.",
      en: "Movies mean stories and images stay with you.",
    },
    "موسیقی": {
      fa: "موسیقی یعنی حس و ریتم را جدی می‌گیری.",
      en: "Music means mood and rhythm matter to you.",
    },
    music: {
      fa: "موسیقی یعنی حس و ریتم را جدی می‌گیری.",
      en: "Music means mood and rhythm matter to you.",
    },
    "کتاب": {
      fa: "کتاب یعنی اهل مکث و عمیق شدنی.",
      en: "Books mean you like going deeper.",
    },
    books: {
      fa: "کتاب یعنی اهل مکث و عمیق شدنی.",
      en: "Books mean you like going deeper.",
    },
    book: {
      fa: "کتاب یعنی اهل مکث و عمیق شدنی.",
      en: "Books mean you like going deeper.",
    },
    "انیمه": {
      fa: "انیمه یعنی تخیل و جهان‌سازی برات جذابه.",
      en: "Anime means vivid worlds catch your eye.",
    },
    anime: {
      fa: "انیمه یعنی تخیل و جهان‌سازی برات جذابه.",
      en: "Anime means vivid worlds catch your eye.",
    },
    "فوتبال": {
      fa: "فوتبال یعنی رقابت و هیجان جمعی رو دوست داری.",
      en: "Football means you enjoy shared energy and competition.",
    },
    football: {
      fa: "فوتبال یعنی رقابت و هیجان جمعی رو دوست داری.",
      en: "Football means you enjoy shared energy and competition.",
    },
    "باشگاه": {
      fa: "باشگاه یعنی به انرژی و پیشرفت اهمیت می‌دی.",
      en: "Gym means progress and energy matter to you.",
    },
    gym: {
      fa: "باشگاه یعنی به انرژی و پیشرفت اهمیت می‌دی.",
      en: "Gym means progress and energy matter to you.",
    },
    "غذا": {
      fa: "غذا یعنی سلیقه‌ات با جزئیات زنده‌ست.",
      en: "Food means your taste notices details.",
    },
    food: {
      fa: "غذا یعنی سلیقه‌ات با جزئیات زنده‌ست.",
      en: "Food means your taste notices details.",
    },
    "سفر": {
      fa: "سفر یعنی ذهن کنجکاو و باز داری.",
      en: "Travel says curious, open-minded energy.",
    },
    travel: {
      fa: "سفر یعنی ذهن کنجکاو و باز داری.",
      en: "Travel says curious, open-minded energy.",
    },
    "عکاسی": {
      fa: "عکاسی یعنی نگاهت قاب و لحظه رو می‌بینه.",
      en: "Photography means you catch moments well.",
    },
    photography: {
      fa: "عکاسی یعنی نگاهت قاب و لحظه رو می‌بینه.",
      en: "Photography means you catch moments well.",
    },
    "ورزش": {
      fa: "ورزش یعنی انرژی و نظم قشنگی داری.",
      en: "Sports says energy with discipline.",
    },
    sports: {
      fa: "ورزش یعنی انرژی و نظم قشنگی داری.",
      en: "Sports says energy with discipline.",
    },
    "هنر": {
      fa: "هنر یعنی سلیقه‌ات دنبال معنی و فرم می‌گرده.",
      en: "Art means you care about meaning and form.",
    },
    art: {
      fa: "هنر یعنی سلیقه‌ات دنبال معنی و فرم می‌گرده.",
      en: "Art means you care about meaning and form.",
    },
    "نوشتن": {
      fa: "نوشتن یعنی ذهنت با کلمه‌ها مرتب می‌شه.",
      en: "Writing means you shape thoughts with words.",
    },
    writing: {
      fa: "نوشتن یعنی ذهنت با کلمه‌ها مرتب می‌شه.",
      en: "Writing means you shape thoughts with words.",
    },
    "مد و فشن": {
      fa: "مد و فشن یعنی جزئیات ظاهر و بیان برات مهمه.",
      en: "Fashion means style and expression catch your attention.",
    },
    fashion: {
      fa: "مد و فشن یعنی جزئیات ظاهر و بیان برات مهمه.",
      en: "Fashion means style and expression catch your attention.",
    },
    "روانشناسی": {
      fa: "روانشناسی یعنی آدم‌ها و ذهن برات جذابن.",
      en: "Psychology means people and minds interest you.",
    },
    psychology: {
      fa: "روانشناسی یعنی آدم‌ها و ذهن برات جذابن.",
      en: "Psychology means people and minds interest you.",
    },
    "علم": {
      fa: "علم یعنی کنجکاوی‌ات دنبال دلیل و کشفه.",
      en: "Science means your curiosity looks for reasons.",
    },
    science: {
      fa: "علم یعنی کنجکاوی‌ات دنبال دلیل و کشفه.",
      en: "Science means your curiosity looks for reasons.",
    },
    "تاریخ": {
      fa: "تاریخ یعنی ریشه داستان‌ها برات مهمه.",
      en: "History means you care about the roots of stories.",
    },
    history: {
      fa: "تاریخ یعنی ریشه داستان‌ها برات مهمه.",
      en: "History means you care about the roots of stories.",
    },
    "آرامش": {
      fa: "آرامش یعنی خوب بلدی سرعت دنیا رو کم کنی.",
      en: "Calm means you know how to slow down.",
    },
    calm: {
      fa: "آرامش یعنی خوب بلدی سرعت دنیا رو کم کنی.",
      en: "Calm means you know how to slow down.",
    },
    "پادکست": {
      fa: "پادکست یعنی ذهن شنونده و کنجکاوی داری.",
      en: "Podcast says curious, listening mind.",
    },
    podcast: {
      fa: "پادکست یعنی ذهن شنونده و کنجکاوی داری.",
      en: "Podcast says curious, listening mind.",
    },
    "یوتیوب": {
      fa: "یوتیوب یعنی همیشه دنبال کشف چیز تازه‌ای.",
      en: "YouTube says you like discovering new things.",
    },
    youtube: {
      fa: "یوتیوب یعنی همیشه دنبال کشف چیز تازه‌ای.",
      en: "YouTube says you like discovering new things.",
    },
    "طبیعت": {
      fa: "طبیعت یعنی سلیقه‌ات ریشه و نفس داره.",
      en: "Nature gives grounded, fresh taste.",
    },
    nature: {
      fa: "طبیعت یعنی سلیقه‌ات ریشه و نفس داره.",
      en: "Nature gives grounded, fresh taste.",
    },
    "آشپزی": {
      fa: "آشپزی یعنی خلاقیتت طعم و حوصله داره.",
      en: "Cooking means creative, patient taste.",
    },
    cooking: {
      fa: "آشپزی یعنی خلاقیتت طعم و حوصله داره.",
      en: "Cooking means creative, patient taste.",
    },
    "دورهمی": {
      fa: "دورهمی یعنی از انرژی جمع شارژ می‌گیری.",
      en: "Social events mean shared energy matters to you.",
    },
    "social events": {
      fa: "دورهمی یعنی از انرژی جمع شارژ می‌گیری.",
      en: "Social events mean shared energy matters to you.",
    },
    "پیاده روی": {
      fa: "پیاده‌روی یعنی کشف آرام و حرکت رو دوست داری.",
      en: "Walking means you like gentle movement and discovery.",
    },
    "پیاده‌روی": {
      fa: "پیاده‌روی یعنی کشف آرام و حرکت رو دوست داری.",
      en: "Walking means you like gentle movement and discovery.",
    },
    walking: {
      fa: "پیاده‌روی یعنی کشف آرام و حرکت رو دوست داری.",
      en: "Walking means you like gentle movement and discovery.",
    },
    "سلامتی": {
      fa: "سلامتی یعنی به حال خوب و دوام اهمیت می‌دی.",
      en: "Wellness means feeling good long-term matters to you.",
    },
    wellness: {
      fa: "سلامتی یعنی به حال خوب و دوام اهمیت می‌دی.",
      en: "Wellness means feeling good long-term matters to you.",
    },
    "رشد فردی": {
      fa: "رشد فردی یعنی دنبال نسخه بهتر خودتی.",
      en: "Self growth means you like improving with intention.",
    },
    "self growth": {
      fa: "رشد فردی یعنی دنبال نسخه بهتر خودتی.",
      en: "Self growth means you like improving with intention.",
    },
    "کسب وکار": {
      fa: "کسب‌وکار یعنی فرصت و ساختن برات جذابه.",
      en: "Business means you notice opportunities and systems.",
    },
    "کسب‌وکار": {
      fa: "کسب‌وکار یعنی فرصت و ساختن برات جذابه.",
      en: "Business means you notice opportunities and systems.",
    },
    business: {
      fa: "کسب‌وکار یعنی فرصت و ساختن برات جذابه.",
      en: "Business means you notice opportunities and systems.",
    },
    "سرمایه گذاری": {
      fa: "سرمایه‌گذاری یعنی آینده‌نگری و تصمیم برات مهمه.",
      en: "Investing means you think in decisions and future value.",
    },
    "سرمایه‌گذاری": {
      fa: "سرمایه‌گذاری یعنی آینده‌نگری و تصمیم برات مهمه.",
      en: "Investing means you think in decisions and future value.",
    },
    investing: {
      fa: "سرمایه‌گذاری یعنی آینده‌نگری و تصمیم برات مهمه.",
      en: "Investing means you think in decisions and future value.",
    },
    "بازی فکری": {
      fa: "بازی فکری یعنی از چالش‌های هوشمند لذت می‌بری.",
      en: "Board games mean you enjoy smart, social challenges.",
    },
    "board games": {
      fa: "بازی فکری یعنی از چالش‌های هوشمند لذت می‌بری.",
      en: "Board games mean you enjoy smart, social challenges.",
    },
    "تئاتر": {
      fa: "تئاتر یعنی اجرای زنده و احساس انسانی برات مهمه.",
      en: "Theater means live emotion and presence matter to you.",
    },
    theater: {
      fa: "تئاتر یعنی اجرای زنده و احساس انسانی برات مهمه.",
      en: "Theater means live emotion and presence matter to you.",
    },
  },
};

let client;
let aiFeedbackResponseCache = null;

function getClient() {
  if (client) return client;

  const apiKey = aiConfig.apiKey;
  if (!apiKey) return null;
  const baseURL = aiConfig.baseUrl;

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
    })
    .filter((token) => !FEEDBACK_TITLE_STOPWORDS.has(token));
}

function isFeedbackRelevantToItem(feedback, item) {
  const feedbackNorm = normalizeCacheItem(feedback);
  if (!feedbackNorm) return false;

  const itemSignals = tokenizeSignalWords(item).slice(0, 6);
  if (!itemSignals.length) return true;

  return itemSignals.some((token) => feedbackNorm.includes(token));
}

function isGenericTasteFeedback(feedback, lang) {
  const normalized = normalizeCacheItem(feedback);
  if (!normalized) return true;

  const patterns = lang === "fa"
    ? [
      /انتخاب(?:ت| شما)?\s+(?:خیلی\s+)?(?:\S+\s*){0,2}(?:است|ه|ایه|ای|بود)?$/,
      /انتخاب (باحال|خوب|عالی|جالب|خاص|فوق العاده)/,
      /عنوان (جالب|خوب|خاص|باحال)/,
      /به نظر (میاد|می رسد|می یاد).*(حس|احساس).*(خوب|خاص|جالب)/,
      /واقعی و جذاب/,
      /حس.*خاص.*داره/,
      /^(وای|عجب|به به)[،!\s]/,
      /سلیقه ات/,
      /نشون می ده/,
      /یعنی (آدم|ذهنت|تو)/,
      /انرژی .* داری/,
    ]
    : [
      /\b(great|good|nice|cool|solid|interesting|unique|excellent|amazing|fantastic) (choice|pick)\b/,
      /\b(sounds|seems|looks) (interesting|special|unique|good)\b/,
      /\bhas a (good|special|unique) (feel|vibe)\b/,
      /\b(choice|pick)[.!]?\s*$/,
      /^(wow|nice|great)[,!\s]/,
      /\byour taste\b/,
      /\bthis says you\b/,
      /\byou (have|like|enjoy|are)\b/,
    ];

  return patterns.some((pattern) => pattern.test(normalized));
}

function isEncyclopedicTasteFeedback(feedback, lang) {
  const normalized = normalizeCacheItem(feedback);
  if (!normalized) return false;

  const patterns = lang === "fa"
    ? [
      /یکی از .*(محبوب|معروف|شناخته شده|برجسته).*(است|ه)/,
      /به (داستان|زندگی|ماجرای|روایت) .* می پردازد/,
      /در مورد .* است/,
      /ژانر .* دارد/,
    ]
    : [
      /\bis one of the (most )?(popular|famous|well known|best known)\b/,
      /\bfollows the (story|life|lives|journey)\b/,
      /\bis about\b/,
      /\bbelongs to the .* genre\b/,
    ];

  return patterns.some((pattern) => pattern.test(normalized));
}

function shortenItemForFeedback(item) {
  const words = String(item || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words.slice(0, 6).join(" ");
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

function buildTasteFeedbackFallbackWithItem({ lang, item }) {
  const shortItem = shortenItemForFeedback(item);
  if (lang === "fa") {
    return limitWords(`«${shortItem || "این مورد"}» رو ثبت کردم.`, 18);
  }

  return limitWords(`Saved "${shortItem || "that item"}".`, 18);
}

function buildUnknownItemFeedback({ lang, item }) {
  const shortItem = shortenItemForFeedback(item);
  if (lang === "fa") {
    return limitWords(`«${shortItem || "این"}» رو نمی‌شناسم، ولی ثبتش کردم.`, 12);
  }
  return limitWords(`Don't know "${shortItem || "that"}" yet, but saved it.`, 12);
}

function getPredefinedTasteFeedback({ section, item, lang }) {
  const sectionFeedback = PREDEFINED_TASTE_FEEDBACK[section];
  if (!sectionFeedback) return "";

  const normalizedItem = normalizeCacheItem(item);
  const response = sectionFeedback[normalizedItem];
  if (!response) return "";

  return response[lang] || response.fa || response.en || "";
}

async function getEmbedding(openai, input) {
  if (!openai?.embeddings?.create || !input) {
    return null;
  }

  try {
    const response = await Promise.race([
      openai.embeddings.create({
        model: aiConfig.embeddingModel,
        input,
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("ai_embedding_timeout")), aiConfig.timeoutMs);
      }),
    ]);
    const embedding = response?.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch (error) {
    logger.warn("AI embedding failed", error);
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
    .replace(/^\((?:activity|game|channel|tool|place|podcast|course|creator|community|experience|practice|project|فعالیت|بازی|کانال|ابزار|مکان|پادکست|دوره|سازنده|جامعه|تجربه|تمرین|پروژه)\)\s*/i, "")
    .replace(/\s*\((?:activity|practice|project|creative project|experience|فعالیت|تمرین|پروژه|پروژه خلاق|تجربه)\)\s*$/i, "")
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

function splitSuggestionSentence(text) {
  const value = String(text || "").trim();
  let parenthesisDepth = 0;

  for (let index = 0; index < value.length - 1; index += 1) {
    const char = value[index];
    if (char === "(") parenthesisDepth += 1;
    if (char === ")" && parenthesisDepth > 0) parenthesisDepth -= 1;

    if (
      parenthesisDepth === 0
      && /[.!?؟]/u.test(char)
      && /\s/u.test(value[index + 1])
    ) {
      return [value.slice(0, index + 1), value.slice(index + 1).trim()];
    }
  }

  return [value, ""];
}

function parseSingleSuggestionResponse(raw, lang) {
  const lines = String(raw || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { title: "", reason: "" };
  }

  let titleLine = lines[0] || "";
  let reasonLine = lines[1] || "";

  if (lines.length === 1) {
    const single = lines[0];
    const delimiterParts = single.split(/\s[-—|]\s/, 2);
    if (delimiterParts.length === 2) {
      [titleLine, reasonLine] = delimiterParts;
    } else {
      [titleLine, reasonLine] = splitSuggestionSentence(single);
    }
  }

  let title = normalizeSuggestionTitle(titleLine);
  let reason = normalizeSuggestionReason(reasonLine, lang);

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

  return [
    "This is the broad Interests section, not the Books section.",
    "Recommend a specific named resource or a tightly-defined action related to one or two of the user's interests.",
    "Good examples: Daily Lichess puzzles; a seven-day street-photo challenge; build a tiny coffee timer app.",
    "Bad examples: join a class, join a local group, attend a workshop, meet new people, improve your skills.",
    "Do not recommend generic containers such as classes, groups, clubs, workshops, communities, or courses unless you name a real resource and explain why it uniquely fits.",
    "The reason must name the relevant user interest and explain a concrete connection, not generic benefits.",
    "Do not default to a book, movie, or song unless the user's listed interests explicitly include that medium.",
    "Do not add category labels such as (activity) or (فعالیت) to the title.",
  ].join(" ");
}

const INTEREST_GENERIC_TITLE_PATTERNS = [
  /\b(join|attend|participate in|sign up for)\b.*\b(class|group|club|workshop|community|course)\b/i,
  /(شرکت در|پیوستن به|ثبت نام در|ثبت‌نام در).*(کلاس|گروه|باشگاه|کارگاه|انجمن|دوره)/,
];
const INTEREST_GENERIC_REASON_PATTERNS = [
  /\b(improve|strengthen|develop|boost|enhance)\b.*\b(skills?|connections?|social|experience)\b/i,
  /\b(meet|meeting)\b.*\b(new people|others|enthusiasts)\b/i,
  /\b(great|good|effective|useful)\b.*\b(for|way to)\b/i,
  /(تقویت|بهبود|افزایش).*(مهارت|ارتباط|تجربه|توانایی)/,
  /برای (تقویت|بهبود|افزایش).*(مناسب|خوب|عالی)/,
  /(ملاقات|آشنایی).*(افراد|آدم|دیگران)/,
  /(عالی|خوب|مؤثر|موثر|مفید) است/,
  /(مناسب|خوب|عالی) است/,
];
const INTEREST_FAMILY_PATTERNS = {
  social_group: [
    /\b(class|group|club|workshop|community|course)\b/i,
    /(کلاس|گروه|باشگاه|کارگاه|انجمن|دوره)/,
  ],
  challenge: [
    /\b(challenge|daily|seven-day|14-day)\b/i,
    /(چالش|روزانه|هفت روز|۷ روز|۱۴ روز)/,
  ],
  project: [
    /\b(build|make|create|project)\b/i,
    /(ساخت|بساز|طراحی|پروژه)/,
  ],
  practice: [
    /\b(puzzle|practice|exercise|drill)\b/i,
    /(پازل|تمرین)/,
  ],
};

function getInterestSuggestionFamily(title) {
  const cleanTitle = String(title || "");
  return Object.entries(INTEREST_FAMILY_PATTERNS)
    .find(([, patterns]) => patterns.some((pattern) => pattern.test(cleanTitle)))?.[0] || "";
}

function getInterestSuggestionQualityIssue({
  title,
  reason,
  topTenItems = [],
  recentSuggestionItems = [],
}) {
  const cleanTitle = String(title || "").trim();
  const cleanReason = String(reason || "").trim();
  if (!cleanTitle || !cleanReason) return "missing_detail";

  if (INTEREST_GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(cleanTitle))) {
    return "generic_container";
  }
  if (INTEREST_GENERIC_REASON_PATTERNS.some((pattern) => pattern.test(cleanReason))) {
    return "generic_reason";
  }

  const family = getInterestSuggestionFamily(cleanTitle);
  if (
    family
    && recentSuggestionItems.some((recent) => getInterestSuggestionFamily(recent) === family)
  ) {
    return "repeated_family";
  }

  const interestSignals = topTenItems
    .flatMap((item) => tokenizeSignalWords(item))
    .filter(Boolean);
  const combined = normalizeCacheItem(`${cleanTitle} ${cleanReason}`);
  if (interestSignals.length && !interestSignals.some((signal) => combined.includes(signal))) {
    return "weak_interest_connection";
  }

  return "";
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

async function withAiTimeout(promise, timeoutLabel) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutLabel)), aiConfig.timeoutMs);
    }),
  ]);
}

async function requestSuggestionText(openai, { instructions, input }) {
  const errors = [];

  if (openai?.chat?.completions?.create) {
    try {
      const response = await withAiTimeout(
        openai.chat.completions.create({
          model: aiConfig.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: input },
          ],
        }),
        "ai_chat_completion_timeout",
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
          model: aiConfig.model,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          instructions,
          input,
        }),
        "ai_responses_timeout",
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

const INTEREST_SUGGESTION_FALLBACKS = [
  {
    keywords: ["coding", "programming", "کدنویسی", "برنامه نویسی", "برنامه‌نویسی", "technology", "تکنولوژی"],
    fa: ["ساخت یک پروژه کوچک آخرهفته", "چون کدنویسی را از مصرف محتوا به ساختن تبدیل می‌کند."],
    en: ["Build a tiny weekend project", "It turns your coding interest into something tangible."],
  },
  {
    keywords: ["chess", "شطرنج", "strategy", "استراتژی"],
    fa: ["پازل روزانه شطرنج در Lichess", "یک تمرین کوتاه و مستقیم برای علاقه‌ات به استراتژی است."],
    en: ["Daily Lichess puzzles", "A short, direct way to deepen your strategy interest."],
  },
  {
    keywords: ["photography", "عکاسی", "art", "هنر", "writing", "نوشتن"],
    fa: ["چالش ثبت یک موضوع در ۷ روز", "به علاقه خلاقانه‌ات یک مسیر ساده و قابل انجام می‌دهد."],
    en: ["A seven-day one-theme challenge", "It gives your creative interest a simple, doable direction."],
  },
  {
    keywords: ["travel", "سفر", "nature", "طبیعت", "walking", "پیاده روی", "پیاده‌روی"],
    fa: ["طراحی یک مسیر پیاده‌روی تازه در شهرت", "سفر و کشف را به یک تجربه نزدیک و عملی تبدیل می‌کند."],
    en: ["Map a new walking route in your city", "It turns exploration into something nearby and practical."],
  },
  {
    keywords: ["gaming", "game", "گیم", "بازی"],
    fa: ["امتحان یک بازی مستقل کوتاه خارج از سبک همیشگی‌ات", "تنوع می‌دهد بدون اینکه تعهد زمانی بزرگی بخواهد."],
    en: ["Try a short indie game outside your usual genre", "It adds variety without demanding a huge time commitment."],
  },
  {
    keywords: ["food", "غذا", "cooking", "آشپزی", "coffee", "قهوه", "cafe", "کافه"],
    fa: ["بازسازی یک طعم محبوب در خانه", "غذا و کنجکاوی را به یک تجربه شخصی وصل می‌کند."],
    en: ["Recreate a favorite flavor at home", "It connects food curiosity with a personal experiment."],
  },
  {
    keywords: ["sports", "ورزش", "gym", "باشگاه", "football", "فوتبال"],
    fa: ["یک چالش حرکتی ۱۴ روزه قابل اندازه‌گیری", "با علاقه ورزشی‌ات جور است و پیشرفت واضحی نشان می‌دهد."],
    en: ["A measurable 14-day movement challenge", "It fits your active interests and makes progress visible."],
  },
  {
    keywords: ["podcast", "پادکست", "youtube", "یوتیوب", "science", "علم", "history", "تاریخ", "psychology", "روانشناسی"],
    fa: ["ساخت یک پلی‌لیست یادگیری سه‌قسمتی", "کنجکاوی‌ات را از پخش پراکنده به یک مسیر کوچک تبدیل می‌کند."],
    en: ["Build a three-episode learning playlist", "It turns scattered curiosity into a small learning path."],
  },
];

function buildInterestSuggestionFallback({ lang, topTenItems = [] }) {
  const normalized = topTenItems.map((item) => normalizeCacheItem(item));
  const matched = INTEREST_SUGGESTION_FALLBACKS.find((entry) => (
    entry.keywords.some((keyword) => normalized.some((item) => item.includes(normalizeCacheItem(keyword))))
  ));
  const fallback = matched || {
    fa: ["یک پروژه کوچک از ترکیب دو علاقه‌ات", "کمکت می‌کند علایقت را به یک تجربه واقعی تبدیل کنی."],
    en: ["A small project combining two interests", "It turns your interests into a real, personal experience."],
  };
  const [title, reason] = lang === "fa" ? fallback.fa : fallback.en;
  return { ok: true, title, reason, text: `${title}\n${reason}`, fallback: true };
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
    const instructions = [
      "You are a Bale chat assistant.",
      "Recommend exactly one item only.",
      "Reply in exactly 2 short lines in plain text.",
      "Line 1: item name (include metadata in name as requested).",
      "Line 2: very short why only (max 12 words).",
      getSingleSuggestionDetailInstruction(mode),
      "No numbering, no markdown, no emojis.",
      personalized
        ? "Base the recommendation on specific overlaps with the user's top 10. Avoid repeating top 10, watchlist, or recently suggested items."
        : "",
      buildTasteStyleInstruction(tasteStyleHint, lang),
      getModeInstruction(mode, lang),
    ].join(" ");
    const request = await requestSuggestionText(openai, {
      instructions,
      input: `Subject: ${mode}\nUser message: ${input}${buildUserContext({
        personalized,
        topTenItems,
        watchlistItems,
        recentSuggestionItems,
      })}`,
    });
    const rawText = request.text;
    if (!rawText) {
      if (mode === "random" && topTenItems.length) {
        return buildInterestSuggestionFallback({ lang, topTenItems });
      }
      logger.warn("AI suggestion providers returned no text", { errors: request.errors || [] });
      return { ok: false, reason: "empty_output" };
    }

    const parsed = parseSingleSuggestionResponse(rawText, lang);
    if (!parsed.title) {
      if (mode === "random" && topTenItems.length) {
        return buildInterestSuggestionFallback({ lang, topTenItems });
      }
      return { ok: false, reason: "invalid_output" };
    }
    if (mode === "random") {
      const qualityIssue = getInterestSuggestionQualityIssue({
        title: parsed.title,
        reason: parsed.reason,
        topTenItems,
        recentSuggestionItems,
      });
      if (qualityIssue) {
        return { ok: false, reason: "low_quality_interest", qualityIssue };
      }
    }

    return {
      ok: true,
      title: parsed.title,
      reason: parsed.reason,
      text: `${parsed.title}\n${parsed.reason}`.trim(),
    };
  } catch (error) {
    logger.warn("AI single suggestion failed", error);
    if (mode === "random" && topTenItems.length) {
      return buildInterestSuggestionFallback({ lang, topTenItems });
    }
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

  if (isLowQualityAiListItem(normalizedItem)) {
    return {
      ok: true,
      text: buildUnknownItemFeedback({ lang, item: normalizedItem }),
      cached: true,
      matchType: "unknown_input",
      normalizedInput: normalizeCacheItem(normalizedItem),
    };
  }

  const predefinedFeedback = getPredefinedTasteFeedback({
    section,
    item: normalizedItem,
    lang,
  });
  if (predefinedFeedback) {
    return {
      ok: true,
      text: predefinedFeedback,
      cached: true,
      matchType: "predefined",
      normalizedInput: normalizeCacheItem(normalizedItem),
    };
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
      model: aiConfig.model,
      embeddingModel: aiConfig.embeddingModel,
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
            model: aiConfig.model,
            max_output_tokens: FEEDBACK_MAX_OUTPUT_TOKENS,
            instructions: [
              "You react naturally to what someone shared, but ONLY if you actually recognize it.",
              `Respond only in ${language}.`,
              "CRITICAL: If you don't clearly recognize this specific work/item, you MUST say so honestly. Never pretend or guess.",
              "For recognized items: sound like a quick human reaction, not a database summary.",
              "Mention one concrete vibe, scene quality, style, joke, sound, theme, or feeling tied to the item.",
              "Prefer lines like 'The Office is painfully awkward in the funniest way' over 'The Office is a popular comedy about office workers'.",
              "Do not define, introduce, or summarize the item as if writing an encyclopedia entry.",
              "For unrecognized items: be direct and honest—say you don't know it. Don't invent details or fake recognition.",
              "Never say generic praise like 'sounds interesting', 'seems special', 'looks good' for items you don't actually know.",
              `Max ${FEEDBACK_MAX_WORDS} words.`,
              "For recognized items, mention at least one word from the title.",
              "For unrecognized items, just admit it clearly.",
              "Do not ask for another item.",
              "Do not invent creators, facts, entities, or characters.",
              "Use plain text only.",
            ].join(" "),
            input: `Section: ${section}\nItem: ${normalizedItem}\nDetected label: ${labelTitle || labelKey || "eclectic"}`,
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("ai_feedback_timeout")), aiConfig.timeoutMs);
          }),
        ]);

        const generated = sanitizeTasteFeedback((response.output_text || "").trim(), lang);
        const text = (
          generated &&
          isFeedbackRelevantToItem(generated, normalizedItem) &&
          !isGenericTasteFeedback(generated, lang) &&
          !isEncyclopedicTasteFeedback(generated, lang)
        )
          ? generated
          : buildTasteFeedbackFallbackWithItem({ lang, labelTitle, item: normalizedItem });

        return { ok: true, text };
      } catch (error) {
        const message = error?.message || String(error);
        if (message === "ai_feedback_timeout") {
          logger.info("AI taste feedback fallback", { reason: message });
        } else {
          logger.warn("AI taste feedback failed", { error: message });
        }
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
  isEncyclopedicTasteFeedback,
  isFeedbackRelevantToItem,
  isGenericTasteFeedback,
  buildTasteFeedbackFallbackWithItem,
  buildInterestSuggestionFallback,
  extractAiResponseText,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  sanitizeTasteFeedback,
};
