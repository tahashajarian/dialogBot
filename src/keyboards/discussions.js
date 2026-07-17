const { callBacks } = require("../constants");
const messages = require("../messages");
const { operationalLimits } = require("../services/operational-limits");
const { isDiscussionBoostAvailable } = require("../services/star-settings");
const { localizeInterestChipTitleWithEmoji } = require("../services/interest-chips");
const {
  formatCapacityOptionLabel,
  getSelectableDiscussionCapacities,
} = require("../services/discussion-capacities");
const { formatStarNumber } = require("../services/stars-ui");

function inlineKeyboard(rows) {
  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

function replyKeyboard(rows) {
  return {
    reply_markup: {
      keyboard: rows.map((row) => row.map((button) => ({ text: button.text }))),
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  };
}

function ltrText(value) {
  return `\u200e${value}`;
}

function discussionsMenuKeyboard(lang, { invitationCount: _invitationCount = 0 } = {}) {
  const rows = [
    [{ text: messages[lang].discussionActiveList }],
    [{ text: messages[lang].discussionInvitations }],
    [{ text: messages[lang].discussionCreate }],
    [{ text: messages[lang].discussionMyList }],
  ];
  rows.push([{ text: messages[lang].aiBack }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: false, selective: true } };
}

function discussionListNavigationKeyboard(lang, {
  listType = "active",
  page = 0,
  totalPages = 1,
  joinableOnly = false,
  languageFilter = null,
} = {}) {
  const rows = [];
  const normalizedPage = Math.max(0, Number(page) || 0);
  const maxPage = Math.max(0, Number(totalPages || 1) - 1);
  const listPrefix = listType === "mine" ? callBacks.discussionListMinePage : callBacks.discussionListActivePage;
  const pageRows = [];

  if (normalizedPage < maxPage) {
    const nextFilter = listType === "active" ? `:${joinableOnly ? "joinable" : "all"}${languageFilter ? `:${languageFilter}` : ""}` : "";
    pageRows.push({
      text: `${messages[lang].discussionListMorePage} ➡️`,
      callback_data: `${listPrefix}${normalizedPage + 1}${nextFilter}`,
    });
  }

  if (normalizedPage > 0) {
    const prevFilter = listType === "active" ? `:${joinableOnly ? "joinable" : "all"}${languageFilter ? `:${languageFilter}` : ""}` : "";
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
      callback_data: `${callBacks.discussionListActivePage}0:${joinableOnly ? "all" : "joinable"}${languageFilter ? `:${languageFilter}` : ""}`,
    }]);
    if (languageFilter) rows.push([{
      text: messages[lang].discussionListLanguageFilterButton.replace(
        "{language}",
        languageFilter === "all" ? messages[lang].discussionLanguageBoth : languageFilter === "en" ? messages[lang].discussionLanguageEnglish : messages[lang].discussionLanguagePersian,
      ),
      callback_data: `${callBacks.discussionListLanguageOpen}${joinableOnly ? "joinable" : "all"}:${languageFilter}`,
    }]);
  }

  rows.push([{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.discussionListClose,
  }]);
  return inlineKeyboard(rows);
}

function discussionLanguagePickerKeyboard(lang, { joinableOnly = false, languageFilter = "fa" } = {}) {
  const joinability = joinableOnly ? "joinable" : "all";
  const options = [
    ["fa", "🇮🇷", messages[lang].discussionLanguagePersian],
    ["en", "🇬🇧", messages[lang].discussionLanguageEnglish],
    ["all", "🌐", messages[lang].discussionLanguageBoth],
  ];
  const rows = options.map(([value, flag, label]) => [{
    text: `${value === languageFilter ? "✓ " : ""}${flag} ${label}`,
    callback_data: `${callBacks.discussionListLanguageSet}${joinability}:${value}`,
  }]);
  rows.push([{
    text: messages[lang].discussionBack,
    callback_data: `${callBacks.discussionListActivePage}0:${joinability}:${languageFilter}`,
  }]);
  return inlineKeyboard(rows);
}

function discussionRoomKeyboard(lang, isOwner = false) {
  const rows = [
    [
      { text: messages[lang].discussionMembersTitle },
      { text: messages[lang].discussionInvite },
    ],
    isOwner
      ? [
        { text: messages[lang].discussionLeave },
        { text: messages[lang].discussionCloseButton },
      ]
      : [
        { text: messages[lang].discussionLeave },
      ],
  ];

  if (isOwner && isDiscussionBoostAvailable()) {
    rows.splice(1, 0, [{ text: messages[lang].discussionBoostButton }]);
  }

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  };
}

