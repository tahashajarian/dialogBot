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
const {
  recordBotHeartbeat,
  recordCapacityEvent,
  recordUpdatePerformanceEvent,
} = require("./services/operational-health");
const { refreshOperationalLimits } = require("./services/operational-limits");
const { refreshStarSettings } = require("./services/star-settings");
const { removeLegacyOwnerBoostIndex } = require("./services/discussion-boosts");
const { formatBotExtra, formatBotText, refreshBotAppearance } = require("./services/bot-appearance");
const { localizeOutgoingExtra, localizeVisibleDigits } = require("./services/number-localization");
const { flushDueOwnerJoinNoticeSummaries } = require("./services/discussion-owner-join-notifications");
const { buildUpdateErrorLogDetails } = require("./services/update-error-log");
const { normalizeCallbackRouteLabel } = require("./services/callback-contracts");
const {
  isDatabaseReady,
  isTransientDatabaseError,
  retryWithJitter,
  sendTemporaryUnavailableNotice,
  withTimeout,
} = require("./services/runtime-resilience");
const {
  handleChosenInlineListResult,
  handleInlineListQuery,
} = require("./flows/inline-list-capture");
const {
  createRuntimeMetricsMonitor,
  createStageTimings,
  estimateDocumentBytes,
  shouldSampleUpdatePerformance,
} = require("./services/performance-metrics");
const { createPeriodicRefresh } = require("./services/periodic-refresh");
const { createUpdateRateLimits } = require("./services/update-rate-limit");
const { sendRateLimitNotice } = require("./services/rate-limit-notice");
const messages = require("./messages");
const User = require("./models/user");

const config = getRuntimeConfig();
const ALLOWED_USERNAMES = config.allowedUsernames;
const SLOW_UPDATE_MS = 1500;
const OWNER_JOIN_SUMMARY_INTERVAL_MS = 60 * 1000;
const BACKGROUND_SEND_TIMEOUT_MS = 2500;
const HOT_PATH_QUERY_TIMEOUT_MS = 2500;
const SETTINGS_REFRESH_INTERVAL_MS = 60 * 1000;
const updateRateLimits = createUpdateRateLimits();

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
let botInfo = null;
let shuttingDown = false;
let activeUpdateCount = 0;
const activeUpdateWaiters = new Set();

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
    const rateLimit = updateRateLimits.check({
      userId: normalizedSource?.id,
      text: rawText,
    });
    if (!rateLimit.allowed) {
      void recordCapacityEvent({
        resource: rateLimit.reason === "profile_lookup_rate_limit" ? "profile_lookup" : "update",
        reason: "rate_limited",
        state: {},
      });
      await sendRateLimitNotice(ctx, {
        userId: normalizedSource?.id,
        messages,
        formatText: (text, lang) => localizeVisibleDigits(formatBotText(text), lang),
      }).catch(() => {});
      return;
    }
    if (!isDatabaseReady()) {
      await sendTemporaryUnavailableNotice(ctx, {
        messages,
        formatText: (text, lang) => localizeVisibleDigits(formatBotText(text), lang),
      }).catch(() => {});
      return;
    }
    let existingUser = normalizedSource
      ? await stageTimings.measure("userExistenceLookupMs", () => (
        User.findOne({ userId: normalizedSource.id }).maxTimeMS(HOT_PATH_QUERY_TIMEOUT_MS)
      ))
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
      botInfo,
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
      const shouldRecordPerformance = shouldSampleUpdatePerformance(user?.userId, durationMs, SLOW_UPDATE_MS);
      const performanceMetadata = shouldRecordPerformance ? {
        telegramApiCalls: apiMetrics.count,
        telegramApiTotalMs: apiMetrics.totalMs,
        telegramApiMaxMs: apiMetrics.maxMs,
        userDocumentBytes: estimateDocumentBytes(user),
        stages: stageTimings.snapshot(),
        sampleReason: durationMs >= SLOW_UPDATE_MS ? "slow" : "baseline",
      } : null;
      if (durationMs >= SLOW_UPDATE_MS) {
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
      }
      if (shouldRecordPerformance) {
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
    if (isTransientDatabaseError(error) || !isDatabaseReady()) {
      await sendTemporaryUnavailableNotice(ctx, {
        user,
        messages,
        formatText: (text, lang) => localizeVisibleDigits(formatBotText(text), lang),
      }).catch(() => {});
      return;
    }
    throw error;
  }
}

