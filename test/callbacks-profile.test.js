const test = require("node:test");
const assert = require("node:assert/strict");

const { handleCallback } = require("../src/callbacks");
const { callBacks } = require("../src/constants");
const User = require("../src/models/user");

test("profile callback deletes current menu message before rendering profile", async () => {
  const deletedIds = [];
  const replies = [];

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

  await handleCallback(ctx);

  assert.equal(deletedIds[0], 123);
  assert.ok(replies.length >= 1);
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

test("saved profile back deletes viewed profile card before rendering list", async () => {
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
