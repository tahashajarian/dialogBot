const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const Discussion = require("../src/models/discussion");
const User = require("../src/models/user");
const {
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  getStartInviteCode,
  handleUpdate,
  isRepeatedStartInvite,
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

test("repeated same start invite payload falls back to normal start", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];

  User.findOneAndUpdate = async () => ({});

  const ctx = {
    text: "/start join_AB12",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Taha",
      profileName: "Taha",
      onboardingVersion: 1,
      lastStartInviteCode: "d_AB12",
      lastStartInviteAt: new Date(),
      handledStartInviteCodes: ["d_AB12"],
      showActiveDiscussionOnProfile: false,
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleUpdate(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.length, 2);
  assert.match(replies[0].text, /Welcome, Taha/);
  assert.doesNotMatch(replies[0].text, /invite/i);
  assert.equal(replies[1].text, messages.en.mainMenu);
});

test("repeated start invite payload clears saved profile list card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deleteAttempts = [];

  User.findOneAndUpdate = async () => ({});

  const ctx = {
    text: "/start join_AB12",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Taha",
      profileName: "Taha",
      onboardingVersion: 1,
      lastStartInviteCode: "d_AB12",
      handledStartInviteCodes: ["d_AB12"],
      savedProfilesLastListMessageId: 42,
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async (messageId) => {
      deleteAttempts.push(messageId);
      return true;
    },
    reply: async () => ({ message_id: 100 + deleteAttempts.length }),
  };

  try {
    await handleUpdate(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleteAttempts, [42]);
  assert.equal(ctx.user.savedProfilesLastListMessageId, null);
});

test("start invite repeat guard blocks handled hidden payloads but not new invite links", () => {
  const now = new Date("2026-06-19T12:00:00Z");
  assert.equal(isRepeatedStartInvite({
    handledStartInviteCodes: ["d_AB12"],
  }, "d_AB12", now), true);

  assert.equal(isRepeatedStartInvite({
    handledStartInviteCodes: ["d_AB12"],
  }, "d_CD34", now), false);
});

test("start invite repeat guard still supports legacy handled-start fields", () => {
  assert.equal(isRepeatedStartInvite({
    lastStartInviteCode: "d_AB12",
    lastStartInviteAt: new Date("2026-06-19T11:59:00Z"),
  }, "d_AB12"), true);

  assert.equal(isRepeatedStartInvite({
    lastStartInviteCode: "d_AB12",
    lastStartInviteAt: new Date("2026-06-19T11:59:00Z"),
  }, "d_CD34"), false);

  assert.equal(isRepeatedStartInvite({
    lastStartInviteCode: "d_AB12",
    lastStartInviteAt: new Date("2026-06-19T11:00:00Z"),
  }, "d_AB12"), true);
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

test("profile name edit rejects emoji and does not save the name", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  const replies = [];

  User.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return {};
  };

  const ctx = {
    text: "Ali 🤖",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      state: "editing_name",
      profileEditPromptMessageId: 20,
    },
    deleteMessage: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 21 };
    },
  };

  try {
    await handleUpdate(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Names cannot include emoji/);
  assert.equal(updates.some((entry) => entry.update?.profileName === "Ali 🤖"), false);
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
    assert.match(messages[lang].discussionMessageOnlyTextOrVoice, /^🤖/);
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

test("saved profile command keeps saved-list back navigation even if stale list cleanup fails", async () => {
  const originalFindOne = User.findOne;
  const deleteAttempts = [];
  const photos = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_3HNU",
    firstName: "Saved User",
    profileName: "Saved User",
  });

  const ctx = {
    text: "/u_3HNU",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      savedProfileCodes: [],
      savedProfilesLastListMessageId: 42,
      discussionLastListType: "invitations",
      discussionLastListMessageId: 77,
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async (messageId) => {
      deleteAttempts.push(messageId);
      return false;
    },
    reply: async () => ({ message_id: 100 }),
    replyWithPhoto: async (photo, extra) => {
      photos.push({ photo, extra });
      return { message_id: 101 };
    },
  };

  try {
    await handleUpdate(ctx);
  } finally {
    User.findOne = originalFindOne;
  }

  assert.equal(deleteAttempts[0], 42);
  assert.equal(
    photos[0].extra.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.savedProfiles,
  );
  assert.equal(photos[0].extra.reply_markup.inline_keyboard.length, 1);
});

test("saved profile discussions command clears saved profile list card", async () => {
  const originalFind = Discussion.find;
  const originalFindOneDiscussion = Discussion.findOne;
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deleteAttempts = [];

  Discussion.findOne = () => ({ lean: async () => null });
  Discussion.find = () => ({ limit: () => ({ lean: async () => [] }) });
  User.findOneAndUpdate = async () => ({});
  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_3HNU",
    firstName: "Saved User",
    profileName: "Saved User",
  });

  const ctx = {
    text: "/discussions_3HNU",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      savedProfileCodes: ["u_3HNU"],
      savedProfilesLastListMessageId: 42,
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async (messageId) => {
      deleteAttempts.push(messageId);
      return true;
    },
    reply: async () => ({ message_id: 100 }),
  };

  try {
    await handleUpdate(ctx);
  } finally {
    Discussion.find = originalFind;
    Discussion.findOne = originalFindOneDiscussion;
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleteAttempts, [42]);
  assert.equal(ctx.user.savedProfilesLastListMessageId, null);
});
