function normalizeSuggestionTitle(text) {
  return String(text || "")
    .replace(/^[\s\-•*#]+/g, "")
    .replace(/^\d+[.)]\s+/g, "")
    .replace(/^\((?:activity|game|channel|tool|place|podcast|course|creator|community|experience|practice|project|فعالیت|بازی|کانال|ابزار|مکان|پادکست|دوره|سازنده|جامعه|تجربه|تمرین|پروژه)\)\s*/i, "")
    .replace(/\s*\((?:activity|practice|project|creative project|experience|فعالیت|تمرین|پروژه|پروژه خلاق|تجربه)\)\s*$/i, "")
    .replace(/^(title|item|suggestion|عنوان|پیشنهاد)\s*[:：-]\s*/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function normalizeSuggestionReason(text, lang, { limitWords }) {
  let cleaned = String(text || "")
    .replace(/^(?:(?:reason|comment|دلیل|توضیح)\s*[:：-]|why\s*[?؟:：-]|چرا\s*[؟?:：-])\s*/i, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/به\s+سلیقه(?:‌|\s)?ات\s+در\s+/g, "به ");
  if (lang === "fa") {
    const awkwardComparison = cleaned.match(
      /^برای\s+(.+?)،\s*(.+?)\s+درمی(?:‌|\s)?آید[.!؟]?$/u,
    );
    if (awkwardComparison) {
      cleaned = `فضای ${awkwardComparison[2]}ش به ${awkwardComparison[1]} نزدیکه.`;
    }
    const awkwardPersonalComparison = cleaned.match(
      /^برای\s+(.+?)،\s*(?:همین\s+)?(.+?)\s+می(?:‌|\s)?گیردت[.!؟]?$/u,
    );
    if (awkwardPersonalComparison) {
      cleaned = `${awkwardPersonalComparison[2]}‌اش به ${awkwardPersonalComparison[1]} نزدیکه.`;
    }
  }
  if (!cleaned) {
    return lang === "fa" ? "برای سلیقه‌ات گزینه خوبیه." : "Good match for your taste.";
  }
  if (lang === "fa" && !/[\u0600-\u06FF]/u.test(cleaned)) {
    return "برای سلیقه‌ات گزینه خوبیه.";
  }
  return limitWords(cleaned, 14);
}

function normalizeSuggestionMetadata(text) {
  const cleaned = String(text || "")
    .replace(/^[\s\-•*#]+/g, "")
    .replace(/^(?:metadata|details|creator|artist|author|director|اطلاعات|جزئیات)\s*[:：-]\s*/i, "")
    .trim()
    .replace(/\s+/g, " ");
  return /^[-—]$/.test(cleaned) ? "" : cleaned.slice(0, 120);
}

function isSuggestionUncertainResponse(text) {
  return /^UNSURE[.!]?$/i.test(String(text || "").trim());
}

function buildSuggestionAttemptText(userText, fallbackText, attempt, previousIssue = "") {
  const context = String(userText || "").trim();
  if (attempt <= 0) return context || fallbackText;
  const issue = String(previousIssue || "").trim();
  const retryInstruction = issue === "generic_reason"
    ? "Try again with a different real item and explain at least two concrete connections; do not use a generic taste-match reason."
    : issue === "favorite_creator_work" || issue === "repeated_creator"
      ? "Try again with a different real item by a different creator."
      : "Try again with a different real item. The previous candidate was unusable or already known.";
  return context ? `${context}\n\n${retryInstruction}` : retryInstruction;
}

function buildSuggestionCopyText(mode, title, metadata = "") {
  const cleanTitle = normalizeSuggestionTitle(title);
  const cleanMetadata = normalizeSuggestionMetadata(metadata)
    .replace(/\b(?:director|dir\.?|creator|artist|author|album|year)\s*:?\s*/gi, "")
    .replace(/(?:کارگردان|سازنده|خالق|هنرمند|خواننده|نویسنده|آلبوم|سال)\s*:\s*/g, "")
    .replace(/\b(?:18|19|20)\d{2}\b/g, "")
    .replace(/(?:۱۸|۱۹|۲۰)[۰-۹]{2}/g, "")
    .replace(/\b(?:IMDb|Goodreads|Metacritic)\s*:\s*[\d.]+(?:\/(?:10|5|100))?/gi, "")
    .trim();
  const identifyingName = cleanMetadata
    .split(/\s*[·|]\s*/)
    .map((part) => part.replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "").trim())
    .find(Boolean) || "";

  if (mode === "random") {
    return [cleanTitle, cleanMetadata].filter(Boolean).join(" ").trim();
  }
  return [cleanTitle, identifyingName].filter(Boolean).join(" ").trim();
}

function getSuggestionRealityIssue({ mode, title, metadata = "", reason }) {
  const cleanTitle = String(title || "").trim();
  const cleanMetadata = String(metadata || "").trim();
  const cleanReason = String(reason || "").trim();
  const combined = `${cleanTitle} ${cleanMetadata} ${cleanReason}`;
  if (!cleanTitle) return "missing_title";

  if (/\b(?:Unknown Artist|Unknown Author|Unknown Director|Unknown Creator|Unknown Title)\b/i.test(combined)) {
    return "placeholder_metadata";
  }
  if (/\b(?:Title|Artist|Author|Director|Creator)\s*:\s*(?:unknown|n\/a|none|tbd|-)\b/i.test(combined)) {
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

  if (mode === "movies") {
    const movieMetadata = cleanMetadata || cleanTitle.match(/\(([^)]+)\)\s*$/)?.[1] || "";
    const yearPattern = /(?:\b(?:18|19|20)\d{2}\b|(?:۱۸|۱۹|۲۰)[۰-۹]{2})/;
    const hasYear = yearPattern.test(movieMetadata);
    const creatorText = movieMetadata
      .replace(/(?:\b(?:18|19|20)\d{2}\b|(?:۱۸|۱۹|۲۰)[۰-۹]{2})/g, "")
      .replace(/(?:\bdir\.|\bdirector\b|\bcreator\b|کارگردان|سازنده|خالق)/gi, "")
      .replace(/[\s,.:;·\-–—()[\]]/g, "");
    if (!hasYear || creatorText.length < 2) return "missing_movie_metadata";
  }
  if (mode === "music" && !cleanMetadata && !/\([^)]+\)/.test(cleanTitle)) {
    return "missing_music_metadata";
  }
  if (mode === "books" && !cleanMetadata && !/\([^)]+\)/.test(cleanTitle)) {
    return "missing_book_metadata";
  }

  return "";
}

const MEDIA_GENERIC_REASON_PATTERNS = [
  /^Good match for your taste[.!]?$/i,
  /^(?:This|It) (?:is|would be) (?:a )?(?:good|great|strong|perfect) (?:match|choice|fit)(?: for you| for your taste)?[.!]?$/i,
  /^(?:A |An )?(?:good|great|strong|perfect) (?:match|choice|fit)(?: for you| for your taste)?[.!]?$/i,
  /^برای سلیقه(?:‌|\s)?ات گزینه (?:خوب|عالی|مناسب)یه[.!؟]?$/u,
  /^(?:خیلی )?به سلیقه(?:‌|\s)?ات می(?:‌|\s)?خوره[.!؟]?$/u,
  /^(?:کاملا |کاملاً )?با سلیقه(?:‌|\s)?ات (?:هماهنگه|جوره)[.!؟]?$/u,
  /^به چیزهایی که دوست داری نزدیکه[.!؟]?$/u,
];
const RETRYABLE_SUGGESTION_FAILURES = new Set([
  "uncertain_suggestion",
  "invalid_output",
  "unverified_suggestion",
  "low_quality_media",
  "low_quality_interest",
  "duplicate_suggestion",
  "creator_repetition",
]);

function getMediaSuggestionQualityIssue({ reason = "" }) {
  const cleanReason = String(reason || "").trim().replace(/\s+/g, " ");
  if (!cleanReason) return "missing_reason";
  if (MEDIA_GENERIC_REASON_PATTERNS.some((pattern) => pattern.test(cleanReason))) {
    return "generic_reason";
  }
  return "";
}

function normalizeComparableCreator(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractSuggestionCreator(metadata = "") {
  const value = normalizeSuggestionMetadata(metadata)
    .replace(/\b(?:IMDb|Goodreads|Metacritic)\s*:\s*[\d.]+(?:\/(?:10|5|100))?/gi, "")
    .trim();
  if (!value) return "";

  const parts = value
    .split(/\s*[·|]\s*/)
    .map((part) => part
      .replace(/\b(?:18|19|20)\d{2}\b/g, "")
      .replace(/(?:۱۸|۱۹|۲۰)[۰-۹]{2}/g, "")
      .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
      .trim())
    .filter(Boolean);
  const creatorPattern = /^(?:director|dir\.?|creator|artist|band|author|writer|singer|کارگردان|سازنده|خالق|هنرمند|گروه|نویسنده|خواننده)\s*:\s*/i;
  const explicit = parts.find((part) => creatorPattern.test(part));
  const candidate = explicit || parts[0] || "";
  return candidate.replace(creatorPattern, "").trim().slice(0, 80);
}

function getSuggestionCreatorIssue({
  metadata = "",
  topTenItems = [],
  recentSuggestionCreators = [],
  requestText = "",
}) {
  const creator = extractSuggestionCreator(metadata);
  const normalizedCreator = normalizeComparableCreator(creator);
  if (!normalizedCreator) return "";
  const normalizedRequest = normalizeComparableCreator(requestText);
  if (normalizedRequest.includes(normalizedCreator)) return "";

  const favoriteNames = new Set(topTenItems.map(normalizeComparableCreator).filter(Boolean));
  if (favoriteNames.has(normalizedCreator)) return "favorite_creator_work";

  const recentCreators = new Set(
    recentSuggestionCreators.map(normalizeComparableCreator).filter(Boolean),
  );
  if (recentCreators.has(normalizedCreator)) return "repeated_creator";
  return "";
}

function isRetryableSuggestionFailure(result) {
  if (!result || result.ok) return false;
  return RETRYABLE_SUGGESTION_FAILURES.has(result.reason);
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
  let metadataLine = lines.length >= 3 ? lines[1] : "";
  let reasonLine = lines.length >= 3 ? lines.slice(2).join(" ") : (lines[1] || "");

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
  let metadata = normalizeSuggestionMetadata(metadataLine);
  if (!metadata) {
    const legacyMetadata = title.match(/\s*\(([^()]+)\)\s*$/);
    if (legacyMetadata) {
      metadata = normalizeSuggestionMetadata(legacyMetadata[1]);
      title = normalizeSuggestionTitle(title.slice(0, legacyMetadata.index));
    }
  }
  let reason = normalizeSuggestionReason(reasonLine, lang, helpers);

  return { title, metadata, reason };
}

function getSingleSuggestionDetailInstruction(mode) {
  if (mode === "movies") {
    return [
      "For a movie, line 1 must be only the exact original title; line 2 must be year + director; example: 2014 · Director: Christopher Nolan.",
      "For a series, line 1 must be only the exact original title; line 2 must be premiere year + creator; example: 2017 · Creator: Baran bo Odar.",
      "If you are highly certain of its IMDb rating, line 3 may start with IMDb: score/10 — then the reason; otherwise omit the rating and give only the reason.",
    ].join(" ");
  }

  if (mode === "music") {
    return [
      "Line 1 must be only the exact track or album title. Line 2 must be artist/band, then album and year when known.",
      "For an album only, if you are highly certain of its Metacritic score, line 3 may start with Metacritic: score/100 — then the reason; otherwise omit the score.",
    ].join(" ");
  }

  if (mode === "books") {
    return [
      "Line 1 must be only the exact book title. Line 2 must be author, then publication year when known.",
      "If you are highly certain of its Goodreads rating, line 3 may start with Goodreads: score/5 — then the reason; otherwise omit the rating.",
    ].join(" ");
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
    "Line 1 must be only the exact searchable name. Line 2 must identify the platform or source.",
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
  buildSuggestionAttemptText,
  buildSuggestionCopyText,
  createSuggestionHelpers,
  getInterestSuggestionFamily,
  getSingleSuggestionDetailInstruction,
  getMediaSuggestionQualityIssue,
  getSuggestionCreatorIssue,
  getSuggestionRealityIssue,
  extractSuggestionCreator,
  isRetryableSuggestionFailure,
  isSuggestionUncertainResponse,
  splitSuggestionSentence,
};
