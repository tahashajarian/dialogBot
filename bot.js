const messages = require("./messages");
const { detectLanguage } = require("./lang");
const { handleCallback } = require("./callbacks");
const { mainMenuKeyboard, languageKeyboard } = require("./keyboards");

async function handleUpdate(ctx) {
  const text = (ctx.text || "").trim();
  const lang = detectLanguage(ctx);

  if (ctx.callbackData) {
    return handleCallback(ctx);
  }

  const userLang = ctx.user?.lang;

  if (text === "/start") {
    await ctx.reply(messages[lang].welcome);

    if (!userLang) {
      return ctx.reply(messages["fa"].chooseLanguage, languageKeyboard());
    }

    return ctx.reply(messages[userLang].mainMenu, mainMenuKeyboard(userLang));
  }

  if (text === "/lang") {
    return ctx.reply(messages[lang].chooseLanguage, languageKeyboard());
  }

  if (text === "/menu") {
    if (!userLang) {
      return ctx.reply(messages["fa"].chooseLanguage, languageKeyboard());
    }

    return ctx.reply(messages[userLang].mainMenu, mainMenuKeyboard(userLang));
  }

  if (!userLang) {
    return ctx.reply(messages["fa"].chooseLanguage, languageKeyboard());
  }

  return ctx.reply(messages[userLang].maintenance, mainMenuKeyboard(userLang));
}

module.exports = {
  handleUpdate,
};
