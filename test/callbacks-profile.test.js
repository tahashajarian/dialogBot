const test = require("node:test");
const assert = require("node:assert/strict");

const { handleCallback } = require("../src/callbacks");
const { callBacks } = require("../src/constants");
const messages = require("../src/messages");
const { mainMenuKeyboard } = require("../src/keyboards");
const {
  handleSavedProfilesCallback,
  requestUnsaveProfileConfirmation,
  saveProfileCommand,
  savedProfilesLimitKeyboard,
  sendPublicProfileByCode,
} = require("../src/flows/saved-profiles");
const User = require("../src/models/user");
const Discussion = require("../src/models/discussion");
const DiscussionInvitation = require("../src/models/discussion-invitation");
const { formatOperationalLimitsText } = require("../src/services/operational-limits-ui");
const { starEconomy } = require("../src/services/star-settings");

const keyboardButtons = (extra) => (
  extra?.reply_markup?.keyboard || extra?.reply_markup?.inline_keyboard || []
).flat();

test("saved-profile limit notice has a dismiss-only Got it action", async () => {
  const keyboard = savedProfilesLimitKeyboard("en");
  const button = keyboard.reply_markup.inline_keyboard[0][0];
  assert.equal(button.text, messages.en.acknowledgeButton);
  assert.equal(button.callback_data, callBacks.savedProfilesLimitClose);

  const deleted = [];
  const handled = await handleSavedProfilesCallback({
    callbackData: callBacks.savedProfilesLimitClose,
    callbackMessageId: 44,
    answerCb: async () => true,
  }, "en", {
    deleteCallbackMessageIfPossible: async (ctx) => {
      deleted.push(ctx.callbackMessageId);
      return true;
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(deleted, [44]);
});

test("inline saved-profile removal confirms and cancels on the same profile card", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const markups = [];
  const deleted = [];
  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_A1",
    profileName: "Saved User",
    showActiveDiscussionOnProfile: false,
  });
  User.findOneAndUpdate = async () => ({ userId: 1 });
  const ctx = {
    callbackMessageId: 77,
    userId: 1,
    user: {
      userId: 1,
      navigationMode: "public_profile:saved:u_A1:2:saved:0",
      savedProfileCodes: ["u_A1"],
    },
    editMessageReplyMarkup: async (messageId, replyMarkup) => {
      markups.push({ messageId, replyMarkup });
      return true;
    },
    reply: async () => {
      throw new Error("inline profile confirmation should not send a new card");
    },
  };

  try {
    await requestUnsaveProfileConfirmation(ctx, "en", "u_A1");
    assert.deepEqual(
      markups[0].replyMarkup.inline_keyboard.flat().map((button) => button.callback_data),
      [callBacks.profileUnsaveConfirm, callBacks.profileUnsaveCancel],
    );

    ctx.callbackData = callBacks.profileUnsaveCancel;
    ctx.user.navigationMode = "profile_unsave_confirm:saved:u_A1:2";
    await handleSavedProfilesCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => {
        deleted.push(77);
        return true;
      },
    });
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const restoredCallbacks = markups[1].replyMarkup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(restoredCallbacks.includes(`${callBacks.profileUnsaveByCode}u_A1`));
  assert.equal(restoredCallbacks.at(-1), callBacks.profileCloseDiscussionMember);
  assert.deepEqual(deleted, []);
});

test("language change sends confirmation before localized Home", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const deletedIds = [];
  User.findOneAndUpdate = async () => ({ userId: 999, lang: "fa" });

  const ctx = {
    callbackData: callBacks.langSetFa,
    callbackMessageId: 123,
    userId: 999,
    user: { userId: 999, lang: "en", state: "idle" },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, [123]);
  assert.equal(replies[0].text, "👩‍🦳 زبان به فارسی تغییر کرد.");
  assert.equal(replies[0].extra, undefined);
  assert.equal(replies[1].text, messages.fa.mainMenu);
  assert.match(replies[1].text, /^🏠 خانه/);
  assert.deepEqual(replies[1].extra, mainMenuKeyboard("fa"));
});

test("Home language button opens an inline picker without replacing the reply keyboard", async () => {
  const replies = [];
  const ctx = {
    callbackData: callBacks.language,
    isReplyKeyboardAction: true,
    userId: 999,
    user: { userId: 999, lang: "en", state: "idle", navigationMode: "global" },
    answerCb: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 1 };
    },
  };

  await handleCallback(ctx);

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.en.chooseLanguage);
  assert.equal(replies[0].extra.reply_markup.keyboard, undefined);
  assert.deepEqual(
    replies[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data),
    [callBacks.langSetFa, callBacks.langSetEn, callBacks.languageClose],
  );
  assert.equal(ctx.user.navigationMode, "global");
});

test("language picker Close deletes only its inline card", async () => {
  const deleted = [];
  const ctx = {
    callbackData: callBacks.languageClose,
    callbackMessageId: 123,
    userId: 999,
    user: { userId: 999, lang: "en", state: "idle", navigationMode: "global" },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
  };

  await handleCallback(ctx);

  assert.deepEqual(deleted, [123]);
  assert.equal(ctx.user.navigationMode, "global");
});

