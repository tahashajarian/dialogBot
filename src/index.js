require("dotenv").config();

const { Telegraf } = require("telegraf");
const connectDB = require("./db");
const { handleUpdate } = require("./bot");
const { getOrCreateUser } = require("./services/users");

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    apiRoot: process.env.API_ROOT
  }
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
  await connectDB();
  bot.launch();

  console.log("Bot started");
})();
