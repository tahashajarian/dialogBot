const { callBacks } = require("./constants");
const {
  INTEREST_CHIPS,
  getInterestChipByTitle,
  getInterestChipTitle,
  isInterestChipSelected,
  localizeInterestChipTitle,
} = require("./services/interest-chips");
const messages = require("./messages");
const { starEconomy } = require("./services/star-settings");
const { getProfileEmojiOptions } = require("./services/profile-emoji");
const {
  AGE_RANGES,
  getProfileAgeRange,
} = require("./services/profile-age");
const discussionKeyboards = require("./keyboards/discussions");
const peopleKeyboards = require("./keyboards/people");
const aiKeyboards = require("./keyboards/ai");
const {
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionRecentListKeyboard,
  discussionLanguagePickerKeyboard,
  discussionRoomKeyboard,
  discussionMembersCloseKeyboard,
  discussionCloseConfirmKeyboard,
  discussionInviteModeKeyboard,
  discussionInviteFullKeyboard,
  discussionInviteSavedProfilesKeyboard,
  discussionInviteNoSavedProfilesKeyboard,
  discussionInviteDiscussionPickerKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationsBackKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionJoinLockedKeyboard,
  discussionUnavailableAckKeyboard,
  discussionLeaveCurrentNoticeKeyboard,
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
  discussionExtraSlotConfirmKeyboard,
  discussionExtraSlotAckKeyboard,
  discussionTasteLabelsKeyboard,
  discussionSelectItemKeyboard,
  discussionRemoveMemberConfirmKeyboard,
} = discussionKeyboards;
const {
  advancedSearchPreviewKeyboard,
  peopleDiscoverEmptyKeyboard,
  peopleDiscoverListKeyboard,
  peopleHubKeyboard,
  savedProfilesListKeyboard,
} = peopleKeyboards;
const {
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
  aiListManageMenuKeyboard,
  aiListRemoveItemsKeyboard,
  aiTasteSuggestionKeyboard,
  aiTasteFailureKeyboard,
  aiTasteCurrentKeyboard,
  aiTasteRecheckConfirmKeyboard,
  aiListCancelAddKeyboard,
  aiListActionItemsKeyboard,
  aiListCancelCommentKeyboard,
} = aiKeyboards;

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
    [
      {
        text: messages[lang].profileStarsButton,
      },
      {
        text: messages[lang].helpReferralButton,
      },
    ],
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
    [{ text: messages[lang].discussionShareClose, callback_data: callBacks.helpCardClose }],
  ]);
}

