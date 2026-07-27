const { getClient, requestSuggestionText } = require("./ai-client");
const { resolveHomeDestination } = require("./home-actions");
const { DEFAULT_BOT_EMOJI } = require("./bot-appearance");
const { getHomeProductKnowledge } = require("./home-product-knowledge");
const { classifyHomeMessage } = require("./home-intent");

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
  if (intent.exactGreeting) {
    return {
      message: lang === "fa"
        ? `${botEmoji} سلام! چطور می‌تونم کمکت کنم؟`
        : `${botEmoji} Hi! How can I help?`,
      destination: null,
    };
  }
  if (intent.reaction) {
    return {
      message: lang === "fa" ? `${botEmoji} چی شد؟` : `${botEmoji} What happened?`,
      destination: null,
    };
  }
  if (intent.age) return {
    message: lang === "fa"
      ? `${botEmoji} سنم رو با نسخه‌ها حساب می‌کنم، نه با شمع‌های تولد.`
      : `${botEmoji} I count my age in versions, not birthday candles.`,
    destination: null,
  };
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
      ? `${botEmoji} اینجا می‌تونی سلیقه‌ت رو بسازی، آدم‌ها رو ببینی و وارد گفت‌وگوها بشی. هر سؤالی درباره‌ی میوز داشتی، کمکت می‌کنم.`
      : `${botEmoji} Here you can build your taste, see people, and join Discussions. I can help whenever you have a question about Muze.`,
    destination: null,
  };
  if (intent.news) return formatNewsResponse(snapshot, lang, botEmoji);
  if (intent.nextStep) return formatNextStepResponse(snapshot, lang, botEmoji);
  if (intent.status) return formatStatusResponse(snapshot, lang, botEmoji);
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
  return `You are Muze, written exactly «میوز» in Persian, never «موزه». Have a natural, useful conversation in ${language}.
Use only the supplied facts and product knowledge. Use the same names users see in Muze: say گفت‌وگو, never بحث, in Persian. Never use internal terms such as public profile. Do not list unrelated features or overstate what you can do. Never invent activity, unread/seen messages, private Saved Profiles relationships, features, or completed actions. Home may explain or suggest one allowlisted destination, but all mutations and confirmations stay in existing flows. Never say you are opening a section or taking the user somewhere; say which section or button they can use.
Reply personally in first person, usually in 1-3 short sentences. Answer directly, understand follow-ups from recent turns, and ask at most one focused question. For Persian, write like a natural Telegram chat, not a guide, article, announcement, or official statement. Prefer forms such as رو, می‌تونی, می‌شه, اگه بخوای, سلیقه‌ت, آدم‌ها, and دستت میاد; avoid formal forms such as را, می‌توانی, می‌شود, اگر بخواهی, سلیقه‌ات, and دستت می‌آید. Keep uncertainty natural and brief; do not repeat words like verified, confirmed, official, exact, or policy language. When information cannot be shared, simply say you cannot tell the user. Do not welcome an onboarded user again or introduce yourself unless they explicitly ask who you are. ${options.allowGreeting ? "The current message is a greeting, so greet once briefly." : "Do not greet in this reply, even if recent history contains greetings."} Do not answer as if the user asked how you are unless the current message explicitly asks that. Start with the current Muze marker emoji ${botEmoji}. Do not use any other emoji anywhere in the reply.
Allowed destination: discussion_invitations, discussions, favorites, people, profile, guide, or null. Never output callbacks, commands, URLs, or payloads.
Return JSON only: {"message":"...","destination":null}.${lang === "fa" ? " Use natural respectful Persian: no tanwin, no hamze above final heh, and use ی for ezafe." : ""}`;
}

function compactInput({ text, snapshot, history, knowledge }) {
  const payload = { message: String(text || "").slice(0, 900) };
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
    input: compactInput({ text, snapshot, history, knowledge: productKnowledge }),
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
};
