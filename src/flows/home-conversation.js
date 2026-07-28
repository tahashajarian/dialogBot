const messages = require("../messages");
const { MODES } = require("../services/reply-keyboard-navigation");
const { buildVerifiedHomeSnapshot } = require("../services/home-context");
const { generateHomeConversationResponse } = require("../services/home-conversation");
const { getHomeConversationHistory, rememberHomeConversationTurn, clearHomeConversationHistory } = require("../services/home-conversation-memory");
const { buildHomeResponseMarkup } = require("../services/home-ui");
const { startHomeThinking } = require("../services/home-thinking");
const { EVENT_NAMES, trackEvent } = require("../services/analytics-events");
const { botAppearance } = require("../services/bot-appearance");
const { classifyHomeMessage, isLikelyProductFollowup } = require("../services/home-intent");
const { routeHomeMessage } = require("../services/home-router");
const { createSlidingWindowRateLimiter } = require("../services/update-rate-limit");

const homeMessageRateLimit = createSlidingWindowRateLimiter({ limit: 2, windowMs: 2000 });
const homeConversationsInFlight = new Set();

function isEligibleHomeConversation(ctx, text, state) {
  return Boolean(
    text && !text.startsWith("/") &&
    ctx.user && !ctx.user.bannedAt &&
    (ctx.user.onboardingCompletedAt || ctx.user.onboardingSkippedAt) &&
    state === "idle" &&
    ctx.user.navigationMode === MODES.GLOBAL &&
    !ctx.user.activeDiscussionId
  );
}

function emit(track, event) {
  try {
    void Promise.resolve(track(event)).catch(() => null);
  } catch {}
}

async function handleHomeConversation(ctx, lang, text, deps = {}) {
  if (!isEligibleHomeConversation(ctx, text, ctx.user?.state || "idle")) return false;
  const userKey = String(ctx.userId || "");
  const limiter = deps.homeRateLimit || homeMessageRateLimit;
  if (userKey && (!(limiter.check(userKey).allowed) || homeConversationsInFlight.has(userKey))) return true;
  if (userKey) homeConversationsInFlight.add(userKey);
  const track = deps.trackEvent || trackEvent;
  emit(track, { name: EVENT_NAMES.homeConversationStarted, userId: ctx.userId, source: "home" });
  const getHistory = deps.getHistory || getHomeConversationHistory;
  const existingHistory = getHistory(ctx.userId);
  let intent = (deps.classifyMessage || classifyHomeMessage)(text);
  let route = (deps.routeMessage || routeHomeMessage)(text, intent);
  intent = route.intent;
  if (intent.outOfScope && (deps.isProductFollowup || isLikelyProductFollowup)(text, existingHistory)) {
    intent = Object.freeze({ ...intent, outOfScope: false, productRelated: true, casual: false });
    route = Object.freeze({ kind: "product_conversation", intent });
  }
  const recentAssistantText = existingHistory.filter((turn) => turn.role === "assistant").map((turn) => turn.text).join(" ");
  const discussionContext = /گفت(?:‌?وگو|گو)|discussion/i.test(recentAssistantText);
  const explicitPeopleContext = route.section === "people" || intent.productHelpSection === "people" || /(?:بخش\s*(?:آدم(?:‌?ها)?|افراد)|(?:آدم|افراد)\s*جدید|دیدن\s*آدم(?:‌?ها)?|people\s*section|new\s*people|see\s*people)/i.test(String(text || ""));
  const discussionMembersFollowup = !explicitPeopleContext && !["feedback", "product_help"].includes(route.kind) && discussionContext && /(?:آدم|کسی|عضو|نفر|شلوغ|خلوت|توشون|داخلشون|people|member|crowded|anyone)/i.test(String(text || ""));
  if (discussionMembersFollowup) {
    intent = Object.freeze({
      ...intent,
      outOfScope: false,
      productRelated: true,
      casual: false,
      discussionStatus: true,
      discussionMembersFollowup: true,
      topics: ["discussions"],
      snapshot: Object.freeze({ ...intent.snapshot, activeDiscussion: true, ownedDiscussions: true, identity: true }),
    });
  }
  const stopThinking = (deps.startThinking || startHomeThinking)(ctx, deps.thinkingDeps);
  try {
    if (intent.personalDistress || intent.immediateSafety || intent.outOfScope) {
      (deps.clearHistory || clearHomeConversationHistory)(ctx.userId);
    }
    if (intent.news || intent.status || intent.nextStep || intent.exactInvitation || intent.discussionStatus) {
      emit(track, {
        name: EVENT_NAMES.homeStatusAsked,
        userId: ctx.userId,
        source: "home",
        metadata: { mode: intent.news ? "news" : intent.nextStep ? "next_step" : intent.exactInvitation ? "invitations" : "status" },
      });
    }

    let snapshot = { language: lang };
    const needsSnapshot = !intent.personalDistress && !intent.immediateSafety && !intent.outOfScope &&
      Object.entries(intent.snapshot || {}).some(([key, value]) => key !== "identity" && Boolean(value));
    if (needsSnapshot) {
      try {
        snapshot = await (deps.buildSnapshot || buildVerifiedHomeSnapshot)(ctx, lang, intent.snapshot);
      } catch {
        emit(track, { name: EVENT_NAMES.homeConversationFailed, userId: ctx.userId, source: "home", metadata: { reason: "snapshot" } });
        await ctx.reply(messages[lang].homeConversationStatusFailure);
        return true;
      }
    }

    const currentBotEmoji = deps.botEmoji || botAppearance.botEmoji;
    let response;
    try {
      response = await (deps.generateResponse || generateHomeConversationResponse)({
        text,
        snapshot,
        history: existingHistory,
        intent,
        lang,
        userId: ctx.userId,
        botEmoji: currentBotEmoji,
      });
    } catch {
      emit(track, { name: EVENT_NAMES.homeConversationFailed, userId: ctx.userId, source: "home", metadata: { reason: "generation_exception" } });
      await ctx.reply(messages[lang].homeConversationAiFailure);
      return true;
    }

    if (!response || response.failure) {
      emit(track, { name: EVENT_NAMES.homeConversationFailed, userId: ctx.userId, source: "home", metadata: { reason: "generation_failure" } });
      await ctx.reply(messages[lang].homeConversationAiFailure);
      return true;
    }
    if (response.destination) {
      emit(track, {
        name: EVENT_NAMES.homeDestinationOffered,
        userId: ctx.userId,
        source: "home",
        metadata: { destination: response.destination },
      });
    }
    if (!intent.personalDistress && !intent.immediateSafety && !intent.outOfScope &&
        !intent.exactGreeting && !intent.thanks && !intent.socialCheckIn && !intent.reaction && !intent.feedback) {
      (deps.rememberTurn || rememberHomeConversationTurn)(ctx.userId, text, response.message);
    }
    await ctx.reply(response.message, buildHomeResponseMarkup(response.destination, lang));
    return true;
  } finally {
    stopThinking();
    if (userKey) homeConversationsInFlight.delete(userKey);
  }
}

module.exports = { handleHomeConversation, isEligibleHomeConversation };