test("profile Back leaves a Home footprint before a fresh card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const edits = [];
  const deletedIds = [];
  const replies = [];
  User.findOneAndUpdate = async () => ({ userId: 999, state: "idle" });

  const ctx = {
    callbackData: callBacks.profileBack,
    callbackMessageId: 123,
    callbackMessage: { text: "Profile" },
    userId: 999,
    user: { userId: 999, lang: "en", state: "idle" },
    answerCb: async () => true,
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text) => {
      replies.push(text);
      return { message_id: 1 };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(edits.length, 0);
  assert.deepEqual(deletedIds, [123]);
  assert.deepEqual(replies, [messages.en.mainMenu]);
});

test("profile Back deletes a photo profile before sending Home", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const edits = [];
  const deletedIds = [];
  const replies = [];
  User.findOneAndUpdate = async () => ({ userId: 999, state: "idle" });

  const ctx = {
    callbackData: callBacks.profileBack,
    callbackMessageId: 124,
    callbackMessage: { photo: [{ file_id: "photo" }], caption: "Profile" },
    userId: 999,
    user: { userId: 999, lang: "en", state: "idle" },
    answerCb: async () => true,
    editMessageText: async (...args) => {
      edits.push(args);
      return true;
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text) => {
      replies.push(text);
      return { message_id: 1 };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(edits, []);
  assert.deepEqual(deletedIds, [124]);
  assert.deepEqual(replies, [messages.en.mainMenu]);
});

test("profile callback deletes current menu message before rendering profile", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const updates = [];

  User.findOneAndUpdate = async (query, update) => {
    updates.push({ query, update });
    return { userId: query.userId };
  };

  const ctx = {
    callbackData: callBacks.profile,
    callbackMessageId: 123,
    userId: 999,
    user: {
      userId: 999,
      lang: "fa",
      firstName: "Ali",
      profileName: "Ali",
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text) => {
      replies.push(text);
      return { message_id: 1 };
    },
    replyWithPhoto: async () => ({ message_id: 2 }),
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(deletedIds[0], 123);
  assert.ok(replies.length >= 1);
});

test("opening a custom-photo profile sends compact controls, then the inline photo card without loading", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const photos = [];
  User.findOneAndUpdate = async (query) => ({ userId: query.userId });

  const ctx = {
    callbackData: callBacks.profile,
    callbackMessageId: 125,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      firstName: "Ali",
      profileName: "Ali",
      photoFileId: "profile-photo",
      state: "idle",
    },
    answerCb: async () => true,
    deleteMessage: async () => true,
    reply: async (text) => {
      replies.push(text);
      return { message_id: 1 };
    },
    replyWithPhoto: async (photo, extra) => {
      photos.push({ photo, extra });
      return { message_id: 2 };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(replies, [messages.en.profileEditMenuText]);
  assert.equal(photos.length, 1);
  assert.equal(photos[0].photo, "profile-photo");
  assert.match(photos[0].extra.caption, /Your profile:/);
});

test("help rules callback opens the rules card", async () => {
  const edits = [];
  const replies = [];
  const ctx = {
    callbackData: callBacks.helpRules,
    callbackMessageId: 321,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      state: "idle",
    },
    answerCb: async () => true,
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 322 };
    },
  };

  await handleCallback(ctx);

  assert.equal(replies.length, 0);
  assert.equal(edits[0].text, formatOperationalLimitsText(messages.en.helpRulesText));
  const buttons = keyboardButtons(edits[0].extra);
  assert.deepEqual(buttons.map((button) => button.text), [messages.en.discussionShareClose]);
  assert.deepEqual(buttons.map((button) => button.callback_data), [callBacks.helpCardClose]);
});

test("Guide card Close deletes only the selected inline card", async () => {
  const deleted = [];
  const ctx = {
    callbackData: callBacks.helpCardClose,
    callbackMessageId: 321,
    userId: 999,
    user: { userId: 999, lang: "en", state: "idle", navigationMode: "help" },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
  };

  await handleCallback(ctx);

  assert.deepEqual(deleted, [321]);
  assert.equal(ctx.user.navigationMode, "help");
});

test("legacy profile settings callback returns to the flattened profile", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  User.findOneAndUpdate = async () => ({});
  const deletedIds = [];
  const replies = [];

  const ctx = {
    callbackData: callBacks.profileSettings,
    callbackMessageId: 321,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      firstName: "Ali",
      profileName: "Ali",
      city: "Tehran",
      age: 30,
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(deletedIds[0], 321);
  assert.match(replies.at(-1).text, /profile/i);
  assert.match(replies.at(-1).text, /Ali/);
  assert.equal(
    keyboardButtons(replies.at(-1).extra)[0].text,
    messages.en.profileEditAge,
  );
});

test("discussion help Got it records acknowledgement and only removes the help card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  const deletedIds = [];
  const replies = [];

  User.findOneAndUpdate = async (query, update) => {
    updates.push({ query, update });
    return { userId: query.userId };
  };

  const ctx = {
    callbackData: callBacks.profileActiveDiscussionHelpDone,
    callbackMessageId: 222,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      firstName: "Ali",
      profileName: "Ali",
      showActiveDiscussionOnProfile: false,
      starBalance: 0,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(updates[0].query.userId, 999);
  assert.ok(updates[0].update.activeDiscussionHelpAcknowledgedAt instanceof Date);
  assert.deepEqual(deletedIds, [222]);
  assert.equal(replies.length, 0);
});

