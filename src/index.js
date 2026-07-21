require("dotenv").config();

const { clearInterval, setInterval } = require("timers");
const createHttpsProxyAgent = require("https-proxy-agent");
const { Telegraf } = require("telegraf");
const connectDB = require("./db");
const { disconnectDB } = require("./db");
const { handleUpdate } = require("./bot");
const { getOrCreateUser, normalizePlatformUserSource } = require("./services/users");
const { claimAccountRestart } = require("./services/account-deletion");
const { beginInteraction } = require("./services/interaction-guard");
const { createAppContext } = require("./services/app-context");
const { getRuntimeConfig, normalizeUsername } = require("./config");
const { seedBotDiscussions } = require("./services/discussion-starters");
const { logger } = require("./services/logger");
const { recordBotHeartbeat, recordUpdatePerformanceEvent } = require("./services/operational-health");
const { refreshOperationalLimits } = require("./services/operational-limits");
const { refreshStarSettings } = require("./services/star-settings");
const { removeLegacyOwnerBoostIndex } = require("./services/discussion-boosts");
const { formatBotExtra, formatBotText, refreshBotAppearance } = require("./services/bot-appearance");
const { localizeOutgoingExtra, localizeVisibleDigits } = require("./services/number-localization");
const { flushDueOwnerJoinNoticeSummaries } = require("./services/discussion-owner-join-notifications");
const { buildUpdateErrorLogDetails } = require("./services/update-error-log");
const { normalizeCallbackRouteLabel } = require("./services/callback-contracts");
const {
  createRuntimeMetricsMonitor,
  createStageTimings,
  estimateDocumentBytes,
} = require("./services/performance-metrics");
const messages = require("./messages");
const User = require("./models/user");

const config = getRuntimeConfig();
const ALLOWED_USERNAMES = config.allowedUsernames;
const SLOW_UPDATE_MS = 1500;
const OWNER_JOIN_SUMMARY_INTERVAL_MS = 60 * 1000;
const BACKGROUND_SEND_TIMEOUT_MS = 2500;

function normalizeCallbackRoute(data = "") {
  return normalizeCallbackRouteLabel(data);
}

function getUpdateRouteLabel(ctx, user, rawText = "") {
  const callbackData = ctx.callbackQuery?.data;
  if (callbackData) return normalizeCallbackRoute(callbackData);

  const text = String(rawText || "").trim();
  const state = String(user?.state || "idle");
  if (text.startsWith("/start")) return text === "/start" ? "text:/start" : "text:/start_payload";
  if (/^\/(?:d|join|leave|close|boost|remove|report|save|unsave|rm|discussions|ds|u|invite|iv|accept_inv|remove_inv)_/i.test(text)) {
    return `text:${text.split("_")[0].toLowerCase()}`;
  }
  if (state !== "idle") return `text:state:${state.split(":")[0]}`;
  if (user?.activeDiscussionId && ctx.message?.voice) return "text:active_discussion_voice";
  if (user?.activeDiscussionId && text && !text.startsWith("/")) return "text:active_discussion_message";
  if (text === "/cancel") return "text:/cancel";
  return text.startsWith("/") ? "text:command" : "text:fallback";
}

function buildTelegramOptions(config) {
  const telegram = {};
  if (config.botApiRoot) {
    telegram.apiRoot = config.botApiRoot;
  }
  if (config.telegramProxyUrl) {
    telegram.agent = createHttpsProxyAgent(config.telegramProxyUrl);
  }
  return Object.keys(telegram).length ? { telegram } : undefined;
}

function isAllowedUser(from) {
  if (ALLOWED_USERNAMES.size === 0) return true;
  return ALLOWED_USERNAMES.has(normalizeUsername(from?.username || from?.user_name || from?.userName));
}

function resolveUpdateUserSource(ctx) {
  const candidates = [
    ctx.from,
    ctx.message?.from,
    ctx.message?.sender,
    ctx.update?.message?.from,
    ctx.update?.message?.sender,
    ctx.callbackQuery?.from,
    ctx.update?.callback_query?.from,
    ctx.update?.callbackQuery?.from,
    ctx.chat,
    ctx.message?.chat,
    ctx.update?.message?.chat,
  ];
  return candidates.find((candidate) => normalizePlatformUserSource(candidate)) || null;
}

const bot = new Telegraf(
  config.botToken,
  buildTelegramOptions(config),
);

