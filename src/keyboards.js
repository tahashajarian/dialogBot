const { callBacks } = require("./constants");
const {
  INTEREST_CHIPS,
  getInterestChipByTitle,
  getInterestChipTitle,
  isInterestChipSelected,
  localizeInterestChipTitle,
} = require("./services/interest-chips");
const messages = require("./messages");
const { operationalLimits } = require("./services/operational-limits");
const { starEconomy } = require("./services/star-settings");
const { getProfileEmojiOptions } = require("./services/profile-emoji");
const {
  AGE_RANGES,
  getProfileAgeRange,
} = require("./services/profile-age");
const {
  getSectionEmoji,
  getSectionListLabel,
} = require("./services/ai-section");
const discussionKeyboards = require("./keyboards/discussions");
const {
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionLanguagePickerKeyboard,
  discussionRoomKeyboard,
  discussionInviteModeKeyboard,
  discussionInviteSavedProfilesKeyboard,
  discussionInviteNoSavedProfilesKeyboard,
  discussionInviteDiscussionPickerKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationsBackKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  normalizeDiscussionJoinErrorDestination,
  discussionBoostAckKeyboard,
  discussionCreateGuidanceAckKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionSectionKeyboard,
  discussionCreateConfirmKeyboard,
  discussionCreateLanguagePickerKeyboard,
  discussionCreateCapacityKeyboard,
  discussionPaidCapacityConfirmKeyboard,
  discussionPaidCapacityAckKeyboard,
  discussionSelectTasteKeyboard,
  discussionSelectItemKeyboard,
  discussionRemoveMembersKeyboard,
} = discussionKeyboards;

