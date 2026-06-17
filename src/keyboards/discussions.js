const { callBacks } = require("../constants");
const messages = require("../messages");

function inlineKeyboard(rows) {
  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

function ltrText(value) {
  return `\u200e${value}`;
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

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  };
}

function discussionInvitePreviewKeyboard(lang, publicDiscussionCode) {
  const cleanCode = String(publicDiscussionCode || "").replace(/^d_/i, "");
  return inlineKeyboard([
    [{ text: messages[lang].discussionInviteJoinButton, callback_data: `${callBacks.discussionInviteJoin}d_${cleanCode}` }],
    [{ text: messages[lang].discussionBack, callback_data: callBacks.discussions }],
  ]);
}

function discussionJoinErrorAckKeyboard(lang, listType = "active") {
  const rawListType = String(listType || "").trim();
  const savedMatch = rawListType.match(/^saved:u_([a-z0-9]+)$/i);
  const normalizedListType = savedMatch
    ? `saved:u_${savedMatch[1].toUpperCase()}`
    : listType === "mine" ? "mine"
    : listType === "discussions" ? "discussions"
    : "active";
  return inlineKeyboard([
    [{
      text: messages[lang].acknowledgeButton,
      callback_data: `${callBacks.discussionJoinErrorAck}${normalizedListType}`,
    }],
  ]);
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
  return inlineKeyboard(rows);
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
  return inlineKeyboard(rows);
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

module.exports = {
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionRoomKeyboard,
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
};
