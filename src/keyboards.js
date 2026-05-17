const { callBacks } = require("./constances");
const messages = require("./messages");

function inlineKeyboard(rows) {
  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

function mainMenuKeyboard(lang) {
  return inlineKeyboard([
    [
      {
        text: messages[lang].language,
        callback_data: callBacks.language,
      },
    ],
    [
      {
        text: messages[lang].profile,
        callback_data: callBacks.profile,
      },
    ],
  ]);
}

function languageKeyboard() {
  return inlineKeyboard([
    [
      { text: "🇮🇷 فارسی", callback_data: callBacks.langSetFa },
      { text: "🇬🇧 English", callback_data:  callBacks.langSetEn},
    ],
    [{ text: "🔙 Back", callback_data: callBacks.menuMain  }],
  ]);
}

module.exports = {
  inlineKeyboard,
  mainMenuKeyboard,
  languageKeyboard,
};
