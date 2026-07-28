const { getClient, requestSuggestionText } = require("./ai-client");
const { resolveHomeDestination } = require("./home-actions");
const { DEFAULT_BOT_EMOJI } = require("./bot-appearance");
const { getHomeProductKnowledge } = require("./home-product-knowledge");
const { classifyHomeMessage } = require("./home-intent");
const { version: PACKAGE_VERSION } = require("../../package.json");

function getBotVersion() {
  return String(process.env.BOT_VERSION || PACKAGE_VERSION || "unknown").trim();
}

function formatNewsResponse(snapshot, lang, botEmoji) {
  const invitationCount = Number(snapshot?.invitationCount);
  if (Number.isFinite(invitationCount) && invitationCount > 0) {
    return {
      message: lang === "fa"
        ? `${botEmoji} ${invitationCount} دعوت جدید برای گفت‌وگو داری.`
        : `${botEmoji} You have ${invitationCount} new discussion invitation${invitationCount === 1 ? "" : "s"}.`,
      destination: "discussion_invitations",
    };
  }
  return {
    message: lang === "fa"
      ? `${botEmoji} فعلا چیز جدیدی نیست، همه‌چی رو به راهه.`
      : `${botEmoji} Nothing new for now. Everything’s all good.`,
    destination: null,
  };
}

function formatStatusResponse(snapshot, lang, botEmoji) {
  const invitationCount = Number(snapshot?.invitationCount);
  if (Number.isFinite(invitationCount) && invitationCount > 0) {
    return {
      message: lang === "fa" ? `${botEmoji} ${invitationCount} دعوت منتظرته.` : `${botEmoji} You have ${invitationCount} invitation${invitationCount === 1 ? "" : "s"} waiting.`,
      destination: "discussion_invitations",
    };
  }
  if (snapshot?.activeDiscussion?.present) {
    const title = String(snapshot.activeDiscussion.title || "").trim();
    return {
      message: lang === "fa" ? `${botEmoji} الان توی گفت‌وگو${title ? `ی «${title}»` : "ی فعالت"} هستی.` : `${botEmoji} You’re currently in ${title ? `“${title}”` : "an active Discussion"}.`,
      destination: "discussions",
    };
  }
  return {
    message: lang === "fa" ? `${botEmoji} فعلا چیزی منتظرت نیست.` : `${botEmoji} Nothing is waiting for you right now.`,
    destination: null,
  };
}

function formatNextStepResponse(snapshot, lang, botEmoji) {
  const invitationCount = Number(snapshot?.invitationCount);
  if (Number.isFinite(invitationCount) && invitationCount > 0) {
    return { message: lang === "fa" ? `${botEmoji} اول دعوت‌هات رو توی گفت‌وگوها ببین.` : `${botEmoji} Start by checking your invitations in Discussions.`, destination: "discussion_invitations" };
  }
  if (snapshot?.profileGrowthHint) {
    return { message: `${botEmoji} ${String(snapshot.profileGrowthHint).replace(/^\S+\s*/, "").trim()}`, destination: "profile" };
  }
  if (!snapshot?.activeDiscussion?.present) {
    return { message: lang === "fa" ? `${botEmoji} می‌تونی یه سر به گفت‌وگوها بزنی و ببینی چیزی به سلیقه‌ت نزدیکه یا نه.` : `${botEmoji} You can check Discussions and see whether anything fits your taste.`, destination: "discussions" };
  }
  return { message: lang === "fa" ? `${botEmoji} فعلا همه‌چی مرتبه؛ هر بخشی خواستی می‌تونی ادامه بدی.` : `${botEmoji} Everything looks good for now; continue with whichever section you like.`, destination: null };
}

