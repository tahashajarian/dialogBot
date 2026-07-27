const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const { isEligibleHomeConversation, handleHomeConversation } = require("../src/flows/home-conversation");
const { buildVerifiedHomeSnapshot } = require("../src/services/home-context");
const { deterministicResponse, safeParseModelOutput, generateHomeConversationResponse, buildInstructions } = require("../src/services/home-conversation");
const { resolveHomeDestination } = require("../src/services/home-actions");
const { isKnownReplyKeyboardLabel } = require("../src/services/reply-keyboard-navigation");

function user(overrides = {}) {
  return { state: "idle", navigationMode: "global", onboardingCompletedAt: new Date(), activeDiscussionId: null, ...overrides };
}

test("Home conversation eligibility is durable Home only", () => {
  assert.equal(isEligibleHomeConversation({ user: user() }, "hello", "idle"), true);
  assert.equal(isEligibleHomeConversation({ user: user({ navigationMode: "favorites" }) }, "hello", "idle"), false);
  assert.equal(isEligibleHomeConversation({ user: user({ state: "editing_bio" }) }, "hello", "editing_bio"), false);
  assert.equal(isEligibleHomeConversation({ user: user({ activeDiscussionId: "x" }) }, "hello", "idle"), false);
  assert.equal(isEligibleHomeConversation({ user: user({ onboardingCompletedAt: null }) }, "hello", "idle"), false);
  assert.equal(isEligibleHomeConversation({ user: user() }, "/start", "idle"), false);
});

test("stale localized keyboard labels are recognized and never need AI", () => {
  assert.equal(isKnownReplyKeyboardLabel(messages.fa.people), true);
  assert.equal(isKnownReplyKeyboardLabel(messages.en.discussionInvitations), true);
  assert.equal(isKnownReplyKeyboardLabel("an ordinary sentence"), false);
});

test("verified snapshot contains compact facts and tolerates partial failures", async () => {
  const snapshot = await buildVerifiedHomeSnapshot({
    userId: 7,
    user: { profileName: "T", interests: ["Cinema"], aiLists: { movies: { topTen: [{ title: "A", secret: "x" }] } }, activeDiscussionId: "d1" },
  }, "en", {
    countInvitations: async () => { throw new Error("db"); },
    findDiscussion: async () => ({ status: "open", title: "Room", lastActivityAt: new Date("2026-01-01") }),
  });
  assert.equal(snapshot.invitationCount, null);
  assert.equal(snapshot.sources.invitations, "unavailable");
  assert.equal(snapshot.activeDiscussion.present, true);
  assert.equal(snapshot.favorites.movies, 1);
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
});

test("deterministic status answers are truthful and never claim unread", () => {
  const fa = deterministicResponse("دعوتی دارم؟", { invitationCount: 0 }, "fa");
  assert.match(fa.message, /فعلا دعوتی نداری/);
  assert.doesNotMatch(fa.message, /خوانده/);
  const en = deterministicResponse("Do I have invitations?", { invitationCount: 2 }, "en");
  assert.match(en.message, /2 invitations/);
  assert.doesNotMatch(en.message, /unread/i);
});

test("model output rejects privacy leaks, unread claims, and callback injection", () => {
  assert.equal(safeParseModelOutput('{"message":"You have 3 unread messages","destination":"discussions"}', "en"), null);
  assert.equal(safeParseModelOutput('{"message":"Someone saved you","destination":"people"}', "en"), null);
  const parsed = safeParseModelOutput('{"message":"I can help.","destination":"menu:main;delete_all"}', "en");
  assert.deepEqual(parsed, { message: "👩‍🦳 I can help.", destination: null });
});

test("destination mapping is application-owned and allowlisted", () => {
  assert.equal(resolveHomeDestination("discussion_invitations", "en").callback_data, callBacks.discussionInvitations);
  assert.equal(resolveHomeDestination("profile", "fa").callback_data, callBacks.profile);
  assert.equal(resolveHomeDestination("../../admin", "en"), null);
});