function inlineKeyboard(rows) {
  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

function mainMenuKeyboard(lang) {
  return { reply_markup: { keyboard: [
    [{ text: messages[lang].aiAssistant }, { text: messages[lang].discussions }],
    [{ text: messages[lang].people }, { text: messages[lang].mainMenuMe }],
    [{ text: messages[lang].help }, { text: messages[lang].language }],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function helpKeyboard(lang) {
  return { reply_markup: { keyboard: [
    [{
      text: messages[lang].profileStarsButton,
    }],
    [{
      text: messages[lang].helpReferralButton,
    }],
    [{
      text: messages[lang].helpRules,
    }],
    [{
      text: messages[lang].helpBackToMain,
    }],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function helpReferralKeyboard(lang, shareUrl = "", copyUrl = "") {
  return inlineKeyboard([
    ...(shareUrl ? [[{ text: messages[lang].helpReferralShare, url: shareUrl }]] : []),
    ...(copyUrl ? [[{ text: messages[lang].helpReferralCopy, copy_text: { text: copyUrl } }]] : []),
    [{ text: messages[lang].helpBackToGuide, callback_data: callBacks.helpReferralBack }],
  ]);
}

function helpRulesKeyboard(lang) {
  return { reply_markup: { keyboard: [
    [{
      text: messages[lang].helpBackToGuide,
    }],
    [{
      text: messages[lang].helpBackToMain,
    }],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
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
        text: messages[lang].aiBack,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
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
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function aiSuggestionNextKeyboard(lang, section) {
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
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
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

function aiSuggestionModeKeyboard(lang, section) {
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].aiSuggestionFromTopTenButton,
      },
    ],
    [
      {
        text: messages[lang].aiSuggestionWithContextButton,
      },
    ],
    [
      {
        text: messages[lang].aiBack,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function aiSuggestionNeedTopTenKeyboard(lang, section) {
  return inlineKeyboard([[
    {
      text: messages[lang].acknowledgeButton,
      callback_data: `${callBacks.aiSectionSuggestNeedTopTenAck}${section}`,
    },
  ]]);
}

function aiSuggestionContextCancelKeyboard(lang, section) {
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].cancelEdit,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
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
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
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

function aiListManageMenuKeyboard(lang, section, listType, { hasItems = false, itemCount = 0, filter = "all" } = {}) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
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
    rows.push([
      {
        text: listButtonText,
      },
    ]);
    if (itemCount >= 3) {
      rows.push([
        {
          text: `${getSectionEmoji(section)} ${messages[lang].aiSectionSuggestButton}`,
        },
      ]);
    }
  }

  if (listType === "topTen" && itemCount > 5) {
    rows.push([
      {
        text: messages[lang].aiListManageShare,
      },
    ]);
  }

  if (listType === "watchlist" && hasItems) {
    const statusLabels = getSectionStatusLabels(lang, section);
    if (filter !== "all") rows.push([{ text: messages[lang].aiListManageShowAll }]);
    else rows.push([
      {
        text: statusLabels.done,
      },
      {
        text: statusLabels.pending,
      },
    ]);
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

  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } };
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

function aiListCancelAddKeyboard(lang, section, listType, { backToList = false } = {}) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  return { reply_markup: { keyboard: [
    [
      {
        text: backToList ? messages[lang].aiListManageAddBackToList : messages[lang].cancelEdit,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

const INTEREST_CHIPS_PER_PAGE = 9;
const ONBOARDING_CHIPS_PER_PAGE = 12;

function getPagedInterestChips(lang, selectedTitles = [], page = 0, pageSize = INTEREST_CHIPS_PER_PAGE) {
  const chipsPerPage = Number(pageSize) || INTEREST_CHIPS_PER_PAGE;
  const totalPages = Math.ceil(INTEREST_CHIPS.length / chipsPerPage);
  const normalizedPage = ((Number(page) || 0) % totalPages + totalPages) % totalPages;
  const pageStart = normalizedPage * chipsPerPage;
  const available = [];

  for (let offset = 0; offset < INTEREST_CHIPS.length; offset += 1) {
    const index = (pageStart + offset) % INTEREST_CHIPS.length;
    const chip = INTEREST_CHIPS[index];
    if (isInterestChipSelected(chip, selectedTitles)) continue;
    available.push({ chip, index });
    if (available.length >= chipsPerPage) break;
  }

  return { available, normalizedPage, totalPages };
}

function getFixedInterestChipPage(page = 0, pageSize = INTEREST_CHIPS_PER_PAGE) {
  const chipsPerPage = Number(pageSize) || INTEREST_CHIPS_PER_PAGE;
  const totalPages = Math.ceil(INTEREST_CHIPS.length / chipsPerPage);
  const normalizedPage = ((Number(page) || 0) % totalPages + totalPages) % totalPages;
  const pageStart = normalizedPage * chipsPerPage;
  const pageChips = [];

  for (let offset = 0; offset < chipsPerPage; offset += 1) {
    const index = (pageStart + offset) % INTEREST_CHIPS.length;
    pageChips.push({ chip: INTEREST_CHIPS[index], index });
  }

  return { pageChips, normalizedPage, totalPages };
}

function getSelectedChipIndex(selectedTitles = [], chip) {
  return selectedTitles.findIndex((title) => getInterestChipByTitle(title) === chip);
}

function buildFixedInterestRows(lang, selectedItems = [], page = 0, {
  pageSize = INTEREST_CHIPS_PER_PAGE,
  chipCallbackPrefix,
  removeCallbackPrefix,
} = {}) {
  const selectedTitles = selectedItems.map((entry) => entry.title || entry);
  const customSelectedItems = selectedItems
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !getInterestChipByTitle(entry.title || entry));
  const { pageChips, normalizedPage, totalPages } = getFixedInterestChipPage(page, pageSize);
  const rows = [];

  for (let i = 0; i < customSelectedItems.length; i += 3) {
    rows.push(customSelectedItems.slice(i, i + 3).map(({ entry, index }) => ({
      text: `${localizeInterestChipTitle(entry.title || entry, lang)} ✓`,
      callback_data: `${removeCallbackPrefix}${index}:${normalizedPage}`,
    })));
  }

  for (let i = 0; i < pageChips.length; i += 3) {
    rows.push(pageChips.slice(i, i + 3).map(({ chip, index }) => {
      const selectedIndex = getSelectedChipIndex(selectedTitles, chip);
      const selected = selectedIndex >= 0;
      return {
        text: `${chip.emoji} ${getInterestChipTitle(chip, lang)}${selected ? " ✓" : ""}`,
        callback_data: selected ? `${removeCallbackPrefix}${selectedIndex}:${normalizedPage}` : `${chipCallbackPrefix}${index}:${normalizedPage}`,
      };
    }));
  }

  return { rows, normalizedPage, totalPages };
}

function aiInterestTopTenChipKeyboard(lang, selectedTitles = [], page = 0, { backToList = false } = {}) {
  const { available, normalizedPage, totalPages } = getPagedInterestChips(lang, selectedTitles, page);
  const rows = [];

  for (let i = 0; i < available.length; i += 3) {
    rows.push(available.slice(i, i + 3).map(({ chip, index }) => ({
      text: `${chip.emoji} ${getInterestChipTitle(chip, lang)}`,
      callback_data: `${callBacks.aiInterestTopTenChip}${index}`,
    })));
  }

  rows.push([{
    text: messages[lang].onboardingMoreButton,
    callback_data: `${callBacks.aiInterestTopTenMore}${(normalizedPage + 1) % totalPages}${backToList ? ":back" : ""}`,
  }]);

  rows.push([
    {
      text: backToList ? messages[lang].aiListManageAddBackToList : messages[lang].cancelEdit,
      callback_data: `${callBacks.aiListManageCancelAdd}random:top_ten${backToList ? ":back" : ""}`,
    },
  ]);

  return inlineKeyboard(rows);
}

function getInterestTopTenChipTitle(index, lang) {
  const chip = INTEREST_CHIPS[index];
  if (!chip) {
    return "";
  }
  return getInterestChipTitle(chip, lang);
}

function getOnboardingInterestChipTitle(index, lang) {
  const chip = INTEREST_CHIPS[index];
  if (!chip) {
    return "";
  }
  return getInterestChipTitle(chip, lang);
}

function onboardingWelcomeKeyboard(lang) {
  return replyKeyboardFromActions([[{
    text: messages[lang].onboardingStartButton,
    callback_data: callBacks.onboardingStart,
  }]]);
}

function getOnboardingInterestsReplyActions(lang, selectedTitles = [], page = 0) {
  const { rows, normalizedPage, totalPages } = buildFixedInterestRows(lang, selectedTitles, page, {
    pageSize: ONBOARDING_CHIPS_PER_PAGE,
    chipCallbackPrefix: callBacks.onboardingInterest,
    removeCallbackPrefix: callBacks.onboardingInterestRemove,
  });

  rows.push([{
    text: messages[lang].onboardingMoreButton,
    callback_data: `${callBacks.onboardingMore}${(normalizedPage + 1) % totalPages}`,
  }]);

  return rows;
}

function replyKeyboardFromActions(rows, { oneTime = false } = {}) {
  return {
    reply_markup: {
      keyboard: rows.map((row) => row.map(({ text }) => ({ text }))),
      resize_keyboard: true,
      one_time_keyboard: oneTime,
      selective: true,
    },
  };
}

function onboardingInterestsKeyboard(lang, selectedTitles = [], page = 0) {
  return replyKeyboardFromActions(getOnboardingInterestsReplyActions(lang, selectedTitles, page));
}

function onboardingTasteSetupNudgeKeyboard(lang) {
  return replyKeyboardFromActions([
    [{
      text: messages[lang].onboardingTasteSetupStartButton,
      callback_data: callBacks.onboardingTasteSetupStart,
    }],
    [{
      text: messages[lang].onboardingTasteSetupLaterButton,
      callback_data: callBacks.onboardingTasteSetupDismiss,
    }],
  ]);
}

function profileInterestsKeyboard(lang, selectedItems = [], page = 0) {
  const actions = getProfileInterestsReplyActions(lang, selectedItems, page);
  return { reply_markup: { keyboard: actions.map((row) => row.map(({ text }) => ({ text }))), resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function getProfileInterestsReplyActions(lang, selectedItems = [], page = 0) {
  const { rows, normalizedPage, totalPages } = buildFixedInterestRows(lang, selectedItems, page, {
    chipCallbackPrefix: callBacks.profileInterestChip,
    removeCallbackPrefix: callBacks.profileInterestRemove,
  });

  rows.push([{
    text: messages[lang].onboardingMoreButton,
    callback_data: `${callBacks.profileInterestMore}${(normalizedPage + 1) % totalPages}`,
  }]);

  rows.push([{
    text: messages[lang].profileInterestsDone,
    callback_data: callBacks.profileInterestsDone,
  }]);

  return rows;
}

function onboardingCompleteKeyboard(lang, { hasInvitation = false, discussionContinuation = false } = {}) {
  return replyKeyboardFromActions([
    ...(discussionContinuation ? [[{
      text: messages[lang].onboardingDiscussionContinueButton,
      callback_data: callBacks.onboardingDiscussionContinue,
    }]] : []),
    ...(hasInvitation ? [[{
      text: messages[lang].onboardingInvitationButton,
      callback_data: callBacks.discussionInvitations,
    }]] : []),
    [{
      text: messages[lang].discussionActiveList,
      callback_data: callBacks.discussionListActive,
    }],
    [{
      text: messages[lang].onboardingFavoritesButton,
      callback_data: callBacks.aiAssistant,
    }],
    [{
      text: messages[lang].onboardingMainMenuButton,
      callback_data: callBacks.menuMain,
    }],
  ]);
}

function aiListActionItemsKeyboard(lang, section, listType, action, items = []) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  const rows = items.map((entry, index) => ([
    {
      text: action === "toggle"
        ? `${entry?.watched ? "✅" : "⏳"} ${index + 1}. ${entry.title}`
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

function aiListCancelCommentKeyboard(lang, section, listType) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  return { reply_markup: { keyboard: [
    [
      {
        text: messages[lang].cancelEdit,
      },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function profileKeyboard(lang, hasPhoto = false) {
  const rows = [
    [
      { text: messages[lang].profileEditName },
      { text: messages[lang].profileEditAge },
    ],
    hasPhoto
      ? [
        { text: messages[lang].profileEditPhoto },
        { text: messages[lang].profileResetPhoto },
      ]
      : [
        { text: messages[lang].profileEditPhoto },
      ],
    [
      { text: messages[lang].profileEditCity },
      { text: messages[lang].profileEditGender },
    ],
    [
      { text: messages[lang].profileEditInterests },
    ],
    [
      { text: messages[lang].profileMoreSettings },
    ],
    [
      { text: messages[lang].cancel },
    ],
  ];

  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function profileSettingsKeyboard(lang, showsActiveDiscussion = false) {
  return { reply_markup: { keyboard: [
    [
      { text: messages[lang].profileEditBio },
      { text: messages[lang].profileEditPetPreference },
    ],
    [
      { text: messages[lang].profileEditLocation },
      {
        text: showsActiveDiscussion
          ? messages[lang].profileHideActiveDiscussion
          : messages[lang].profileShowActiveDiscussion,
      },
    ],
    [
      { text: messages[lang].profileEmojiButton },
    ],
    [{ text: messages[lang].accountDeleteButton }],
    [
      { text: messages[lang].profileBackToProfile },
    ],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function accountDeleteWarningKeyboard(lang) {
  return inlineKeyboard([
    [{ text: messages[lang].accountDeleteContinueButton, callback_data: callBacks.accountDeleteContinue }],
    [{ text: messages[lang].accountDeleteCancelButton, callback_data: callBacks.accountDeleteCancel }],
  ]);
}

function accountDeleteConfirmKeyboard(lang, nonce) {
  return inlineKeyboard([
    [{ text: messages[lang].accountDeleteConfirmButton, callback_data: `${callBacks.accountDeleteConfirm}${nonce}` }],
    [{ text: messages[lang].accountDeleteCancelButton, callback_data: callBacks.accountDeleteCancel }],
  ]);
}

function startAgainKeyboard(lang) {
  return { reply_markup: { keyboard: [[{ text: messages[lang].accountStartAgainButton }]], resize_keyboard: true } };
}

const PROFILE_EMOJI_PAGE_SIZE = 20;

function profileEmojiKeyboard(lang, currentEmoji = "", page = 0) {
  const options = getProfileEmojiOptions();
  const pageCount = Math.max(1, Math.ceil(options.length / PROFILE_EMOJI_PAGE_SIZE));
  const normalizedPage = Math.min(pageCount - 1, Math.max(0, Number(page) || 0));
  const start = normalizedPage * PROFILE_EMOJI_PAGE_SIZE;
  const visibleOptions = options.slice(start, start + PROFILE_EMOJI_PAGE_SIZE);
  const rows = [];
  for (let i = 0; i < visibleOptions.length; i += 4) {
    rows.push(visibleOptions.slice(i, i + 4).map((emoji, offset) => ({
      text: emoji === currentEmoji ? `${emoji} ✓` : emoji,
      callback_data: `${callBacks.profileEmojiChoose}${start + i + offset}`,
    })));
  }
  if (pageCount > 1) {
    rows.push([{
      text: messages[lang].profileEmojiMoreButton,
      callback_data: `${callBacks.profileEmojiPage}${(normalizedPage + 1) % pageCount}`,
    }]);
  }
  rows.push([{ text: messages[lang].profileBackToSettings, callback_data: callBacks.profileSettings }]);
  return inlineKeyboard(rows);
}

function profileEmojiConfirmKeyboard(lang, nonce, cost) {
  return inlineKeyboard([
    [{
      text: messages[lang].profileEmojiConfirmButton.replace("{cost}", formatKeyboardNumber(lang, cost)),
      callback_data: `${callBacks.profileEmojiConfirm}${nonce}`,
    }],
    [{
      text: messages[lang].profileEmojiCancelButton,
      callback_data: callBacks.profileEmojiCancel,
    }],
  ]);
}

function profileEmojiInsufficientKeyboard(lang) {
  return inlineKeyboard([[
    { text: messages[lang].acknowledgeButton, callback_data: callBacks.profileEmojiInsufficientDone },
  ]]);
}

function profileActiveDiscussionHelpKeyboard(lang) {
  return inlineKeyboard([
    [
      {
        text: messages[lang].profileActiveDiscussionHelpDone,
        callback_data: callBacks.profileActiveDiscussionHelpDone,
      },
    ],
  ]);
}

function profileStarsKeyboard(lang) {
  return { reply_markup: { keyboard: [[{ text: messages[lang].profileStarsBack }]], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function cancelEditKeyboard(lang) {
  return { reply_markup: { keyboard: [[{ text: messages[lang].cancelEdit }]], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function ltrText(value) {
  return `\u2066${value}\u2069`;
}

function ageKeyboard(lang) {
  const ranges = AGE_RANGES.map(([start, end]) => ({
    text: ltrText(`${start}-${end}`),
  }));

  const rows = [];
  for (let index = 0; index < ranges.length; index += 3) {
    rows.push(ranges.slice(index, index + 3));
  }

  rows.push([{ text: messages[lang].cancelEdit }]);

  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function ageRangeKeyboard(lang, startAge) {
  const [rangeStart, rangeEnd] = getProfileAgeRange(startAge);
  const ages = [];

  for (let age = rangeStart; age <= rangeEnd; age += 1) {
    ages.push({ text: ltrText(String(age)) });
  }

  const rows = [];
  for (let index = 0; index < ages.length; index += 5) {
    rows.push(ages.slice(index, index + 5));
  }

  rows.push([{ text: "🔙" }]);
  rows.push([{ text: messages[lang].cancelEdit }]);

  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function petPreferenceKeyboard(lang) {
  return { reply_markup: { keyboard: [
    [
      { text: messages[lang].petOptionAnyButton },
      { text: messages[lang].petOptionNoneButton },
    ],
    [
      { text: messages[lang].petOptionCatButton },
      { text: messages[lang].petOptionDogButton },
    ],
    [
      { text: messages[lang].petOptionBirdButton },
      { text: messages[lang].petOptionSmallPetsButton },
    ],
    [{ text: messages[lang].cancelEdit }],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function genderKeyboard(lang) {
  return { reply_markup: { keyboard: [
    [
      { text: messages[lang].genderOptionFemaleButton },
      { text: messages[lang].genderOptionMaleButton },
    ],
    [
      { text: messages[lang].genderOptionOtherButton },
    ],
    [{ text: messages[lang].cancelEdit }],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
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

function languageKeyboard(lang = "fa") {
  return { reply_markup: { keyboard: [
    [
      { text: "🇮🇷 فارسی" },
      { text: "🇬🇧 English" },
    ],
    [{ text: messages[lang].aiBack }],
  ], resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function onboardingLanguageKeyboard() {
  return replyKeyboardFromActions([[
    { text: "🇮🇷 فارسی", callback_data: callBacks.langSetFa },
    { text: "🇬🇧 English", callback_data: callBacks.langSetEn },
  ]]);
}

function profileViewBackKeyboard(lang) {
  return inlineKeyboard([[{ text: messages[lang].profileBackToSaved, callback_data: callBacks.savedProfiles }]]);
}

function profilePeopleBackKeyboard(lang) {
  return inlineKeyboard([[
    {
      text: messages[lang].aiBack,
      callback_data: callBacks.peopleDiscover,
    },
  ]]);
}

function profilePublicActionsKeyboard(lang, code, {
  isSaved = false,
  hasDiscussions = false,
  source = "people",
} = {}) {
  const normalizedCode = String(code || "");
  const discussionSource = source === "saved" ? "saved" : "browse";
  const actionSuffix = source === "discussion_members" ? ":members" : "";
  const rows = [];

  if (source !== "discussion_members" && isSaved && hasDiscussions) {
    rows.push([{
      text: messages[lang].savedProfileDiscussions,
      callback_data: `${callBacks.savedProfilesDiscussions}${discussionSource}:${normalizedCode}`,
    }]);
  }

  if (isSaved) {
    if (source !== "discussion_members") rows.push([{
      text: messages[lang].savedProfileRemove,
      callback_data: `${callBacks.profileUnsaveByCode}${normalizedCode}${actionSuffix}`,
    }]);
  } else {
    rows.push([{
      text: messages[lang].profileSaveButton,
      callback_data: `${callBacks.profileSaveByCode}${normalizedCode}${actionSuffix}`,
    }]);
  }

  if (source === "discussion_members") {
    rows.push([{ text: messages[lang].discussionShareClose, callback_data: callBacks.profileCloseDiscussionMember }]);
  } else if (source === "saved") {
    rows.push([{ text: messages[lang].profileBackToSaved, callback_data: callBacks.savedProfiles }]);
  } else {
    rows.push([{
      text: messages[lang].aiBack,
      callback_data: callBacks.peopleDiscover,
    }]);
  }

  if (source === "discussion_members") return inlineKeyboard(rows);
  return {
    reply_markup: {
      keyboard: rows.map((row) => row.map((button) => ({ text: button.text }))),
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  };
}

function profileInvitationBackKeyboard(lang, userId = "") {
  const rows = [[{ text: messages[lang].profileBackToInvitations, callback_data: callBacks.discussionInvitations }]];
  const mutedUserId = Number(userId);
  if (Number.isInteger(mutedUserId) && mutedUserId > 0) {
    rows.unshift([{
      text: messages[lang].discussionInvitationMuteInviter,
      callback_data: `${callBacks.discussionInvitationMute}${mutedUserId}`,
    }]);
  }
  return inlineKeyboard(rows);
}

function savedProfilesListKeyboard(lang, items = []) {
  const rows = [];
  const options = items && !Array.isArray(items) ? items : {};
  const normalizedPage = Math.max(0, Number(options.page) || 0);
  const maxPage = Math.max(0, Number(options.totalPages || 1) - 1);
  const pageRows = [];

  if (normalizedPage < maxPage) {
    pageRows.push({ text: `${messages[lang].discussionListMorePage} ➡️` });
  }

  if (normalizedPage > 0) {
    pageRows.push({ text: `🔙 ${messages[lang].discussionListPrevPage}` });
  }

  if (pageRows.length) {
    rows.push(pageRows);
  }

  rows.push([{ text: messages[lang].aiBack }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } };
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
  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function advancedSearchPreviewKeyboard(lang, { notified = false } = {}) {
  const rows = [];
  if (!notified && starEconomy.advancedSearchNotifyEnabled) {
    rows.push([{
      text: messages[lang].advancedSearchNotifyButton,
      callback_data: callBacks.peopleAdvancedSearchNotify,
    }]);
  }
  rows.push([{
    text: messages[lang].peopleBackToHub,
    callback_data: callBacks.peopleAdvancedSearchBack,
  }]);
  return inlineKeyboard(rows);
}

function formatKeyboardNumber(lang, value) {
  const number = Number(value) || 0;
  if (lang !== "fa") return String(number);
  return new Intl.NumberFormat("fa-IR").format(number);
}

function peopleDiscoverListKeyboard(lang, options = {}) {
  const rows = [];
  const normalizedPage = Math.max(0, Number(options.page) || 0);
  const maxPage = Math.max(0, Number(options.totalPages || 1) - 1);
  const pageRows = [];

  if (normalizedPage < maxPage) {
    pageRows.push({ text: `${messages[lang].discussionListMorePage} ➡️` });
  }

  if (normalizedPage > 0) {
    pageRows.push({ text: `🔙 ${messages[lang].discussionListPrevPage}` });
  }

  if (pageRows.length) rows.push(pageRows);
  if (options.showLists) {
    rows.push([{ text: messages[lang].peopleGoToLists }]);
  }
  rows.push([{ text: messages[lang].aiBack }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function peopleDiscoverEmptyKeyboard(lang) {
  return {
    reply_markup: {
      keyboard: [
        [{ text: messages[lang].peopleGoToLists }],
        [{ text: messages[lang].aiBack }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  };
}

module.exports = {
  ONBOARDING_CHIPS_PER_PAGE,
  inlineKeyboard,
  mainMenuKeyboard,
  helpKeyboard,
  helpRulesKeyboard,
  helpReferralKeyboard,
  aiAssistantKeyboard,
  aiChatBackKeyboard,
  aiSectionKeyboard,
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionNextKeyboard,
  aiSuggestionLimitKeyboard,
  aiPaidSuggestionConfirmKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionNeedTopTenKeyboard,
  aiSuggestionContextCancelKeyboard,
  aiSuggestionAddedOptionsKeyboard,
  aiListManageMenuKeyboard,
  aiListRemoveItemsKeyboard,
  aiListCancelAddKeyboard,
  aiInterestTopTenChipKeyboard,
  getInterestTopTenChipTitle,
  getOnboardingInterestChipTitle,
  onboardingWelcomeKeyboard,
  onboardingInterestsKeyboard,
  getOnboardingInterestsReplyActions,
  onboardingTasteSetupNudgeKeyboard,
  onboardingCompleteKeyboard,
  profileInterestsKeyboard,
  getProfileInterestsReplyActions,
  aiListActionItemsKeyboard,
  aiListCancelCommentKeyboard,
  profileKeyboard,
  profileSettingsKeyboard,
  accountDeleteWarningKeyboard,
  accountDeleteConfirmKeyboard,
  startAgainKeyboard,
  profileEmojiKeyboard,
  profileEmojiConfirmKeyboard,
  profileEmojiInsufficientKeyboard,
  profileActiveDiscussionHelpKeyboard,
  profileStarsKeyboard,
  cancelEditKeyboard,
  ageKeyboard,
  ageRangeKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  languageKeyboard,
  onboardingLanguageKeyboard,
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionLanguagePickerKeyboard,
  discussionRoomKeyboard,
  discussionInviteModeKeyboard,
  discussionInviteSavedProfilesKeyboard,
  discussionInviteNoSavedProfilesKeyboard,
  discussionInviteDiscussionPickerKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationsBackKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  normalizeDiscussionJoinErrorDestination,
  discussionBoostAckKeyboard,
  discussionCreateGuidanceAckKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionSectionKeyboard,
  discussionCreateConfirmKeyboard,
  discussionCreateLanguagePickerKeyboard,
  discussionCreateCapacityKeyboard,
  discussionPaidCapacityConfirmKeyboard,
  discussionPaidCapacityAckKeyboard,
  discussionSelectTasteKeyboard,
  discussionSelectItemKeyboard,
  discussionRemoveMembersKeyboard,
  profileViewBackKeyboard,
  profilePeopleBackKeyboard,
  profilePublicActionsKeyboard,
  profileInvitationBackKeyboard,
  savedProfilesListKeyboard,
  peopleHubKeyboard,
  advancedSearchPreviewKeyboard,
  peopleDiscoverListKeyboard,
  peopleDiscoverEmptyKeyboard,
};