function helpRulesKeyboard(lang) {
  return inlineKeyboard([[
    { text: messages[lang].discussionShareClose, callback_data: callBacks.helpCardClose },
  ]]);
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
  actions[actions.length - 1] = [{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.profilePickerClose,
  }];
  return inlineKeyboard(actions);
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

function profileKeyboard(lang, hasPhoto = false) {
  const rows = [
    [
      { text: messages[lang].profileEditName },
      { text: messages[lang].profileEditCity },
    ],
    hasPhoto
      ? [
        { text: messages[lang].profileEditBio },
        ...(starEconomy.profileLocationEnabled
          ? [{ text: messages[lang].profileEditLocation }]
          : []),
      ]
      : [
        { text: messages[lang].profileEditBio },
        { text: messages[lang].profileAddPhoto },
      ],
    ...(hasPhoto
      ? [[
        { text: messages[lang].profileEditPhoto },
        { text: messages[lang].profileResetPhoto },
      ]]
      : []),
    ...(!hasPhoto && starEconomy.profileLocationEnabled
      ? [[{ text: messages[lang].profileEditLocation }]]
      : []),
    [
      { text: messages[lang].cancel },
    ],
  ];

  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function profileQuickActionsKeyboard(lang, {
  petPreferenceEnabled = starEconomy.profilePetPreferenceEnabled,
  canShareProfile = false,
} = {}) {
  const rows = [[
    { text: messages[lang].profileEditAge, callback_data: callBacks.profileEditAge },
    { text: messages[lang].profileEditGender, callback_data: callBacks.profileEditGender },
  ]];
  rows.push([
    { text: messages[lang].profileEditInterests, callback_data: callBacks.profileEditInterests },
    { text: messages[lang].profileEmojiButton, callback_data: callBacks.profileEmoji },
  ]);
  if (petPreferenceEnabled) {
    rows.push([{
      text: messages[lang].profileEditPetPreference,
      callback_data: callBacks.profileEditPetPreference,
    }]);
  }
  if (canShareProfile) {
    rows.push([{
      text: messages[lang].profileShareButton,
      callback_data: callBacks.profileShare,
    }]);
  }
  rows.push([{
    text: messages[lang].profilePrivacySafetyButton,
    callback_data: callBacks.profilePrivacy,
  }]);
  return inlineKeyboard(rows);
}

function profileShareGuidanceKeyboard(lang) {
  return inlineKeyboard([[
    {
      text: messages[lang].profileShareBackButton,
      callback_data: callBacks.profileShareBack,
    },
  ]]);
}

function profilePrivacySafetyKeyboard(lang, {
  showsActiveDiscussion = true,
  showsInPeopleDiscovery = true,
} = {}) {
  return inlineKeyboard([
    [
      {
        text: showsInPeopleDiscovery
          ? messages[lang].profileHideFromPeopleDiscovery
          : messages[lang].profileShowInPeopleDiscovery,
        callback_data: `${callBacks.profileSetPeopleDiscovery}${showsInPeopleDiscovery ? "0" : "1"}`,
      },
      {
        text: showsActiveDiscussion
          ? messages[lang].profileHideActiveDiscussion
          : messages[lang].profileShowActiveDiscussion,
        callback_data: callBacks.profileToggleActiveDiscussionVisible,
      },
    ],
    [{
      text: messages[lang].profileInvitationRestrictionsButton,
      callback_data: callBacks.profileInvitationRestrictions,
    }],
    [{
      text: messages[lang].accountDeleteButton,
      callback_data: callBacks.accountDelete,
    }],
    [{
      text: messages[lang].profilePrivacyBackToSettings,
      callback_data: callBacks.profilePrivacyBack,
    }],
  ]);
}

function profileInvitationRestrictionsKeyboard(lang, _entries = [], { page = 0, totalPages = 1 } = {}) {
  const rows = [];
  const navigation = [];
  if (page > 0) navigation.push({
    text: `⬅️ ${messages[lang].discussionListPrevPage}`,
    callback_data: `${callBacks.profileInvitationRestrictionsPage}${page - 1}`,
  });
  if (page < totalPages - 1) navigation.push({
    text: `${messages[lang].discussionListMorePage} ➡️`,
    callback_data: `${callBacks.profileInvitationRestrictionsPage}${page + 1}`,
  });
  if (navigation.length) rows.push(navigation);
  rows.push([{
    text: messages[lang].profileBackToSettings,
    callback_data: callBacks.profileInvitationRestrictionsClose,
  }]);
  return inlineKeyboard(rows);
}

function profileRestrictionViewKeyboard(lang, {
  profileCode = "",
  hasFavorites = false,
  hasDiscussions = false,
  sourcePage = 0,
} = {}) {
  const rows = [];
  if (hasFavorites && profileCode) {
    rows.push([{
      text: messages[lang].profileFavoritesButton,
      callback_data: `${callBacks.profileFavoritesOpen}restrictions:${Number(sourcePage) || 0}:${profileCode}`,
    }]);
  }
  if (hasDiscussions && profileCode) {
    rows.push([{
      text: messages[lang].savedProfileDiscussions,
      callback_data: `${callBacks.savedProfilesDiscussions}restrictions:${profileCode}`,
    }]);
  }
  rows.push([
    { text: messages[lang].discussionShareClose, callback_data: callBacks.profileCloseDiscussionMember },
  ]);
  return inlineKeyboard(rows);
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
  rows.push([{ text: messages[lang].profileEmojiCloseButton, callback_data: callBacks.profileEmojiClose }]);
  return inlineKeyboard(rows);
}

function profileEmojiConfirmKeyboard(lang, nonce, cost) {
  return inlineKeyboard([
    [{
      text: cost > 0
        ? messages[lang].profileEmojiConfirmButton.replace("{cost}", formatKeyboardNumber(lang, cost))
        : messages[lang].profileEmojiConfirmUnlockedButton,
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
    { text: messages[lang].discussionShareClose, callback_data: callBacks.helpCardClose },
  ]]);
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
    callback_data: `${callBacks.profileAgeRangeSet}${start}`,
  }));

  const rows = [];
  for (let index = 0; index < ranges.length; index += 3) {
    rows.push(ranges.slice(index, index + 3));
  }

  rows.push([{ text: messages[lang].discussionShareClose, callback_data: callBacks.profilePickerClose }]);
  return inlineKeyboard(rows);
}