test("discussion help Got it does not navigate when card deletion fails", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const edits = [];
  const replies = [];

  User.findOneAndUpdate = async (query) => ({ userId: query.userId });

  const ctx = {
    callbackData: callBacks.profileActiveDiscussionHelpDone,
    callbackMessageId: 333,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      firstName: "Ali",
      profileName: "Ali",
      showActiveDiscussionOnProfile: false,
      starBalance: 0,
    },
    answerCb: async () => true,
    deleteMessage: async () => false,
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.length, 0);
  assert.equal(edits.length, 0);
});

test("profile emoji insufficient Stars edits the profile card to acknowledgement", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const edits = [];

  User.findOne = () => ({
    select: () => ({
      lean: async () => ({ userId: 999, starBalance: 0, profileEmoji: "" }),
    }),
  });
  User.findOneAndUpdate = async () => ({ userId: 999 });

  const ctx = {
    callbackData: `${callBacks.profileEmojiConfirm}abc`,
    callbackMessageId: 321,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      state: "profile_emoji_confirm:0:3:abc",
      starBalance: 0,
      profileEmoji: "",
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, []);
  assert.deepEqual(replies, []);
  assert.match(edits[0].text, /complete your profile/i);
  const buttons = edits[0].extra.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map((button) => button.callback_data), [callBacks.profileEmojiInsufficientDone]);
});

test("profile emoji confirm Back edits the same card to the emoji picker", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const states = [];
  const edits = [];

  User.findOneAndUpdate = async (query, update) => {
    if (Object.hasOwn(update || {}, "state")) {
      states.push(update.state);
    }
    return { userId: query.userId };
  };

  const ctx = {
    callbackData: callBacks.profileEmojiCancel,
    callbackMessageId: 333,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      state: "profile_emoji_confirm:0:3:abc",
      starBalance: 5,
      profileEmoji: "",
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(states, ["editing_profile_emoji"]);
  assert.deepEqual(deletedIds, []);
  assert.deepEqual(replies, []);
  assert.match(edits[0].text, /Choose an emoji/);
  const callbacks = edits[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(callbacks.includes("profile:emoji:choose:0"));
});

test("profile emoji Close restores the same profile card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const states = [];
  const edits = [];

  User.findOneAndUpdate = async (query, update) => {
    if (Object.hasOwn(update || {}, "state")) states.push(update.state);
    return { userId: query.userId };
  };

  const ctx = {
    callbackData: callBacks.profileEmojiClose,
    callbackMessageId: 334,
    userId: 999,
    user: { userId: 999, lang: "en", state: "editing_profile_emoji" },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(states, ["idle"]);
  assert.deepEqual(deletedIds, []);
  assert.deepEqual(replies, []);
  assert.match(edits[0].text, /Your profile/);
  assert.equal(keyboardButtons(edits[0].extra)[0].callback_data, callBacks.profileEditAge);
});

test("selection-only profile picker Close restores the same profile card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const edits = [];
  User.findOneAndUpdate = async () => ({ userId: 999 });
  const ctx = {
    callbackData: callBacks.profilePickerClose,
    callbackMessageId: 456,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      state: "editing_gender",
      profileEditPromptMessageId: 456,
      publicProfileLastMessageId: 456,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 1 };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, []);
  assert.deepEqual(replies, []);
  assert.match(edits[0].text, /Your profile/);
  assert.equal(ctx.user.state, "idle");
  assert.equal(ctx.user.profileEditPromptMessageId, null);
});

test("Interests opens inline by editing a photo profile card and remembering it", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const captionEdits = [];
  User.findOneAndUpdate = async (query) => ({ userId: query.userId });
  const ctx = {
    callbackData: callBacks.profileEditInterests,
    callbackMessageId: 457,
    callbackMessage: { photo: [{}], caption: "old profile" },
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      state: "idle",
      photoFileId: "photo-file",
      aiLists: { random: { topTen: [] } },
    },
    answerCb: async () => true,
    editMessageCaption: async (messageId, text, extra) => {
      captionEdits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
    reply: async () => assert.fail("Interests should edit the profile card"),
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(captionEdits[0].messageId, 457);
  assert.match(captionEdits[0].text, /Interests/);
  assert.equal(ctx.user.profileEditPromptMessageId, 457);
  assert.equal(ctx.user.navigationMode, "profile_interests:0");
});

test("saving inline Age restores the same photo profile card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const captionEdits = [];
  User.findOneAndUpdate = async (query) => ({ userId: query.userId });
  const ctx = {
    callbackData: `${callBacks.profileAgeSet}29`,
    callbackMessageId: 458,
    callbackMessage: { photo: [{}], caption: messages.en.profileAskAge },
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      state: "editing_age",
      profileName: "Ali",
      firstName: "Ali",
      photoFileId: "photo-file",
      starBalance: 0,
      showActiveDiscussionOnProfile: true,
    },
    answerCb: async () => true,
    editMessageCaption: async (messageId, text, extra) => {
      captionEdits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
    reply: async () => assert.fail("Age save should restore the profile card in place"),
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(captionEdits.at(-1).messageId, 458);
  assert.match(captionEdits.at(-1).text, /Age:.*29/);
  assert.equal(keyboardButtons(captionEdits.at(-1).extra)[0].callback_data, callBacks.profileEditAge);
  assert.equal(ctx.user.navigationMode, "profile");
});

