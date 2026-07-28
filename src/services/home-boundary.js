const IMMEDIATE_SAFETY_PATTERN = /(?:خودکشی|خودم(?:و| را)? بکشم|به خودم آسیب|نمی.?خوام زنده بمونم|امن نیستم|ممکنه به خودم آسیب بزنم|suicid|kill myself|hurt myself|self[- ]?harm|not safe|don'?t want to live)/i;

const RELATIONSHIP_PROPOSAL_PATTERN = /(?:با من ازدواج می.?کنی|با من عروسی می.?کنی|همسرم می.?شی|زنم می.?شی|شوهرم می.?شی|دوست.?دخترم می.?شی|دوست.?پسرم می.?شی|با من وارد رابطه می.?شی|با من قرار می.?ذاری|عاشقم می.?شی|می.?خوای با من باشی|will you marry me|marry me|be my (?:girlfriend|boyfriend|partner|wife|husband)|date me|go out with me|be in a relationship with me)/i;

const PERSONAL_BOUNDARY_PATTERNS = Object.freeze([
  // General emotional distress and loneliness.
  /(?:حالم.{0,24}(?:بده|خوب نیست|خرابه)|خیلی ناراحتم|داغونم|بهم ریختم|آشفته.?م|دلم گرفته|غمگینم|افسرده.?م|تنها(?:م|یی)|حوصله(?:‌| )?(?:هیچی|هیچ.?چیز|ندارم)|از همه.?چی (?:خسته.?م|خسته شدم)|دیگه بریدم|روزای بدی دارم|زندگیم.{0,20}(?:به.?هم ریخته|خرابه))/i,
  /(?:i(?:'m| am) (?:very )?(?:sad|upset|lonely|depressed|miserable|heartbroken)|i feel (?:awful|terrible|empty|hopeless|alone)|having a hard time|my life is falling apart)/i,

  // Relationships, breakup, betrayal, grief, and family problems.
  /(?:دوست.?دختر|دوس.?دختر|دوست.?پسر|همسر|نامزد|رابطه(?:‌| )?م|طلاق|جدا شد|ولم کرد|ترکم کرد|خیانت|دلم براش تنگ|عزیزم.{0,16}(?:مرد|فوت)|یکی رو از دست دادم|مشکل خانوادگی|با خانوادم)/i,
  /(?:girlfriend|boyfriend|partner|spouse|relationship|break.?up|broke up|left me|cheated|betray|divorc|grief|died|passed away|family problem)/i,

  // Personal health or sleep complaints that invite counselling rather than product help.
  /(?:چند شب.{0,20}نخواب|خوابم نمی.?بره|بی.?خواب(?:ی|م)|حمله اضطراب|استرس شدید|اضطراب|پنیک|حال جسمیم بده|درد دارم|بیمارم)/i,
  /(?:haven'?t slept|can'?t sleep|insomnia|panic attack|severe anxiety|very anxious|i(?:'m| am) sick|in pain)/i,

  // Attempts to continue an emotional-support conversation after a boundary.
  /(?:فقط تو رو دارم|کسی رو ندارم|بذار برات تعریف کنم|می.?خوام درد دل کنم|فقط گوش کن|می.?شه باهات حرف بزنم|تو تنها کسی هستی|نمی.?تونم به کسی بگم)/i,
  /(?:you'?re all i have|i have no one|let me tell you|i need to vent|just listen|can i talk to you|can'?t tell anyone)/i,
]);

function classifyHomeBoundary(text) {
  const normalized = String(text || "").trim().slice(0, 1200);
  if (!normalized) return Object.freeze({ immediateSafety: false, personalBoundary: false });
  const immediateSafety = IMMEDIATE_SAFETY_PATTERN.test(normalized);
  const relationshipProposal = !immediateSafety && RELATIONSHIP_PROPOSAL_PATTERN.test(normalized);
  const personalBoundary = !immediateSafety && !relationshipProposal && PERSONAL_BOUNDARY_PATTERNS.some((pattern) => pattern.test(normalized));
  return Object.freeze({ immediateSafety, personalBoundary, relationshipProposal });
}

module.exports = {
  classifyHomeBoundary,
  IMMEDIATE_SAFETY_PATTERN,
  PERSONAL_BOUNDARY_PATTERNS,
  RELATIONSHIP_PROPOSAL_PATTERN,
};
