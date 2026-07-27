const messages = require("../messages");
const { MODES } = require("../services/reply-keyboard-navigation");
const { buildVerifiedHomeSnapshot } = require("../services/home-context");
const { generateHomeConversationResponse } = require("../services/home-conversation");
const { getHomeConversationHistory, rememberHomeConversationTurn } = require("../services/home-conversation-memory");
const { buildHomeResponseMarkup } = require("../services/home-ui");
const { startHomeThinking } = require("../services/home-thinking");
const { EVENT_NAMES, trackEvent } = require("../services/analytics-events");
const { botAppearance } = require("../services/bot-appearance");
const { classifyHomeMessage } = require("../services/home-intent");

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
  const track = deps.trackEvent || trackEvent;
  emit(track, { name: EVENT_NAMES.homeConversationStarted, userId: ctx.userId, source: "home" });
  const stopThinking = (deps.startThinking || startHomeThinking)(ctx, deps.thinkingDeps);
  try {
    const intent = (deps.classifyMessage || classifyHomeMessage)(text);
    if (intent.news || intent.status || intent.nextStep || intent.exactInvitation || intent.discussionStatus) {
      emit(track, {
        name: EVENT_NAMES.homeStatusAsked,
        userId: ctx.userId,
        source: "home",
        metadata: { mode: intent.news ? "news" : intent.nextStep ? "next_step" : intent.exactInvitation ? "invitations" : "status" },
      });
    }

    let snapshot;
    try {
      snapshot = await (deps.buildSnapshot || buildVerifiedHomeSnapshot)(ctx, lang, intent.snapshot);
    } catch {
      emit(track, { name: EVENT_NAMES.homeConversationFailed, userId: ctx.userId, source: "home", metadata: { reason: "snapshot" } });
      await ctx.reply(messages[lang].homeConversationStatusFailure);
      return true;
    }

    const currentBotEmoji = deps.botEmoji || botAppearance.botEmoji;
    const getHistory = deps.getHistory || getHomeConversationHistory;
    let response;
    try {
      response = await (deps.generateResponse || generateHomeConversationResponse)({
        text,
        snapshot,
        history: getHistory(ctx.userId),
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
    (deps.rememberTurn || rememberHomeConversationTurn)(ctx.userId, text, response.message);
    await ctx.reply(response.message, buildHomeResponseMarkup(response.destination, lang));
    return true;
  } finally {
    stopThinking();
  }
}

module.exports = { handleHomeConversation, isEligibleHomeConversation };
