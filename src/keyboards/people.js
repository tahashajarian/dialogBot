const { callBacks } = require("../constants");
const messages = require("../messages");
const { starEconomy } = require("../services/star-settings");

function inlineKeyboard(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function savedProfilesListKeyboard(lang, items = []) {
  const rows = [];
  const options = items && !Array.isArray(items) ? items : {};
  const normalizedPage = Math.max(0, Number(options.page) || 0);
  const maxPage = Math.max(0, Number(options.totalPages || 1) - 1);
  const pageRows = [];

  if (normalizedPage < maxPage) {
    pageRows.push({
      text: `${messages[lang].discussionListMorePage} ➡️`,
      callback_data: `${callBacks.savedProfilesPage}${normalizedPage + 1}`,
    });
  }
  if (normalizedPage > 0) {
    pageRows.push({
      text: `🔙 ${messages[lang].discussionListPrevPage}`,
      callback_data: `${callBacks.savedProfilesPage}${normalizedPage - 1}`,
    });
  }
  if (pageRows.length) rows.push(pageRows);
  rows.push([{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.peopleListClose,
  }]);
  return inlineKeyboard(rows);
}

function peopleHubKeyboard(lang) {
  const rows = [
    [{ text: messages[lang].peopleDiscover }],
    [{ text: messages[lang].savedProfiles }],
  ];
  if (starEconomy.advancedSearchPreviewEnabled) {
    rows.push([{ text: messages[lang].advancedSearchButton }]);
  }
  rows.push([{ text: messages[lang].aiBack }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function advancedSearchPreviewKeyboard(lang) {
  return inlineKeyboard([[{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.peopleAdvancedSearchBack,
  }]]);
}

function peopleDiscoverListKeyboard(lang, options = {}) {
  const rows = [];
  const normalizedPage = Math.max(0, Number(options.page) || 0);
  const maxPage = Math.max(0, Number(options.totalPages || 1) - 1);
  const pageRows = [];

  if (normalizedPage < maxPage) {
    pageRows.push({
      text: `${messages[lang].discussionListMorePage} ➡️`,
      callback_data: `${callBacks.peopleDiscoverPage}${normalizedPage + 1}`,
    });
  }
  if (normalizedPage > 0) {
    pageRows.push({
      text: `🔙 ${messages[lang].discussionListPrevPage}`,
      callback_data: `${callBacks.peopleDiscoverPage}${normalizedPage - 1}`,
    });
  }
  if (pageRows.length) rows.push(pageRows);
  if (options.showLists) {
    rows.push([{
      text: messages[lang].peopleGoToLists,
      callback_data: callBacks.aiAssistant,
    }]);
  }
  rows.push([{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.peopleListClose,
  }]);
  return inlineKeyboard(rows);
}

function peopleDiscoverEmptyKeyboard(lang) {
  return inlineKeyboard([
    [{ text: messages[lang].peopleGoToLists, callback_data: callBacks.aiAssistant }],
    [{ text: messages[lang].discussionShareClose, callback_data: callBacks.peopleListClose }],
  ]);
}

module.exports = {
  advancedSearchPreviewKeyboard,
  peopleDiscoverEmptyKeyboard,
  peopleDiscoverListKeyboard,
  peopleHubKeyboard,
  savedProfilesListKeyboard,
};
