const messages = require("./messages");
const { setLanguage, detectLanguage } = require("./lang");
const { mainMenuKeyboard, languageKeyboard } = require("./keyboards");

async function handleCallback(ctx) {
  const data = ctx.callbackData || "";
  const lang = detectLanguage(ctx);

  if (!data) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
  }

  // menu routes
  if (data === "menu:main") {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === "menu:language") {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].chooseLanguage, languageKeyboard());
  }

  // language routes
  if (data.startsWith("lang:set:")) {
    const selected = data.split(":")[2];
    const ok = setLanguage(ctx.userId, selected);

    await ctx.answerCb?.();

    if (!ok) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch (err) {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const newLang = detectLanguage({ ...ctx, languageCode: selected });

    try {
      return await ctx.editMessageText(
        messages[newLang].languageChanged,
        mainMenuKeyboard(newLang),
      );
    } catch (err) {
      return await ctx.reply(
        messages[newLang].languageChanged,
        mainMenuKeyboard(newLang),
      );
    }
  }

  await ctx.answerCb?.();
  return ctx.reply(messages[lang].unknownAction);
}

module.exports = {
  handleCallback,
};
