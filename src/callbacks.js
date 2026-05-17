const messages = require("./messages");
const { setLanguage, detectLanguage, normalizeLang } = require("./lang");
const { mainMenuKeyboard, languageKeyboard } = require("./keyboards");
const { callBacks } = require("./constances");

async function handleCallback(ctx) {
  const data = ctx.callbackData || "";
  const lang = detectLanguage(ctx);

  if (!data) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
  }

  // menu routes
  if (data === callBacks.menuMain) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === callBacks.language) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].chooseLanguage, languageKeyboard());
  }

  // language routes
  if (data.startsWith(callBacks.langSet)) {
    const raw = data.split(":")[2];
    const selected = normalizeLang(raw); // fa/en

    await ctx.answerCb?.();

    if (!selected) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const userId = ctx.user?.userId;
    if (!userId) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const ok = await setLanguage(userId, selected); // DB update + normalize inside too
    if (!ok) {
      try {
        return await ctx.editMessageText(messages[lang].unknownAction);
      } catch {
        return await ctx.reply(messages[lang].unknownAction);
      }
    }

    const newLang = selected;

    try {
      // Telegraf editMessageText: (text, extra)
      return await ctx.editMessage(
        messages[newLang].languageChanged,
        mainMenuKeyboard(newLang)
      );
    } catch {
      return await ctx.reply(
        messages[newLang].languageChanged,
        mainMenuKeyboard(newLang)
      );
    }
  }

  await ctx.answerCb?.();
  return ctx.reply(messages[lang].unknownAction);
}

module.exports = { handleCallback };
