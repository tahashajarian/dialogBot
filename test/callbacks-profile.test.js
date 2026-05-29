const test = require("node:test");
const assert = require("node:assert/strict");

const { handleCallback } = require("../src/callbacks");
const { callBacks } = require("../src/constances");

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
      profileDiscoverable: false,
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
    callBacks.savedProfiles,
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
        profileDiscoverable: false,
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