test("Profile reply-keyboard Back closes an inline Pet picker without redrawing it", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const previousPetEnabled = starEconomy.profilePetPreferenceEnabled;
  const captionEdits = [];
  const replies = [];
  User.findOneAndUpdate = async (query) => ({ userId: query.userId });
  starEconomy.profilePetPreferenceEnabled = true;
  const ctx = {
    callbackData: callBacks.profileCancelEdit,
    isReplyKeyboardAction: true,
    userId: 999,
    user: {
      userId: 999,
      lang: "fa",
      state: "editing_pet_preference",
      navigationMode: "profile_pet",
      profileEditPromptMessageId: 459,
      profileName: "Ali",
      firstName: "Ali",
      photoFileId: "photo-file",
      showActiveDiscussionOnProfile: true,
    },
    answerCb: async () => true,
    editMessageCaption: async (messageId, text, extra) => {
      captionEdits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 999 };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
    starEconomy.profilePetPreferenceEnabled = previousPetEnabled;
  }

  assert.equal(captionEdits.length, 1);
  assert.equal(captionEdits[0].messageId, 459);
  assert.match(captionEdits[0].text, /پروفایل/);
  assert.deepEqual(replies, []);
  assert.equal(ctx.user.state, "idle");
  assert.equal(ctx.user.navigationMode, "profile");
  assert.equal(ctx.user.profileEditPromptMessageId, null);
});

test("profile reply buttons do not retire unrelated remembered cards", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  const deletedIds = [];
  const replies = [];

  User.findOneAndUpdate = async (query, update) => {
    updates.push(update);
    return { userId: query.userId };
  };

  const ctx = {
    callbackData: callBacks.profileEditBio,
    isReplyKeyboardAction: true,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      state: "idle",
      navigationMode: "profile_settings",
      aiLastListMessageId: 111,
      aiLastListSection: "movie",
      aiLastListType: "topTen",
      discussionLastRoomHeaderMessageId: 222,
      discussionLastRoomRecentMessageId: 223,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, []);
  assert.equal(ctx.user.aiLastListMessageId, 111);
  assert.equal(ctx.user.discussionLastRoomHeaderMessageId, 222);
  assert.equal(ctx.user.discussionLastRoomRecentMessageId, 223);
  assert.equal(ctx.user.state, "idle");
  assert.ok(updates.some((update) => update.state === "editing_bio"));
  assert.equal(replies.at(-1).text, messages.en.profileAskBio);
});

test("main Profile reply buttons also preserve remembered cards", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  User.findOneAndUpdate = async (query) => ({ userId: query.userId });

  const ctx = {
    callbackData: callBacks.profileEditName,
    isReplyKeyboardAction: true,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      state: "idle",
      navigationMode: "profile",
      discussionLastRoomHeaderMessageId: 301,
      discussionLastRoomRecentMessageId: 302,
      discussionMenuNoticeMessageId: 303,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async () => ({ message_id: 1 }),
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deletedIds, []);
  assert.equal(ctx.user.discussionLastRoomHeaderMessageId, 301);
  assert.equal(ctx.user.discussionLastRoomRecentMessageId, 302);
  assert.equal(ctx.user.discussionMenuNoticeMessageId, 303);
});

test("saving a legacy Pet picker choice returns to flattened Profile", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const previousPetEnabled = starEconomy.profilePetPreferenceEnabled;
  const replies = [];
  User.findOneAndUpdate = async (query) => ({ userId: query.userId });
  starEconomy.profilePetPreferenceEnabled = true;

  const ctx = {
    callbackData: `${callBacks.profilePetSet}cat`,
    isReplyKeyboardAction: true,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      state: "editing_pet_preference",
      navigationMode: "profile_pet",
      firstName: "Ali",
      profileName: "Ali",
      petPreference: "any",
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
    starEconomy.profilePetPreferenceEnabled = previousPetEnabled;
  }

  assert.equal(ctx.user.navigationMode, "profile");
  assert.match(replies.at(-1).text, /cat/i);
  assert.equal(keyboardButtons(replies.at(-1).extra)[0].callback_data, callBacks.profileEditAge);
});