function ageRangeKeyboard(lang, startAge) {
  const [rangeStart, rangeEnd] = getProfileAgeRange(startAge);
  const ages = [];

  for (let age = rangeStart; age <= rangeEnd; age += 1) {
    ages.push({ text: ltrText(String(age)), callback_data: `${callBacks.profileAgeSet}${age}` });
  }

  const rows = [];
  for (let index = 0; index < ages.length; index += 5) {
    rows.push(ages.slice(index, index + 5));
  }

  rows.push([{ text: messages[lang].discussionBack, callback_data: callBacks.profileAgeRangeBack }]);
  rows.push([{ text: messages[lang].discussionShareClose, callback_data: callBacks.profilePickerClose }]);
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
    [{ text: messages[lang].discussionShareClose, callback_data: callBacks.profilePickerClose }],
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
    [{ text: messages[lang].discussionShareClose, callback_data: callBacks.profilePickerClose }],
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

function languageKeyboard(lang = "fa") {
  return inlineKeyboard([
    [
      { text: "🇮🇷 فارسی", callback_data: callBacks.langSetFa },
      { text: "🇬🇧 English", callback_data: callBacks.langSetEn },
    ],
    [{ text: messages[lang].discussionShareClose, callback_data: callBacks.languageClose }],
  ]);
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
  hasFavorites = false,
  source = "people",
  sourcePage = 0,
} = {}) {
  const normalizedCode = String(code || "");
  const actionSuffix = source === "discussion_members" ? ":members" : "";
  const supportsSavedProfileActions = source === "saved" || source === "people";
  const rows = [];

  if (hasFavorites) {
    rows.push([{
      text: messages[lang].profileFavoritesButton,
      callback_data: `${callBacks.profileFavoritesOpen}${source}:${Number(sourcePage) || 0}:${normalizedCode}`,
    }]);
  }

  if (hasDiscussions) {
    rows.push([{
      text: messages[lang].savedProfileDiscussions,
      callback_data: `${callBacks.savedProfilesDiscussions}${source === "people" ? "browse" : source}:${normalizedCode}`,
    }]);
  }

  if (isSaved) {
    if (supportsSavedProfileActions) rows.push([{
      text: messages[lang].savedProfileRemove,
      callback_data: `${callBacks.profileUnsaveByCode}${normalizedCode}${actionSuffix}`,
    }]);
  } else {
    rows.push([{
      text: messages[lang].profileSaveButton,
      callback_data: `${callBacks.profileSaveByCode}${normalizedCode}${actionSuffix}`,
    }]);
  }

  rows.push([{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.profileCloseDiscussionMember,
  }]);

  return inlineKeyboard(rows);
}