test("provider and snapshot failures preserve localized low-noise behavior", async () => {
  const replies = [];
  const ctx = { userId: 1, user: user(), reply: async (...args) => { replies.push(args); } };
  assert.equal(await handleHomeConversation(ctx, "en", "hello", {
    buildSnapshot: async () => ({ invitationCount: 0, favorites: {}, sources: {}, activeDiscussion: { present: false } }),
    generateResponse: async () => ({ failure: true }),
    trackEvent: async () => null,
  }), true);
  assert.equal(replies[0][0], messages.en.homeConversationAiFailure);

  replies.length = 0;
  await handleHomeConversation(ctx, "fa", "یه سوال درباره میوز دارم", {
    buildSnapshot: async () => { throw new Error("db"); },
    trackEvent: async () => null,
  });
  assert.equal(replies[0][0], messages.fa.homeConversationStatusFailure);
});

test("Home copy has Persian and English conversation parity", () => {
  assert.match(messages.fa.mainMenu, /همین‌جا با من حرف بزن/);
  assert.match(messages.en.mainMenu, /talk to me here/);
  assert.doesNotMatch(messages.fa.mainMenu, /[ًٌٍ]/u);
});

const {
  getHomeConversationHistory,
  rememberHomeConversationTurn,
  clearHomeConversationHistory,
  sweepExpired,
  MAX_USER_ENTRIES,
  TTL_MS,
} = require("../src/services/home-conversation-memory");
const {
  shouldGuideToBottomButtons,
  handleUnrecognizedSectionText,
} = require("../src/flows/unrecognized-section-text");

test("ordinary Home conversation reaches AI with recent ephemeral context", async () => {
  clearHomeConversationHistory(91);
  rememberHomeConversationTurn(91, "hello", "Hi, how are you?");
  let received;
  const replies = [];
  const ctx = { userId: 91, user: user(), reply: async (...args) => replies.push(args) };
  await handleHomeConversation(ctx, "en", "I meant the movie we discussed", {
    buildSnapshot: async () => ({ invitationCount: 0, favorites: {}, sources: {}, activeDiscussion: { present: false } }),
    generateResponse: async (input) => { received = input; return { message: "Yes, I remember the context.", destination: null }; },
    trackEvent: async () => null,
  });
  assert.deepEqual(received.history, [
    { role: "user", text: "hello" },
    { role: "assistant", text: "Hi, how are you?" },
  ]);
  assert.equal(getHomeConversationHistory(91).at(-1).text, "Yes, I remember the context.");
  assert.equal(replies[0][0], "Yes, I remember the context.");
});


