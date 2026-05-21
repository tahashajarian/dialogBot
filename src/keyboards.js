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
    [
      {
        text: messages[lang].aiAssistant,
        callback_data: callBacks.aiAssistant,
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

module.exports = {
  inlineKeyboard,
  mainMenuKeyboard,
  aiAssistantKeyboard,
  aiChatBackKeyboard,
  profileKeyboard,
  cancelEditKeyboard,
  ageKeyboard,
  ageRangeKeyboard,
  genderKeyboard,
  petPreferenceKeyboard,
  locationKeyboard,
  languageKeyboard,
};
