const { callBacks } = require("./constants");
const {
  INTEREST_CHIPS,
  getInterestChipTitle,
  isInterestChipSelected,
  localizeInterestChipTitle,
} = require("./services/interest-chips");
const messages = require("./messages");
const { operationalLimits } = require("./services/operational-limits");
const { starEconomy } = require("./services/star-settings");
const { getProfileEmojiOptions } = require("./services/profile-emoji");
const discussionKeyboards = require("./keyboards/discussions");
const {
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionRoomKeyboard,
  discussionInviteModeKeyboard,
  discussionInviteSavedProfilesKeyboard,
  discussionInviteNoSavedProfilesKeyboard,
  discussionInviteDiscussionPickerKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationsBackKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionBoostAckKeyboard,
  discussionCreateGuidanceAckKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionSectionKeyboard,
  discussionCreateConfirmKeyboard,
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
  return inlineKeyboard([
    [
      {
        text: messages[lang].language,
        callback_data: callBacks.language,
      },
    ],
    [
      {
        text: messages[lang].mainMenuMe,
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
        text: messages[lang].people,
        callback_data: callBacks.people,
      },
    ],
    [
      {
        text: messages[lang].help,
        callback_data: callBacks.help,
      },
    ],
  ]);
}

function helpKeyboard(lang) {
  return inlineKeyboard([
    [{
      text: messages[lang].profileStarsButton,
      callback_data: callBacks.profileStars,
    }],
    [{
      text: messages[lang].helpRules,
      callback_data: callBacks.helpRules,
    }],
    [{
      text: messages[lang].helpGoToLists,
      callback_data: callBacks.aiAssistant,
    }],
    [{
      text: messages[lang].helpBrowseDiscussions,
      callback_data: callBacks.discussionListActive,
    }],
    [{
      text: messages[lang].helpBackToMain,
      callback_data: callBacks.menuMain,
    }],
  ]);
}

