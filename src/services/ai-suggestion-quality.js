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

function normalizeSuggestionReason(text, lang, { limitWords }) {
  const cleaned = String(text || "")
    .replace(/^(reason|why|comment|دلیل|توضیح)\s*[:：-]\s*/i, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return lang === "fa" ? "برای سلیقه‌ات گزینه خوبیه." : "Good match for your taste.";
  }
  return limitWords(cleaned, 14);
}

function getSuggestionRealityIssue({ mode, title, reason }) {
  const cleanTitle = String(title || "").trim();
  const cleanReason = String(reason || "").trim();
  const combined = `${cleanTitle} ${cleanReason}`;
  if (!cleanTitle) return "missing_title";

  if (/\b(?:Title|Artist|Author|Director|Unknown Artist|Unknown Author|Unknown Director)\b/.test(combined)) {
    return "placeholder_metadata";
  }
  if (/(عنوان|نویسنده|کارگردان|هنرمند)\s*(نامشخص|فرضی)/.test(combined)) {
    return "placeholder_metadata";
  }
  if (/\b(?:unknown|fictional|imaginary|made[- ]?up|placeholder)\b/i.test(combined)) {
    return "fabrication_marker";
  }
  if (/(خیالی|ساختگی|فرضی|ناموجود)/.test(combined)) {
    return "fabrication_marker";
  }

  if (mode === "movies" && !/\((?=.*(?:\bdir\.|\bdirector\b))[^)]+\)/i.test(cleanTitle)) {
    return "missing_movie_metadata";
  }
  if (mode === "music" && !/\([^)]+\)/.test(cleanTitle)) {
    return "missing_music_metadata";
  }
  if (mode === "books" && !/\([^)]+\)/.test(cleanTitle)) {
    return "missing_book_metadata";
  }

  return "";
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

function parseSingleSuggestionResponse(raw, lang, helpers) {
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
  let reason = normalizeSuggestionReason(reasonLine, lang, helpers);

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
}, { normalizeCacheItem, tokenizeSignalWords }) {
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


function createSuggestionHelpers(helpers) {
  return {
    getInterestSuggestionFamily,
    getInterestSuggestionQualityIssue: (payload) => getInterestSuggestionQualityIssue(payload, helpers),
    parseSingleSuggestionResponse: (raw, lang) => parseSingleSuggestionResponse(raw, lang, helpers),
    splitSuggestionSentence,
    getSuggestionRealityIssue,
  };
}

module.exports = {
  createSuggestionHelpers,
  getInterestSuggestionFamily,
  getSingleSuggestionDetailInstruction,
  getSuggestionRealityIssue,
  splitSuggestionSentence,
};
