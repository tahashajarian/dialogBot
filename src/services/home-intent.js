const TOPIC_PATTERNS = Object.freeze({
  discussions: /(?:گفت(?:‌?وگو|گو)|بحث|اتاق|دعوت|conversation|discussion|room|invite)/i,
  people: /(?:آدم|افراد|پیام مستقیم|دایرکت|people|person|direct message|dm\b)/i,
  savedProfiles: /(?:ذخیره.?شده|پروفایل ذخیره|نشانک|saved profile|bookmark)/i,
  favorites: /(?:محبوب|علاقه|فیلم|سریال|موسیقی|کتاب|پیشنهاد|favorite|interest|movie|series|music|book|suggestion)/i,
  profile: /(?:پروفایل|حریم|خصوصی|نمایش|profile|privacy|visible|visibility)/i,
  stars: /(?:استار|ستاره|stars?|balance|پرداخت|خرید|spend|buy)/i,
  guide: /(?:راهنما|کمک|دعوت دوست|referral|guide|help)/i,
});

const STATUS_PATTERNS = Object.freeze({
  greeting: /^(?:سلام|درود|hi|hello|hey)[!؟?., ]*$/i,
  reaction: /^(?:وا|عه|اوه|oh|wow|huh)[!؟?., ]*$/i,
  invitations: /^(?:دعوتی دارم|دعوت دارم|دعوت جدیدی دارم|do i have (?:(?:any|an) )?(?:invites?|invitations?)|any (?:invites?|invitations?))[؟?!. ]*$/i,
  news: /^(?:چه خبر(?:ا|ها)?|خبر جدیدی هست|what(?:\'s| is) new|any news)[؟?!. ]*$/i,
  status: /(?:چیزی منتظرمه|وضعیتم|what(?:\'s| is) happening|anything waiting|my status)/i,
  nextStep: /(?:الان چیکار کنم|قدم بعدی چیه|چی کار کنم|what should i do|what now|next step)/i,
  aboutMuze: /^(?:میوز چیه|اینجا چه کار میشه کرد|اینجا چیکار میشه کرد|what is muze|what can i do here)[؟?!. ]*$/i,
  age: /^(?:چند سالته|سنت چقدره|چند سالت هست|how old are you|what(?:\'s| is) your age)[؟?!. ]*$/i,
  userStats: /(?:چند تا کاربر|تعداد کاربر|آمار کاربر|how many users|user count|user stats)/i,
  trends: /(?:چی ترنده|چه چیزی ترنده|ترندهای میوز|الان چی محبوبه|what(?:\'s| is) trending|muze trends?)/i,
  discussion: /(?:بحثم چه وضعیه|گفت(?:‌?وگو|گو)م|my discussion|my room)/i,
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
  const exactInvitation = STATUS_PATTERNS.invitations.test(normalized);
  const news = STATUS_PATTERNS.news.test(normalized);
  const status = STATUS_PATTERNS.status.test(normalized);
  const nextStep = STATUS_PATTERNS.nextStep.test(normalized);
  const aboutMuze = STATUS_PATTERNS.aboutMuze.test(normalized);
  const age = STATUS_PATTERNS.age.test(normalized);
  const userStats = STATUS_PATTERNS.userStats.test(normalized);
  const trends = STATUS_PATTERNS.trends.test(normalized);
  const overview = news || status || nextStep;
  const discussionStatus = STATUS_PATTERNS.discussion.test(normalized);
  const snapshot = {
    invitations: exactInvitation || news || status || nextStep,
    activeDiscussion: status || nextStep || discussionStatus,
    favorites: status || nextStep || topics.includes("favorites"),
    news,
    profileGrowth: nextStep,
    identity: true,
  };

  if (exactInvitation || discussionStatus) topics.unshift("discussions");
  if ((overview || aboutMuze) && !topics.length) topics.push("overview");
  if (!topics.length && /(?:میوز|muze|این ربات|this bot|چه کار می.?کنی|what can you do)/i.test(normalized)) {
    topics.push("overview");
  }

  return Object.freeze({
    exactGreeting,
    reaction,
    exactInvitation,
    news,
    status,
    nextStep,
    aboutMuze,
    age,
    userStats,
    trends,
    overview,
    discussionStatus,
    topics: unique(topics).slice(0, 2),
    snapshot: Object.freeze(snapshot),
    casual: !overview && !discussionStatus && !exactInvitation && !exactGreeting && !reaction && !aboutMuze && !age && !userStats && !trends && topics.length === 0,
  });
}

module.exports = { classifyHomeMessage, TOPIC_PATTERNS, STATUS_PATTERNS };