test("exact greetings are brief and do not reintroduce or welcome", () => {
  const fa = deterministicResponse("سلام", { language: "fa" }, "fa", "🐾");
  const en = deterministicResponse("Hello!", { language: "en" }, "en", "🐾");
  assert.deepEqual(fa, { message: "🐾 سلام! چطور می‌تونم کمکت کنم؟", destination: null });
  assert.deepEqual(en, { message: "🐾 Hi! How can I help?", destination: null });
  assert.doesNotMatch(fa.message, /خوش اومدی|من میوزم/);
  assert.doesNotMatch(en.message, /welcome|I(?:'m| am) Muze/i);
  assert.match(buildInstructions("en"), /Do not welcome an onboarded user again/);
});

test("what's new reports only verified news and never Favorites totals", () => {
  const withInvite = deterministicResponse("چه خبر؟", { invitationCount: 2 }, "fa", "🐾");
  assert.match(withInvite.message, /دعوت جدید/);
  assert.equal(withInvite.destination, "discussion_invitations");
  assert.doesNotMatch(withInvite.message, /محبوب|انتخاب/);

  const quiet = deterministicResponse("چه خبر؟", { invitationCount: 0, recentDiscussion: { present: false }, recentPerson: { present: false } }, "fa", "🐾");
  assert.equal(quiet.message, "🐾 فعلا چیز جدیدی نیست، همه‌چی رو به راهه.");
  assert.equal(quiet.destination, null);
  assert.equal(deterministicResponse("سلام، حالت چطوره؟", {}, "fa"), null);
});



test("colloquial Persian news stays deterministic and does not greet", () => {
  const intent = classifyHomeMessage("چه خبرا؟");
  assert.equal(intent.news, true);
  const response = deterministicResponse("چه خبرا؟", { invitationCount: 0, recentDiscussion: { present: false }, recentPerson: { present: false } }, "fa", "🐾", intent);
  assert.equal(response.message, "🐾 فعلا چیز جدیدی نیست، همه‌چی رو به راهه.");
  assert.doesNotMatch(response.message, /سلام|تو چه خبر/);
});

test("generated Home replies keep only Muze marker and remove repeated greetings", () => {
  const parsed = safeParseModelOutput('{"message":"سلام طاها، من خوبم 🙂 تو چه خبر؟","destination":null}', "fa", "🐾", { allowGreeting: false });
  assert.equal(parsed.message, "🐾 من خوبم تو چه خبر؟");
  assert.doesNotMatch(parsed.message, /سلام|🙂/);
  const withExtraEmoji = safeParseModelOutput('{"message":"باشه ✨ کمکت می‌کنم 😄","destination":null}', "fa", "🪩");
  assert.equal(withExtraEmoji.message, "🪩 باشه کمکت می‌کنم");
});

test("unrecognized text in non-Home idle sections points to buttons", async () => {
  assert.equal(shouldGuideToBottomButtons({ user: user({ navigationMode: "people" }) }, "hello", "idle"), true);
  assert.equal(shouldGuideToBottomButtons({ user: user({ navigationMode: "global" }) }, "hello", "idle"), false);
  assert.equal(shouldGuideToBottomButtons({ user: user({ navigationMode: "discussions", activeDiscussionId: "d1" }) }, "hello", "idle"), false);
  assert.equal(shouldGuideToBottomButtons({ user: user({ navigationMode: "profile", state: "editing_bio" }) }, "hello", "editing_bio"), false);

  const replies = [];
  const ctx = { user: user({ navigationMode: "people" }), reply: async (message) => replies.push(message) };
  assert.equal(await handleUnrecognizedSectionText(ctx, "en", "random text", "idle"), true);
  assert.equal(replies[0], messages.en.sectionTextUseBottomButtons);
});

test("section fallback copy is simple in Persian and English", () => {
  assert.equal(messages.en.sectionTextUseBottomButtons, "👩‍🦳 Just use the buttons here.");
  assert.equal(messages.fa.sectionTextUseBottomButtons, "👩‍🦳 اینجا فقط از دکمه‌ها استفاده کن.");
  assert.doesNotMatch(messages.fa.sectionTextUseBottomButtons, /[ًٌٍ]/u);
});


test("Home product knowledge states that People has no direct messages", async () => {
  let requestPayload;
  const result = await generateHomeConversationResponse({
    text: "Can I message people there?",
    snapshot: { invitationCount: 0, favorites: {}, sources: {}, activeDiscussion: { present: false } },
    history: [],
    lang: "en",
    userId: 5,
    deps: {
      getClient: () => ({}),
      requestText: async (_client, payload) => {
        requestPayload = payload;
        return { text: '{"message":"No. People has no direct messages; conversations happen in Discussions.","destination":"discussions"}' };
      },
    },
  });
  const input = JSON.parse(requestPayload.input);
  assert.match(input.product.people.messaging, /no direct messages/);
  assert.equal(input.product.stars, undefined);
  assert.equal(input.product.profile, undefined);
  assert.equal(result.message, "👩‍🦳 No. People has no direct messages; conversations happen in Discussions.");
  assert.equal(result.destination, "discussions");
});

test("Persian Muze name and marker are enforced after model generation", () => {
  const parsed = safeParseModelOutput('{"message":"من موزه هستم و کمکت می‌کنم.","destination":null}', "fa");
  assert.equal(parsed.message, "👩‍🦳 من میوز هستم و کمکت می‌کنم.");
  assert.doesNotMatch(parsed.message, /موزه/);
  assert.match(buildInstructions("fa"), /«میوز»/);
  assert.match(buildInstructions("fa"), /never «موزه»/);
});

test("Home thinking state starts immediately and always stops", async () => {
  const calls = [];
  const replies = [];
  const ctx = { userId: 22, user: user(), reply: async (...args) => replies.push(args) };
  await handleHomeConversation(ctx, "en", "hello", {
    startThinking: () => { calls.push("start"); return () => calls.push("stop"); },
    buildSnapshot: async () => ({ invitationCount: 0, favorites: {}, sources: {}, activeDiscussion: { present: false } }),
    generateResponse: async () => ({ message: "👩‍🦳 Hello.", destination: null }),
    trackEvent: async () => null,
  });
  assert.deepEqual(calls, ["start", "stop"]);
  assert.equal(replies[0][0], "👩‍🦳 Hello.");
});


test("configured dashboard Muze emoji is used in prompt and normalized output", async () => {
  let requestPayload;
  const result = await generateHomeConversationResponse({
    text: "Tell me something useful",
    snapshot: { invitationCount: 0, favorites: {}, sources: {}, activeDiscussion: { present: false } },
    history: [],
    lang: "en",
    userId: 8,
    botEmoji: "🪩",
    deps: {
      getClient: () => ({}),
      requestText: async (_client, payload) => {
        requestPayload = payload;
        return { text: '{"message":"👩‍🦳 Hi there.","destination":null}' };
      },
    },
  });
  assert.match(requestPayload.instructions, /current Muze marker emoji 🪩/);
  assert.equal(result.message, "🪩 Hi there.");
  assert.equal(deterministicResponse("Do I have invitations?", { invitationCount: 0 }, "en", "🪩").message, "🪩 You don’t have any invitations right now.");
});


const { classifyHomeMessage } = require("../src/services/home-intent");
const { getHomeProductKnowledge } = require("../src/services/home-product-knowledge");

test("casual messages avoid database-backed Home snapshot fields", async () => {
  let receivedPlan;
  const ctx = { userId: 33, user: user({ firstName: "Taha" }), reply: async () => null };
  await handleHomeConversation(ctx, "en", "How are you?", {
    buildSnapshot: async (_ctx, _lang, plan) => { receivedPlan = plan; return { language: "en", displayName: "Taha" }; },
    generateResponse: async () => ({ message: "👩‍🦳 I’m good.", destination: null }),
    trackEvent: async () => null,
  });
  assert.deepEqual(receivedPlan, { invitations: false, activeDiscussion: false, favorites: false, news: false, profileGrowth: false, identity: true });
});

test("topic routing loads only relevant concise product blocks", () => {
  const peopleIntent = classifyHomeMessage("Can I send a direct message to people?");
  assert.deepEqual(peopleIntent.topics, ["people"]);
  const knowledge = getHomeProductKnowledge(peopleIntent.topics);
  assert.ok(knowledge.core);
  assert.ok(knowledge.people);
  assert.equal(knowledge.discussions, undefined);
  assert.equal(knowledge.stars, undefined);
});

test("Home generation uses bounded prompt, history, and output budget", async () => {
  let requestPayload;
  await generateHomeConversationResponse({
    text: "Tell me about Stars",
    snapshot: { language: "en", displayName: "T" },
    history: Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `turn-${index}` })),
    lang: "en",
    userId: 44,
    botEmoji: "🪩",
    deps: {
      getClient: () => ({}),
      requestText: async (_client, payload) => { requestPayload = payload; return { text: '{"message":"🪩 Stars use existing rules.","destination":"guide"}' }; },
    },
  });
  const input = JSON.parse(requestPayload.input);
  assert.equal(requestPayload.maxOutputTokens, 140);
  assert.equal(input.recent.length, 4);
  assert.ok(input.product.stars);
  assert.equal(input.product.people, undefined);
  assert.ok(requestPayload.input.length < 2500);
});

