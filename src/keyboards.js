const { callBacks } = require("./constants");
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
    [
      {
        text: messages[lang].aiAssistant,
        callback_data: callBacks.aiAssistant,
      },
    ],
    [
      {
        text: messages[lang].discussions,
        callback_data: callBacks.discussions,
      },
    ],
    [
      {
        text: messages[lang].savedProfiles,
        callback_data: callBacks.savedProfiles,
      },
    ],
  ]);
}

function aiAssistantKeyboard(lang) {
  return inlineKeyboard([
    [
      {
        text: messages[lang].aiSuggestMovies,
        callback_data: callBacks.aiSuggestMovies,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestMusic,
        callback_data: callBacks.aiSuggestMusic,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestBooks,
        callback_data: callBacks.aiSuggestBooks,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestRandom,
        callback_data: callBacks.aiSuggestRandom,
      },
    ],
    [
      {
        text: messages[lang].aiBack,
        callback_data: callBacks.aiBack,
      },
    ],
  ]);
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

  return {
    reply_markup: {
      keyboard: [
        [
          {
            text: listButtonText,
          },
          {
            text: messages[lang].aiSectionTopTenButton,
          },
        ],
        [
          {
            text: messages[lang].aiSectionSuggestButton,
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
      selective: true,
    },
  };
}

function aiSuggestionAddKeyboard(lang, section) {
  const doneButtonText = section === "music"
    ? messages[lang].aiSuggestionAddDoneButtonMusic
    : section === "books"
      ? messages[lang].aiSuggestionAddDoneButtonBooks
      : section === "random"
        ? messages[lang].aiSuggestionAddDoneButtonRandom
        : messages[lang].aiSuggestionAddDoneButtonMovies;

  return inlineKeyboard([
    [
      {
        text: messages[lang].aiSuggestionAddToListButton,
        callback_data: `${callBacks.aiSectionAddSuggestion}${section}`,
      },
    ],
    [
      {
        text: doneButtonText,
        callback_data: `${callBacks.aiSectionAddSuggestionDone}${section}`,
      },
    ],
  ]);
}

function aiSuggestionNextKeyboard(lang, section) {
  return inlineKeyboard([
    [
      {
        text: messages[lang].aiSuggestionAnotherButton,
        callback_data: `${callBacks.aiSectionAnotherSuggestion}${section}`,
      },
    ],
  ]);
}

function aiSuggestionModeKeyboard(lang, section) {
  return inlineKeyboard([
    [
      {
        text: messages[lang].aiSuggestionFromTopTenButton,
        callback_data: `${callBacks.aiSectionSuggestFromTopTen}${section}`,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestionWithContextButton,
        callback_data: `${callBacks.aiSectionSuggestWithContext}${section}`,
      },
    ],
  ]);
}

function aiSuggestionContextCancelKeyboard(lang, section) {
  return inlineKeyboard([
    [
      {
        text: messages[lang].cancelEdit,
        callback_data: `${callBacks.aiSectionSuggestContextCancel}${section}`,
      },
    ],
  ]);
}

function aiSuggestionAddedOptionsKeyboard(lang, section) {
  return inlineKeyboard([
    [
      {
        text: messages[lang].aiSuggestionAnotherButton,
        callback_data: `${callBacks.aiSectionAnotherSuggestion}${section}`,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestionGoToListButton,
        callback_data: `${callBacks.aiListManageShow}${section}:watchlist`,
      },
    ],
  ]);
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

function aiListManageMenuKeyboard(lang, section, listType) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  const rows = [
    [
      {
        text: messages[lang].aiListManageShow,
        callback_data: `${callBacks.aiListManageShow}${section}:${listTypeToken}`,
      },
    ],
    [
      {
        text: messages[lang].aiListManageAdd,
        callback_data: `${callBacks.aiListManageAdd}${section}:${listTypeToken}`,
      },
      {
        text: messages[lang].aiListManageRemove,
        callback_data: `${callBacks.aiListManageRemovePicker}${section}:${listTypeToken}`,
      },
    ],
    [
      {
        text: messages[lang].aiListManageComment,
        callback_data: `${callBacks.aiListManageCommentPicker}${section}:${listTypeToken}`,
      },
    ],
  ];

  if (listType === "watchlist") {
    const statusLabels = getSectionStatusLabels(lang, section);
    rows.push([
      {
        text: messages[lang].aiListManageToggleWatched,
        callback_data: `${callBacks.aiListManageTogglePicker}${section}:${listTypeToken}`,
      },
    ]);
    rows.push([
      {
        text: messages[lang].aiListManageMoveToTopTen,
        callback_data: `${callBacks.aiListManagePromotePicker}${section}:${listTypeToken}`,
      },
    ]);
    rows.push([
      {
        text: statusLabels.done,
        callback_data: `${callBacks.aiListManageShow}${section}:${listTypeToken}:watched`,
      },
      {
        text: statusLabels.pending,
        callback_data: `${callBacks.aiListManageShow}${section}:${listTypeToken}:not_watched`,
      },
    ]);
  } else {
    rows.push([
      {
        text: messages[lang].aiTopTenInsightButton,
        callback_data: `${callBacks.aiTopTenInsight}${section}`,
      },
    ]);
  }

  rows.push([
    {
      text: messages[lang].aiBack,
      callback_data: `${callBacks.aiListManageBack}${section}`,
    },
  ]);

  return inlineKeyboard(rows);
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

function aiListCancelAddKeyboard(lang, section, listType) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  return inlineKeyboard([
    [
      {
        text: messages[lang].cancelEdit,
        callback_data: `${callBacks.aiListManageCancelAdd}${section}:${listTypeToken}`,
      },
    ],
  ]);
}

const INTEREST_TOP_TEN_CHIPS = [
  { emoji: "♟", fa: "شطرنج", en: "Chess" },
  { emoji: "💻", fa: "کدنویسی", en: "Coding" },
  { emoji: "☕", fa: "قهوه", en: "Coffee" },
  { emoji: "🏙", fa: "کافه‌گردی", en: "Cafes" },
  { emoji: "🎮", fa: "گیم", en: "Gaming" },
  { emoji: "🍜", fa: "غذا", en: "Food" },
  { emoji: "✈️", fa: "سفر", en: "Travel" },
  { emoji: "📸", fa: "عکاسی", en: "Photography" },
  { emoji: "🏃", fa: "ورزش", en: "Sports" },
  { emoji: "🎨", fa: "هنر", en: "Art" },
  { emoji: "🧘", fa: "آرامش", en: "Calm" },
  { emoji: "🎧", fa: "پادکست", en: "Podcast" },
  { emoji: "📺", fa: "یوتیوب", en: "YouTube" },
  { emoji: "🌿", fa: "طبیعت", en: "Nature" },
  { emoji: "🍳", fa: "آشپزی", en: "Cooking" },
];

function aiInterestTopTenChipKeyboard(lang) {
  const rows = [];
  for (let i = 0; i < INTEREST_TOP_TEN_CHIPS.length; i += 3) {
    rows.push(INTEREST_TOP_TEN_CHIPS.slice(i, i + 3).map((chip, index) => ({
      text: `${chip.emoji} ${lang === "fa" ? chip.fa : chip.en}`,
      callback_data: `${callBacks.aiInterestTopTenChip}${i + index}`,
    })));
  }

  rows.push([
    {
      text: messages[lang].cancelEdit,
      callback_data: `${callBacks.aiListManageCancelAdd}random:top_ten`,
    },
  ]);

  return inlineKeyboard(rows);
}

function getInterestTopTenChipTitle(index, lang) {
  const chip = INTEREST_TOP_TEN_CHIPS[index];
  if (!chip) {
    return "";
  }
  return lang === "fa" ? chip.fa : chip.en;
}

function aiListActionItemsKeyboard(lang, section, listType, action, items = []) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  const rows = items.map((entry, index) => ([
    {
      text: `${index + 1}. ${entry.title}`,
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

function aiListCancelCommentKeyboard(lang, section, listType) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  return inlineKeyboard([
    [
      {
        text: messages[lang].cancelEdit,
        callback_data: `${callBacks.aiListManageCancelComment}${section}:${listTypeToken}`,
      },
    ],
  ]);
}

function profileKeyboard(lang, hasPhoto = false, isDiscoverable = false, showsActiveDiscussion = false) {
  const rows = [
    [
      { text: messages[lang].profileEditName, callback_data: callBacks.profileEditName },
    ],
    [
      { text: messages[lang].profileEditPhoto, callback_data: callBacks.profileEditPhoto },
    ],
    [
      { text: messages[lang].profileEditCity, callback_data: callBacks.profileEditCity },
      { text: messages[lang].profileEditAge, callback_data: callBacks.profileEditAge },
    ],
    [
      { text: messages[lang].profileEditGender, callback_data: callBacks.profileEditGender },
    ],
    [
      { text: messages[lang].profileEditPetPreference, callback_data: callBacks.profileEditPetPreference },
    ],
    [
      { text: messages[lang].profileEditLocation, callback_data: callBacks.profileEditLocation },
    ],
    [
      { text: messages[lang].profileEditBio, callback_data: callBacks.profileEditBio },
    ],
    [
      {
        text: isDiscoverable ? messages[lang].profileMakePrivate : messages[lang].profileMakeDiscoverable,
        callback_data: callBacks.profileToggleDiscoverable,
      },
    ],
    [
      {
        text: showsActiveDiscussion
          ? messages[lang].profileHideActiveDiscussion
          : messages[lang].profileShowActiveDiscussion,
        callback_data: callBacks.profileToggleActiveDiscussionVisible,
      },
    ],
  ];

  if (hasPhoto) {
    rows.push([
      { text: messages[lang].profileResetPhoto, callback_data: callBacks.profileResetPhoto },
    ]);
  }

  rows.push([
    { text: messages[lang].cancel, callback_data: callBacks.profileBack },
  ]);

  return inlineKeyboard(rows);
}

function cancelEditKeyboard(lang) {
  return inlineKeyboard([
    [{ text: messages[lang].cancelEdit, callback_data: callBacks.profileCancelEdit }],
  ]);
}

function ltrText(value) {
  return `\u2066${value}\u2069`;
}

function ageKeyboard(lang) {
  const ranges = [];
  for (let start = 10; start <= 79; start += 10) {
    const end = Math.min(start + 9, 79);
    ranges.push({
      text: ltrText(`${start}-${end}`),
      callback_data: `${callBacks.profileAgeRangeSet}${start}`,
    });
  }

  const rows = [];
  for (let index = 0; index < ranges.length; index += 3) {
    rows.push(ranges.slice(index, index + 3).reverse());
  }

  rows.push([{ text: messages[lang].cancelEdit, callback_data: callBacks.profileCancelEdit }]);

  return inlineKeyboard(rows);
}

function ageRangeKeyboard(lang, startAge) {
  const rangeStart = Math.max(10, Math.min(Number(startAge) || 10, 79));
  const rangeEnd = Math.min(rangeStart + 9, 79);
  const ages = [];

  for (let age = rangeStart; age <= rangeEnd; age += 1) {
    ages.push({ text: ltrText(String(age)), callback_data: `${callBacks.profileAgeSet}${age}` });
  }

  const rows = [];
  for (let index = 0; index < ages.length; index += 5) {
    rows.push(ages.slice(index, index + 5).reverse());
  }

  rows.push([{ text: "↩️", callback_data: callBacks.profileAgeRangeBack }]);
  rows.push([{ text: messages[lang].cancelEdit, callback_data: callBacks.profileCancelEdit }]);

  return inlineKeyboard(rows);
}

function petPreferenceKeyboard(lang) {
  return inlineKeyboard([
    [
      { text: messages[lang].petOptionAnyButton, callback_data: `${callBacks.profilePetSet}any` },
      { text: messages[lang].petOptionNoneButton, callback_data: `${callBacks.profilePetSet}none` },
    ],
    [
      { text: messages[lang].petOptionCatButton, callback_data: `${callBacks.profilePetSet}cat` },
      { text: messages[lang].petOptionDogButton, callback_data: `${callBacks.profilePetSet}dog` },
    ],
    [
      { text: messages[lang].petOptionBirdButton, callback_data: `${callBacks.profilePetSet}bird` },
      { text: messages[lang].petOptionSmallPetsButton, callback_data: `${callBacks.profilePetSet}small_pets` },
    ],
    [{ text: messages[lang].cancelEdit, callback_data: callBacks.profileCancelEdit }],
  ]);
}

function genderKeyboard(lang) {
  return inlineKeyboard([
    [
      { text: messages[lang].genderOptionFemaleButton, callback_data: `${callBacks.profileGenderSet}female` },
      { text: messages[lang].genderOptionMaleButton, callback_data: `${callBacks.profileGenderSet}male` },
    ],
    [
      { text: messages[lang].genderOptionOtherButton, callback_data: `${callBacks.profileGenderSet}other` },
    ],
    [{ text: messages[lang].cancelEdit, callback_data: callBacks.profileCancelEdit }],
  ]);
}

function locationKeyboard(lang) {
  return {
    reply_markup: {
      keyboard: [
        [
          {
            text: messages[lang].profileLocationButton,
            request_location: true,
          },
        ],
        [
          {
            text: messages[lang].cancelEdit,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
      selective: true,
    },
  };
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

function discussionsMenuKeyboard(lang) {
  const rows = [
    [{ text: messages[lang].discussionActiveList, callback_data: callBacks.discussionListActive }],
    [{ text: messages[lang].discussionCreate, callback_data: callBacks.discussionCreateStart }],
    [{ text: messages[lang].discussionMyList, callback_data: callBacks.discussionListMine }],
  ];
  rows.push([{ text: messages[lang].aiBack, callback_data: callBacks.menuMain }]);
  return inlineKeyboard(rows);
}

function discussionListNavigationKeyboard(lang, {
  listType = "active",
  page = 0,
  totalPages = 1,
  joinableOnly = false,
} = {}) {
  const rows = [];
  const normalizedPage = Math.max(0, Number(page) || 0);
  const maxPage = Math.max(0, Number(totalPages || 1) - 1);
  const listPrefix = listType === "mine" ? callBacks.discussionListMinePage : callBacks.discussionListActivePage;
  const pageRows = [];

  if (normalizedPage < maxPage) {
    const nextFilter = listType === "active" ? `:${joinableOnly ? "joinable" : "all"}` : "";
    pageRows.push({
      text: `${messages[lang].discussionListMorePage} ➡️`,
      callback_data: `${listPrefix}${normalizedPage + 1}${nextFilter}`,
    });
  }

  if (normalizedPage > 0) {
    const prevFilter = listType === "active" ? `:${joinableOnly ? "joinable" : "all"}` : "";
    pageRows.push({
      text: `⬅️ ${messages[lang].discussionListPrevPage}`,
      callback_data: `${listPrefix}${normalizedPage - 1}${prevFilter}`,
    });
  }

  if (pageRows.length) {
    rows.push(pageRows);
  }

  if (listType === "active") {
    rows.push([{
      text: `🔓 ${joinableOnly ? messages[lang].discussionListShowAll : messages[lang].discussionListOnlyJoinable}`,
      callback_data: `${callBacks.discussionListActivePage}0:${joinableOnly ? "all" : "joinable"}`,
    }]);
  }

  rows.push([{ text: messages[lang].discussionBack, callback_data: callBacks.discussions }]);
  return inlineKeyboard(rows);
}

function discussionRoomKeyboard(lang, isOwner = false) {
  const rows = [
    [
      { text: messages[lang].discussionMembersTitle },
      { text: isOwner ? messages[lang].discussionCloseButton : messages[lang].discussionLeave },
    ],
    [
      { text: messages[lang].discussionReturnToMenu },
    ],
  ];

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  };
}

function discussionCreateDescriptionKeyboard(lang, {
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
} = {}) {
  const rows = [
    [{ text: messages[lang].discussionSkipDescription, callback_data: callBacks.discussionCreateSkipDescription }],
  ];
  if (backButton?.text && backButton?.callback_data) {
    rows.push([{ text: backButton.text, callback_data: backButton.callback_data }]);
  }
  rows.push([{ text: cancelText || messages[lang].discussionCreateCancel, callback_data: cancelCallback }]);
  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

function discussionCreateCancelKeyboard(
  lang,
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
) {
  const rows = [];
  if (backButton?.text && backButton?.callback_data) {
    rows.push([{ text: backButton.text, callback_data: backButton.callback_data }]);
  }
  rows.push([{ text: cancelText || messages[lang].discussionCreateCancel, callback_data: cancelCallback }]);
  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

function discussionJoinRuleKeyboard(lang, {
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
} = {}) {
  const rows = [
    [{ text: messages[lang].discussionJoinRuleOpen, callback_data: callBacks.discussionCreateRuleOpen }],
    [{ text: messages[lang].discussionJoinRuleTaste, callback_data: callBacks.discussionCreateRuleTaste }],
    [{ text: messages[lang].discussionJoinRuleItem, callback_data: callBacks.discussionCreateRuleItem }],
  ];
  if (backButton?.text && backButton?.callback_data) {
    rows.push([{ text: backButton.text, callback_data: backButton.callback_data }]);
  }
  rows.push([{ text: cancelText || messages[lang].discussionCreateCancel, callback_data: cancelCallback }]);
  return inlineKeyboard(rows);
}

function discussionSectionKeyboard(lang, prefix, {
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
} = {}) {
  const rows = [
    [{ text: messages[lang].aiSuggestMovies, callback_data: `${prefix}movies` }],
    [{ text: messages[lang].aiSuggestMusic, callback_data: `${prefix}music` }],
    [{ text: messages[lang].aiSuggestBooks, callback_data: `${prefix}books` }],
    [{ text: messages[lang].aiSuggestRandom, callback_data: `${prefix}random` }],
  ];
  if (backButton?.text && backButton?.callback_data) {
    rows.push([{ text: backButton.text, callback_data: backButton.callback_data }]);
  }
  rows.push([{ text: cancelText || messages[lang].discussionCreateCancel, callback_data: cancelCallback }]);
  return inlineKeyboard(rows);
}

function discussionCreateConfirmKeyboard(lang) {
  return inlineKeyboard([
    [{ text: messages[lang].discussionCreateConfirm, callback_data: callBacks.discussionCreateConfirm }],
    [{ text: messages[lang].discussionEditTitle, callback_data: callBacks.discussionCreateEditTitle }],
    [{ text: messages[lang].discussionEditDescription, callback_data: callBacks.discussionCreateEditDescription }],
    [{ text: messages[lang].discussionEditRule, callback_data: callBacks.discussionCreateEditRule }],
    [{ text: messages[lang].discussionEditCapacity, callback_data: callBacks.discussionCreateEditCapacity }],
    [{ text: messages[lang].discussionCreateCancel, callback_data: callBacks.discussionCreateCancel }],
  ]);
}

function discussionCreateCapacityKeyboard(lang, currentCapacity = 20) {
  const capacities = [2, 3, 4, 5, 10, 15, 20];
  const rows = [];
  for (let index = 0; index < capacities.length; index += 4) {
    const row = capacities.slice(index, index + 4).map((capacity) => ({
      text: Number(currentCapacity) === capacity ? "✅" : ltrText(String(capacity)),
      callback_data: `${callBacks.discussionCreateSetCapacity}${capacity}`,
    }));
    rows.push(lang === "fa" ? row.reverse() : row);
  }
  rows.push([{
    text: messages[lang].discussionCancelEdit || messages[lang].discussionCreateCancel,
    callback_data: callBacks.discussionCreatePreview,
  }]);
  return inlineKeyboard(rows);
}

function discussionSelectTasteKeyboard(lang, section, tasteLabelKey, {
  tasteLabelTitle = "",
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
} = {}) {
  const tasteButtonText = tasteLabelTitle
    ? tasteLabelTitle
    : messages[lang].discussionCreateSelectCurrentTaste;
  const rows = [
    [{ text: tasteButtonText, callback_data: `${callBacks.discussionCreateSelectTaste}${section}:${tasteLabelKey}` }],
  ];
  if (backButton?.text && backButton?.callback_data) {
    rows.push([{ text: backButton.text, callback_data: backButton.callback_data }]);
  }
  rows.push([{ text: cancelText || messages[lang].discussionCreateCancel, callback_data: cancelCallback }]);
  return inlineKeyboard(rows);
}

function discussionSelectItemKeyboard(lang, section, items = [], {
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
} = {}) {
  const rows = items.slice(0, 10).map((entry, index) => ([
    {
      text: entry.title,
      callback_data: `${callBacks.discussionCreateSelectItem}${section}:${index}`,
    },
  ]));
  if (backButton?.text && backButton?.callback_data) {
    rows.push([{ text: backButton.text, callback_data: backButton.callback_data }]);
  }
  rows.push([{ text: cancelText || messages[lang].discussionCreateCancel, callback_data: cancelCallback }]);
  return inlineKeyboard(rows);
}

function discussionRemoveMembersKeyboard(lang, discussionId, members = []) {
  const rows = members.map((entry) => ([
    {
      text: `${entry.profileName || entry.firstName || "کاربر"}`,
      callback_data: `${callBacks.discussionRemoveMember}${discussionId}:${entry.publicProfileCode}`,
    },
  ]));
  rows.push([{ text: messages[lang].discussionBackToRoom, callback_data: `${callBacks.discussionOpen}${discussionId}` }]);
  return inlineKeyboard(rows);
}

function profileViewBackKeyboard(lang) {
  const rows = [[{ text: messages[lang].profileBackToSaved, callback_data: callBacks.savedProfiles }]];
  return inlineKeyboard(rows);
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
      text: `⬅️ ${messages[lang].discussionListPrevPage}`,
      callback_data: `${callBacks.savedProfilesPage}${normalizedPage - 1}`,
    });
  }

  if (pageRows.length) {
    rows.push(pageRows);
  }

  rows.push([{ text: messages[lang].aiBack, callback_data: callBacks.menuMain }]);
  return inlineKeyboard(rows);
}

module.exports = {
  inlineKeyboard,
  mainMenuKeyboard,
  aiAssistantKeyboard,
  aiChatBackKeyboard,
  aiSectionKeyboard,
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionNextKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionContextCancelKeyboard,
  aiSuggestionAddedOptionsKeyboard,
  aiListManageMenuKeyboard,
  aiListRemoveItemsKeyboard,
  aiListCancelAddKeyboard,
  aiInterestTopTenChipKeyboard,
  getInterestTopTenChipTitle,
  aiListActionItemsKeyboard,
  aiListCancelCommentKeyboard,
  profileKeyboard,
  cancelEditKeyboard,
  ageKeyboard,
  ageRangeKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  languageKeyboard,
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionRoomKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionSectionKeyboard,
  discussionCreateConfirmKeyboard,
  discussionCreateCapacityKeyboard,
  discussionSelectTasteKeyboard,
  discussionSelectItemKeyboard,
  discussionRemoveMembersKeyboard,
  profileViewBackKeyboard,
  savedProfilesListKeyboard,
};
