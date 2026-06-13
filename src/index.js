require("dotenv").config();

const { Telegraf } = require("telegraf");
const connectDB = require("./db");
const { disconnectDB } = require("./db");
const { handleUpdate } = require("./bot");
const { getOrCreateUser } = require("./services/users");
const { beginInteraction } = require("./services/interaction-guard");
const { createAppContext } = require("./services/app-context");
const { getRuntimeConfig, normalizeUsername } = require("./config");

const config = getRuntimeConfig();
const ALLOWED_USERNAMES = config.allowedUsernames;

function isAllowedUser(from) {
  return ALLOWED_USERNAMES.has(normalizeUsername(from?.username));
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
  if (!isAllowedUser(ctx.from)) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("go away it's not ready yet!").catch(() => {});
    }
    await ctx.reply("go away it's not ready yet!").catch(() => {});
    return;
  }

  const user = await getOrCreateUser(ctx.from);
  const appCtx = createAppContext(ctx, user, {
    canBypassDiscussionCreateLimit: isAllowedUser(ctx.from),
  });
  const interaction = beginInteraction({
    userId: user?.userId || ctx.from?.id,
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
    await retry(
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
