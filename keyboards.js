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
        text: messages[lang].buttons.language,
        callback_data: "menu:language",
      },
    ],
  ]);
}

function languageKeyboard() {
  return inlineKeyboard([
    [
      { text: "🇮🇷 فارسی", callback_data: "lang:set:fa" },
      { text: "🇬🇧 English", callback_data: "lang:set:en" },
    ],
    [{ text: "🔙 Back", callback_data: "menu:main" }],
  ]);
}

module.exports = {
  inlineKeyboard,
  mainMenuKeyboard,
  languageKeyboard,
};