test("on-demand snapshot performs no invitation or discussion reads for casual chat", async () => {
  let invitationReads = 0;
  let discussionReads = 0;
  const snapshot = await buildVerifiedHomeSnapshot({
    userId: 1,
    user: user({ firstName: "T", activeDiscussionId: "room" }),
  }, "en", classifyHomeMessage("hello").snapshot, {
    countInvitations: async () => { invitationReads += 1; return 2; },
    findDiscussion: async () => { discussionReads += 1; return { status: "open" }; },
  });
  assert.equal(invitationReads, 0);
  assert.equal(discussionReads, 0);
  assert.deepEqual(snapshot, { language: "en", displayName: "T" });
});


test("about Muze copy is practical and does not mention public profiles", () => {
  const fa = deterministicResponse("میوز چیه؟", {}, "fa", "🐾");
  assert.match(fa.message, /سلیقه‌ت رو بسازی/);
  assert.match(fa.message, /آدم‌ها رو ببینی/);
  assert.doesNotMatch(fa.message, /پروفایل عمومی/);
});


test("age, user statistics, and trends use natural bounded answers", () => {
  const age = deterministicResponse("چند سالته؟", {}, "fa", "🐾");
  assert.equal(age.message, "🐾 سنم رو با نسخه‌ها حساب می‌کنم، نه با شمع‌های تولد.");

  const stats = deterministicResponse("میوز چند تا کاربر داره؟", {}, "fa", "🐾");
  assert.equal(stats.message, "🐾 نمی‌تونم آمار کاربرهای میوز رو بهت بگم.");
  assert.doesNotMatch(stats.message, /تأیید|تایید|در دسترس/);

  const trends = deterministicResponse("الان چی ترنده؟", {}, "fa", "🐾");
  assert.equal(trends.message, "🐾 فعلا نمی‌تونم ترندهای میوز رو بهت بگم.");
});

