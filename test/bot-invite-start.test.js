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

test("banned users receive only the ban notice", async () => {
  const replies = [];
  const answers = [];
  const ctx = {
    callbackData: callBacks.profile,
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      bannedAt: new Date(),
      state: "idle",
    },
    answerCb: async (text, extra) => {
      answers.push({ text, extra });
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  await handleUpdate(ctx);

  assert.equal(answers.length, 1);
  assert.equal(answers[0].text, messages.en.userBannedAccessDenied);
  assert.equal(answers[0].extra.show_alert, true);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.en.userBannedAccessDenied);
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
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

test("saved profile command clears saved list before opening profile", async () => {
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
      return true;
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

  assert.equal(deleteAttempts.includes(42), true);
  assert.equal(
    photos[0].extra.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.savedProfiles,
  );
  assert.equal(photos[0].extra.reply_markup.inline_keyboard.length, 1);
  assert.equal(ctx.user.savedProfilesLastListMessageId, null);
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

test("saved profile discussions include visible active discussion without duplicating created room", async () => {
  const originalFind = Discussion.find;
  const originalFindOneDiscussion = Discussion.findOne;
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  const activeDiscussion = {
    _id: "disc_active",
    title: "Active room",
    publicDiscussionCode: "d_ACTIVE",
    creatorUserId: 2,
    memberUserIds: [2],
    maxMembers: 20,
    status: "open",
    joinRule: { type: "open" },
  };

  Discussion.findOne = () => ({ lean: async () => activeDiscussion });
  Discussion.find = (query) => {
    assert.deepEqual(query._id, { $ne: "disc_active" });
    return { limit: () => ({ lean: async () => [] }) };
  };
  User.findOneAndUpdate = async () => ({});
  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_3HNU",
    firstName: "Saved User",
    profileName: "Saved User",
    activeDiscussionId: "disc_active",
    showActiveDiscussionOnProfile: true,
  });

  const ctx = {
    text: "/discussions_3HNU",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      savedProfileCodes: ["u_3HNU"],
      savedProfilesLastListMessageId: null,
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
  };

  try {
    await handleUpdate(ctx);
  } finally {
    Discussion.find = originalFind;
    Discussion.findOne = originalFindOneDiscussion;
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.match(replies[0].text, /Active discussion/);
  assert.match(replies[0].text, /Active room/);
  assert.doesNotMatch(replies[0].text, /Created discussions/);
});

test("saved profile invite command clears saved profile surfaces", async () => {
  const originalFindOne = User.findOne;
  const originalFind = Discussion.find;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deleteAttempts = [];

  User.findOne = () => ({
    select: () => ({
      lean: async () => ({
        userId: 2,
        publicProfileCode: "u_3HNU",
        firstName: "Saved User",
        profileName: "Saved User",
      }),
    }),
  });
  Discussion.find = () => ({ sort: async () => [] });
  User.findOneAndUpdate = async () => ({});

  const ctx = {
    text: "/iv_3HNU",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      savedProfileCodes: ["u_3HNU"],
      savedProfilesLastListMessageId: 42,
      publicProfileLastMessageId: 43,
      discussionLastListMessageId: 44,
      discussionLastListType: "saved:u_3HNU",
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
    User.findOne = originalFindOne;
    Discussion.find = originalFind;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleteAttempts.slice(0, 3), [42, 43, 44]);
  assert.equal(ctx.user.savedProfilesLastListMessageId, null);
  assert.equal(ctx.user.publicProfileLastMessageId, null);
  assert.equal(ctx.user.discussionLastListMessageId, null);
  assert.equal(ctx.user.discussionLastListType, "");
});
