const { resolveHomeDestination } = require("./home-actions");

function buildHomeResponseMarkup(destination, lang) {
  const action = resolveHomeDestination(destination, lang);
  if (!action) return undefined;
  return { reply_markup: { inline_keyboard: [[{ text: action.text, callback_data: action.callback_data }]] } };
}

module.exports = { buildHomeResponseMarkup };