test("generated Persian uses گفت‌وگو and never claims automatic navigation", () => {
  const parsed = safeParseModelOutput('{"message":"باشه، بحث‌ها رو باز می‌کنم.","destination":"discussions"}', "fa", "🐾");
  assert.equal(parsed.message, "🐾 از دکمه‌ی زیر می‌تونی وارد بخش «گفت‌وگوها» بشی.");
  assert.equal(parsed.destination, "discussions");
  const instructions = buildInstructions("fa", "🐾");
  assert.match(instructions, /never بحث/);
  assert.match(instructions, /Never say you are opening a section/);
  assert.match(instructions, /do not repeat words like verified, confirmed/);
});


test("news snapshot uses unseen invitations while direct status uses all pending", async () => {
  let unseenReads = 0;
  let allReads = 0;
  const ctx = { userId: 17, user: user() };
  const news = await buildVerifiedHomeSnapshot(ctx, "en", classifyHomeMessage("What's new?").snapshot, {
    countUnseenInvitations: async () => { unseenReads += 1; return 1; },
    countAllInvitations: async () => { allReads += 1; return 4; },
  });
  assert.equal(news.invitationCount, 1);
  assert.equal(news.invitationCountKind, "unseen");
  assert.equal(unseenReads, 1);
  assert.equal(allReads, 0);

  const direct = await buildVerifiedHomeSnapshot(ctx, "en", classifyHomeMessage("Do I have any invitations?").snapshot, {
    countUnseenInvitations: async () => { unseenReads += 1; return 1; },
    countAllInvitations: async () => { allReads += 1; return 4; },
  });
  assert.equal(direct.invitationCount, 4);
  assert.equal(direct.invitationCountKind, "pending");
  assert.equal(allReads, 1);
});

test("English invitation variants stay deterministic", () => {
  for (const text of [
    "Do I have an invitation?",
    "Do I have any invitations?",
    "Any invite?",
    "Any invites?",
    "Any invitation?",
    "Any invitations?",
  ]) {
    const intent = classifyHomeMessage(text);
    assert.equal(intent.exactInvitation, true, text);
    assert.match(deterministicResponse(text, { invitationCount: 0 }, "en", "🐾", intent).message, /don’t have any invitations/);
  }
});

