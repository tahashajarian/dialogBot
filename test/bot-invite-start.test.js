const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  getStartInviteCode,
  isUnsupportedDiscussionMessage,
  replyToUnsupportedDiscussionMessage,
  sendDiscussionMessageToRecipient,
} = require("../src/bot");

test("start invite parser accepts deep-link payload variants", () => {
  assert.equal(getStartInviteCode("/start join_ab12"), "d_AB12");
  assert.equal(getStartInviteCode("/start@LikelyBot join_ab12"), "d_AB12");
  assert.equal(getStartInviteCode("/start?join_ab12"), "d_AB12");
  assert.equal(getStartInviteCode("/start=d_ab12"), "d_AB12");
});

test("start invite parser ignores normal start and unrelated payloads", () => {
  assert.equal(getStartInviteCode("/start"), "");
  assert.equal(getStartInviteCode("/start profile_ab12"), "");
});

test("invite welcome copy leads into the invite instead of onboarding", () => {
  for (const lang of ["fa", "en"]) {
    assert.match(messages[lang].discussionInviteWelcome, /^🤖/);
    assert.match(messages[lang].discussionInviteWelcome, /inv|دعوت/i);
    assert.doesNotMatch(messages[lang].discussionInviteWelcome, /3 interests|۳ علاقه/);
  }
});

test("discussion reply helper extracts replied message id", () => {
  assert.equal(getReplyMessageId({ reply_to_message: { message_id: 123 } }), 123);
  assert.equal(getReplyMessageId({ replyToMessage: { messageId: 456 } }), 456);
  assert.equal(getReplyMessageId({}), null);
});

test("discussion outbound formatter stays plain for natural replies", () => {
  const text = formatDiscussionOutboundMessage(messages, "en", {
    senderDisplayName: "Sara",
    text: "I agree",
  });

  assert.equal(text, "Sara: I agree");
});

test("active discussions reject non-text messages only in the normal room state", () => {
  const activeMediaContext = {
    user: { activeDiscussionId: "discussion-id" },
    message: { photo: [{ file_id: "photo-id" }] },
  };

  assert.equal(isUnsupportedDiscussionMessage(activeMediaContext, "idle", ""), true);
  assert.equal(isUnsupportedDiscussionMessage(activeMediaContext, "editing_photo", ""), false);
  assert.equal(isUnsupportedDiscussionMessage(activeMediaContext, "idle", "hello"), false);
  assert.equal(isUnsupportedDiscussionMessage({ user: {}, message: activeMediaContext.message }, "idle", ""), false);

  for (const lang of ["fa", "en"]) {
    assert.match(messages[lang].discussionMessageOnlyText, /^🤖/);
  }
});

test("unsupported discussion notice replies to the failed message", async () => {
  const replies = [];
  const ctx = {
    message: { message_id: 77 },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 78 };
    },
  };

  await replyToUnsupportedDiscussionMessage(ctx, "Not sent");

  assert.deepEqual(replies, [{
    text: "Not sent",
    extra: { reply_to_message_id: 77 },
  }]);
});

test("unsupported discussion notice falls back when native reply fails", async () => {
  const replies = [];
  const ctx = {
    message: { message_id: 77 },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      if (extra) throw new Error("reply unsupported");
      return { message_id: 78 };
    },
  };

  await replyToUnsupportedDiscussionMessage(ctx, "Not sent");

  assert.deepEqual(replies, [
    { text: "Not sent", extra: { reply_to_message_id: 77 } },
    { text: "Not sent", extra: undefined },
  ]);
});

test("discussion message sender uses platform reply id when available", async () => {
  const sends = [];
  const ctx = {
    sendToUser: async (userId, text, extra = {}) => {
      sends.push({ userId, text, extra });
      return { message_id: 99 };
    },
  };
  const sent = await sendDiscussionMessageToRecipient(ctx, 2, "Sara: I agree", {
    deliveries: { 2: 55 },
  });

  assert.deepEqual(sends, [{
    userId: 2,
    text: "Sara: I agree",
    extra: { reply_to_message_id: 55 },
  }]);
  assert.equal(sent.message_id, 99);
});