test("profile emoji insufficient Got it restores the same profile card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const states = [];
  const edits = [];

  User.findOneAndUpdate = async (query, update) => {
    if (Object.hasOwn(update || {}, "state")) {
      states.push(update.state);
    }
    return { userId: query.userId };
  };

  const ctx = {
    callbackData: callBacks.profileEmojiInsufficientDone,
    callbackMessageId: 444,
    userId: 999,
    user: {
      userId: 999,
      lang: "en",
      firstName: "Ali",
      profileName: "Ali",
      state: "editing_profile_emoji",
      starBalance: 0,
      profileEmoji: "",
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(states, ["idle"]);
  assert.deepEqual(deletedIds, []);
  assert.deepEqual(replies, []);
  assert.match(edits[0].text, /Your profile/);
});

test("closing a shared profile restores the exact reply-keyboard mode that was open", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deleted = [];
  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_SHARED",
    profileName: "Shared User",
    showActiveDiscussionOnProfile: false,
    aiLists: { movies: { topTen: [{ title: "Movie" }] } },
  });
  User.findOneAndUpdate = async () => ({});
  const ctx = {
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      state: "idle",
      profileName: "Viewer",
      navigationMode: "favorites",
      savedProfileCodes: [],
    },
    reply: async (text, extra) => ({ message_id: 70, text, extra }),
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
    answerCb: async () => true,
  };

  try {
    await sendPublicProfileByCode(ctx, "en", "u_SHARED", { fromSharedLink: true });
    assert.equal(ctx.user.publicProfileReturnNavigationMode, "favorites");
    assert.match(ctx.user.navigationMode, /^public_profile:shared:/);

    ctx.callbackData = callBacks.profileCloseDiscussionMember;
    ctx.callbackMessageId = 70;
    await handleCallback(ctx);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleted, [70]);
  assert.equal(ctx.user.navigationMode, "favorites");
  assert.equal(ctx.user.publicProfileReturnNavigationMode, "");
});

test("saving the post-onboarding shared profile updates its buttons without redrawing the card", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deleted = [];
  const markups = [];
  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_SHARED",
    profileName: "Shared User",
    showActiveDiscussionOnProfile: false,
    aiLists: { movies: { topTen: [{ title: "Movie" }] } },
  });
  User.findOneAndUpdate = (_query, update) => {
    if (update?.$push?.savedProfileCodes) {
      return { lean: async () => ({ userId: 1, savedProfileCodes: ["u_SHARED"] }) };
    }
    return { lean: async () => ({ userId: 1, savedProfileCodes: ["u_SHARED"] }) };
  };
  const ctx = {
    callbackData: `${callBacks.profileSaveByCode}u_SHARED`,
    callbackMessageId: 70,
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      state: "idle",
      profileName: "Viewer",
      navigationMode: "public_profile:shared:u_SHARED:0:unsaved:0",
      publicProfileReturnNavigationMode: "onboarding_complete:0:0",
      publicProfileLastMessageId: 70,
      savedProfileCodes: [],
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deleted.push(messageId);
      return true;
    },
    editMessageReplyMarkup: async (messageId, markup) => {
      markups.push({ messageId, markup });
      return true;
    },
    reply: async () => assert.fail("saving a shared profile should not resend it"),
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleted, []);
  assert.equal(markups.length, 1);
  assert.equal(markups[0].messageId, 70);
  const callbacks = markups[0].markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(!callbacks.some((callback) => callback.startsWith(callBacks.profileSaveByCode)));
  assert.ok(callbacks.includes(`${callBacks.profileFavoritesOpen}shared:0:u_SHARED`));
  assert.equal(ctx.user.navigationMode, "public_profile:shared:u_SHARED:0:saved:0");
  assert.equal(ctx.user.publicProfileReturnNavigationMode, "onboarding_complete:0:0");
});

test("public profile viewing asks for basic profile first", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];

  User.findOne = async () => ({
    userId: 222,
    publicProfileCode: "u_TARGET",
    firstName: "Target",
    profileName: "Target",
  });

  User.findOneAndUpdate = async () => ({});

  const ctx = {
    userId: 111,
    user: {
      userId: 111,
      lang: "en",
      firstName: "",
      profileName: "",
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => {
      throw new Error("gate should not render target profile");
    },
    toObject: () => ({}),
  };

  try {
    await sendPublicProfileByCode(ctx, "en", "u_TARGET");
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Before viewing other profiles/);
  assert.deepEqual(
    replies[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data),
    [callBacks.profileEditName],
  );
});

test("Home entries retain history and open their bottom-keyboard hubs", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalCountDocuments = DiscussionInvitation.countDocuments;
  User.findOneAndUpdate = async () => ({});
  DiscussionInvitation.countDocuments = async () => 0;
  const scenarios = [
    callBacks.aiAssistant,
    callBacks.discussions,
  ];

  try {
    for (const callbackData of scenarios) {
    const deletedIds = [];
    const ctx = {
      callbackData,
      callbackMessageId: 456,
      userId: 1,
      user: {
        userId: 1,
        lang: "fa",
        firstName: "A",
        profileName: "A",
        savedProfileCodes: [],
        showActiveDiscussionOnProfile: false,
      },
      answerCb: async () => true,
      deleteMessage: async (messageId) => {
        deletedIds.push(messageId);
        return true;
      },
      editMessageText: async () => false,
      reply: async () => ({ message_id: 1 }),
      replyWithPhoto: async () => ({ message_id: 2 }),
    };

      await handleCallback(ctx);
      assert.deepEqual(deletedIds, []);
    }
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
    DiscussionInvitation.countDocuments = originalCountDocuments;
  }
});

