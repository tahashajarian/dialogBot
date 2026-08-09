const { callBacks } = require("../constants");
const messages = require("../messages");
const { operationalLimits } = require("../services/operational-limits");
const {
  getSectionEmoji,
  getSectionListLabel,
  getTasteLabelEmoji,
  getTasteLabelTitle,
} = require("../services/ai-section");

function inlineKeyboard(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function formatKeyboardNumber(lang, value) {
  const number = Number(value) || 0;
  return lang === "fa" ? new Intl.NumberFormat("fa-IR").format(number) : String(number);
}

function aiAssistantKeyboard(lang) {
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].aiSuggestMovies,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestBooks,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestMusic,
      },
    ],
    [
      {
        text: messages[lang].onboardingMainMenuButton,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function aiChatBackKeyboard(lang) {
  return {
    reply_markup: {
      keyboard: [
        [
          {
            text: messages[lang].aiBack,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      is_persistent: true,
      selective: true,
    },
  };
}

function aiSectionKeyboard(lang) {
  return aiSectionKeyboardForSection(lang, "movies");
}

function aiSectionKeyboardForSection(lang, section) {
  const listButtonText = section === "movies"
    ? messages[lang].aiSectionListButtonMovies
    : section === "music"
      ? messages[lang].aiSectionListButtonMusic
      : section === "books"
        ? messages[lang].aiSectionListButtonBooks
        : messages[lang].aiSectionListButtonRandom;
  const topTenButtonText = ["movies", "music", "books"].includes(section)
    ? `${getSectionEmoji(section)} ${messages[lang].aiSectionTopTenButton}`
    : messages[lang].aiSectionTopTenButton;
  const suggestButtonText = ["movies", "music", "books"].includes(section)
    ? `${getSectionEmoji(section)} ${messages[lang].aiSectionSuggestButton}`
    : messages[lang].aiSectionSuggestButton;

  return {
    reply_markup: {
      keyboard: [
        [
          {
            text: topTenButtonText,
          },
        ],
        [
          {
            text: listButtonText,
          },
        ],
        [
          {
            text: suggestButtonText,
          },
        ],
        [
          {
            text: messages[lang].aiBack,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      is_persistent: true,
      selective: true,
    },
  };
}

function aiSuggestionAddKeyboard(lang, section) {
  const listLabel = getSectionListLabel(messages, lang, section);
  const doneButtonText = section === "music"
    ? messages[lang].aiSuggestionAddDoneButtonMusic
    : section === "books"
      ? messages[lang].aiSuggestionAddDoneButtonBooks
      : section === "random"
        ? messages[lang].aiSuggestionAddDoneButtonRandom
        : messages[lang].aiSuggestionAddDoneButtonMovies;

  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].aiSuggestionAddToListButton.replace("{listName}", listLabel),
      },
    ],
    [
      {
        text: doneButtonText,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestionRejectButton,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function aiSuggestionCopyKeyboard(lang, title) {
  return inlineKeyboard([[
    {
      text: messages[lang].aiSuggestionCopyNameButton,
      copy_text: { text: String(title || "").slice(0, 160) },
    },
  ]]);
}

function aiSuggestionNextKeyboard(lang, _section) {
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].aiSuggestionAnotherButton,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestionGoToFavoritesButton,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function aiSuggestionLimitKeyboard(lang, section) {
  const sectionCallbacks = {
    movies: callBacks.aiSuggestMovies,
    music: callBacks.aiSuggestMusic,
    books: callBacks.aiSuggestBooks,
    random: callBacks.aiSuggestRandom,
  };
  return inlineKeyboard([[
    {
      text: messages[lang].aiBack,
      callback_data: sectionCallbacks[section] || callBacks.aiBack,
    },
  ]]);
}

function aiPaidSuggestionConfirmKeyboard(lang, publicCode, cost, section) {
  return inlineKeyboard([
    [{
      text: messages[lang].aiSuggestionPaidConfirmButton.replace("{cost}", formatKeyboardNumber(lang, cost)),
      callback_data: `${callBacks.aiPaidSuggestionConfirm}${publicCode}`,
    }],
    [{
      text: messages[lang].aiSuggestionPaidCancelButton,
      callback_data: `${callBacks.aiPaidSuggestionCancel}${section}`,
    }],
  ]);
}

function aiSuggestionModeKeyboard(lang, _section) {
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].aiSuggestionFromTopTenButton,
      },
    ],
    [
      {
        text: messages[lang].aiBack,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: true, selective: true } };
}

function aiSuggestionNeedTopTenKeyboard(lang, section) {
  return inlineKeyboard([[
    {
      text: messages[lang].acknowledgeButton,
      callback_data: `${callBacks.aiSectionSuggestNeedTopTenAck}${section}`,
    },
  ]]);
}

function aiSuggestionContextCancelKeyboard(lang, _section) {
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].cancelEdit,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function aiSuggestionAddedOptionsKeyboard(lang, section) {
  const listLabel = getSectionListLabel(messages, lang, section);
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].aiSuggestionAnotherButton,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestionGoToListButton.replace("{listName}", listLabel),
      },
    ],
    [
      {
        text: messages[lang].aiSuggestionGoToFavoritesButton,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function getSectionStatusLabels(lang, section) {
  if (section === "music") {
    return {
      done: messages[lang].aiListManageShowWatchedMusic || messages[lang].aiListManageShowWatched,
      pending: messages[lang].aiListManageShowNotWatchedMusic || messages[lang].aiListManageShowNotWatched,
    };
  }

  if (section === "books") {
    return {
      done: messages[lang].aiListManageShowWatchedBooks || messages[lang].aiListManageShowWatched,
      pending: messages[lang].aiListManageShowNotWatchedBooks || messages[lang].aiListManageShowNotWatched,
    };
  }

  if (section === "random") {
    return {
      done: messages[lang].aiListManageShowWatchedRandom || messages[lang].aiListManageShowWatched,
      pending: messages[lang].aiListManageShowNotWatchedRandom || messages[lang].aiListManageShowNotWatched,
    };
  }

  return {
    done: messages[lang].aiListManageShowWatchedMovies || messages[lang].aiListManageShowWatched,
    pending: messages[lang].aiListManageShowNotWatchedMovies || messages[lang].aiListManageShowNotWatched,
  };
}

function aiListManageMenuKeyboard(lang, section, listType, {
  itemCount = 0,
  hasWatchlistItems = false,
  hasTasteLabel = false,
} = {}) {
  const rows = [];
  const canAdd = !(listType === "topTen" && itemCount >= operationalLimits.aiTopTenItems);
  const isMediaSection = ["movies", "music", "books"].includes(section);

  const getAddButtonText = () => {
    if (!isMediaSection) return messages[lang].aiListManageAdd;
    if (listType === "watchlist") {
      if (section === "movies") return messages[lang].aiListManageAddLaterMovies;
      if (section === "music") return messages[lang].aiListManageAddLaterMusic;
      return messages[lang].aiListManageAddLaterBooks;
    }
    const firstKey = section === "movies" ? "aiFavoritesAddFirstMovies"
      : section === "music" ? "aiFavoritesAddFirstMusic" : "aiFavoritesAddFirstBooks";
    const anotherKey = section === "movies" ? "aiFavoritesAddAnotherMovies"
      : section === "music" ? "aiFavoritesAddAnotherMusic" : "aiFavoritesAddAnotherBooks";
    if (itemCount === 0) return messages[lang][firstKey];
    return messages[lang][anotherKey]
      .replace("{count}", String(itemCount))
      .replace("{goal}", String(operationalLimits.aiTopTenItems));
  };

  if (canAdd) {
    rows.push([
      {
        text: getAddButtonText(),
      },
    ]);
  }

  if (listType === "topTen" && isMediaSection) {
    const listButtonText = section === "movies"
      ? messages[lang].aiSectionListButtonMovies
      : section === "music"
        ? messages[lang].aiSectionListButtonMusic
        : messages[lang].aiSectionListButtonBooks;
    if (itemCount >= 3) {
      rows.push([
        {
          text: `${getSectionEmoji(section)} ${messages[lang].aiSectionSuggestButton}`,
        },
      ]);
    }
    if (itemCount >= operationalLimits.aiTopTenItems || hasTasteLabel) {
      rows.push([{ text: messages[lang].aiTasteReviewButton }]);
    }
    if (hasWatchlistItems) {
      rows.push([
        {
          text: listButtonText,
        },
      ]);
    }
  }

  // Removed for now: Top 10 insight button (was in else block for watchlist condition)
  //   rows.push([
  //     {
  //       text: messages[lang].aiTopTenInsightButton,
  //       callback_data: `${callBacks.aiTopTenInsight}${section}`,
  //     },
  //   ]);

  rows.push([
    {
      text: listType === "watchlist" ? messages[lang].aiSuggestionGoToFavoritesButton : messages[lang].aiBack,
    },
  ]);

  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function aiSuggestionListFullKeyboard(lang, section) {
  const listLabel = getSectionListLabel(messages, lang, section);
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].aiSuggestionGoToListButton.replace("{listName}", listLabel),
      },
    ],
    [
      {
        text: messages[lang].aiSuggestionAnotherButton,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function aiWatchlistCardKeyboard(lang, section, {
  filter = "all",
  page = 0,
  totalPages = 1,
  watchlistItems = [],
} = {}) {
  const rows = [];
  const hasMixedStatuses = watchlistItems.some((entry) => entry?.watched === true)
    && watchlistItems.some((entry) => entry?.watched !== true);
  const payload = (nextFilter, nextPage = 0) => (
    `${callBacks.aiListManageShow}${section}:watchlist:${nextFilter}:${nextPage}`
  );

  if (hasMixedStatuses) {
    const labels = getSectionStatusLabels(lang, section);
    rows.push(filter === "watched"
      ? [
        { text: messages[lang].aiListManageShowAll, callback_data: payload("all") },
        { text: labels.pending, callback_data: payload("not_watched") },
      ]
      : filter === "not_watched"
        ? [
          { text: labels.done, callback_data: payload("watched") },
          { text: messages[lang].aiListManageShowAll, callback_data: payload("all") },
        ]
        : [
          { text: labels.done, callback_data: payload("watched") },
          { text: labels.pending, callback_data: payload("not_watched") },
        ]);
  }

  const normalizedPage = Math.max(0, Number(page) || 0);
  const normalizedTotalPages = Math.max(1, Number(totalPages) || 1);
  const pageRow = [];
  if (normalizedPage > 0) {
    pageRow.push({
      text: `⬅️ ${messages[lang].discussionListPrevPage}`,
      callback_data: payload(filter, normalizedPage - 1),
    });
  }
  if (normalizedPage < normalizedTotalPages - 1) {
    pageRow.push({
      text: `${messages[lang].discussionListMorePage} ➡️`,
      callback_data: payload(filter, normalizedPage + 1),
    });
  }
  if (pageRow.length) rows.push(pageRow);
  return rows.length ? { reply_markup: { inline_keyboard: rows } } : {};
}

function aiListRemoveItemsKeyboard(lang, section, listType, items = []) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  const rows = items.map((entry, index) => ([
    {
      text: `❌ ${index + 1}. ${entry.title}`,
      callback_data: `${callBacks.aiListManageRemoveItem}${section}:${listTypeToken}:${index}`,
    },
  ]));

  rows.push([
    {
      text: messages[lang].aiBack,
      callback_data: `${callBacks.aiListManageMenu}${section}:${listTypeToken}`,
    },
  ]);

  return inlineKeyboard(rows);
}

function aiTasteSuggestionKeyboard(lang, section, labelKeys = [], {
  selectedLabelKey = "",
  selectedNoLabel = false,
  includeClose = false,
  canRecheck = false,
  recheckCost = 0,
} = {}) {
  const ranks = ["🥇", "🥈", "🥉"];
  const visibleLabelKeys = labelKeys.slice(0, 4);
  const rows = visibleLabelKeys.map((labelKey, index) => ([{
    text: `${labelKey === selectedLabelKey ? "✓" : (index === visibleLabelKeys.length - 1 ? "🧩" : ranks[index])} ${getTasteLabelEmoji(section, labelKey)} ${getTasteLabelTitle(messages, lang, section, labelKey)}`,
    callback_data: `${callBacks.aiTasteConfirm}${section}:${labelKey}`,
  }]));
  rows.push([{
    text: `${selectedNoLabel ? "✓ " : ""}${messages[lang].aiTasteSkipButton}`,
    callback_data: `${callBacks.aiTasteSkip}${section}`,
  }]);
  if (canRecheck) {
    rows.push([{
      text: messages[lang].aiTasteRecheckButton.replace("{cost}", String(recheckCost)),
      callback_data: `${callBacks.aiTasteRecheck}${section}`,
    }]);
  }
  if (includeClose) {
    rows.push([{ text: messages[lang].discussionShareClose, callback_data: callBacks.aiTasteClose }]);
  }
  return inlineKeyboard(rows);
}

function aiTasteFailureKeyboard(lang, section) {
  return inlineKeyboard([
    [{ text: messages[lang].aiTasteRetryButton, callback_data: `${callBacks.aiTasteRetry}${section}` }],
    [{
      text: messages[lang].aiListManageAddBackToList,
      callback_data: `${callBacks.aiListManageMenu}${section}:top_ten`,
    }],
  ]);
}

function aiTasteCurrentKeyboard(lang, section, { canRecheck = false, recheckCost = 0 } = {}) {
  const rows = [
    [{ text: messages[lang].aiTasteChangeButton, callback_data: `${callBacks.aiTasteChoose}${section}` }],
    [{ text: messages[lang].aiTasteSkipButton, callback_data: `${callBacks.aiTasteSkip}${section}` }],
    [{ text: messages[lang].discussionShareClose, callback_data: callBacks.aiTasteClose }],
  ];
  if (canRecheck) {
    rows.unshift([{
      text: messages[lang].aiTasteRecheckButton.replace("{cost}", String(recheckCost)),
      callback_data: `${callBacks.aiTasteRecheck}${section}`,
    }]);
  }
  return inlineKeyboard(rows);
}

function aiTasteRecheckConfirmKeyboard(lang, publicCode) {
  return inlineKeyboard([
    [
      { text: messages[lang].aiTasteRecheckConfirmButton, callback_data: `${callBacks.aiTasteRecheckConfirm}${publicCode}` },
      { text: messages[lang].cancelEdit, callback_data: `${callBacks.aiTasteRecheckCancel}${publicCode}` },
    ],
  ]);
}

function aiListCancelAddKeyboard(lang, _section, _listType, { backToList = false } = {}) {
  return { reply_markup: { keyboard: [
    [
      {
        text: backToList ? messages[lang].aiListManageAddBackToList : messages[lang].cancelEdit,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

function aiListActionItemsKeyboard(lang, section, listType, action, items = []) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  const rows = items.map((entry, index) => ([
    {
      text: action === "toggle"
        ? `${entry?.watched ? "✔️" : "○"} ${index + 1}. ${entry.title}`
        : `${index + 1}. ${entry.title}`,
      callback_data: action === "toggle"
        ? `${callBacks.aiListManageToggleItem}${section}:${listTypeToken}:${index}`
        : action === "promote"
          ? `${callBacks.aiListManagePromoteItem}${section}:${listTypeToken}:${index}`
          : `${callBacks.aiListManageCommentItem}${section}:${listTypeToken}:${index}`,
    },
  ]));

  rows.push([
    {
      text: messages[lang].aiBack,
      callback_data: `${callBacks.aiListManageMenu}${section}:${listTypeToken}`,
    },
  ]);

  return inlineKeyboard(rows);
}

function aiListCancelCommentKeyboard(lang, _section, _listType) {
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].cancelEdit,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, is_persistent: true, selective: true } };
}

module.exports = {
  aiAssistantKeyboard,
  aiChatBackKeyboard,
  aiSectionKeyboard,
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionCopyKeyboard,
  aiSuggestionNextKeyboard,
  aiSuggestionLimitKeyboard,
  aiPaidSuggestionConfirmKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionNeedTopTenKeyboard,
  aiSuggestionContextCancelKeyboard,
  aiSuggestionAddedOptionsKeyboard,
  aiSuggestionListFullKeyboard,
  aiListManageMenuKeyboard,
  aiWatchlistCardKeyboard,
  aiListRemoveItemsKeyboard,
  aiTasteSuggestionKeyboard,
  aiTasteFailureKeyboard,
  aiTasteCurrentKeyboard,
  aiTasteRecheckConfirmKeyboard,
  aiListCancelAddKeyboard,
  aiListActionItemsKeyboard,
  aiListCancelCommentKeyboard,
};
