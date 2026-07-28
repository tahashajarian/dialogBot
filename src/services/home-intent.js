const { classifyHomeBoundary } = require("./home-boundary");

const TOPIC_PATTERNS = Object.freeze({
  discussions: /(?:گفت(?:‌?وگو|گو)|بحث|اتاق|گروه|چت|روم|دعوت|conversation|discussion|room|group|chat|invite)/i,
  people: /(?:آدم|افراد|پیام مستقیم|دایرکت|people|person|direct message|dm\b)/i,
  savedProfiles: /(?:ذخیره.?شده|پروفایل ذخیره|نشانک|saved profile|bookmark)/i,
  favorites: /(?:محبوب|علاقه|فیلم|سریال|موسیقی|کتاب|پیشنهاد|favorite|interest|movie|series|music|book|suggestion)/i,
  profile: /(?:پروفایل|حریم|خصوصی|نمایش|profile|privacy|visible|visibility)/i,
  stars: /(?:استار|ستاره|stars?|balance|پرداخت|خرید|spend|buy)/i,
  guide: /(?:راهنما|کمک|دعوت دوست|referral|guide|help)/i,
});



const CLEARLY_UNRELATED_PATTERN = /(?:^|\s)(?:یه|یک|برام|برای من|لطفا|please)?\s*(?:جک|جوک|شعر|داستان|قصه|فال)(?:\s|$)|(?:تعریف کن|بگو|بنویس|بساز).{0,30}(?:جک|جوک|شعر|داستان|قصه)|(?:translate|ترجمه کن|ترجمه‌اش کن)|(?:پایتخت|capital of)|(?:هوا چطوره|آب و هوا|weather)|(?:مسئله|معادله|calculate|solve).{0,30}(?:ریاضی|math)|(?:tell me a joke|write (?:me )?(?:a )?(?:poem|story)|sing (?:me )?a song)/i;

const PRODUCT_FOLLOWUP_PATTERN = /^(?:چطور|یعنی چی|بیشتر توضیح بده|کدوم بخش|بعدش چی|چرا|how|why|what do you mean|tell me more|which section|what next)[؟?!. ]*$/i;

function isLikelyProductFollowup(text, history = []) {
  return Boolean(history?.length && PRODUCT_FOLLOWUP_PATTERN.test(String(text || "").trim()));
}

