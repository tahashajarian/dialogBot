const test = require("node:test");
const assert = require("node:assert/strict");

const { handleCallback } = require("../src/callbacks");
const { callBacks } = require("../src/constants");

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
    editMessageText: async () => false,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => ({ message_id: 99 }),
  };

  await handleCallback(ctx);

  assert.equal(deletedIds[0], 456);
  assert.equal(deletedIds[1], 1);
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
  assert.match(replies.at(-1).text, /پروفیل‌های ذخیره‌شده|هنوز پروفایلی ذخیره نکردی/);
});

test("saved profile back removes inline keyboard without deleting profile card", async () => {
  const deletedIds = [];
  const editedMarkups = [];
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
      showActiveDiscussionOnProfile: false,
    },
    answerCb: async () => true,
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
    editMessageReplyMarkup: async (messageId, replyMarkup) => {
      editedMarkups.push({ messageId, replyMarkup });
      return true;
    },
    editMessageText: async () => false,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  await handleCallback(ctx);

  assert.deepEqual(deletedIds, []);
  assert.deepEqual(editedMarkups, [{ messageId: 789, replyMarkup: { inline_keyboard: [] } }]);
  assert.match(replies.at(-1).text, /پروفیل‌های ذخیره‌شده|هنوز پروفایلی ذخیره نکردی/);
});