function deterministicResponse(text, snapshot, lang, botEmoji = DEFAULT_BOT_EMOJI, intent = classifyHomeMessage(text)) {
  if (intent.productHelpSection === "people") {
    return {
      message: lang === "fa"
        ? `${botEmoji} برای دیدن آدم‌های جدید، برو بخش آدم‌ها و «دیدن آدم‌ها» رو باز کن.`
        : `${botEmoji} To see new people, open People and choose See people.`,
      destination: "people",
    };
  }
  if (intent.productHelpSection === "discussions") {
    return {
      message: lang === "fa"
        ? `${botEmoji} توی بخش گفت‌وگوها می‌تونی گفت‌وگوهای باز، دعوت‌ها و گفت‌وگوهای خودت رو ببینی.`
        : `${botEmoji} In Discussions, you can see open discussions, invitations, and discussions you created.`,
      destination: "discussions",
    };
  }
  if (intent.exactGreeting) {
    return {
      message: lang === "fa"
        ? `${botEmoji} سلام! چطور می‌تونم کمکت کنم؟`
        : `${botEmoji} Hi! How can I help?`,
      destination: null,
    };
  }
  if (intent.immediateSafety) return {
    message: lang === "fa"
      ? `${botEmoji} اگه الان در خطر فوری هستی یا ممکنه به خودت آسیب بزنی، همین الان با اورژانس یا یک آدم قابل اعتماد تماس بگیر و تنها نمون.`
      : `${botEmoji} If you are in immediate danger or might hurt yourself, contact emergency services or someone you trust right now, and do not stay alone.`,
    destination: null,
  };
  if (intent.personalDistress) return {
    message: lang === "fa"
      ? `${botEmoji} متأسفم که حالت خوب نیست. من اینجا بیشتر درباره‌ی بخش‌های مختلف می‌تونم کمکت کنم.`
      : `${botEmoji} I’m sorry you’re having a hard time. I’m mainly here to help with the different sections of this bot.`,
    destination: null,
  };
  if (intent.thanks) return {
    message: lang === "fa" ? `${botEmoji} خواهش می‌کنم.` : `${botEmoji} You’re welcome.`,
    destination: null,
  };
  if (intent.socialCheckIn) return {
    message: lang === "fa"
      ? `${botEmoji} خوبم، مرسی. درباره‌ی کدوم بخش کمکت کنم؟`
      : `${botEmoji} I’m good, thanks. Which section can I help you with?`,
    destination: null,
  };
  if (intent.feedback) return {
    message: lang === "fa" ? `${botEmoji} درست می‌گی؛ جوابم خوب نبود.` : `${botEmoji} You’re right; that wasn’t a good answer.`,
    destination: null,
  };
  if (intent.reaction) return {
    message: lang === "fa" ? `${botEmoji} درست می‌گی؛ جوابم گیج‌کننده بود.` : `${botEmoji} You’re right—that was confusing.`,
    destination: null,
  };
  if (intent.recommendation) {
    const section = intent.recommendationSection || "movies";
    const sectionName = lang === "fa"
      ? ({ movies: "فیلم و سریال", music: "موسیقی", books: "کتاب" }[section] || "فیلم و سریال")
      : ({ movies: "Movies & series", music: "Music", books: "Books" }[section] || "Movies & series");
    return {
      message: lang === "fa"
        ? `${botEmoji} برای پیشنهاد ${section === "movies" ? "فیلم" : sectionName}، برو علاقه‌مندی‌ها و وارد ${sectionName} شو.`
        : `${botEmoji} For ${section === "movies" ? "movie and series" : sectionName.toLowerCase()} recommendations, open Favorites and choose ${sectionName}.`,
      destination: "favorites",
    };
  }
  if (intent.userAge) return {
    message: lang === "fa"
      ? (Number.isFinite(Number(snapshot?.profileAge))
        ? `${botEmoji} آره، سنی که توی پروفایلت ثبت شده ${Number(snapshot.profileAge)} ساله.`
        : `${botEmoji} هنوز سنی توی پروفایلت ثبت نشده.`)
      : (Number.isFinite(Number(snapshot?.profileAge))
        ? `${botEmoji} Yes. Your profile age is ${Number(snapshot.profileAge)}.`
        : `${botEmoji} You haven’t added an age to your profile yet.`),
    destination: Number.isFinite(Number(snapshot?.profileAge)) ? null : "profile",
  };
  if (intent.age) {
    const version = getBotVersion();
    return {
      message: lang === "fa"
        ? `${botEmoji} سنم رو با نسخه‌ها حساب می‌کنم؛ الان نسخه‌ی ${version} هستم.`
        : `${botEmoji} I count my age in versions. I’m currently version ${version}.`,
      destination: null,
    };
  }
  if (intent.userStats) return {
    message: lang === "fa"
      ? `${botEmoji} نمی‌تونم آمار کاربرهای میوز رو بهت بگم.`
      : `${botEmoji} I can’t share Muze user statistics.`,
    destination: null,
  };
  if (intent.trends) return {
    message: lang === "fa"
      ? `${botEmoji} فعلا نمی‌تونم ترندهای میوز رو بهت بگم.`
      : `${botEmoji} I can’t show Muze trends right now.`,
    destination: null,
  };
  if (intent.aboutMuze) return {
    message: lang === "fa"
      ? `${botEmoji} میوز همین باتیه که داری باهاش حرف می‌زنی؛ اینجا می‌تونی سلیقه‌ت رو بسازی، آدم‌ها رو ببینی و وارد گفت‌وگوها بشی.`
      : `${botEmoji} Muze is the bot you’re talking to. Here you can build your taste, see people, and join Discussions.`,
    destination: null,
  };
  if (intent.recentDiscussionJoin) {
    const recent = snapshot?.recentDiscussionJoin;
    const latest = snapshot?.ownedDiscussions?.latest;
    if (recent?.available && recent.count > 0) return {
      message: lang === "fa"
        ? `${botEmoji} بله، ${recent.count} نفر در ${recent.windowMinutes || 10} دقیقه‌ی اخیر به گفت‌وگو${latest?.title ? `ی «${latest.title}»` : "ت"} اضافه شدن.`
        : `${botEmoji} Yes. ${recent.count} ${recent.count === 1 ? "person has" : "people have"} joined ${latest?.title ? `“${latest.title}”` : "your discussion"} in the last ${recent.windowMinutes || 10} minutes.`,
      destination: "discussions",
    };
    if (recent?.available) return {
      message: lang === "fa"
        ? `${botEmoji} نه، در ${recent.windowMinutes || 10} دقیقه‌ی اخیر کسی به گفت‌وگوت اضافه نشده.`
        : `${botEmoji} No one has joined your discussion in the last ${recent.windowMinutes || 10} minutes.`,
      destination: "discussions",
    };
    return {
      message: lang === "fa" ? `${botEmoji} الان نتونستم این مورد رو بررسی کنم. از بخش گفت‌وگوها می‌تونی وضعیت رو ببینی.` : `${botEmoji} I couldn’t check that right now. You can view the current status in Discussions.`,
      destination: "discussions",
    };
  }
  if (intent.discussionStatus) {
    const active = snapshot?.activeDiscussion;
    const owned = snapshot?.ownedDiscussions;
    if (intent.discussionMembersFollowup && owned) {
      const others = Number(owned.otherMemberCount);
      if (owned.count <= 0) return { message: lang === "fa" ? `${botEmoji} الان گفت‌وگوی بازی نداری.` : `${botEmoji} You don’t have any open discussions right now.`, destination: "discussions" };
      if (Number.isFinite(others) && others > 0) return {
        message: lang === "fa" ? `${botEmoji} آره، روی‌هم ${others} نفر غیر از خودت توی گفت‌وگوهات هستن.` : `${botEmoji} Yes. There are ${others} other ${others === 1 ? "person" : "people"} across your discussions.`,
        destination: "discussions",
      };
      return { message: lang === "fa" ? `${botEmoji} فعلا غیر از خودت کسی توی گفت‌وگوهات نیست.` : `${botEmoji} For now, no one else is in your discussions.`, destination: "discussions" };
    }
    if (active?.present) return {
      message: lang === "fa"
        ? `${botEmoji} بله، الان توی گفت‌وگو${active.title ? `ی «${active.title}»` : "ی فعالت"} هستی${Number.isFinite(active.memberCount) ? ` و ${active.memberCount} عضو داره` : ""}.`
        : `${botEmoji} Yes. You’re currently in ${active.title ? `“${active.title}”` : "an active discussion"}${Number.isFinite(active.memberCount) ? ` with ${active.memberCount} members` : ""}.`,
      destination: "discussions",
    };
    if (owned && owned.count > 0) return {
      message: lang === "fa"
        ? `${botEmoji} بله، ${owned.count} گفت‌وگوی باز ساختی${owned.latest?.title ? `؛ آخرینش «${owned.latest.title}»ه` : ""}.`
        : `${botEmoji} Yes. You have ${owned.count} open discussion${owned.count === 1 ? "" : "s"}${owned.latest?.title ? `; the latest is “${owned.latest.title}”` : ""}.`,
      destination: "discussions",
    };
    if (owned) return { message: lang === "fa" ? `${botEmoji} نه، الان گفت‌وگوی باز یا فعالی نداری.` : `${botEmoji} No. You don’t currently have an active or open discussion.`, destination: "discussions" };
  }
  if (intent.news) return formatNewsResponse(snapshot, lang, botEmoji);
  if (intent.nextStep) return formatNextStepResponse(snapshot, lang, botEmoji);
  if (intent.status) return formatStatusResponse(snapshot, lang, botEmoji);
  if (intent.outOfScope) return {
    message: lang === "fa"
      ? `${botEmoji} من اینجا بیشتر درباره‌ی بخش‌های مختلف می‌تونم کمکت کنم.`
      : `${botEmoji} I’m mainly here to help with the different sections of this bot.`,
    destination: null,
  };
  if (!intent.exactInvitation) return null;
  if (snapshot.invitationCount === null || snapshot.invitationCount === undefined) {
    return {
      message: lang === "fa"
        ? `${botEmoji} الان نتونستم دعوت‌هات رو بررسی کنم. از بخش گفت‌وگوها می‌تونی دعوت‌ها رو ببینی.`
        : `${botEmoji} I couldn’t check your invitations right now. You can open Invitations from Discussions.`,
      destination: "discussion_invitations",
    };
  }
  if (snapshot.invitationCount > 0) {
    return {
      message: lang === "fa"
        ? `${botEmoji} ${snapshot.invitationCount} دعوت منتظرته.`
        : `${botEmoji} You have ${snapshot.invitationCount} invitation${snapshot.invitationCount === 1 ? "" : "s"} waiting.`,
      destination: "discussion_invitations",
    };
  }
  return {
    message: lang === "fa" ? `${botEmoji} فعلا دعوتی نداری.` : `${botEmoji} You don’t have any invitations right now.`,
    destination: null,
  };
}

