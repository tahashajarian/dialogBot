const DEFAULT_FEEDBACK_TITLE_STOPWORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with",
  "از", "با", "به", "برای", "تا", "در", "را", "و",
]);

function normalizeCacheItem(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function tokenizeSignalWords(text, { titleStopwords = DEFAULT_FEEDBACK_TITLE_STOPWORDS } = {}) {
  return normalizeCacheItem(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => {
      const isAscii = /^[a-z0-9]+$/i.test(token);
      return isAscii ? token.length >= 3 : token.length >= 2;
    })
    .filter((token) => !titleStopwords.has(token));
}

function isFeedbackRelevantToItem(feedback, item, helpers = {}) {
  const { normalize = normalizeCacheItem, tokenize = tokenizeSignalWords } = helpers;
  const feedbackNorm = normalize(feedback);
  if (!feedbackNorm) return false;

  const itemSignals = tokenize(item).slice(0, 6);
  if (!itemSignals.length) return true;

  return itemSignals.some((token) => feedbackNorm.includes(token));
}

function isGenericTasteFeedback(feedback, lang, { normalize = normalizeCacheItem } = {}) {
  const normalized = normalize(feedback);
  if (!normalized) return true;

  const patterns = lang === "fa"
    ? [
      /نمی\s*شناسم/,
      /نمی\s*دونم/,
      /نمی\s*دانم/,
      /متاسفانه/,
      /متأسفانه/,
      /آشنا نیستم/,
      /شناخته شده نیست/,
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
      /\b(i )?(do not|don't|dont|don t) (know|recognize)\b/,
      /\b(i am|i'm) not familiar\b/,
      /\bnot familiar with\b/,
      /\bunrecognized\b/,
      /\bunknown\b/,
      /\bsorry\b.*\b(don't|do not|can't|cannot)\b/,
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

function isEncyclopedicTasteFeedback(feedback, lang, { normalize = normalizeCacheItem } = {}) {
  const normalized = normalize(feedback);
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

function limitWords(text, maxWords = 18) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ").trim();
}

function sanitizeTasteFeedback(text, lang, maxWords = 18) {
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

  return limitWords(clean, maxWords);
}

function buildTasteFeedbackFallbackWithItem({ lang, item }) {
  const shortItem = shortenItemForFeedback(item);
  if (lang === "fa") {
    return limitWords(`«${shortItem || "این مورد"}» ذخیره شد.`, 18);
  }

  return limitWords(`Saved "${shortItem || "that item"}".`, 18);
}

function buildUnknownItemFeedback({ lang, item }) {
  const shortItem = shortenItemForFeedback(item);
  if (lang === "fa") {
    return limitWords(`«${shortItem || "این مورد"}» ذخیره شد.`, 12);
  }
  return limitWords(`Saved "${shortItem || "that item"}".`, 12);
}

function isSavedOnlyTasteFeedback(feedback, lang) {
  const normalized = normalizeCacheItem(feedback);
  if (!normalized) return false;

  if (lang === "fa") {
    return normalized.endsWith("ذخیره شد") ||
      normalized.endsWith("ثبت کردم") ||
      normalized.endsWith("ثبت شد");
  }

  return /^saved\b/.test(normalized);
}


function createFeedbackQualityHelpers({ maxWords = 18 } = {}) {
  const tokenize = (text) => tokenizeSignalWords(text);
  return {
    isEncyclopedicTasteFeedback,
    isFeedbackRelevantToItem: (feedback, item) => isFeedbackRelevantToItem(feedback, item, { tokenize }),
    isGenericTasteFeedback,
    tokenizeSignalWords: tokenize,
    sanitizeTasteFeedback: (text, lang) => sanitizeTasteFeedback(text, lang, maxWords),
  };
}

module.exports = {
  buildTasteFeedbackFallbackWithItem,
  buildUnknownItemFeedback,
  createFeedbackQualityHelpers,
  isEncyclopedicTasteFeedback,
  isFeedbackRelevantToItem,
  isGenericTasteFeedback,
  isSavedOnlyTasteFeedback,
  limitWords,
  normalizeCacheItem,
  sanitizeTasteFeedback,
  shortenItemForFeedback,
  tokenizeSignalWords,
};
