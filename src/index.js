require("dotenv").config();

const { Telegraf } = require("telegraf");
const connectDB = require("./db");
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
    console.log("[startup] bot started in polling mode.");

    pollingLoop.catch((pollingError) => {
      console.error("Polling stopped with error:", pollingError);
      process.exit(1);
    });
  } catch (error) {
    console.error("Bot startup failed:", error);
    process.exit(1);
  }
})();