async function sendBackgroundMessage(userId, text, extra = {}, lang = "fa") {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timeout = setTimeout(() => controller?.abort(), BACKGROUND_SEND_TIMEOUT_MS);
  try {
    return await bot.telegram.callApi("sendMessage", {
      chat_id: Number(userId),
      text: localizeVisibleDigits(formatBotText(text), lang),
      ...localizeOutgoingExtra(formatBotExtra(extra), lang),
    }, controller ? { signal: controller.signal } : undefined);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

bot.catch((err) => {
  logger.error("Bot update error", err);
});

async function processUpdate(ctx) {
  const startedAt = Date.now();
  const stageTimings = createStageTimings();
  const apiMetrics = {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    slowestMethod: "",
  };
  const from = resolveUpdateUserSource(ctx);
  let user = null;
  try {
    try {
      await stageTimings.measure("appearanceRefreshMs", () => refreshBotAppearance());
    } catch (appearanceError) {
      logger.warn("Failed to refresh bot appearance settings; using cached/default values", appearanceError);
    }
    if (!isAllowedUser(from)) {
      const lang = String(from?.language_code || from?.languageCode || "").toLowerCase().startsWith("en") ? "en" : "fa";
      const text = formatBotText(messages[lang].betaAccessOnly);
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(text).catch(() => {});
      }
      await ctx.reply(text).catch(() => {});
      return;
    }

    const normalizedSource = normalizePlatformUserSource(from);
    const rawText = String(ctx.message?.text || "").trim();
    let existingUser = normalizedSource
      ? await stageTimings.measure("userExistenceLookupMs", () => User.findOne({ userId: normalizedSource.id }))
      : null;
    const isStartAgain = rawText === messages.fa.accountStartAgainButton
      || rawText === messages.en.accountStartAgainButton;
    const canCreateAccount = /^\/start(?:@\w+)?(?:$|[\s?=])/i.test(rawText) || isStartAgain;
    const restartClaim = !existingUser && canCreateAccount && normalizedSource
      ? await claimAccountRestart(normalizedSource.id)
      : null;
    if (restartClaim) {
      await User.deleteOne({ userId: normalizedSource.id });
      existingUser = null;
    }
    if (!existingUser && !canCreateAccount) {
      const lang = String(from?.language_code || from?.languageCode || "").toLowerCase().startsWith("en") ? "en" : "fa";
      await ctx.reply(messages[lang].accountNoActiveAccount, {
        reply_markup: { keyboard: [[{ text: messages[lang].accountStartAgainButton }]], resize_keyboard: true },
      });
      return;
    }
    user = existingUser || await stageTimings.measure("userLookupMs", () => getOrCreateUser(from));
    if (user?.bannedAt) {
      const lang = messages[user.lang] ? user.lang : "fa";
      const text = formatBotText(messages[lang].userBannedAccessDenied);
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(text, { show_alert: true }).catch(() => {});
      }
      await ctx.reply(text, { reply_markup: { remove_keyboard: true, selective: false } }).catch(() => {});
      return;
    }

    const appCtx = createAppContext(ctx, user, {
      wasUserCreated: !existingUser,
      canRestartAfterDeletion: Boolean(restartClaim),
      apiMetrics,
    });
    const updateRoute = getUpdateRouteLabel(ctx, user, rawText);
    const interaction = beginInteraction({
      userId: user?.userId || normalizePlatformUserSource(from)?.id,
      callbackData: appCtx.callbackData,
      text: appCtx.text,
      state: user?.state || "idle",
    });

    if (!interaction.allowed) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
      }
      return;
    }

    try {
      const result = await stageTimings.measure("handlerMs", () => handleUpdate(appCtx));
      const durationMs = Date.now() - startedAt;
      if (durationMs >= SLOW_UPDATE_MS) {
        const performanceMetadata = {
          telegramApiCalls: apiMetrics.count,
          telegramApiTotalMs: apiMetrics.totalMs,
          telegramApiMaxMs: apiMetrics.maxMs,
          userDocumentBytes: estimateDocumentBytes(user),
          stages: stageTimings.snapshot(),
        };
        logger.warn("Slow update processed", {
          durationMs,
          hasCallback: Boolean(ctx.callbackQuery),
          hasMessage: Boolean(ctx.message),
          state: user?.state || "idle",
          route: updateRoute,
          telegramApiCalls: apiMetrics.count,
          telegramApiTotalMs: apiMetrics.totalMs,
          telegramApiMaxMs: apiMetrics.maxMs,
          telegramApiSlowestMethod: apiMetrics.slowestMethod,
          userDocumentBytes: performanceMetadata.userDocumentBytes,
          stages: performanceMetadata.stages,
        });
        void recordUpdatePerformanceEvent({
          route: updateRoute,
          durationMs,
          metadata: performanceMetadata,
        });
      }
      return result;
    } finally {
      interaction.finish();
    }
  } catch (error) {
    logger.error("Update processing failed", buildUpdateErrorLogDetails({
      ctx,
      user,
      durationMs: Date.now() - startedAt,
      stages: stageTimings.snapshot(),
      error,
    }));
    throw error;
  }
}