const STATUS_PATTERNS = Object.freeze({
  greeting: /^(?:سلام|درود|hi|hello|hey)[!؟?., ]*$/i,
  reaction: /^(?:وا|عه|اوه|oh|wow|huh)[!؟?., ]*$/i,
  feedback: /(?:تو خیلی بد حرف می.?زنی|بد جواب می.?دی|جوابت خوب نبود|اصلا کمک نمی.?کنی|که نمی.?تونی|پس نمی.?تونی|you(?:'re| are) not helping|bad answer|you can(?:'t|not) help)/i,
  thanks: /^(?:مرسی|ممنون|خیلی ممنون|سپاس|دمت گرم|تشکر|thanks|thank you|thx)[!؟?., ]*$|(?:جواب|پاسخ).{0,20}(?:مرسی|ممنون).{0,20}(?:نمی.?دی|نمیدی|نمی.?دهی|نمی.?دین)/i,
  socialCheckIn: /^(?:(?:سلام|درود)[،, ]*)?(?:حالت چطوره|خوبی|چطوری|how are you|how(?:\'s| is) it going)[؟?!. ]*$/i,
  invitations: /^(?:دعوتی دارم|دعوت دارم|دعوت جدیدی دارم|do i have (?:(?:any|an) )?(?:invites?|invitations?)|any (?:invites?|invitations?))[؟?!. ]*$/i,
  news: /^(?:چه خبر(?:ا|ها)?|خبر جدیدی هست|what(?:\'s| is) new|any news)[؟?!. ]*$/i,
  status: /(?:چیزی منتظرمه|وضعیتم|what(?:\'s| is) happening|anything waiting|my status)/i,
  nextStep: /(?:الان چیکار کنم|قدم بعدی چیه|چی کار کنم|what should i do|what now|next step)/i,
  aboutMuze: /^(?:میوز چیه|اینجا چه کار میشه کرد|اینجا چیکار میشه کرد|what is muze|what can i do here)[؟?!. ]*$/i,
  botAge: /^(?:(?:(?:تو|خودت|میوز)\s*)?(?:چند\s*سال(?:ت|ش)(?:ه| هست)?|چند\s*سال\s*داری|سن(?:ت|\s*خودت|\s*میوز)\s*(?:چقدره|چنده|چند\s*ساله))|(?:نسخه(?:\s*ی|‌ی)?(?:‌?ت|\s*میوز)?\s*(?:چنده|چقدره)|ورژن(?:‌?ت|\s*میوز)?\s*(?:چنده|چقدره))|how old are you|what(?:\'s| is) your age|what version are you|what(?:\'s| is) your version)[؟?!. ]*$/i,
  userAge: /^(?:سن منو می.?دونی|سن من رو می.?دونی|من چند سالمه|چند سالمه من|چند سالمه|سنم چقدره|سن من چقدره|do you know my age|how old am i)[؟?!. ]*$/i,
  userStats: /(?:چند تا کاربر|تعداد کاربر|آمار کاربر|how many users|user count|user stats)/i,
  trends: /(?:چی ترنده|چه چیزی ترنده|ترندهای میوز|الان چی محبوبه|what(?:\'s| is) trending|muze trends?)/i,
  discussion: /(?:بحثم چه وضعیه|(?:گفت(?:‌?وگو|گو)|گروه|چت|روم)(?:هام|های من|م|یی)?(?: دارم| ندارم| چه وضعیه| چند تا دارم)?|گفتگویی دارم|گفت‌وگویی دارم|من چند تا (?:گروه|چت|روم) دارم|my (?:discussion|room|group|chat)|do i have (?:a|any) (?:discussion|room|group|chat)|how many (?:discussions|rooms|groups|chats) do i have)/i,
  discussionMembers: /(?:(?:گفت(?:‌?وگو|گو)|گروه|چت|روم)(?:هام|های من|هامون)?.{0,25}(?:چند نفر|چند عضو|آدم|کسی|شلوغ|خلوت)|(?:چند نفر|چند عضو|آدم|کسی).{0,25}(?:توی|تو|داخل).{0,15}(?:گفت(?:‌?وگو|گو)|گروه|چت|روم)|how many (?:people|members).{0,25}(?:discussion|room|group|chat)|(?:anyone|people|members).{0,25}(?:in|inside).{0,15}(?:discussion|room|group|chat))/i,
  recentDiscussionJoin: /(?:کسی|فردی|عضوی).{0,30}(?:جدیدا|تازه|اخیرا).{0,30}(?:اضافه|وارد|پیوست)|(?:جدیدا|تازه|اخیرا).{0,30}(?:کسی|فردی|عضوی).{0,30}(?:اضافه|وارد|پیوست)|(?:anyone|someone|new member).{0,30}(?:recently|just).{0,30}(?:join|added)|(?:recently|just).{0,30}(?:join|added)/i,
  recommendation: /(?:پیشنهاد بده|پیشنهاد می.?دی|معرفی کن|چی ببینم|چی گوش بدم|چی بخونم|recommend|suggest).{0,50}(?:فیلم|سریال|موسیقی|آهنگ|ترانه|کتاب|movie|series|show|music|song|book)|(?:فیلم|سریال|موسیقی|آهنگ|ترانه|کتاب|movie|series|show|music|song|book).{0,50}(?:پیشنهاد|معرفی|recommend|suggest)|(?:یه|یک|چند(?:تا)?)?.{0,16}(?:فیلم|سریال|موسیقی|آهنگ|ترانه|کتاب).{0,40}(?:بگو|بده|معرفی کن|پیشنهاد بده|برای دیدن|برای شنیدن|برای خوندن|بخونم|ببینم|گوش بدم)|(?:بگو|بده|معرفی کن|پیشنهاد بده).{0,40}(?:فیلم|سریال|موسیقی|آهنگ|ترانه|کتاب)/i,
});

function unique(values) {
  return [...new Set(values)];
}

function classifyHomeMessage(text) {
  const normalized = String(text || "").trim().slice(0, 1000);
  const topics = Object.entries(TOPIC_PATTERNS)
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([topic]) => topic);

  const exactGreeting = STATUS_PATTERNS.greeting.test(normalized);
  const reaction = STATUS_PATTERNS.reaction.test(normalized);
  const feedback = STATUS_PATTERNS.feedback.test(normalized);
  const thanks = STATUS_PATTERNS.thanks.test(normalized);
  const socialCheckIn = STATUS_PATTERNS.socialCheckIn.test(normalized);
  const exactInvitation = STATUS_PATTERNS.invitations.test(normalized);
  const news = STATUS_PATTERNS.news.test(normalized);
  const status = STATUS_PATTERNS.status.test(normalized);
  const nextStep = STATUS_PATTERNS.nextStep.test(normalized);
  const aboutMuze = STATUS_PATTERNS.aboutMuze.test(normalized);
  const botAge = STATUS_PATTERNS.botAge.test(normalized);
  const userAge = STATUS_PATTERNS.userAge.test(normalized);
  const age = botAge;
  const userStats = STATUS_PATTERNS.userStats.test(normalized);
  const trends = STATUS_PATTERNS.trends.test(normalized);
  const boundary = classifyHomeBoundary(normalized);
  const personalDistress = boundary.personalBoundary;
  const relationshipProposal = boundary.relationshipProposal;
  const overview = news || status || nextStep;
  const discussionMembers = STATUS_PATTERNS.discussionMembers.test(normalized);
  const discussionStatus = STATUS_PATTERNS.discussion.test(normalized) || discussionMembers;
  const recentDiscussionJoin = STATUS_PATTERNS.recentDiscussionJoin.test(normalized);
  const recommendation = STATUS_PATTERNS.recommendation.test(normalized);
  const recommendationSection = recommendation
    ? /(?:موسیقی|آهنگ|ترانه|music|song)/i.test(normalized) ? "music"
      : /(?:کتاب|book)/i.test(normalized) ? "books"
        : "movies"
    : null;
  const snapshot = {
    invitations: exactInvitation || news || status || nextStep,
    activeDiscussion: status || nextStep || discussionStatus || recentDiscussionJoin,
    ownedDiscussions: discussionStatus || recentDiscussionJoin,
    discussionMembers,
    recentDiscussionJoin,
    favorites: status || nextStep || topics.includes("favorites"),
    news,
    profileGrowth: nextStep,
    identity: true,
    profileAge: userAge,
  };

  if (exactInvitation || discussionStatus || recentDiscussionJoin) topics.unshift("discussions");
  if ((overview || aboutMuze) && !topics.length) topics.push("overview");
  if (!topics.length && /(?:میوز|muze|این ربات|this bot|چه کار می.?کنی|what can you do)/i.test(normalized)) {
    topics.push("overview");
  }

  const productRelated = Boolean(
    exactGreeting || reaction || feedback || thanks || socialCheckIn || exactInvitation || news || status || nextStep || aboutMuze || botAge || userAge ||
    userStats || trends || discussionStatus || recentDiscussionJoin || recommendation || relationshipProposal || topics.length
  );
  // Keep scope control narrow: only clearly unrelated requests are blocked locally.
  // Natural or ambiguous wording continues to the conversational model, which can
  // understand product context and follow-ups without a growing regex allowlist.
  const outOfScope = !boundary.immediateSafety && !personalDistress && CLEARLY_UNRELATED_PATTERN.test(normalized);

  return Object.freeze({
    exactGreeting,
    reaction,
    feedback,
    thanks,
    socialCheckIn,
    exactInvitation,
    news,
    status,
    nextStep,
    aboutMuze,
    age,
    botAge,
    userAge,
    userStats,
    trends,
    personalDistress,
    relationshipProposal,
    immediateSafety: boundary.immediateSafety,
    outOfScope,
    productRelated,
    overview,
    discussionStatus,
    discussionMembers,
    discussionMembersFollowup: discussionMembers,
    recentDiscussionJoin,
    recommendation,
    recommendationSection,
    topics: unique(topics).slice(0, 2),
    snapshot: Object.freeze(snapshot),
    casual: outOfScope,
  });
}

module.exports = { classifyHomeMessage, isLikelyProductFollowup, PRODUCT_FOLLOWUP_PATTERN, CLEARLY_UNRELATED_PATTERN, TOPIC_PATTERNS, STATUS_PATTERNS };