function discussionCloseConfirmKeyboard(lang, discussionId, source = "room") {
  const suffix = `${discussionId}:${source}`;
  return inlineKeyboard([
    [{
      text: messages[lang].discussionCloseConfirmYes,
      callback_data: `${callBacks.discussionCloseConfirm}${suffix}`,
    }],
    [{
      text: messages[lang].discussionCloseConfirmNo,
      callback_data: `${callBacks.discussionCloseCancel}${suffix}`,
    }],
  ]);
}

function discussionInvitePreviewKeyboard(lang, publicDiscussionCode, { activeElsewhere = false, cancelOnly = false } = {}) {
  const cleanCode = String(publicDiscussionCode || "").replace(/^d_/i, "");
  if (cancelOnly) {
    return inlineKeyboard([
      [{ text: messages[lang].acknowledgeButton, callback_data: `${callBacks.discussionInviteCancel}d_${cleanCode}` }],
    ]);
  }

  if (activeElsewhere) {
    return inlineKeyboard([
      [{ text: messages[lang].discussionInviteSwitchJoinButton, callback_data: `${callBacks.discussionInviteSwitchJoin}d_${cleanCode}` }],
      [{ text: messages[lang].discussionInviteCancelButton, callback_data: `${callBacks.discussionInviteCancel}d_${cleanCode}` }],
    ]);
  }

  return inlineKeyboard([
    [{ text: messages[lang].discussionInviteJoinButton, callback_data: `${callBacks.discussionInviteJoin}d_${cleanCode}` }],
    [{ text: messages[lang].discussionBack, callback_data: callBacks.discussions }],
  ]);
}

function normalizeDiscussionJoinErrorDestination(listType = "active") {
  const rawListType = String(listType || "").trim();
  const savedMatch = rawListType.match(/^saved:u_([a-z0-9]+)$/i);
  return savedMatch
    ? `saved:u_${savedMatch[1].toUpperCase()}`
    : listType === "mine" ? "mine"
    : listType === "discussions" ? "discussions"
    : listType === "invitations" ? "invitations"
    : "active";
}

function discussionJoinErrorAckKeyboard(lang, listType = "active") {
  const normalizedListType = normalizeDiscussionJoinErrorDestination(listType);
  return replyKeyboard([
    [{
      text: messages[lang].acknowledgeButton,
      callback_data: `${callBacks.discussionJoinErrorAck}${normalizedListType}`,
    }],
  ]);
}

function discussionBoostAckKeyboard(lang) {
  return inlineKeyboard([[
    {
      text: messages[lang].acknowledgeButton,
      callback_data: callBacks.discussionBoostAck,
    },
  ]]);
}

function discussionCreateGuidanceAckKeyboard(lang) {
  return inlineKeyboard([[
    {
      text: messages[lang].acknowledgeButton,
      callback_data: callBacks.discussionCreateGuidanceAck,
    },
  ]]);
}

function discussionInviteModeKeyboard(lang, { hasSavedProfiles = true } = {}) {
  return inlineKeyboard([
    ...(hasSavedProfiles ? [[{ text: messages[lang].discussionInviteSavedProfile, callback_data: callBacks.discussionInviteModeSaved }]] : []),
    [{ text: messages[lang].discussionInviteShareable, callback_data: callBacks.discussionInviteModeShare }],
    [{ text: messages[lang].discussionShareClose, callback_data: callBacks.discussionInvitePickerClose }],
  ]);
}

