const test = require("node:test");
const assert = require("node:assert/strict");

const { handleCallback } = require("../src/callbacks");
const { callBacks } = require("../src/constants");
const messages = require("../src/messages");
const { sendPublicProfileByCode } = require("../src/flows/saved-profiles");
const User = require("../src/models/user");
const { formatOperationalLimitsText } = require("../src/services/operational-limits-ui");

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
  assert.equal(updates[0].update.profileLastMessageId, 1);
});

test("help rules callback opens the rules card", async () => {
  const edits = [];
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
  };

  await handleCallback(ctx);

  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, 321);
  assert.equal(edits[0].text, formatOperationalLimitsText(messages.en.helpRulesText));
  const labels = edits[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.text);
  assert.deepEqual(labels, [messages.en.helpBackToGuide, messages.en.helpBackToMain]);
});

test("profile settings keeps the profile display with settings controls", async () => {
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

  await handleCallback(ctx);

  assert.equal(deletedIds[0], 321);
  assert.match(replies[0].text, /profile/i);
  assert.match(replies[0].text, /Ali/);
  assert.equal(
    replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.profileEditBio,
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
  assert.match(replies[0].text, /Show active discussion/);
  assert.doesNotMatch(replies[0].text, /\/ad_help/);
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
  assert.equal(edits[0].extra.reply_markup.inline_keyboard[0][0].callback_data, callBacks.profileEditName);
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
  assert.match(replies[0].text, /Ali/);
  assert.equal(replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data, callBacks.profileEditName);
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

test("main menu entries open sections without hard delete-first gap", async () => {
  const scenarios = [
    callBacks.aiAssistant,
    callBacks.discussions,
  ];

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
    assert.equal(deletedIds.length, 0);
  }
});

test("saved profiles clears stale cards and bottom keyboard before rendering list", async () => {
  const deletedIds = [];
  const replies = [];
  const edits = [];
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

  assert.equal(deletedIds[0], 456);
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
  assert.match(replies[0].text, /پروفیل‌های ذخیره‌شده|هنوز پروفایلی ذخیره نکردی/);
  assert.equal(edits[0].extra.reply_markup.inline_keyboard.at(-1)[0].callback_data, callBacks.menuMain);
});

test("people hub opens discovery and saved profile choices", async () => {
  const replies = [];
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
    deleteMessage: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  await handleCallback(ctx);

  assert.match(replies.at(-1).text, /آدم‌ها/);
  const buttons = replies.at(-1).extra.reply_markup.inline_keyboard.flat();
  assert.equal(buttons[0].callback_data, callBacks.peopleDiscover);
  assert.equal(buttons[1].callback_data, callBacks.savedProfiles);
});

test("free people discovery empty state uses the profile empty tip", async () => {
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

  assert.match(replies.at(-1).text, /فعلاً پروفایلی برای نمایش نیست/);
  const buttons = replies.at(-1).extra.reply_markup.inline_keyboard.flat();
  assert.ok(!buttons.some((button) => button.callback_data === callBacks.aiAssistant));
  assert.equal(buttons.at(-1).callback_data, callBacks.people);
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

  assert.deepEqual(deletedIds, [42]);
  assert.equal(ctx.user.peopleLastListMessageId, null);
  assert.equal(replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data, callBacks.peopleDiscover);
});

test("saved profiles remembers the real list message id when edit returns true", async () => {
  const ctx = {
    callbackData: callBacks.savedProfiles,
    callbackMessageId: 456,
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "A",
      profileName: "A",
      savedProfileCodes: [],
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async () => true,
    editMessageText: async () => true,
    reply: async () => ({ message_id: 77 }),
    replyWithPhoto: async () => ({ message_id: 99 }),
  };

  await handleCallback(ctx);

  assert.equal(ctx.user.savedProfilesLastListMessageId, 77);
});

test("AI back clears the section bottom keyboard before main menu", async () => {
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
      aiSectionPinnedMessageId: null,
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

  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
  assert.match(replies[0].text, /منوی اصلی/);
  assert.equal(deletedIds.includes(1), false);
  assert.deepEqual(
    edits[0].extra.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.language,
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
      savedProfileCodes: [],
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

  assert.deepEqual(deletedIds, [42, 55]);
  assert.equal(ctx.user.savedProfilesLastListMessageId, null);
  assert.equal(ctx.user.publicProfileLastMessageId, 100);
  assert.equal(replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data, callBacks.savedProfiles);
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

  assert.equal(edits[0].messageId, 42);
  assert.equal(edits[0].text, " ");
  assert.deepEqual(edits[0].extra.reply_markup.inline_keyboard, []);
  assert.equal(deletedIds.includes(42), true);
  assert.equal(ctx.user.savedProfilesLastListMessageId, null);
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
