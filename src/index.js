require("dotenv").config();

const { Telegraf } = require("telegraf");
const connectDB = require("./db");
const { disconnectDB } = require("./db");
const { handleUpdate } = require("./bot");
const { getOrCreateUser, normalizePlatformUserSource } = require("./services/users");
const { beginInteraction } = require("./services/interaction-guard");
const { createAppContext } = require("./services/app-context");
const { getRuntimeConfig, normalizeUsername } = require("./config");
const { seedBotDiscussions } = require("./services/discussion-starters");
const { logger } = require("./services/logger");
const messages = require("./messages");

const config = getRuntimeConfig();
const ALLOWED_USERNAMES = config.allowedUsernames;

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
  config.baleApiRoot
    ? {
      telegram: {
        apiRoot: config.baleApiRoot,
      },
    }
    : undefined,
);

bot.catch((err) => {
  logger.error("Bot update error", err);
});

async function processUpdate(ctx) {
  const from = resolveUpdateUserSource(ctx);
  if (!isAllowedUser(from)) {
    const lang = String(from?.language_code || from?.languageCode || "").toLowerCase().startsWith("en") ? "en" : "fa";
    const text = messages[lang].betaAccessOnly;
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(text).catch(() => {});
    }
    await ctx.reply(text).catch(() => {});
    return;
  }

  const user = await getOrCreateUser(from);
  if (user?.bannedAt) {
    const lang = messages[user.lang] ? user.lang : "fa";
    const text = messages[lang].userBannedAccessDenied;
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(text, { show_alert: true }).catch(() => {});
    }
    await ctx.reply(text, { reply_markup: { remove_keyboard: true, selective: false } }).catch(() => {});
    return;
  }

  const appCtx = createAppContext(ctx, user, {
  });
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
    return await handleUpdate(appCtx);
  } finally {
    interaction.finish();
  }
}

bot.on("message", processUpdate);
bot.on("callback_query", processUpdate);

let pollingStarted = false;
let shuttingDown = false;

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