function finishTrackedUpdate() {
  activeUpdateCount = Math.max(0, activeUpdateCount - 1);
  if (activeUpdateCount === 0) {
    for (const resolve of activeUpdateWaiters) resolve();
    activeUpdateWaiters.clear();
  }
}

function waitForActiveUpdates() {
  if (activeUpdateCount === 0) return Promise.resolve();
  return new Promise((resolve) => activeUpdateWaiters.add(resolve));
}

async function trackedProcessUpdate(ctx) {
  if (shuttingDown) {
    await sendTemporaryUnavailableNotice(ctx, {
      messages,
      formatText: (text, lang) => localizeVisibleDigits(formatBotText(text), lang),
    }).catch(() => {});
    return;
  }
  activeUpdateCount += 1;
  try {
    return await processUpdate(ctx);
  } finally {
    finishTrackedUpdate();
  }
}

bot.on("message", trackedProcessUpdate);
bot.on("callback_query", trackedProcessUpdate);
bot.on("inline_query", async (ctx) => {
  if (shuttingDown) return ctx.answerInlineQuery([], { cache_time: 1, is_personal: true }).catch(() => {});
  activeUpdateCount += 1;
  try {
    if (!isAllowedUser(ctx.inlineQuery?.from || ctx.from)) {
      await ctx.answerInlineQuery([], { cache_time: 1, is_personal: true }).catch(() => {});
      return;
    }
    try {
      await handleInlineListQuery(ctx);
    } catch (error) {
      logger.warn("Inline list query failed", {
        userId: Number(ctx.inlineQuery?.from?.id || ctx.from?.id) || null,
        error: error?.message || error,
      });
      await ctx.answerInlineQuery([], { cache_time: 1, is_personal: true }).catch(() => {});
    }
  } finally {
    finishTrackedUpdate();
  }
});
bot.on("chosen_inline_result", async (ctx) => {
  if (shuttingDown) return;
  activeUpdateCount += 1;
  try {
    if (!isAllowedUser(ctx.chosenInlineResult?.from || ctx.from)) return;
    try {
      const result = await handleChosenInlineListResult(ctx);
      if (!result.ok) {
        logger.warn("Chosen inline list item was not saved", {
          userId: Number(ctx.chosenInlineResult?.from?.id || ctx.from?.id) || null,
          reason: result.reason || "unknown",
        });
      }
    } catch (error) {
      logger.warn("Chosen inline list save failed", {
        userId: Number(ctx.chosenInlineResult?.from?.id || ctx.from?.id) || null,
        error: error?.message || error,
      });
    }
  } finally {
    finishTrackedUpdate();
  }
});

let pollingStarted = false;
let heartbeatTimer = null;
let ownerJoinSummaryTimer = null;
let ownerJoinSummaryRunning = false;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const runtimeMetrics = createRuntimeMetricsMonitor({ intervalMs: HEARTBEAT_INTERVAL_MS });
const appearanceRefreshLoop = createPeriodicRefresh({
  name: "bot appearance settings",
  refresh: () => refreshBotAppearance({ force: true }),
  intervalMs: SETTINGS_REFRESH_INTERVAL_MS,
});

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
  appearanceRefreshLoop.stop();

  try {
    await withTimeout(waitForActiveUpdates(), 5000, "active update drain");
  } catch (error) {
    logger.warn("Timed out waiting for active updates during shutdown", {
      activeUpdateCount,
      error: error?.message || error,
    });
  }

  try {
    await withTimeout(disconnectDB(), 5000, "database disconnect");
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

(async () => {
  try {
    logger.info("Connecting database");
    await connectDB(config);
    const removedLegacyBoostIndex = await removeLegacyOwnerBoostIndex();
    if (removedLegacyBoostIndex) {
      logger.info("Removed legacy one-boost-per-owner database index");
    }
    const settingsLoads = await Promise.allSettled([
      refreshOperationalLimits({ force: true }),
      refreshStarSettings({ force: true }),
      refreshBotAppearance({ force: true }),
    ]);
    const settingNames = ["operational limits", "Star economy settings", "bot appearance settings"];
    settingsLoads.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.warn(`Failed to load ${settingNames[index]}; using defaults`, result.reason);
      }
    });
    appearanceRefreshLoop.start();
    logger.info("Checking bot token/API via getMe");
    botInfo = await retryWithJitter(
      () => bot.telegram.getMe(),
      {
        attempts: 5,
        delayMs: 2000,
        onRetry: (error, attempt, attempts, nextDelayMs) => {
          logger.warn("getMe failed; retrying", {
            attempt,
            maxRetries: attempts - 1,
            nextDelayMs,
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
