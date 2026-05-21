require("dotenv").config();

const { Telegraf } = require("telegraf");
const connectDB = require("./db");
const { handleUpdate } = require("./bot");
const { getOrCreateUser } = require("./services/users");

function resolveBaleApiRoot() {
  return (process.env.API_ROOT || "").trim() || null;
}

const baleApiRoot = resolveBaleApiRoot();
const bot = new Telegraf(
  process.env.BOT_TOKEN,
  baleApiRoot
    ? {
      telegram: {
        apiRoot: baleApiRoot,
      },
    }
    : undefined,
);

bot.catch((err) => {
  console.error("Bot update error:", err);
});

function createAppContext(ctx, user) {
  return {
    user,
    userId: user?.userId,
    languageCode: ctx.from?.language_code,
    message: ctx.message,
    text: ctx.message?.text,
    callbackData: ctx.callbackQuery?.data,

    reply: (...args) => ctx.reply(...args),
    replyWithPhoto: (...args) => ctx.replyWithPhoto(...args),
    answerCb: (text) => ctx.answerCbQuery(text).catch(() => {}),
    editMessage: (...args) => ctx.editMessageText(...args)
  };
}

async function processUpdate(ctx) {

  const user = await getOrCreateUser(ctx.from);

  const appCtx = createAppContext(ctx, user);

  return handleUpdate(appCtx);
}

bot.on("message", processUpdate);
bot.on("callback_query", processUpdate);

(async () => {
  try {
    await connectDB();
    await bot.telegram.getMe();

    try {
      await bot.telegram.deleteWebhook();
    } catch (deleteWebhookError) {
      console.warn("deleteWebhook failed; continuing with polling mode.");
      console.warn(deleteWebhookError?.message || deleteWebhookError);
    }

    const pollingLoop = bot.startPolling();
    console.log("Bot started");

    pollingLoop.catch((pollingError) => {
      console.error("Polling stopped with error:", pollingError);
      process.exit(1);
    });
  } catch (error) {
    console.error("Bot startup failed:", error);
    process.exit(1);
  }
})();