test("Home generation exceptions use localized fallback and failure telemetry", async () => {
  const replies = [];
  const events = [];
  const ctx = { userId: 23, user: user(), reply: async (...args) => replies.push(args) };
  await handleHomeConversation(ctx, "en", "Tell me something useful", {
    buildSnapshot: async () => ({ language: "en", displayName: "T" }),
    generateResponse: async () => { throw new Error("provider"); },
    trackEvent: async (event) => events.push(event),
    startThinking: () => () => null,
  });
  assert.equal(replies[0][0], messages.en.homeConversationAiFailure);
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  assert.ok(events.some((event) => event.name === "home_conversation_failed" && event.metadata.reason === "generation_exception"));
});

test("Home telemetry records status questions and offered destinations without prompt text", async () => {
  const events = [];
  const ctx = { userId: 24, user: user(), reply: async () => null };
  await handleHomeConversation(ctx, "en", "Do I have invitations?", {
    buildSnapshot: async () => ({ invitationCount: 2, invitationCountKind: "pending", language: "en" }),
    trackEvent: async (event) => events.push(event),
    startThinking: () => () => null,
  });
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  assert.ok(events.some((event) => event.name === "home_status_asked"));
  assert.ok(events.some((event) => event.name === "home_destination_offered" && event.metadata.destination === "discussion_invitations"));
  assert.equal(JSON.stringify(events).includes("Do I have invitations"), false);
});

test("runtime Home memory expires and enforces a global user cap", () => {
  const base = Date.now();
  rememberHomeConversationTurn("expired", "hello", "hi", base - TTL_MS - 1);
  sweepExpired(base);
  assert.deepEqual(getHomeConversationHistory("expired", base), []);

  for (let index = 0; index < MAX_USER_ENTRIES + 2; index += 1) {
    rememberHomeConversationTurn(`cap-${index}`, "u", "a", base + index);
  }
  assert.deepEqual(getHomeConversationHistory("cap-0", base + MAX_USER_ENTRIES + 2), []);
  assert.ok(getHomeConversationHistory(`cap-${MAX_USER_ENTRIES + 1}`, base + MAX_USER_ENTRIES + 2).length > 0);
});

test("Home hot path uses cached appearance and does not refresh it", async () => {
  let refreshCalls = 0;
  const replies = [];
  const ctx = { userId: 25, user: user(), reply: async (...args) => replies.push(args) };
  await handleHomeConversation(ctx, "en", "Hello", {
    refreshAppearance: async () => { refreshCalls += 1; },
    botEmoji: "🪩",
    buildSnapshot: async () => ({ language: "en" }),
    startThinking: () => () => null,
    trackEvent: async () => null,
  });
  assert.equal(refreshCalls, 0);
  assert.equal(replies[0][0], "🪩 Hi! How can I help?");
});

test("generated Persian is normalized to a consistent conversational tone", () => {
  const parsed = safeParseModelOutput('{"message":"همه چیز را یکجا نمی‌شود یاد گرفت، ولی با دیدن آدم ها، کامل کردن سلیقه ات و شرکت در گفت‌وگوها کم کم دستت می‌آید. اگر بخواهی، از بخش راهنما می‌توانی شروع کنی.","destination":"guide"}', "fa", "🐾");
  assert.equal(parsed.message, "🐾 همه‌چی رو یکجا نمی‌شه یاد گرفت، ولی با دیدن آدم‌ها، کامل کردن سلیقه‌ت و سر زدن به گفت‌وگوها کم‌کم دستت میاد. اگه بخوای، از بخش راهنما می‌تونی شروع کنی.");
  assert.doesNotMatch(parsed.message, /\bرا\b|می‌توانی|می‌شود|اگر بخواهی|سلیقه ات|دستت می‌آید/);
});

test("Persian Home prompt explicitly requires chatty colloquial language", () => {
  const instructions = buildInstructions("fa", "🐾");
  assert.match(instructions, /natural Telegram chat/);
  assert.match(instructions, /avoid formal forms such as را, می‌توانی, می‌شود/);
});