function helpRulesKeyboard(lang) {
  return inlineKeyboard([
    [{
      text: messages[lang].helpBackToGuide,
      callback_data: callBacks.help,
    }],
    [{
      text: messages[lang].helpBackToMain,
      callback_data: callBacks.menuMain,
    }],
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
        text: messages[lang].aiSuggestBooks,
        callback_data: callBacks.aiSuggestBooks,
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
    [
      {
        text: messages[lang].aiSuggestionRejectButton,
        callback_data: `${callBacks.aiSectionRejectSuggestion}${section}`,
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
  const sectionCallbacks = {
    movies: callBacks.aiSuggestMovies,
    music: callBacks.aiSuggestMusic,
    books: callBacks.aiSuggestBooks,
    random: callBacks.aiSuggestRandom,
  };
  return inlineKeyboard([
    [{
      text: messages[lang].aiSuggestionPaidConfirmButton.replace("{cost}", formatKeyboardNumber(lang, cost)),
      callback_data: `${callBacks.aiPaidSuggestionConfirm}${publicCode}`,
    }],
    [{
      text: messages[lang].aiSuggestionPaidCancelButton,
      callback_data: `${callBacks.aiPaidSuggestionCancel}${section}`,
    }],
    [{
      text: messages[lang].aiBack,
      callback_data: sectionCallbacks[section] || callBacks.aiBack,
    }],
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

function aiListManageMenuKeyboard(lang, section, listType, { hasItems = false, itemCount = 0 } = {}) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  const rows = [];
  const canAdd = !(listType === "topTen" && itemCount >= operationalLimits.aiTopTenItems);

  if (canAdd) {
    rows.push([
      {
        text: messages[lang].aiListManageAdd,
        callback_data: `${callBacks.aiListManageAdd}${section}:${listTypeToken}`,
      },
    ]);
  }

  if (hasItems) {
    rows.push([
      {
        text: messages[lang].aiListManageShow,
        callback_data: `${callBacks.aiListManageShow}${section}:${listTypeToken}`,
      },
    ]);
  }

  if (itemCount > 5) {
    rows.push([
      {
        text: messages[lang].aiListManageShare,
        callback_data: `${callBacks.aiListManageShare}${section}:${listTypeToken}`,
      },
    ]);
  }

  if (listType === "watchlist" && hasItems) {
    const statusLabels = getSectionStatusLabels(lang, section);
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

function aiListCancelAddKeyboard(lang, section, listType, { backToList = false } = {}) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  return inlineKeyboard([
    [
      {
        text: backToList ? messages[lang].aiListManageAddBackToList : messages[lang].cancelEdit,
        callback_data: `${callBacks.aiListManageCancelAdd}${section}:${listTypeToken}${backToList ? ":back" : ""}`,
      },
    ],
  ]);
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
  return inlineKeyboard([[
    {
      text: messages[lang].onboardingStartButton,
      callback_data: callBacks.onboardingStart,
    },
  ]]);
}

function onboardingInterestsKeyboard(lang, selectedTitles = [], page = 0) {
  const { available, normalizedPage, totalPages } = getPagedInterestChips(
    lang,
    selectedTitles,
    page,
    ONBOARDING_CHIPS_PER_PAGE,
  );
  const rows = [];
  const availableButtons = available.map(({ chip, index }) => ({
    text: `${chip.emoji} ${getInterestChipTitle(chip, lang)}`,
    callback_data: `${callBacks.onboardingInterest}${index}`,
  }));

  for (let i = 0; i < selectedTitles.length; i += 3) {
    const row = selectedTitles.slice(i, i + 3).map((title, offset) => ({
      text: `${localizeInterestChipTitle(title, lang)} ×`,
      callback_data: `${callBacks.onboardingInterestRemove}${i + offset}`,
    }));
    while (row.length < 3) {
      const nextButton = availableButtons.shift();
      if (!nextButton) break;
      row.push(nextButton);
    }
    rows.push(row);
  }

  for (let i = 0; i + 2 < availableButtons.length; i += 3) {
    rows.push(availableButtons.slice(i, i + 3));
  }

  rows.push([{
    text: messages[lang].onboardingMoreButton,
    callback_data: `${callBacks.onboardingMore}${(normalizedPage + 1) % totalPages}`,
  }, {
    text: messages[lang].onboardingCustomButton,
    callback_data: `${callBacks.onboardingCustom}${normalizedPage}`,
  }]);

  if (selectedTitles.length >= operationalLimits.onboardingInterestMinItems) {
    rows.push([{
      text: messages[lang].onboardingContinueButton,
      callback_data: callBacks.onboardingContinue,
    }]);
  }

  return inlineKeyboard(rows);
}

function onboardingCustomInterestKeyboard(lang, page = 0) {
  return inlineKeyboard([[
    {
      text: messages[lang].onboardingCustomCancelButton,
      callback_data: `${callBacks.onboardingCustomCancel}${Number(page) || 0}`,
    },
  ]]);
}

function profileInterestsKeyboard(lang, selectedItems = [], page = 0) {
  const selectedTitles = selectedItems.map((entry) => entry.title || entry);
  const { available, normalizedPage, totalPages } = getPagedInterestChips(lang, selectedTitles, page);
  const rows = [];
  const availableButtons = available.map(({ chip, index }) => ({
    text: `${chip.emoji} ${getInterestChipTitle(chip, lang)}`,
    callback_data: `${callBacks.profileInterestChip}${index}`,
  }));

  for (let i = 0; i < selectedItems.length; i += 3) {
    const row = selectedItems.slice(i, i + 3).map((entry, offset) => ({
      text: `${localizeInterestChipTitle(entry.title || entry, lang)} ×`,
      callback_data: `${callBacks.profileInterestRemove}${i + offset}`,
    }));
    while (row.length < 3) {
      const nextButton = availableButtons.shift();
      if (!nextButton) break;
      row.push(nextButton);
    }
    rows.push(row);
  }

  for (let i = 0; i + 2 < availableButtons.length; i += 3) {
    rows.push(availableButtons.slice(i, i + 3));
  }

  rows.push([{
    text: messages[lang].onboardingMoreButton,
    callback_data: `${callBacks.profileInterestMore}${(normalizedPage + 1) % totalPages}`,
  }]);

  rows.push([{
    text: messages[lang].profileInterestsDone,
    callback_data: callBacks.profileInterestsDone,
  }]);

  return inlineKeyboard(rows);
}

function onboardingCompleteKeyboard(lang, { invitationCount = 0 } = {}) {
  return inlineKeyboard([
    [{
      text: messages[lang].discussionInvitationsWithCount.replace(
        "{count}",
        String(Math.max(0, Number(invitationCount) || 0)),
      ),
      callback_data: callBacks.discussionInvitations,
    }],
    [{
      text: messages[lang].discussionActiveList,
      callback_data: callBacks.discussionListActive,
    }],
    [{
      text: messages[lang].peopleGoToLists,
      callback_data: callBacks.aiAssistant,
    }],
    [{
      text: messages[lang].onboardingMainMenuButton,
      callback_data: callBacks.menuMain,
    }],
    [{
      text: messages[lang].help,
      callback_data: callBacks.help,
    }],
  ]);
}

function aiListActionItemsKeyboard(lang, section, listType, action, items = []) {
  const listTypeToken = listType === "watchlist" ? "watchlist" : "top_ten";
  const rows = items.map((entry, index) => ([
    {
      text: action === "toggle"
        ? `${entry?.watched ? "✅" : "⬜"} ${index + 1}. ${entry.title}`
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
  return inlineKeyboard([
    [
      {
        text: messages[lang].cancelEdit,
        callback_data: `${callBacks.aiListManageCancelComment}${section}:${listTypeToken}`,
      },
    ],
  ]);
}

function profileKeyboard(lang, hasPhoto = false) {
  const rows = [
    [
      { text: messages[lang].profileEditName, callback_data: callBacks.profileEditName },
      { text: messages[lang].profileEditAge, callback_data: callBacks.profileEditAge },
    ],
    hasPhoto
      ? [
        { text: messages[lang].profileEditPhoto, callback_data: callBacks.profileEditPhoto },
        { text: messages[lang].profileResetPhoto, callback_data: callBacks.profileResetPhoto },
      ]
      : [
        { text: messages[lang].profileEditPhoto, callback_data: callBacks.profileEditPhoto },
      ],
    [
      { text: messages[lang].profileEditCity, callback_data: callBacks.profileEditCity },
      { text: messages[lang].profileEditGender, callback_data: callBacks.profileEditGender },
    ],
    [
      { text: messages[lang].profileEditInterests, callback_data: callBacks.profileEditInterests },
    ],
    [
      { text: messages[lang].profileMoreSettings, callback_data: callBacks.profileSettings },
    ],
  ];

  rows.push([
    { text: messages[lang].cancel, callback_data: callBacks.profileBack },
  ]);

  return inlineKeyboard(rows);
}

function profileSettingsKeyboard(lang, showsActiveDiscussion = false) {
  return inlineKeyboard([
    [
      { text: messages[lang].profileEditBio, callback_data: callBacks.profileEditBio },
      { text: messages[lang].profileEditPetPreference, callback_data: callBacks.profileEditPetPreference },
    ],
    [
      { text: messages[lang].profileEditLocation, callback_data: callBacks.profileEditLocation },
      {
        text: showsActiveDiscussion
          ? messages[lang].profileHideActiveDiscussion
          : messages[lang].profileShowActiveDiscussion,
        callback_data: callBacks.profileToggleActiveDiscussionVisible,
      },
    ],
    [
      { text: messages[lang].profileEmojiButton, callback_data: callBacks.profileEmoji },
    ],
    [
      { text: messages[lang].profileBackToProfile, callback_data: callBacks.profileSettingsBack },
    ],
  ]);
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
  return inlineKeyboard([[
    { text: messages[lang].profileStarsBack, callback_data: callBacks.profileStarsBack },
  ]]);
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

  rows.push([{ text: "🔙", callback_data: callBacks.profileAgeRangeBack }]);
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

function onboardingLanguageKeyboard() {
  return inlineKeyboard([[
    { text: "🇮🇷 فارسی", callback_data: callBacks.langSetFa },
    { text: "🇬🇧 English", callback_data: callBacks.langSetEn },
  ]]);
}

function profileViewBackKeyboard(lang) {
  return inlineKeyboard([[{ text: messages[lang].profileBackToSaved, callback_data: callBacks.savedProfiles }]]);
}

function profilePeopleBackKeyboard(lang, mode = "browse") {
  return inlineKeyboard([[
    {
      text: messages[lang].aiBack,
      callback_data: mode === "taste" ? callBacks.peopleTasteMatches : callBacks.peopleDiscover,
    },
  ]]);
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

  if (pageRows.length) {
    rows.push(pageRows);
  }

  rows.push([{ text: messages[lang].aiBack, callback_data: callBacks.people }]);
  return inlineKeyboard(rows);
}

function peopleHubKeyboard(lang, { showTasteMatches = false } = {}) {
  const rows = [
    [{ text: messages[lang].peopleDiscover, callback_data: callBacks.peopleDiscover }],
    [{ text: messages[lang].savedProfiles, callback_data: callBacks.savedProfiles }],
  ];
  if (showTasteMatches) {
    rows.splice(1, 0, [{ text: messages[lang].peopleTasteMatchesButton, callback_data: callBacks.peopleTasteMatches }]);
  }
  if (starEconomy.advancedSearchPreviewEnabled) {
    rows.push([{ text: messages[lang].advancedSearchButton, callback_data: callBacks.peopleAdvancedSearch }]);
  }
  rows.push([{ text: messages[lang].aiBack, callback_data: callBacks.menuMain }]);
  return inlineKeyboard(rows);
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

function peopleTasteMatchesUnlockKeyboard(lang, publicCode, cost) {
  return inlineKeyboard([
    [{
      text: messages[lang].peopleTasteMatchesConfirmButton.replace("{cost}", formatKeyboardNumber(lang, cost)),
      callback_data: `${callBacks.peopleTasteMatchesConfirm}${publicCode}`,
    }],
    [{
      text: messages[lang].peopleTasteMatchesCancelButton,
      callback_data: callBacks.peopleTasteMatchesCancel,
    }],
  ]);
}

function peopleDiscoverListKeyboard(lang, options = {}) {
  const rows = [];
  const normalizedPage = Math.max(0, Number(options.page) || 0);
  const maxPage = Math.max(0, Number(options.totalPages || 1) - 1);
  const pageCallback = options.mode === "taste"
    ? callBacks.peopleTasteMatchesPage
    : callBacks.peopleDiscoverPage;
  const pageRows = [];

  if (normalizedPage < maxPage) {
    pageRows.push({
      text: `${messages[lang].discussionListMorePage} ➡️`,
      callback_data: `${pageCallback}${normalizedPage + 1}`,
    });
  }

  if (normalizedPage > 0) {
    pageRows.push({
      text: `🔙 ${messages[lang].discussionListPrevPage}`,
      callback_data: `${pageCallback}${normalizedPage - 1}`,
    });
  }

  if (pageRows.length) rows.push(pageRows);
  if (options.showLists) {
    rows.push([{ text: messages[lang].peopleGoToLists, callback_data: callBacks.aiAssistant }]);
  }
  rows.push([{ text: messages[lang].aiBack, callback_data: callBacks.people }]);
  return inlineKeyboard(rows);
}

module.exports = {
  inlineKeyboard,
  mainMenuKeyboard,
  helpKeyboard,
  helpRulesKeyboard,
  aiAssistantKeyboard,
  aiChatBackKeyboard,
  aiSectionKeyboard,
  aiSectionKeyboardForSection,
  aiSuggestionAddKeyboard,
  aiSuggestionNextKeyboard,
  aiSuggestionLimitKeyboard,
  aiPaidSuggestionConfirmKeyboard,
  aiSuggestionModeKeyboard,
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
  onboardingCustomInterestKeyboard,
  onboardingCompleteKeyboard,
  profileInterestsKeyboard,
  aiListActionItemsKeyboard,
  aiListCancelCommentKeyboard,
  profileKeyboard,
  profileSettingsKeyboard,
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
  discussionRoomKeyboard,
  discussionInviteModeKeyboard,
  discussionInviteSavedProfilesKeyboard,
  discussionInviteNoSavedProfilesKeyboard,
  discussionInviteDiscussionPickerKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationsBackKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionBoostAckKeyboard,
  discussionCreateGuidanceAckKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionSectionKeyboard,
  discussionCreateConfirmKeyboard,
  discussionCreateCapacityKeyboard,
  discussionPaidCapacityConfirmKeyboard,
  discussionPaidCapacityAckKeyboard,
  discussionSelectTasteKeyboard,
  discussionSelectItemKeyboard,
  discussionRemoveMembersKeyboard,
  profileViewBackKeyboard,
  profilePeopleBackKeyboard,
  profileInvitationBackKeyboard,
  savedProfilesListKeyboard,
  peopleHubKeyboard,
  peopleTasteMatchesUnlockKeyboard,
  advancedSearchPreviewKeyboard,
  peopleDiscoverListKeyboard,
};