bot.on("message", processUpdate);
bot.on("callback_query", processUpdate);

let pollingStarted = false;
let shuttingDown = false;
let heartbeatTimer = null;
let ownerJoinSummaryTimer = null;
let ownerJoinSummaryRunning = false;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const runtimeMetrics = createRuntimeMetricsMonitor({ intervalMs: HEARTBEAT_INTERVAL_MS });

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Stopping application", { reason });

  if (pollingStarted) {
    try {
      bot.stop(reason);
    } catch (error) {
      logger.warn("Failed to stop bot polling", error);
    }
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (ownerJoinSummaryTimer) {
    clearInterval(ownerJoinSummaryTimer);
    ownerJoinSummaryTimer = null;
  }

  try {
    await disconnectDB();
  } catch (error) {
    logger.error("Failed to disconnect database", error);
    exitCode = 1;
  }

  process.exitCode = exitCode;
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(fn, {
  attempts = 4,
  delayMs = 1500,
  onRetry = () => {},
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      onRetry(error, attempt, attempts);
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

(async () => {
  try {
    logger.info("Connecting database");
    await connectDB(config);
    const removedLegacyBoostIndex = await removeLegacyOwnerBoostIndex();
    if (removedLegacyBoostIndex) {
      logger.info("Removed legacy one-boost-per-owner database index");
    }
    try {
      await refreshOperationalLimits({ force: true });
    } catch (limitsError) {
      logger.warn("Failed to load operational limits; using defaults", limitsError);
    }
    try {
      await refreshStarSettings({ force: true });
    } catch (starSettingsError) {
      logger.warn("Failed to load Star economy settings; using defaults", starSettingsError);
    }
    try {
      await refreshBotAppearance({ force: true });
    } catch (appearanceError) {
      logger.warn("Failed to load bot appearance settings; using defaults", appearanceError);
    }
    logger.info("Checking bot token/API via getMe");
    const botInfo = await retry(
      () => bot.telegram.getMe(),
      {
        attempts: 5,
        delayMs: 2000,
        onRetry: (error, attempt, attempts) => {
          logger.warn("getMe failed; retrying", {
            attempt,
            maxRetries: attempts - 1,
            error,
          });
        },
      },
    );
    logger.info("getMe successful");
    try {
      const seeded = await seedBotDiscussions(botInfo?.id);
      logger.info("Bot discussions ready", { count: seeded.discussions?.length || 0 });
    } catch (seedError) {
      logger.warn("Failed to seed bot discussions; continuing without them", seedError);
    }

    try {
      logger.info("Deleting webhook for polling mode");
      await bot.telegram.deleteWebhook();
    } catch (deleteWebhookError) {
      logger.warn("deleteWebhook failed; continuing with polling mode", deleteWebhookError);
    }

    const pollingLoop = bot.startPolling();
    pollingStarted = true;
    void recordBotHeartbeat({ botId: botInfo?.id, ...runtimeMetrics.snapshot() });
    heartbeatTimer = setInterval(() => {
      runtimeMetrics.sample(HEARTBEAT_INTERVAL_MS);
      void recordBotHeartbeat({ botId: botInfo?.id, ...runtimeMetrics.snapshot() });
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
    const flushOwnerJoinSummaries = async () => {
      if (ownerJoinSummaryRunning) return;
      ownerJoinSummaryRunning = true;
      try {
        await flushDueOwnerJoinNoticeSummaries({
          sendToUser: sendBackgroundMessage,
          messages,
        });
      } catch (error) {
        logger.warn("Failed to flush due discussion owner join summaries", error);
      } finally {
        ownerJoinSummaryRunning = false;
      }
    };
    void flushOwnerJoinSummaries();
    ownerJoinSummaryTimer = setInterval(flushOwnerJoinSummaries, OWNER_JOIN_SUMMARY_INTERVAL_MS);
    ownerJoinSummaryTimer.unref?.();
    logger.info("Bot started in polling mode");

    pollingLoop.catch(async (pollingError) => {
      logger.error("Polling stopped with error", pollingError);
      await shutdown("polling_error", 1);
    });
  } catch (error) {
    logger.error("Bot startup failed", error);
    await shutdown("startup_error", 1);
  }
})();
