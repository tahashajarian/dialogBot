const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearDiscussionDeliveriesForTest,
  findDiscussionDelivery,
  getReplyMessageIdForRecipient,
  rememberDiscussionDelivery,
} = require("../src/services/discussion-delivery-memory");

test("discussion delivery memory maps local message ids across recipients", () => {
  clearDiscussionDeliveriesForTest();

  rememberDiscussionDelivery({
    discussionId: "room1",
    deliveriesByUserId: {
      1: 10,
      2: 20,
      3: 30,
    },
  });

  const delivery = findDiscussionDelivery({
    userId: 2,
    messageId: 20,
    discussionId: "room1",
  });

  assert.equal(getReplyMessageIdForRecipient(delivery, 1), 10);
  assert.equal(getReplyMessageIdForRecipient(delivery, 3), 30);
  assert.equal(findDiscussionDelivery({ userId: 2, messageId: 20, discussionId: "other" }), null);
});
