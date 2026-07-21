const test = require("node:test");
const assert = require("node:assert/strict");

const { callBacks } = require("../src/constants");
const {
  deleteCallbackMessageIfPossible,
  getStaleCallbackFields,
  isHistorySafeListCallback,
  retireStaleCallbackCardIfNeeded,
} = require("../src/flows/callback-lifecycle");

test("callback lifecycle maps feature actions to their remembered card fields", () => {
  assert.deepEqual(getStaleCallbackFields(callBacks.profilePrivacy), ["publicProfileLastMessageId"]);
  assert.ok(getStaleCallbackFields(`${callBacks.discussionClose}room-1`).includes("discussionLastRoomRecentMessageId"));
  assert.ok(getStaleCallbackFields(`${callBacks.profileSaveByCode}u_ABC123`).includes("publicProfileLastMessageId"));
  assert.deepEqual(getStaleCallbackFields(callBacks.menuMain), []);
});

test("a superseded callback card is retired before its action runs", async () => {
  const operations = [];
  const ctx = {
    callbackMessageId: 10,
    user: { publicProfileLastMessageId: 20 },
    answerCb: async () => operations.push("answer"),
    deleteMessage: async (messageId) => {
      operations.push(["delete", messageId]);
      return true;
    },
  };

  assert.equal(await retireStaleCallbackCardIfNeeded(ctx, callBacks.profilePrivacy), true);
  assert.deepEqual(operations, ["answer", ["delete", 10]]);
});

test("current cards and history-safe list callbacks remain actionable", async () => {
  const currentCtx = {
    callbackMessageId: 20,
    user: { publicProfileLastMessageId: 20 },
  };
  assert.equal(await retireStaleCallbackCardIfNeeded(currentCtx, callBacks.profilePrivacy), false);

  const historyCtx = {
    callbackMessageId: 10,
    user: { savedProfilesLastListMessageId: 20 },
  };
  const pageCallback = `${callBacks.savedProfilesPage}1`;
  assert.equal(isHistorySafeListCallback(pageCallback), true);
  assert.equal(await retireStaleCallbackCardIfNeeded(historyCtx, pageCallback), false);
});

test("callback cleanup never deletes a reply-keyboard user message", async () => {
  let deleted = false;
  const result = await deleteCallbackMessageIfPossible({
    callbackMessageId: 10,
    isReplyKeyboardAction: true,
    deleteMessage: async () => {
      deleted = true;
      return true;
    },
  });
  assert.equal(result, false);
  assert.equal(deleted, false);
});
