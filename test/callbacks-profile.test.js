const test = require("node:test");
const assert = require("node:assert/strict");

const { handleCallback } = require("../src/callbacks");
const { callBacks } = require("../src/constants");
const messages = require("../src/messages");
const { mainMenuKeyboard } = require("../src/keyboards");
const { saveProfileCommand, sendPublicProfileByCode } = require("../src/flows/saved-profiles");
const User = require("../src/models/user");
const Discussion = require("../src/models/discussion");
const DiscussionInvitation = require("../src/models/discussion-invitation");
const { formatOperationalLimitsText } = require("../src/services/operational-limits-ui");

const keyboardButtons = (extra) => (
  extra?.reply_markup?.keyboard || extra?.reply_markup?.inline_keyboard || []
).flat();

test("language change sends confirmation before the localized main menu", async () => {
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
  assert.match(replies[1].text, /^🏠 منوی اصلی/);
  assert.deepEqual(replies[1].extra, mainMenuKeyboard("fa"));
});

test("profile Back leaves a main-menu footprint before a fresh menu card", async () => {
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

test("profile Back deletes a photo profile before sending the main menu", async () => {
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

test("opening a custom-photo profile sends one footprint, then the photo without a loading message", async () => {
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

  assert.deepEqual(replies, []);
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

  assert.equal(edits.length, 0);
  assert.equal(replies[0].text, formatOperationalLimitsText(messages.en.helpRulesText));
  const labels = keyboardButtons(replies[0].extra).map((button) => button.text);
  assert.deepEqual(labels, [messages.en.helpBackToGuide, messages.en.helpBackToMain]);
});

test("profile settings keeps the profile display with settings controls", async () => {
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
    messages.en.profileEditBio,
  );
});

test("active discussion help Got it hides future profile help link", async () => {
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
  assert.match(replies.at(-1).text, /Show active discussion/);
  assert.doesNotMatch(replies.at(-1).text, /\/ad_help/);
});

test("active discussion help Got it edits stale card when delete fails", async () => {
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
  assert.equal(edits[0].messageId, 333);
  assert.match(edits[0].text, /Ali/);
  assert.doesNotMatch(edits[0].text, /\/ad_help/);
  assert.equal(keyboardButtons(edits[0].extra)[0].text, messages.en.profileEditName);
});

test("profile emoji insufficient Stars retires confirm card and shows acknowledgement", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];

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

  assert.deepEqual(deletedIds, [321]);
  assert.match(replies[0].text, /complete your profile/i);
  const buttons = replies[0].extra.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map((button) => button.callback_data), [callBacks.profileEmojiInsufficientDone]);
});

test("profile emoji confirm Back returns to emoji picker", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const states = [];

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
  assert.deepEqual(deletedIds, [333]);
  assert.match(replies[0].text, /Choose an emoji/);
  const callbacks = replies[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(callbacks.includes("profile:emoji:choose:0"));
});

test("profile emoji insufficient Got it returns to profile", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deletedIds = [];
  const replies = [];
  const states = [];

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
  assert.deepEqual(deletedIds, [444]);
  assert.match(replies.at(-1).text, /Ali/);
  assert.equal(keyboardButtons(replies.at(-1).extra)[0].text, messages.en.profileEditName);
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

test("main menu entries retain history and open their bottom-keyboard hubs", async () => {
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
  assert.match(replies[0].text, /پروفیل‌های ذخیره‌شده|هنوز پروفایلی ذخیره نکردی/);
  assert.equal(keyboardButtons(replies[0].extra).at(-1).text, messages.fa.aiBack);
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

  assert.match(replies[0].text, /پروفیل‌های ذخیره‌شده|هنوز پروفایلی ذخیره نکردی/);
  assert.deepEqual(deletedIds, [456]);
  assert.deepEqual(edits, []);
  assert.equal(keyboardButtons(replies[0].extra).at(-1).text, messages.fa.aiBack);
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
  assert.equal(buttons.at(-1).text, messages.fa.aiBack);
  assert.equal(ctx.user.peopleLastListMessageId, 77);
});

test("people profile opened from discovery returns to people discovery", async () => {
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
  assert.equal(buttons.at(-1).text, messages.en.aiBack);
});

test("people profile opened from taste discovery returns to taste people list", async () => {
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
  assert.equal(buttons.at(-1).text, messages.en.aiBack);
});

test("typed people profile code keeps people actions when only mode context remains", async () => {
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
  assert.equal(buttons.at(-1).text, messages.en.aiBack);
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

    const discussionButtons = keyboardButtons(replies[0].extra);
    assert.equal(discussionButtons.at(-1).text, messages.en.aiBack);
    assert.equal(ctx.user.discussionLastListType, "people:taste:u_A1");

    ctx.callbackData = `${callBacks.profileViewByCode}u_A1`;
    ctx.callbackMessageId = 101;
    await handleCallback(ctx);
  } finally {
    User.findOne = originalFindOneUser;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    Discussion.findOne = originalFindOneDiscussion;
    Discussion.find = originalFindDiscussion;
  }

  const profileButtons = keyboardButtons(replies.at(-1).extra);
  assert.ok(!profileButtons.some((button) => button.text === messages.en.savedProfileDiscussions));
  assert.equal(profileButtons.at(-1).text, messages.en.aiBack);
  assert.equal(ctx.user.discussionLastListType, "");
  assert.ok(deletedIds.includes(50));
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

test("AI inline back leaves a main-menu footprint before a fresh card", async () => {
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

  assert.match(replies[0].text, /منوی اصلی/);
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
  assert.match(replies.at(-1).text, /پروفیل‌های ذخیره‌شده|هنوز پروفایلی ذخیره نکردی/);
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
  assert.equal(buttons.at(-1).text, messages.en.profileBackToSaved);
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
  assert.match(replies.at(-1).text, /haven't saved any profiles yet/);
  assert.equal(ctx.user.savedProfilesLastListMessageId, 1);
});
