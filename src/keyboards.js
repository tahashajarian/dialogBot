const { callBacks } = require("./constants");
const messages = require("./messages");
const discussionKeyboards = require("./keyboards/discussions");
const {
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionRoomKeyboard,
  discussionInviteModeKeyboard,
  discussionInviteSavedProfilesKeyboard,
  discussionInviteDiscussionPickerKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationsBackKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionSectionKeyboard,
  discussionCreateConfirmKeyboard,
  discussionCreateCapacityKeyboard,
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

function getSectionToggleButtonText(lang, section) {
  if (section === "music") {
    return messages[lang].aiListManageToggleWatchedMusic || messages[lang].aiListManageToggleWatched;
  }

  if (section === "books") {
    return messages[lang].aiListManageToggleWatchedBooks || messages[lang].aiListManageToggleWatched;
  }

  if (section === "random") {
    return messages[lang].aiListManageToggleWatchedRandom || messages[lang].aiListManageToggleWatched;
  }

  return messages[lang].aiListManageToggleWatchedMovies || messages[lang].aiListManageToggleWatched;
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
        text: getSectionToggleButtonText(lang, section),
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

const ONBOARDING_INTEREST_CHIPS = [
  { emoji: "♟", fa: "شطرنج", en: "Chess" },
  { emoji: "💻", fa: "کدنویسی", en: "Coding" },
  { emoji: "🎮", fa: "گیم", en: "Gaming" },
  { emoji: "🎬", fa: "فیلم", en: "Movies" },
  { emoji: "🎵", fa: "موسیقی", en: "Music" },
  { emoji: "📚", fa: "کتاب", en: "Books" },
  { emoji: "🍥", fa: "انیمه", en: "Anime" },
  { emoji: "⚽", fa: "فوتبال", en: "Football" },
  { emoji: "🏋️", fa: "باشگاه", en: "Gym" },
  { emoji: "✈️", fa: "سفر", en: "Travel" },
  { emoji: "🌿", fa: "طبیعت", en: "Nature" },
  { emoji: "🍜", fa: "غذا", en: "Food" },
  { emoji: "🍳", fa: "آشپزی", en: "Cooking" },
  { emoji: "☕", fa: "قهوه", en: "Coffee" },
  { emoji: "🏙", fa: "کافه‌گردی", en: "Cafes" },
  { emoji: "🎨", fa: "هنر", en: "Art" },
  { emoji: "📸", fa: "عکاسی", en: "Photography" },
  { emoji: "✍️", fa: "نوشتن", en: "Writing" },
  { emoji: "👗", fa: "مد و فشن", en: "Fashion" },
  { emoji: "🧠", fa: "روانشناسی", en: "Psychology" },
  { emoji: "🔬", fa: "علم", en: "Science" },
  { emoji: "🏛", fa: "تاریخ", en: "History" },
  { emoji: "🎧", fa: "پادکست", en: "Podcast" },
  { emoji: "📺", fa: "یوتیوب", en: "YouTube" },
  { emoji: "🎉", fa: "دورهمی", en: "Social events" },
  { emoji: "🧘", fa: "آرامش", en: "Calm" },
  { emoji: "🚶", fa: "پیاده‌روی", en: "Walking" },
  { emoji: "💪", fa: "سلامتی", en: "Wellness" },
  { emoji: "🌱", fa: "رشد فردی", en: "Self growth" },
  { emoji: "💼", fa: "کسب‌وکار", en: "Business" },
  { emoji: "💰", fa: "سرمایه‌گذاری", en: "Investing" },
  { emoji: "🧩", fa: "بازی فکری", en: "Board games" },
  { emoji: "🎭", fa: "تئاتر", en: "Theater" },
];
const ONBOARDING_CHIPS_PER_PAGE = 9;

function getPagedInterestChips(lang, selectedTitles = [], page = 0) {
  const selected = new Set(selectedTitles.map((title) => String(title || "").toLowerCase()));
  const totalPages = Math.ceil(ONBOARDING_INTEREST_CHIPS.length / ONBOARDING_CHIPS_PER_PAGE);
  const normalizedPage = ((Number(page) || 0) % totalPages + totalPages) % totalPages;
  const pageStart = normalizedPage * ONBOARDING_CHIPS_PER_PAGE;
  const available = [];

  for (let offset = 0; offset < ONBOARDING_INTEREST_CHIPS.length; offset += 1) {
    const index = (pageStart + offset) % ONBOARDING_INTEREST_CHIPS.length;
    const chip = ONBOARDING_INTEREST_CHIPS[index];
    const title = lang === "fa" ? chip.fa : chip.en;
    if (selected.has(title.toLowerCase())) continue;
    available.push({ chip, index });
    if (available.length >= ONBOARDING_CHIPS_PER_PAGE) break;
  }

  return { available, normalizedPage, totalPages };
}

function aiInterestTopTenChipKeyboard(lang, selectedTitles = [], page = 0, { backToList = false } = {}) {
  const { available, normalizedPage, totalPages } = getPagedInterestChips(lang, selectedTitles, page);
  const rows = [];

  for (let i = 0; i < available.length; i += 3) {
    rows.push(available.slice(i, i + 3).map(({ chip, index }) => ({
      text: `${chip.emoji} ${lang === "fa" ? chip.fa : chip.en}`,
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
  const chip = ONBOARDING_INTEREST_CHIPS[index];
  if (!chip) {
    return "";
  }
  return lang === "fa" ? chip.fa : chip.en;
}

function getOnboardingInterestChipTitle(index, lang) {
  const chip = ONBOARDING_INTEREST_CHIPS[index];
  if (!chip) {
    return "";
  }
  return lang === "fa" ? chip.fa : chip.en;
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
  const { available, normalizedPage, totalPages } = getPagedInterestChips(lang, selectedTitles, page);
  const rows = [];

  for (let i = 0; i < available.length; i += 3) {
    rows.push(available.slice(i, i + 3).map(({ chip, index }) => ({
      text: `${chip.emoji} ${lang === "fa" ? chip.fa : chip.en}`,
      callback_data: `${callBacks.onboardingInterest}${index}`,
    })));
  }

  rows.push([{
    text: messages[lang].onboardingMoreButton,
    callback_data: `${callBacks.onboardingMore}${(normalizedPage + 1) % totalPages}`,
  }, {
    text: messages[lang].onboardingCustomButton,
    callback_data: `${callBacks.onboardingCustom}${normalizedPage}`,
  }]);

  rows.push([{
    text: messages[lang].onboardingSkipButton,
    callback_data: callBacks.onboardingSkip,
  }]);

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

function onboardingCompleteKeyboard(lang) {
  return inlineKeyboard([
    [{
      text: messages[lang].onboardingBrowseDiscussionsButton,
      callback_data: callBacks.discussionListActive,
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
      {
        text: messages[lang].profileMoreSettings,
        callback_data: callBacks.profileSettings,
      },
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
      { text: messages[lang].profileBackToProfile, callback_data: callBacks.profileSettingsBack },
    ],
  ]);
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

function onboardingLanguageKeyboard() {
  return inlineKeyboard([[
    { text: "🇮🇷 فارسی", callback_data: callBacks.langSetFa },
    { text: "🇬🇧 English", callback_data: callBacks.langSetEn },
  ]]);
}

function profileViewBackKeyboard(lang) {
  return inlineKeyboard([[{ text: messages[lang].profileBackToSaved, callback_data: callBacks.savedProfiles }]]);
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
  helpKeyboard,
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
  getOnboardingInterestChipTitle,
  onboardingWelcomeKeyboard,
  onboardingInterestsKeyboard,
  onboardingCustomInterestKeyboard,
  onboardingCompleteKeyboard,
  aiListActionItemsKeyboard,
  aiListCancelCommentKeyboard,
  profileKeyboard,
  profileSettingsKeyboard,
  profileActiveDiscussionHelpKeyboard,
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
  discussionInviteDiscussionPickerKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationsBackKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
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
  profileInvitationBackKeyboard,
  savedProfilesListKeyboard,
};
