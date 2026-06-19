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
  console.error("Bot update error:", err);
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
  console.log(`[shutdown] stopping application (${reason})...`);

  if (pollingStarted) {
    try {
      bot.stop(reason);
    } catch (error) {
      console.warn("[shutdown] failed to stop bot polling:", error?.message || error);
    }
  }

  try {
    await disconnectDB();
  } catch (error) {
    console.error("[shutdown] failed to disconnect database:", error?.message || error);
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
    console.log("[startup] connecting database...");
    await connectDB(config);
    console.log("[startup] checking bot token/API via getMe...");
    const botInfo = await retry(
      () => bot.telegram.getMe(),
      {
        attempts: 5,
        delayMs: 2000,
        onRetry: (error, attempt, attempts) => {
          console.warn(
            `[startup] getMe failed (${attempt}/${attempts - 1} retries used):`,
            error?.message || error,
          );
        },
      },
    );
    console.log("[startup] getMe successful.");
    try {
      const seeded = await seedBotDiscussions(botInfo?.id);
      console.log(`[startup] bot discussions ready (${seeded.discussions?.length || 0}).`);
    } catch (seedError) {
      console.warn("[startup] failed to seed bot discussions; continuing without them.");
      console.warn(seedError?.message || seedError);
    }

    try {
      console.log("[startup] deleting webhook (polling mode)...");
      await bot.telegram.deleteWebhook();
    } catch (deleteWebhookError) {
      console.warn("deleteWebhook failed; continuing with polling mode.");
      console.warn(deleteWebhookError?.message || deleteWebhookError);
    }

    const pollingLoop = bot.startPolling();
    pollingStarted = true;
    console.log("[startup] bot started in polling mode.");

    pollingLoop.catch(async (pollingError) => {
      console.error("Polling stopped with error:", pollingError);
      await shutdown("polling_error", 1);
    });
  } catch (error) {
    console.error("Bot startup failed:", error);
    await shutdown("startup_error", 1);
  }
})();
