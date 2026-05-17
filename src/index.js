require("dotenv").config();

const { Telegraf } = require("telegraf");
const connectDB = require("./db");
const { handleUpdate } = require("./bot");
const { getUser } = require("./services/users");

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    apiRoot: process.env.API_ROOT
  }
});

function createAppContext(ctx, user) {
  return {
    user,
    languageCode: ctx.from?.language_code,
    text: ctx.message?.text,
    callbackData: ctx.callbackQuery?.data,

    reply: (...args) => ctx.reply(...args),
    answerCb: (text) => ctx.answerCbQuery(text).catch(() => {}),
    editMessage: (...args) => ctx.editMessageText(...args)
  };
}

async function processUpdate(ctx) {
  const userId = ctx.from.id;

  const user = await getUser(userId);

  const appCtx = createAppContext(ctx, user);

  return handleUpdate(appCtx);
}

bot.on("text", processUpdate);
bot.on("callback_query", processUpdate);

(async () => {
  await connectDB();
  bot.launch();

  console.log("Bot started");
})();