function discussionInviteSavedProfilesKeyboard(lang, items = [], {
  page = 0,
  totalPages = 1,
  discussionId = "",
  discussionCode = "",
} = {}) {
  const rows = items.map((entry) => ([{
    text: entry.name,
    callback_data: `${callBacks.discussionInviteSavedTarget}${entry.code}:${discussionCode}`,
  }]));
  const normalizedPage = Math.max(0, Number(page) || 0);
  const normalizedTotalPages = Math.max(1, Number(totalPages) || 1);
  const pageButtons = [];
  if (normalizedPage > 0) {
    pageButtons.push({
      text: `⬅️ ${messages[lang].discussionListPrevPage}`,
      callback_data: `${callBacks.discussionInviteSavedPage}${normalizedPage - 1}:${discussionId}`,
    });
  }
  if (normalizedPage < normalizedTotalPages - 1) {
    pageButtons.push({
      text: `${messages[lang].discussionListMorePage} ➡️`,
      callback_data: `${callBacks.discussionInviteSavedPage}${normalizedPage + 1}:${discussionId}`,
    });
  }
  if (pageButtons.length) rows.push(pageButtons);
  rows.push([{ text: messages[lang].discussionShareClose, callback_data: callBacks.discussionInvitePickerClose }]);
  return inlineKeyboard(rows);
}

function discussionInviteNoSavedProfilesKeyboard(lang) {
  return inlineKeyboard([
    [{ text: messages[lang].discussionInviteShareable, callback_data: callBacks.discussionInviteModeShare }],
    [{ text: messages[lang].discussionBackToRoom, callback_data: callBacks.discussionInvitationAck + "room" }],
  ]);
}

function discussionInviteDiscussionPickerKeyboard(lang, profileCode, discussions = []) {
  const cleanProfileCode = String(profileCode || "").replace(/^u_/i, "");
  const rows = discussions.map((discussion, index) => ([{
    text: `${index + 1}. ${discussion.title || "-"}`,
    callback_data: `${callBacks.discussionInviteDiscussionTarget}u_${cleanProfileCode}:${discussion.publicDiscussionCode}`,
  }]));
  rows.push([{ text: messages[lang].profileBackToSaved, callback_data: callBacks.savedProfiles }]);
  return inlineKeyboard(rows);
}

function discussionInvitationAckKeyboard(lang, destination = "invitations") {
  return inlineKeyboard([[
    {
      text: messages[lang].acknowledgeButton,
      callback_data: `${callBacks.discussionInvitationAck}${destination}`,
    },
  ]]);
}

function discussionInvitationsBackKeyboard(lang, {
  page = 0,
  totalPages = 1,
} = {}) {
  const rows = [];
  const normalizedPage = Math.max(0, Number(page) || 0);
  const maxPage = Math.max(0, Number(totalPages || 1) - 1);
  const pageRows = [];
  if (normalizedPage < maxPage) {
    pageRows.push({
      text: `${messages[lang].discussionListMorePage} ➡️`,
      callback_data: `${callBacks.discussionInvitationsPage}${normalizedPage + 1}`,
    });
  }
  if (normalizedPage > 0) {
    pageRows.push({
      text: `⬅️ ${messages[lang].discussionListPrevPage}`,
      callback_data: `${callBacks.discussionInvitationsPage}${normalizedPage - 1}`,
    });
  }
  if (pageRows.length) rows.push(pageRows);
  rows.push([{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.discussionListClose,
  }]);
  return inlineKeyboard(rows);
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
  return replyKeyboard(rows);
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
  return replyKeyboard(rows);
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
  return replyKeyboard(rows);
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
  return replyKeyboard(rows);
}

function discussionCreateConfirmKeyboard(lang, currentLanguage = lang) {
  const languageLabel = currentLanguage === "en"
    ? messages[lang].discussionLanguageEnglish
    : messages[lang].discussionLanguagePersian;
  return replyKeyboard([
    [{ text: messages[lang].discussionCreateConfirm, callback_data: callBacks.discussionCreateConfirm }],
    [
      { text: messages[lang].discussionEditTitle, callback_data: callBacks.discussionCreateEditTitle },
      { text: messages[lang].discussionEditDescription, callback_data: callBacks.discussionCreateEditDescription },
    ],
    [
      { text: messages[lang].discussionEditRule, callback_data: callBacks.discussionCreateEditRule },
      { text: messages[lang].discussionEditCapacity, callback_data: callBacks.discussionCreateEditCapacity },
    ],
    [
      { text: messages[lang].discussionChangeLanguage.replace("{language}", languageLabel), callback_data: callBacks.discussionCreateToggleLanguage },
      { text: messages[lang].discussionCreateCancel, callback_data: callBacks.discussionCreateCancel },
    ],
  ]);
}