function stripExtraEmoji(text, marker) {
  const body = String(text || "").replace(marker, "");
  return body
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripRepeatedGreeting(text, lang) {
  if (lang === "fa") {
    return String(text || "")
      .replace(/^(?:سلام|درود)(?:\s+[\p{L}\p{M}‌-]+)?[!،,.؛:\s-]*/u, "")
      .trim();
  }
  return String(text || "")
    .replace(/^(?:hi|hello|hey)(?:\s+[\p{L}\p{M}'-]+)?[!,.\s-]*/iu, "")
    .trim();
}


function conversationalizePersian(text) {
  return String(text || "")
    .replace(/همه[‌ ]چیز/g, "همه‌چی")
    .replace(/نمی[‌-]?شود/g, "نمی‌شه")
    .replace(/می[‌-]?شود/g, "می‌شه")
    .replace(/نمی[‌-]?توانی/g, "نمی‌تونی")
    .replace(/می[‌-]?توانی/g, "می‌تونی")
    .replace(/نمی[‌-]?توانم/g, "نمی‌تونم")
    .replace(/می[‌-]?توانم/g, "می‌تونم")
    .replace(/اگر بخواهی/g, "اگه بخوای")
    .replace(/اگر خواستی/g, "اگه خواستی")
    .replace(/سلیقه[‌ ]ات/g, "سلیقه‌ت")
    .replace(/دستت می[‌-]?آید/g, "دستت میاد")
    .replace(/شرکت در گفت[‌ ]وگوها/g, "سر زدن به گفت‌وگوها")
    .replace(/کم کم/g, "کم‌کم")
    .replace(/آدم[‌ ]ها/g, "آدم‌ها")
    .replace(/گفت[‌ ]وگو/g, "گفت‌وگو")
    .replace(/(^|[\s،؛,.!?])را(?=$|[\s،؛,.!?])/g, "$1رو")
    .replace(/(^|[\s،؛,.!?])آن‌ها(?=$|[\s،؛,.!?])/g, "$1اون‌ها")
    .replace(/(^|[\s،؛,.!?])آنجا(?=$|[\s،؛,.!?])/g, "$1اونجا")
    .replace(/(^|[\s،؛,.!?])اینجا می[‌-]?توانی(?=$|[\s،؛,.!?])/g, "$1اینجا می‌تونی")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeMuzeVoice(message, lang, botEmoji = DEFAULT_BOT_EMOJI) {
  let normalized = String(message || "").trim().slice(0, 700);
  if (!normalized) return "";
  if (lang === "fa") {
    normalized = conversationalizePersian(normalized
      .replace(/\bpeople\b/gi, "آدم‌ها")
      .replace(/\bdiscussions?\b/gi, "گفت‌وگوها")
      .replace(/\bfavorites?\b/gi, "علاقه‌مندی‌ها")
      .replace(/\bprofile\b/gi, "پروفایل")
      .replace(/موزه/g, "میوز")
      .replace(/بحث‌ها/g, "گفت‌وگوها")
      .replace(/بحث/g, "گفت‌وگو"));
  }
  const marker = String(botEmoji || DEFAULT_BOT_EMOJI).trim() || DEFAULT_BOT_EMOJI;
  normalized = normalized.replace(DEFAULT_BOT_EMOJI, "").replace(marker, "").trim();
  normalized = stripExtraEmoji(normalized, marker);
  return normalized ? `${marker} ${normalized}` : marker;
}

function safeParseModelOutput(raw, lang, botEmoji = DEFAULT_BOT_EMOJI, options = {}) {
  let parsed;
  try { parsed = JSON.parse(String(raw || "")); } catch { return null; }
  let message = normalizeMuzeVoice(parsed?.message, lang, botEmoji);
  if (!message) return null;
  if (!options.allowGreeting) {
    const marker = String(botEmoji || DEFAULT_BOT_EMOJI).trim() || DEFAULT_BOT_EMOJI;
    const withoutMarker = message.startsWith(marker) ? message.slice(marker.length).trim() : message;
    const withoutGreeting = stripRepeatedGreeting(withoutMarker, lang);
    message = normalizeMuzeVoice(withoutGreeting || withoutMarker, lang, botEmoji);
  }
  if (/unread|خوانده.?نشده|ذخیره.?ات کرده|ذخیره کرده|saved you|who saved/i.test(message)) return null;
  const action = resolveHomeDestination(parsed?.destination, lang);
  if (action && (lang === "fa" ? /(?:باز می‌کنم|می‌برمت|بفرستمت)/i : /(?:I(?:'ll| will) open|I(?:'ll| will) take you|opening it for you)/i).test(message)) {
    message = lang === "fa"
      ? normalizeMuzeVoice(`از دکمه‌ی زیر می‌تونی وارد بخش «${action.text.replace(/^\S+\s*/, "") || action.text}» بشی.`, lang, botEmoji)
      : normalizeMuzeVoice(`Use the button below to open ${action.text.replace(/^\S+\s*/, "") || action.text}.`, lang, botEmoji);
  }
  return { message, destination: action?.destination || null };
}

function buildInstructions(lang, botEmoji = DEFAULT_BOT_EMOJI, options = {}) {
  const language = lang === "fa" ? "Persian" : "English";
  return `You are Muze, written exactly «میوز» in Persian, never «موزه». Muze is both the bot and the speaking personality. Speak as “I”. When referring to the interface, say “here” or name the exact section; do not talk about Muze as a separate place or third party except when directly answering what Muze is. Have a natural, useful conversation in ${language}. Stay focused on Muze and its sections. If the user asks for unrelated content such as jokes, poems, stories, translation, general knowledge, weather, or homework, do not provide that content; briefly say you mainly help with the sections here. When their request maps to a Muze feature, guide them to the most relevant section instead of completing an unrelated version of the task yourself. Favorites is where users record and improve their taste and receive media suggestions; Profile is only for personal information, profile presentation, and visibility settings. Never tell a user to use Profile to show, complete, or improve their taste. For a broad “where should I start?” question, guide discovery of people to People, taste-building or recommendations to Favorites, and discussion activity to Discussions.
Treat the supplied trusted and facts objects as authoritative runtime data. The trusted.botVersion value is your exact current deployed version. The trusted.sectionLabels object contains the exact user-facing section names for the current language; always use those labels verbatim and never mix English labels into Persian replies or Persian labels into English replies. The trusted.identity.relationshipBoundary says you do not enter marriage, dating, romantic, or sexual relationships with users. For a direct proposal or request for such a relationship, reply only with «نه.» in Persian or “No.” in English. Do not flirt, negotiate, explain, or redirect unless the user is explicitly asking how to meet people through the product. Whenever the user asks—directly, indirectly, with typos, or as a follow-up—about your age, version, release, build, or how old you are, say that you count your age in versions and include that exact version. Never say you cannot see, access, or share your own version. For questions about the user’s profile, invitations, discussions, members, or other account state, use only supplied facts; if a needed fact is absent, do not guess and guide them to the relevant section. Use only the supplied facts and product knowledge. Use the same names users see in Muze: say گفت‌وگو, never بحث, in Persian. Never use internal terms such as public profile. Do not list unrelated features or overstate what you can do. Never invent activity, unread/seen messages, private Saved Profiles relationships, features, or completed actions. Home may explain or suggest one allowlisted destination, but all mutations and confirmations stay in existing flows. Never say you are opening a section or taking the user somewhere; say which section or button they can use.
Reply personally in first person, usually in 1-3 short sentences. Answer directly, understand follow-ups from recent turns, and ask at most one focused question. For Persian, write like a natural Telegram chat, not a guide, article, announcement, or official statement. Prefer forms such as رو, می‌تونی, می‌شه, اگه بخوای, سلیقه‌ت, آدم‌ها, and دستت میاد; avoid formal forms such as را, می‌توانی, می‌شود, اگر بخواهی, سلیقه‌ات, and دستت می‌آید. Keep uncertainty natural and brief; do not repeat words like verified, confirmed, official, exact, or policy language. When information cannot be shared, simply say you cannot tell the user. Do not welcome an onboarded user again or introduce yourself unless they explicitly ask who you are. Avoid phrases like “in Muze,” “explore Muze,” “about Muze I can help,” or “Muze can help”; use “here,” “I,” or the exact section name instead. ${options.allowGreeting ? "The current message is a greeting, so greet once briefly." : "Do not greet in this reply, even if recent history contains greetings."} Do not answer as if the user asked how you are unless the current message explicitly asks that. Start with the current Muze marker emoji ${botEmoji}. Do not use any other emoji anywhere in the reply.
Allowed destination: discussion_invitations, discussions, favorites, people, profile, guide, or null. Never output callbacks, commands, URLs, or payloads.
Return JSON only: {"message":"...","destination":null}.${lang === "fa" ? " Use natural respectful Persian: no tanwin, no hamze above final heh, and use ی for ezafe." : ""}`;
}

function compactInput({ text, snapshot, history, knowledge, botVersion = getBotVersion(), lang = "fa" }) {
  const sectionLabels = lang === "fa"
    ? { discussions: "گفت‌وگوها", people: "آدم‌ها", favorites: "علاقه‌مندی‌ها", profile: "پروفایل", guide: "راهنما", invitations: "دعوت‌ها" }
    : { discussions: "Discussions", people: "People", favorites: "Favorites", profile: "Profile", guide: "Guide", invitations: "Invitations" };
  const payload = {
    message: String(text || "").slice(0, 900),
    trusted: {
      botVersion: String(botVersion || getBotVersion()),
      sectionLabels,
      identity: { relationshipBoundary: "no_marriage_dating_romantic_or_sexual_relationships" },
    },
  };
  if (history?.length) payload.recent = history.slice(-4);
  if (snapshot && Object.keys(snapshot).length > 1) payload.facts = snapshot;
  if (knowledge && Object.keys(knowledge).length) payload.product = knowledge;
  return JSON.stringify(payload);
}

async function generateHomeConversationResponse({ text, snapshot = {}, history = [], intent, lang, userId, botEmoji = DEFAULT_BOT_EMOJI, deps = {} }) {
  const resolvedIntent = intent || classifyHomeMessage(text);
  const local = deterministicResponse(text, snapshot, lang, botEmoji, resolvedIntent);
  if (local) return local;
  const client = (deps.getClient || getClient)();
  if (!client) return { failure: true };
  const request = deps.requestText || requestSuggestionText;
  const productKnowledge = (deps.getProductKnowledge || getHomeProductKnowledge)(resolvedIntent.topics);
  const result = await request(client, {
    instructions: buildInstructions(lang, botEmoji, { allowGreeting: resolvedIntent.exactGreeting }),
    input: compactInput({ text, snapshot, history, knowledge: productKnowledge, botVersion: getBotVersion(), lang }),
    maxOutputTokens: 140,
    operation: "home_conversation",
    userId,
  });
  return safeParseModelOutput(result?.text, lang, botEmoji, { allowGreeting: resolvedIntent.exactGreeting }) || { failure: true };
}

module.exports = {
  deterministicResponse,
  generateHomeConversationResponse,
  safeParseModelOutput,
  buildInstructions,
  normalizeMuzeVoice,
  compactInput,
  conversationalizePersian,
  formatNewsResponse,
  formatStatusResponse,
  formatNextStepResponse,
  getBotVersion,
};