test("saved profiles clears bottom keyboard before rendering list when one is active", async () => {
  const deletedIds = [];
  const replies = [];
  const ctx = {
    callbackData: callBacks.savedProfiles,
    callbackMessageId: 456,
    userId: 1,
    user: {
      userId: 1,
      lang: "fa",
      firstName: "A",
      profileName: "A",
      savedProfileCodes: [],
      state: "editing_location",
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => ({ message_id: 99 }),
  };

  await handleCallback(ctx);

  assert.equal(deletedIds[0], 456);
  assert.equal(replies[0].extra?.reply_markup?.remove_keyboard, undefined);
  assert.equal(deletedIds.includes(1), false);
  assert.match(replies[0].text, /آدم‌های ذخیره‌شده|فعلاً پروفایل ذخیره‌شده‌ای نداری/);
  assert.equal(keyboardButtons(replies[0].extra).at(-1).text, messages.fa.discussionShareClose);
});

test("saved profiles sends footprint before a fresh list card", async () => {
  const replies = [];
  const edits = [];
  const deletedIds = [];
  const ctx = {
    callbackData: callBacks.savedProfiles,
    callbackMessageId: 456,
    userId: 1,
    user: {
      userId: 1,
      lang: "fa",
      firstName: "A",
      profileName: "A",
      savedProfileCodes: [],
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => ({ message_id: 99 }),
  };

  await handleCallback(ctx);

  assert.match(replies[0].text, /آدم‌های ذخیره‌شده|فعلاً پروفایل ذخیره‌شده‌ای نداری/);
  assert.deepEqual(deletedIds, [456]);
  assert.deepEqual(edits, []);
  assert.equal(keyboardButtons(replies[0].extra).at(-1).text, messages.fa.discussionShareClose);
});

test("people hub opens discovery and saved profile choices", async () => {
  const replies = [];
  const edits = [];
  const deletedIds = [];
  const ctx = {
    callbackData: callBacks.people,
    callbackMessageId: 456,
    userId: 1,
    user: {
      userId: 1,
      lang: "fa",
      firstName: "A",
      profileName: "A",
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  await handleCallback(ctx);

  assert.match(replies[0].text, /آدم‌ها/);
  assert.deepEqual(deletedIds, [456]);
  assert.deepEqual(edits, []);
  const buttons = keyboardButtons(replies[0].extra);
  assert.equal(buttons[0].text, messages.fa.peopleDiscover);
  assert.equal(buttons[1].text, messages.fa.savedProfiles);
});

test("people discovery insufficient data state links users to lists", async () => {
  const originalFind = User.find;
  const replies = [];
  User.find = () => ({
    select: () => ({
      limit: () => ({
        lean: async () => [],
      }),
    }),
  });
  const ctx = {
    callbackData: callBacks.peopleDiscover,
    callbackMessageId: 456,
    userId: 1,
    user: {
      userId: 1,
      lang: "fa",
      firstName: "A",
      profileName: "A",
      aiLists: { music: { topTen: [], watchlist: [] } },
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 77 };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.find = originalFind;
  }

  assert.match(replies.at(-1).text, /برای دیدن آدم‌ها/);
  const buttons = keyboardButtons(replies.at(-1).extra);
  assert.ok(!buttons.some((button) => button.text === messages.fa.profileEditInterests));
  assert.ok(buttons.some((button) => button.text === messages.fa.aiAssistant));
  assert.equal(buttons.at(-1).text, messages.fa.discussionShareClose);
  assert.equal(ctx.user.peopleLastListMessageId, 77);
});

test("people profile opened from discovery ends with Close", async () => {
  const originalFindOne = User.findOne;
  const deletedIds = [];
  const replies = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_A1",
    firstName: "Seen User",
    profileName: "Seen User",
  });

  const ctx = {
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      peopleLastListMessageId: 42,
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await sendPublicProfileByCode(ctx, "en", "u_A1", { fromPeopleList: true });
  } finally {
    User.findOne = originalFindOne;
  }

  assert.deepEqual(deletedIds, []);
  const buttons = keyboardButtons(replies.at(-1).extra);
  assert.ok(buttons.some((button) => button.text === messages.en.profileSaveButton));
  assert.equal(buttons.at(-1).text, messages.en.discussionShareClose);
});

test("people profile opened from taste discovery ends with Close", async () => {
  const originalFindOne = User.findOne;
  const deletedIds = [];
  const replies = [];
  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_A1",
    profileName: "Taste Match",
    firstName: "Taste",
    showActiveDiscussionOnProfile: false,
  });

  const ctx = {
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      peopleLastListMessageId: 42,
      peopleLastListMode: "taste",
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await sendPublicProfileByCode(ctx, "en", "u_A1", { fromPeopleList: true });
  } finally {
    User.findOne = originalFindOne;
  }

  assert.deepEqual(deletedIds, []);
  const buttons = keyboardButtons(replies.at(-1).extra);
  assert.ok(buttons.some((button) => button.text === messages.en.profileSaveButton));
  assert.equal(buttons.at(-1).text, messages.en.discussionShareClose);
});

test("typed people profile code keeps inline people actions when only mode context remains", async () => {
  const originalFindOne = User.findOne;
  const replies = [];
  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_A1",
    profileName: "Taste Match",
    firstName: "Taste",
    showActiveDiscussionOnProfile: false,
  });

  const ctx = {
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      peopleLastListMessageId: null,
      peopleLastListMode: "taste",
      savedProfileCodes: [],
      showActiveDiscussionOnProfile: false,
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await sendPublicProfileByCode(ctx, "en", "u_A1");
  } finally {
    User.findOne = originalFindOne;
  }

  const buttons = keyboardButtons(replies.at(-1).extra);
  assert.ok(buttons.some((button) => button.text === messages.en.profileSaveButton));
  assert.equal(buttons.at(-1).text, messages.en.discussionShareClose);
});