function discussionCreateLanguagePickerKeyboard(lang, currentLanguage = "fa") {
  const language = currentLanguage === "en" ? "en" : "fa";
  return replyKeyboard([
    [{
      text: `${language === "fa" ? "✓ " : ""}🇮🇷 ${messages[lang].discussionLanguagePersian}`,
      callback_data: `${callBacks.discussionCreateSetLanguage}fa`,
    }],
    [{
      text: `${language === "en" ? "✓ " : ""}🇬🇧 ${messages[lang].discussionLanguageEnglish}`,
      callback_data: `${callBacks.discussionCreateSetLanguage}en`,
    }],
    [{ text: messages[lang].discussionBack, callback_data: callBacks.discussionCreateLanguageBack }],
  ]);
}

function discussionCreateCapacityKeyboard(lang, currentCapacity = 20) {
  const maximum = operationalLimits.discussionMaxMembers;
  const capacities = getSelectableDiscussionCapacities()
    .filter((capacity) => capacity <= maximum || capacity > 20);
  const rows = [];
  for (let index = 0; index < capacities.length; index += 4) {
    const row = capacities.slice(index, index + 4).map((capacity) => ({
      text: ltrText(
        Number(currentCapacity) === capacity
          ? `✅ ${formatCapacityOptionLabel(capacity, lang)}`
          : formatCapacityOptionLabel(capacity, lang),
      ),
      callback_data: `${callBacks.discussionCreateSetCapacity}${capacity}`,
    }));
    rows.push(row);
  }
  rows.push([{
    text: messages[lang].discussionCancelEdit || messages[lang].discussionCreateCancel,
    callback_data: callBacks.discussionCreateCancelEdit,
  }]);
  return replyKeyboard(rows);
}

function discussionPaidCapacityConfirmKeyboard(lang, capacity, cost) {
  const formattedCost = formatStarNumber(cost, lang);
  return replyKeyboard([
    [{
      text: messages[lang].discussionPaidCapacityConfirmButton.replace("{cost}", formattedCost),
      callback_data: `${callBacks.discussionCreatePaidCapacityConfirm}${capacity}:${cost}`,
    }],
    [{
      text: messages[lang].discussionPaidCapacityCancelButton,
      callback_data: callBacks.discussionCreatePaidCapacityCancel,
    }],
  ]);
}

function discussionPaidCapacityAckKeyboard(lang) {
  return replyKeyboard([
    [{
      text: messages[lang].discussionEditCapacity,
      callback_data: callBacks.discussionCreateEditCapacity,
    }],
    [{
      text: messages[lang].discussionBack,
      callback_data: callBacks.discussionCreatePaidCapacityAck,
    }],
  ]);
}

function discussionExtraSlotConfirmKeyboard(lang, cost) {
  const formattedCost = formatStarNumber(cost, lang);
  return inlineKeyboard([
    [{
      text: messages[lang].discussionExtraSlotConfirmButton.replace("{cost}", formattedCost),
      callback_data: `${callBacks.discussionCreateExtraSlotConfirm}${cost}`,
    }],
    [{
      text: messages[lang].discussionExtraSlotCancelButton,
      callback_data: callBacks.discussionCreateExtraSlotCancel,
    }],
  ]);
}

function discussionExtraSlotAckKeyboard(lang) {
  return inlineKeyboard([[
    {
      text: messages[lang].acknowledgeButton,
      callback_data: callBacks.discussionCreateExtraSlotAck,
    },
  ]]);
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
  return replyKeyboard(rows);
}

function discussionSelectItemKeyboard(lang, section, items = [], {
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
} = {}) {
  const rows = items.slice(0, 10).map((entry, index) => ([
    {
      text: section === "random" ? localizeInterestChipTitleWithEmoji(entry.title, lang) : entry.title,
      callback_data: `${callBacks.discussionCreateSelectItem}${section}:${index}`,
    },
  ]));
  if (backButton?.text && backButton?.callback_data) {
    rows.push([{ text: backButton.text, callback_data: backButton.callback_data }]);
  }
  rows.push([{ text: cancelText || messages[lang].discussionCreateCancel, callback_data: cancelCallback }]);
  return replyKeyboard(rows);
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

module.exports = {
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionLanguagePickerKeyboard,
  discussionRoomKeyboard,
  discussionCloseConfirmKeyboard,
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
  discussionExtraSlotConfirmKeyboard,
  discussionExtraSlotAckKeyboard,
  discussionSelectTasteKeyboard,
  discussionSelectItemKeyboard,
  discussionRemoveMembersKeyboard,
};
