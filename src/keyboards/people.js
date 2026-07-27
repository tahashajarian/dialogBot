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
  rows.push([{ text: messages[lang].onboardingMainMenuButton }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function advancedSearchPreviewKeyboard(lang) {
  return inlineKeyboard([[{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.peopleAdvancedSearchBack,
  }]]);
}

function getPeopleLanguageButton(lang, languageFilter) {
  const language = ["en", "all"].includes(languageFilter) ? languageFilter : "fa";
  const languageLabel = language === "all"
    ? messages[lang].discussionLanguageBoth
    : language === "en"
      ? messages[lang].discussionLanguageEnglish
      : messages[lang].discussionLanguagePersian;
  return {
    text: messages[lang].peopleDiscoverLanguageFilterButton.replace("{language}", languageLabel),
    callback_data: `${callBacks.peopleDiscoverLanguageOpen}${language}`,
  };
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
  if (options.showLanguageFilter) {
    rows.push([getPeopleLanguageButton(lang, options.languageFilter)]);
  }
  if (options.showLists) {
    rows.push([{
      text: messages[lang].peopleGoToLists,
      callback_data: callBacks.aiAssistant,
    }]);
  }
  if (options.showFavoritesAction) {
    rows.push([{
      text: options.favoritesFull
        ? messages[lang].peopleDiscoverViewFavorites
        : messages[lang].peopleDiscoverAddFavorites,
      callback_data: callBacks.aiAssistant,
    }]);
  }
  rows.push([{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.peopleListClose,
  }]);
  return inlineKeyboard(rows);
}

function peopleDiscoverEmptyKeyboard(lang, options = {}) {
  const rows = [];
  if (options.showLanguageFilter) {
    rows.push([getPeopleLanguageButton(lang, options.languageFilter)]);
  }
  rows.push(
    [{ text: messages[lang].peopleGoToLists, callback_data: callBacks.aiAssistant }],
    [{ text: messages[lang].discussionShareClose, callback_data: callBacks.peopleListClose }],
  );
  return inlineKeyboard(rows);
}

function peopleDiscoverLanguageKeyboard(lang, currentLanguage) {
  const current = ["fa", "en", "all"].includes(currentLanguage) ? currentLanguage : "fa";
  const rows = [["fa", "🇮🇷", "discussionLanguagePersian"], ["en", "🇬🇧", "discussionLanguageEnglish"], ["all", "🌐", "discussionLanguageBoth"]]
    .map(([value, flag, key]) => [{
      text: `${value === current ? "✓ " : ""}${flag} ${messages[lang][key]}`,
      callback_data: `${callBacks.peopleDiscoverLanguageSet}${value}`,
    }]);
  rows.push([{
    text: messages[lang].discussionBack,
    callback_data: `${callBacks.peopleDiscoverPage}0`,
  }]);
  return inlineKeyboard(rows);
}

module.exports = {
  advancedSearchPreviewKeyboard,
  peopleDiscoverEmptyKeyboard,
  peopleDiscoverLanguageKeyboard,
  peopleDiscoverListKeyboard,
  peopleHubKeyboard,
  savedProfilesListKeyboard,
};