test("saving from people profile refreshes profile with saved actions", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const updates = [];

  User.findOneAndUpdate = (query, update) => {
    updates.push({ query, update });
    return {
      lean: async () => ({
        userId: 1,
        savedProfileCodes: ["u_A1"],
      }),
    };
  };
  User.findOne = async (query) => {
    if (query.publicProfileCode === "u_A1") {
      return {
        userId: 2,
        publicProfileCode: "u_A1",
        profileName: "Taste Match",
        firstName: "Taste",
        showActiveDiscussionOnProfile: false,
      };
    }
    return { userId: 1, savedProfileCodes: ["u_A1"] };
  };

  const ctx = {
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      peopleLastListMessageId: null,
      peopleLastListMode: "taste",
      savedProfileCodes: [],
      publicProfileLastMessageId: 44,
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 101 };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await saveProfileCommand(ctx, "en", "/save_A1");
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(ctx.user.savedProfileCodes, ["u_A1"]);
  assert.ok(replies.some((entry) => /was saved/.test(entry.text)));
  assert.ok(updates.some((entry) => entry.update.savedProfileCodes));
});

test("profile discussions Back returns to profile with people source intact", async () => {
  const originalFindOneUser = User.findOne;
  const originalFindOneDiscussion = Discussion.findOne;
  const originalFindDiscussion = Discussion.find;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const edits = [];
  const deletedIds = [];
  const updates = [];

  User.findOne = async (query) => {
    if (query.publicProfileCode === "u_A1") {
      return {
        userId: 2,
        publicProfileCode: "u_A1",
        profileName: "Taste Match",
        firstName: "Taste",
        showActiveDiscussionOnProfile: false,
      };
    }
    return { userId: 1, savedProfileCodes: ["u_A1"] };
  };
  User.findOneAndUpdate = async (query, update) => {
    updates.push({ query, update });
    return { userId: query.userId };
  };
  Discussion.findOne = async () => null;
  Discussion.find = () => ({
    limit: () => ({ lean: async () => [] }),
  });

  const ctx = {
    callbackData: `${callBacks.savedProfilesDiscussions}taste:u_A1`,
    callbackMessageId: 50,
    callbackMessage: { text: "profile card" },
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      peopleLastListMode: "taste",
      savedProfileCodes: ["u_A1"],
      publicProfileLastMessageId: 50,
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 101 };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await handleCallback(ctx);

    const discussionButtons = keyboardButtons(edits[0].extra);
    assert.equal(discussionButtons.at(-2).text, messages.en.discussionBack);
    assert.equal(discussionButtons.at(-1).text, messages.en.discussionShareClose);
    assert.equal(ctx.user.discussionLastListType, "people:taste:u_A1");

    ctx.callbackData = `${callBacks.profileDiscussionsBack}u_A1`;
    await handleCallback(ctx);
  } finally {
    User.findOne = originalFindOneUser;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    Discussion.findOne = originalFindOneDiscussion;
    Discussion.find = originalFindDiscussion;
  }

  const profileButtons = keyboardButtons(edits.at(-1).extra);
  assert.ok(!profileButtons.some((button) => button.text === messages.en.savedProfileDiscussions));
  assert.equal(profileButtons.at(-1).text, messages.en.discussionShareClose);
  assert.equal(ctx.user.discussionLastListType, "");
  assert.deepEqual(deletedIds, []);
  assert.ok(updates.some((entry) => entry.update.$set?.discussionLastListType === "people:taste:u_A1"));
});

test("saved profiles remembers the real list message id when edit returns true", async () => {
  const originalFind = User.find;
  User.find = () => ({
    select: () => ({ lean: async () => [] }),
  });
  const ctx = {
    callbackData: callBacks.savedProfiles,
    callbackMessageId: 456,
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "A",
      profileName: "A",
      savedProfileCodes: ["u_A1"],
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async () => true,
    editMessageText: async (messageId) => ({ message_id: messageId }),
    reply: async () => ({ message_id: 77 }),
    replyWithPhoto: async () => ({ message_id: 99 }),
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.find = originalFind;
  }

  assert.equal(ctx.user.savedProfilesLastListMessageId, 77);
});

