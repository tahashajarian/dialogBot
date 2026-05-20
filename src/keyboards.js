const { callBacks } = require("./constances");
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
  ]);
}

function profileKeyboard(lang, hasPhoto = false) {
  const rows = [
    [
      { text: messages[lang].profileEditName, callback_data: callBacks.profileEditName },
    ],
    [
      { text: messages[lang].profileEditCity, callback_data: callBacks.profileEditCity },
      { text: messages[lang].profileEditAge, callback_data: callBacks.profileEditAge },
    ],
    [
      { text: messages[lang].profileEditPhoto, callback_data: callBacks.profileEditPhoto },
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

function ageKeyboard(lang) {
  const ranges = [];
  for (let start = 10; start <= 70; start += 10) {
    const end = Math.min(start + 9, 70);
    ranges.push({
      text: `${start}-${end}`,
      callback_data: `${callBacks.profileAgeRangeSet}${start}`,
    });
  }

  const rows = [];
  for (let index = 0; index < ranges.length; index += 3) {
    rows.push(ranges.slice(index, index + 3));
  }

  rows.push([{ text: messages[lang].cancelEdit, callback_data: callBacks.profileCancelEdit }]);

  return inlineKeyboard(rows);
}

function ageRangeKeyboard(lang, startAge) {
  const rangeStart = Math.max(10, Math.min(Number(startAge) || 10, 70));
  const rangeEnd = Math.min(rangeStart + 9, 70);
  const ages = [];

  for (let age = rangeStart; age <= rangeEnd; age += 1) {
    ages.push({ text: String(age), callback_data: `${callBacks.profileAgeSet}${age}` });
  }

  const rows = [];
  for (let index = 0; index < ages.length; index += 5) {
    rows.push(ages.slice(index, index + 5));
  }

  rows.push([{ text: "↩️", callback_data: callBacks.profileAgeRangeBack }]);
  rows.push([{ text: messages[lang].cancelEdit, callback_data: callBacks.profileCancelEdit }]);

  return inlineKeyboard(rows);
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

module.exports = {
  inlineKeyboard,
  mainMenuKeyboard,
  profileKeyboard,
  cancelEditKeyboard,
  ageKeyboard,
  ageRangeKeyboard,
  languageKeyboard,
};