function profileInvitationBackKeyboard(lang, userId = "", {
  profileCode = "",
  hasFavorites = false,
  hasDiscussions = false,
  sourcePage = 0,
} = {}) {
  const rows = [];
  if (hasFavorites && profileCode) {
    rows.push([{
      text: messages[lang].profileFavoritesButton,
      callback_data: `${callBacks.profileFavoritesOpen}invitations:${Number(sourcePage) || 0}:${profileCode}`,
    }]);
  }
  if (hasDiscussions && profileCode) {
    rows.push([{
      text: messages[lang].savedProfileDiscussions,
      callback_data: `${callBacks.savedProfilesDiscussions}invitations:${profileCode}`,
    }]);
  }
  rows.push([{ text: messages[lang].profileBackToInvitations, callback_data: callBacks.discussionInvitations }]);
  const mutedUserId = Number(userId);
  if (Number.isInteger(mutedUserId) && mutedUserId > 0) {
    rows.unshift([{
      text: messages[lang].discussionInvitationRestrictInviter,
      callback_data: `${callBacks.discussionInvitationMute}${mutedUserId}`,
    }]);
  }
  return inlineKeyboard(rows);
}

function discussionInvitationRestrictionConfirmKeyboard(lang, mutedUserId) {
  return inlineKeyboard([
    [{
      text: messages[lang].discussionInvitationRestrictConfirmButton,
      callback_data: `${callBacks.discussionInvitationMuteConfirm}${Number(mutedUserId)}`,
    }],
    [{
      text: messages[lang].discussionInvitationRestrictCancelButton,
      callback_data: callBacks.discussionInvitationMuteCancel,
    }],
  ]);
}

function formatKeyboardNumber(lang, value) {
  const number = Number(value) || 0;
  if (lang !== "fa") return String(number);
  return new Intl.NumberFormat("fa-IR").format(number);
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
  aiSuggestionCopyKeyboard,
  aiSuggestionNextKeyboard,
  aiSuggestionLimitKeyboard,
  aiPaidSuggestionConfirmKeyboard,
  aiSuggestionModeKeyboard,
  aiSuggestionNeedTopTenKeyboard,
  aiSuggestionContextCancelKeyboard,
  aiSuggestionAddedOptionsKeyboard,
  aiListManageMenuKeyboard,
  aiListRemoveItemsKeyboard,
  aiTasteSuggestionKeyboard,
  aiTasteFailureKeyboard,
  aiTasteCurrentKeyboard,
  aiTasteRecheckConfirmKeyboard,
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
  profileQuickActionsKeyboard,
  profileShareGuidanceKeyboard,
  profilePrivacySafetyKeyboard,
  profileInvitationRestrictionsKeyboard,
  profileRestrictionViewKeyboard,
  accountDeleteWarningKeyboard,
  accountDeleteConfirmKeyboard,
  startAgainKeyboard,
  profileEmojiKeyboard,
  profileEmojiConfirmKeyboard,
  profileEmojiInsufficientKeyboard,
  profileActiveDiscussionHelpKeyboard,
  discussionInvitationRestrictionConfirmKeyboard,
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
  discussionRecentListKeyboard,
  discussionLanguagePickerKeyboard,
  discussionRoomKeyboard,
  discussionMembersCloseKeyboard,
  discussionCloseConfirmKeyboard,
  discussionInviteModeKeyboard,
  discussionInviteFullKeyboard,
  discussionInviteSavedProfilesKeyboard,
  discussionInviteNoSavedProfilesKeyboard,
  discussionInviteDiscussionPickerKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationsBackKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionJoinLockedKeyboard,
  discussionUnavailableAckKeyboard,
  discussionLeaveCurrentNoticeKeyboard,
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
  discussionExtraSlotConfirmKeyboard,
  discussionExtraSlotAckKeyboard,
  discussionTasteLabelsKeyboard,
  discussionSelectItemKeyboard,
  discussionRemoveMemberConfirmKeyboard,
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