test("AI inline back leaves a Home footprint before a fresh card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const edits = [];

  User.findOneAndUpdate = async () => ({});

  const ctx = {
    callbackData: callBacks.aiBack,
    callbackMessageId: 456,
    userId: 1,
    user: {
      userId: 1,
      lang: "fa",
      state: "idle",
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return { message_id: messageId };
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleCallback(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.match(replies[0].text, /خانه/);
  assert.deepEqual(deletedIds, [456]);
  assert.deepEqual(edits, []);
  assert.deepEqual(
    keyboardButtons(replies[0].extra).some((button) => button.text === messages.fa.language),
    true,
  );
});

test("saved profile back deletes viewed profile card and renders fresh list", async () => {
  const deletedIds = [];
  const replies = [];
  const ctx = {
    callbackData: callBacks.savedProfiles,
    callbackMessageId: 789,
    callbackMessage: { caption: "profile card", photo: [{}] },
    userId: 1,
    user: {
      userId: 1,
      lang: "fa",
      firstName: "A",
      profileName: "A",
      savedProfileCodes: [],
      publicProfileLastMessageId: 789,
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageText: async () => false,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  await handleCallback(ctx);

  assert.deepEqual(deletedIds, [789]);
  assert.match(replies.at(-1).text, /آدم‌های ذخیره‌شده|فعلاً پروفایل ذخیره‌شده‌ای نداری/);
});

test("opening saved profile clears old list and previous profile before rendering profile", async () => {
  const originalFindOne = User.findOne;
  const deletedIds = [];
  const replies = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_A1",
    firstName: "Saved User",
    profileName: "Saved User",
    showActiveDiscussionOnProfile: true,
  });

  const ctx = {
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      savedProfileCodes: ["u_A1"],
      savedProfilesLastListMessageId: 42,
      publicProfileLastMessageId: 55,
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await sendPublicProfileByCode(ctx, "en", "u_A1", { fromSavedList: true });
  } finally {
    User.findOne = originalFindOne;
  }

  assert.deepEqual(deletedIds, [55]);
  assert.equal(ctx.user.publicProfileLastMessageId, 100);
  const buttons = keyboardButtons(replies.at(-1).extra);
  assert.ok(!buttons.some((button) => button.text === messages.en.savedProfileDiscussions));
  assert.ok(buttons.some((button) => button.text === messages.en.savedProfileRemove));
  assert.equal(buttons.at(-1).text, messages.en.discussionShareClose);
});

test("saved profile shows discussions action when user has an open discussion", async () => {
  const originalFindOneUser = User.findOne;
  const originalFindOneDiscussion = Discussion.findOne;
  const replies = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_A1",
    firstName: "Saved User",
    profileName: "Saved User",
    showActiveDiscussionOnProfile: true,
  });
  Discussion.findOne = (query) => ({
    select: () => ({
      lean: async () => (Number(query.creatorUserId) === 2 ? { _id: "discussion-id" } : null),
    }),
  });

  const ctx = {
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      savedProfileCodes: ["u_A1"],
      showActiveDiscussionOnProfile: false,
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await sendPublicProfileByCode(ctx, "en", "u_A1", { fromSavedList: true });
  } finally {
    User.findOne = originalFindOneUser;
    Discussion.findOne = originalFindOneDiscussion;
  }

  const buttons = keyboardButtons(replies.at(-1).extra);
  assert.ok(buttons.some((button) => button.text === messages.en.savedProfileDiscussions));
  assert.ok(buttons.some((button) => button.text === messages.en.savedProfileRemove));
});

test("shared profiles show visible discussions even when the viewer has not saved them", async () => {
  const originalFindOneUser = User.findOne;
  const originalFindOneDiscussion = Discussion.findOne;
  const replies = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_SHARED",
    firstName: "Shared User",
    profileName: "Shared User",
    showActiveDiscussionOnProfile: true,
  });
  Discussion.findOne = (query) => ({
    select: () => ({
      lean: async () => (Number(query.creatorUserId) === 2 ? { _id: "discussion-id" } : null),
    }),
  });

  const ctx = {
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      navigationMode: "global",
      savedProfileCodes: [],
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
  };

  try {
    await sendPublicProfileByCode(ctx, "en", "u_SHARED", { fromSharedLink: true });
  } finally {
    User.findOne = originalFindOneUser;
    Discussion.findOne = originalFindOneDiscussion;
  }

  const callbacks = keyboardButtons(replies.at(-1).extra).map((button) => button.callback_data);
  assert.ok(callbacks.includes(`${callBacks.savedProfilesDiscussions}shared:u_SHARED`));
  assert.ok(callbacks.includes(`${callBacks.profileSaveByCode}u_SHARED`));
});

test("opening saved profile retires old list text when delete fails", async () => {
  const originalFindOne = User.findOne;
  const deletedIds = [];
  const edits = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_A1",
    firstName: "Saved User",
    profileName: "Saved User",
  });

  const ctx = {
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      savedProfileCodes: ["u_A1"],
      savedProfilesLastListMessageId: 42,
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return false;
    },
    editMessageText: async (messageId, text, extra) => {
      edits.push({ messageId, text, extra });
      return true;
    },
    reply: async () => ({ message_id: 100 }),
    replyWithPhoto: async () => ({ message_id: 101 }),
  };

  try {
    await sendPublicProfileByCode(ctx, "en", "u_A1", { fromSavedList: true });
  } finally {
    User.findOne = originalFindOne;
  }

  assert.deepEqual(edits, []);
  assert.equal(deletedIds.includes(42), false);
});

test("saved profile Back renders fresh list after profile card", async () => {
  const deletedIds = [];
  const replies = [];
  const ctx = {
    callbackData: callBacks.savedProfiles,
    callbackMessageId: 101,
    callbackMessage: { caption: "profile card", photo: [{}] },
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      savedProfileCodes: [],
      savedProfilesLastListMessageId: null,
      publicProfileLastMessageId: 101,
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  await handleCallback(ctx);

  assert.deepEqual(deletedIds, [101]);
  assert.match(replies.at(-1).text, /don't currently have any saved profiles/);
  assert.equal(ctx.user.savedProfilesLastListMessageId, 1);
});
