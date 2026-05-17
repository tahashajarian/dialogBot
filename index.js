require("dotenv").config();
const { Telegraf } = require("telegraf");
const { handleUpdate } = require("./bot");

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    apiRoot: process.env.API_ROOT,
  },
});

function createAppContext(ctx) {
  return {
    userId: ctx.from?.id,
    chatId: ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id,
    text: ctx.message?.text || "",
    callbackData: ctx.callbackQuery?.data || "",
    languageCode: ctx.from?.language_code || "fa",

    reply: (text, extra = {}) => ctx.reply(text, extra),
    answerCb: (text) => ctx.answerCbQuery(text).catch((err) => {
      console.error("answerCbQuery error:", err.message);
    }),
    editMessageText: (text, extra = {}) => ctx.editMessageText(text, extra),
    deleteMessage: () => ctx.deleteMessage(),
  };
}


bot.on("message", async (ctx) => {
  try {
    await handleUpdate(createAppContext(ctx));
  } catch (err) {
    console.error("Message handler error:", err);
    await ctx.reply("Internal error");
  }
});

bot.on("callback_query", async (ctx) => {
  try {
    await handleUpdate(createAppContext(ctx));
  } catch (err) {
    console.error("Callback handler error:", err);
    await ctx.answerCbQuery("Error").catch(() => {});
    await ctx.reply("Internal error");
  }
});

bot.launch();
console.log("Dialog bot started");
