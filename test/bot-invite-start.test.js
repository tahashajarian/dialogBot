const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const Discussion = require("../src/models/discussion");
const DiscussionInvitation = require("../src/models/discussion-invitation");
const DiscussionInvitationMute = require("../src/models/discussion-invitation-mute");
const StarReferralClaim = require("../src/models/star-referral-claim");
const StarReferralLink = require("../src/models/star-referral-link");
const User = require("../src/models/user");
const {
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  getNavigationCommand,
  getStartInviteCode,
  getStartReferralCode,
  handleUpdate,
  isUnsupportedDiscussionMessage,
  normalizeIncomingText,
  replyToUnsupportedDiscussionMessage,
  sendDiscussionMessageToRecipient,
} = require("../src/bot");

test("incoming RTL direction marks do not break invitation commands", () => {
  assert.equal(
    normalizeIncomingText("\u200F\u2068/accept_inv_DAG6LZC\u2069"),
    "/accept_inv_DAG6LZC",
  );
});

test("start referral parser accepts opaque referral payloads only", () => {
  assert.equal(getStartReferralCode("/start ref_A1B2C3D4E5F6"), "A1B2C3D4E5F6");
  assert.equal(getStartReferralCode("/start?ref_a1b2c3d4e5f6"), "A1B2C3D4E5F6");
  assert.equal(getStartReferralCode("/start ref_42"), "");
  assert.equal(getStartReferralCode("/start join_A1B2C3"), "");
});

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

test("repeated same start invite payload still opens invite preview", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalFindOneDiscussion = Discussion.findOne;
  const replies = [];

  User.findOneAndUpdate = async () => ({});
  Discussion.findOne = async () => ({
    _id: "discussion-id",
    title: "Movie Chat",
    description: "Films",
    publicDiscussionCode: "d_AB12",
    memberUserIds: [],
    maxMembers: 20,
    status: "open",
    joinRule: { type: "open" },
  });

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
    Discussion.findOne = originalFindOneDiscussion;
  }

  assert.equal(replies.length, 1);
  assert.match(replies.at(-1).text, /Invite preview/);
  assert.match(replies.at(-1).text, /Movie Chat/);
});

test("a newly created invite recipient always starts onboarding before the preview", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  User.findOneAndUpdate = async () => ({});
  const ctx = {
    text: "/start join_AB12",
    userId: 1,
    wasUserCreated: true,
    user: {
      userId: 1,
      lang: "fa",
      state: "idle",
      onboardingVersion: 0,
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

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.fa.chooseLanguage);
  assert.equal(ctx.user.state, "onboarding_invite_language:d_AB12");
  assert.equal(ctx.user.navigationMode, "onboarding_language");
});

test("an older account with unfinished onboarding still starts onboarding from a shared link", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  User.findOneAndUpdate = async () => ({});
  const ctx = {
    text: "/start join_AB12",
    userId: 2,
    wasUserCreated: false,
    user: {
      userId: 2,
      lang: "en",
      state: "idle",
      onboardingVersion: 0,
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
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

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.en.chooseLanguage);
  assert.equal(ctx.user.state, "onboarding_invite_language:d_AB12");
});

test("an unavailable shared link does not reset an onboarded user's flow state", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalFindOneDiscussion = Discussion.findOne;
  const updates = [];
  const replies = [];
  User.findOneAndUpdate = async (...args) => {
    updates.push(args);
    return {};
  };
  Discussion.findOne = async () => null;
  const ctx = {
    text: "/start join_GONE",
    userId: 2,
    wasUserCreated: false,
    user: {
      userId: 2,
      lang: "fa",
      state: "editing_bio",
      navigationMode: "profile",
      onboardingVersion: 1,
      profileName: "Sara",
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
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
    Discussion.findOne = originalFindOneDiscussion;
  }

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.fa.discussionInviteUnavailable);
  assert.equal(replies[0].extra.reply_markup.keyboard, undefined);
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, undefined);
  assert.equal(
    replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.discussionUnavailableClose,
  );
  assert.equal(ctx.user.state, "editing_bio");
  assert.equal(ctx.user.navigationMode, "profile");
  assert.equal(updates.some(([, update]) => update?.state === "idle"), false);
});

test("a new user with an unavailable shared link still starts onboarding", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalFindOneDiscussion = Discussion.findOne;
  const replies = [];
  User.findOneAndUpdate = async () => ({});
  Discussion.findOne = async () => null;
  const ctx = {
    text: "/start join_GONE",
    userId: 3,
    wasUserCreated: true,
    user: {
      userId: 3,
      lang: "fa",
      state: "idle",
      onboardingVersion: 0,
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
    Discussion.findOne = originalFindOneDiscussion;
  }

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.fa.chooseLanguage);
  assert.equal(ctx.user.state, "onboarding_invite_language:d_GONE");
  assert.equal(ctx.user.navigationMode, "onboarding_language");
});

test("general referral payload remains a start entry without a discussion code", () => {
  const text = "/start ref_A1B2C3D4E5F6";
  assert.equal(Boolean(getStartReferralCode(text)), true);
  assert.equal(getStartInviteCode(text), "");
});

test("a new shared-profile recipient persists the destination and starts normal onboarding", async () => {
  const originalReferralFindOne = StarReferralLink.findOne;
  const originalClaimCreate = StarReferralClaim.create;
  const originalUserFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];
  StarReferralLink.findOne = async () => ({
    _id: "profile-link-id",
    publicCode: "A1B2C3D4E5F6",
    inviterUserId: 99,
    profilePublicCode: "u_SHARED",
    source: "profile_share",
    expiresAt: new Date(Date.now() + 60_000),
  });
  StarReferralClaim.create = async (value) => ({ _id: "claim-id", ...value });
  User.findOneAndUpdate = async () => ({});
  const ctx = {
    text: "/start ref_A1B2C3D4E5F6",
    userId: 10,
    wasUserCreated: true,
    user: { userId: 10, lang: "fa", state: "idle", onboardingVersion: 0 },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await handleUpdate(ctx);
  } finally {
    StarReferralLink.findOne = originalReferralFindOne;
    StarReferralClaim.create = originalClaimCreate;
    User.findOneAndUpdate = originalUserFindOneAndUpdate;
  }

  assert.equal(ctx.user.pendingProfileShareCode, "u_SHARED");
  assert.equal(ctx.user.state, "onboarding_language");
  assert.equal(replies[0].text, messages.fa.chooseLanguage);
});

test("navigation command parser accepts advertised commands and bot mentions", () => {
  for (const command of ["menu", "profile", "lang", "taste", "discussions", "people", "help"]) {
    assert.equal(getNavigationCommand(`/${command}`), command);
    assert.equal(getNavigationCommand(`/${command}@MuzeBot`), command);
  }
  assert.equal(getNavigationCommand("/unknown"), "");
});

test("start invite preview offers switch action when active elsewhere", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalFindOneDiscussion = Discussion.findOne;
  const replies = [];

  User.findOneAndUpdate = async () => ({});
  Discussion.findOne = async () => ({
    _id: "target-discussion-id",
    title: "Movie Chat",
    description: "Films",
    publicDiscussionCode: "d_AB12",
    memberUserIds: [],
    maxMembers: 20,
    status: "open",
    joinRule: { type: "open" },
  });

  const ctx = {
    text: "/start join_AB12",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Taha",
      profileName: "Taha",
      onboardingVersion: 1,
      activeDiscussionId: "other-discussion-id",
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
    Discussion.findOne = originalFindOneDiscussion;
  }

  assert.notEqual(replies[0].text, ".");
  const buttons = replies.at(-1).extra.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.find((button) => button.callback_data === `${callBacks.discussionInviteSwitchJoin}d_AB12`));
  assert.ok(buttons.find((button) => button.callback_data === `${callBacks.discussionInviteCancel}d_AB12`));
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.discussionInviteJoin}d_AB12`), false);
});

test("start invite preview shows lock reason before switching rooms", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalFindOneDiscussion = Discussion.findOne;
  const replies = [];

  User.findOneAndUpdate = async () => ({});
  Discussion.findOne = async () => ({
    _id: "target-discussion-id",
    title: "Movie Chat",
    description: "Films",
    publicDiscussionCode: "d_AB12",
    memberUserIds: [],
    maxMembers: 20,
    status: "open",
    joinRule: {
      type: "top_ten_item",
      section: "movies",
      itemTitle: "Heat",
      itemAliases: ["Heat"],
    },
  });

  const ctx = {
    text: "/start join_AB12",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Taha",
      profileName: "Taha",
      onboardingVersion: 1,
      activeDiscussionId: "other-discussion-id",
      aiLists: { movies: { topTen: [{ title: "Arrival" }] } },
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
    Discussion.findOne = originalFindOneDiscussion;
  }

  assert.notEqual(replies[0].text, ".");
  const finalReply = replies.at(-1);
  const buttons = finalReply.extra.reply_markup.inline_keyboard.flat();
  assert.match(finalReply.text, /Heat/);
  assert.ok(buttons.find((button) => button.callback_data === `${callBacks.discussionInviteCancel}d_AB12`));
  assert.equal(buttons.find((button) => button.callback_data === `${callBacks.discussionInviteCancel}d_AB12`).text, messages.en.discussionShareClose);
  assert.equal(buttons.some((button) => button.callback_data === `${callBacks.discussionInviteSwitchJoin}d_AB12`), false);
  assert.notEqual(finalReply.extra.reply_markup.remove_keyboard, true);
});

test("repeated start invite payload keeps retained saved-profile history", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalFindOneDiscussion = Discussion.findOne;
  const deleteAttempts = [];

  User.findOneAndUpdate = async () => ({});
  Discussion.findOne = async () => ({
    _id: "discussion-id",
    title: "Movie Chat",
    description: "Films",
    publicDiscussionCode: "d_AB12",
    memberUserIds: [],
    maxMembers: 20,
    status: "open",
    joinRule: { type: "open" },
  });

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
    Discussion.findOne = originalFindOneDiscussion;
  }

  assert.equal(deleteAttempts.includes(42), false);
});

test("discussion reply helper extracts replied message id", () => {
  assert.equal(getReplyMessageId({ reply_to_message: { message_id: 123 } }), 123);
  assert.equal(getReplyMessageId({ replyToMessage: { messageId: 456 } }), 456);
  assert.equal(getReplyMessageId({}), null);
});

test("discussion outbound formatter bolds only the sender", () => {
  const text = formatDiscussionOutboundMessage(messages, "en", {
    senderDisplayName: "Sara",
    text: "I agree",
  });

  assert.equal(text, "<b>Sara</b>: I agree");
});

test("discussion outbound formatter escapes user text for HTML parse mode", () => {
  const text = formatDiscussionOutboundMessage(messages, "en", {
    senderDisplayName: "A < B",
    text: "Use <tag> & go",
  });

  assert.equal(text, "<b>A &lt; B</b>: Use &lt;tag&gt; &amp; go");
});

test("active discussion help command removes the current profile card", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const updates = [];
  const deleteAttempts = [];
  const replies = [];

  User.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return {};
  };

  const ctx = {
    text: "/ad_help",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      state: "idle",
      profileLastMessageId: 42,
    },
    deleteMessage: async (messageId) => {
      deleteAttempts.push(messageId);
      return true;
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
  };

  try {
    await handleUpdate(ctx);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleteAttempts, [42]);
  assert.equal(ctx.user.profileLastMessageId, null);
  assert.ok(updates.some((entry) => entry.update.profileLastMessageId === null));
  assert.equal(replies[0].text, messages.en.profileActiveDiscussionHelpText);
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
    text: "Ali 👩‍🦳",
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
  assert.equal(updates.some((entry) => entry.update?.profileName === "Ali 👩‍🦳"), false);
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
    assert.match(messages[lang].discussionMessageOnlyTextOrVoice, /^👩‍🦳/);
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

test("failed discussion warning replies to the exact message and preserves room controls", async () => {
  const replies = [];
  const keyboard = { reply_markup: { keyboard: [[{ text: "Leave" }]] } };
  const ctx = {
    message: { message_id: 77 },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 78 };
    },
  };

  await replyToUnsupportedDiscussionMessage(ctx, "Not sent", keyboard);

  assert.deepEqual(replies, [{
    text: "Not sent",
    extra: {
      reply_markup: keyboard.reply_markup,
      reply_to_message_id: 77,
    },
  }]);
});

test("active discussions reject unknown global slash commands before navigation", async () => {
  const replies = [];
  const ctx = {
    text: "/unknown",
    message: { message_id: 77, text: "/unknown" },
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      state: "idle",
      activeDiscussionId: "discussion-id",
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 78 };
    },
  };

  await handleUpdate(ctx);

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.en.discussionMessageNoCommands);
  assert.deepEqual(replies[0].extra, { reply_to_message_id: 77 });
  assert.equal(ctx.user.activeDiscussionId, "discussion-id");
});

test("start command still recovers from active discussion state", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalDiscussionFindOneAndUpdate = Discussion.findOneAndUpdate;
  const originalDiscussionFindById = Discussion.findById;
  const replies = [];
  const deletes = [];
  const updates = [];
  User.findOne = async () => ({ userId: 1 });
  User.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return {};
  };
  Discussion.findOneAndUpdate = async () => null;
  Discussion.findById = () => ({
    select: () => ({
      lean: async () => null,
    }),
  });

  const ctx = {
    text: "/start",
    message: { message_id: 77, text: "/start" },
    userId: 1,
    user: {
      _id: "user-document-id",
      userId: 1,
      lang: "en",
      state: "idle",
      navigationMode: "ai_suggestion_result:books",
      firstName: "A",
      activeDiscussionId: "discussion-id",
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    deleteMessage: async (messageId) => {
      deletes.push(messageId);
      return true;
    },
  };

  try {
    await handleUpdate(ctx);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    Discussion.findOneAndUpdate = originalDiscussionFindOneAndUpdate;
    Discussion.findById = originalDiscussionFindById;
  }

  assert.equal(ctx.user.activeDiscussionId, null);
  assert.equal(ctx.user.navigationMode, "global");
  assert.equal(replies[0].text, messages.en.welcomeWithName.replace("{name}", "A"));
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
  assert.equal(replies[1].text, messages.en.mainMenu);
  assert.equal(updates.some((entry) => entry.update?.activeDiscussionId === null), true);
  assert.equal(updates.some((entry) => entry.update?.navigationMode === "global"), true);
  assert.deepEqual(deletes, []);
});

test("unknown idle text and stale bottom labels are ignored without resetting context", async () => {
  for (const command of ["/resetphoto", messages.en.profileEditName, "nonsense text"]) {
    const replies = [];
    const ctx = {
      text: command,
      message: { message_id: 77, text: command },
      userId: 1,
      user: {
        userId: 1,
        lang: "en",
        state: "idle",
        navigationMode: "people",
      },
      reply: async (text, extra) => {
        replies.push({ text, extra });
        return { message_id: replies.length };
      },
      deleteMessage: async () => {
        throw new Error("no cleanup message should be deleted");
      },
    };

    await handleUpdate(ctx);

    assert.equal(replies.length, 0);
    assert.equal(ctx.user.navigationMode, "people");
  }
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

test("discussion message sender preserves text parse mode with reply id", async () => {
  const sends = [];
  const ctx = {
    sendToUser: async (userId, text, extra = {}) => {
      sends.push({ userId, text, extra });
      return { message_id: 99 };
    },
  };
  const sent = await sendDiscussionMessageToRecipient(ctx, 2, {
    text: "<b>Sara</b>: I agree",
    extra: { parse_mode: "HTML" },
  }, {
    deliveries: { 2: 55 },
  });

  assert.deepEqual(sends, [{
    userId: 2,
    text: "<b>Sara</b>: I agree",
    extra: { parse_mode: "HTML", reply_to_message_id: 55 },
  }]);
  assert.equal(sent.message_id, 99);
});

test("discussion message sender retries without a native reply when that delivery throws", async () => {
  const sends = [];
  const ctx = {
    sendToUser: async (userId, text, extra = {}) => {
      sends.push({ userId, text, extra });
      if (extra.reply_to_message_id) throw new Error("reply target unavailable");
      return { message_id: 100 };
    },
  };

  const sent = await sendDiscussionMessageToRecipient(ctx, 2, "Sara: fallback", {
    deliveries: { 2: 55 },
  });

  assert.deepEqual(sends, [
    { userId: 2, text: "Sara: fallback", extra: { reply_to_message_id: 55 } },
    { userId: 2, text: "Sara: fallback", extra: {} },
  ]);
  assert.equal(sent.message_id, 100);
});

test("saved profile command keeps retained list history before opening profile", async () => {
  const originalFindOne = User.findOne;
  const deleteAttempts = [];
  const replies = [];

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
      savedProfileCodes: ["u_3HNU"],
      savedProfilesLastListMessageId: 42,
      discussionLastListType: "invitations",
      discussionLastListMessageId: 77,
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async (messageId) => {
      deleteAttempts.push(messageId);
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
    await handleUpdate(ctx);
  } finally {
    User.findOne = originalFindOne;
  }

  assert.equal(deleteAttempts.includes(42), false);
  const buttons = replies.at(-1).extra.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.text === messages.en.savedProfileRemove));
  assert.equal(buttons.at(-1).text, messages.en.discussionShareClose);
});

test("discussion profile command does not use saved-profile back button for saved users", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const deleteAttempts = [];
  const replies = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_3HNU",
    firstName: "Saved User",
    profileName: "Saved User",
  });
  User.findOneAndUpdate = async () => ({});

  const ctx = {
    text: "/u_3HNU",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      activeDiscussionId: "discussion-id",
      savedProfileCodes: ["u_3HNU"],
      savedProfilesLastListMessageId: null,
      discussionLastMembersMessageId: 88,
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async (messageId) => {
      deleteAttempts.push(messageId);
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
    await handleUpdate(ctx);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(deleteAttempts, []);
  assert.match(replies.at(-1).text, /User profile:/);
  const buttons = replies.at(-1).extra.reply_markup.inline_keyboard.flat();
  assert.ok(!buttons.some((button) => button.callback_data === `${callBacks.savedProfilesDiscussions}browse:u_3HNU`));
  assert.ok(!buttons.some((button) => button.callback_data === `${callBacks.profileUnsaveByCode}u_3HNU`));
  assert.ok(buttons.some((button) => button.callback_data === callBacks.profileCloseDiscussionMember));
  assert.notEqual(buttons.at(-1).callback_data, callBacks.savedProfiles);
  assert.equal(ctx.user.savedProfilesLastListMessageId, null);
});

test("inviter profile command keeps its restriction action while the invitee is in a discussion", async () => {
  const originalFindOne = User.findOne;
  const originalInvitationExists = DiscussionInvitation.exists;
  const originalMuteFindOne = DiscussionInvitationMute.findOne;
  const replies = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_3HNU",
    firstName: "Inviter",
    profileName: "Inviter",
    showActiveDiscussionOnProfile: false,
  });
  DiscussionInvitation.exists = async () => ({ _id: "invite" });
  DiscussionInvitationMute.findOne = () => ({ lean: async () => null });

  const ctx = {
    text: "/inviter_u_3HNU",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      state: "idle",
      navigationMode: "discussion_room:active-room",
      activeDiscussionId: "active-room",
      savedProfileCodes: [],
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
    await handleUpdate(ctx);
  } finally {
    User.findOne = originalFindOne;
    DiscussionInvitation.exists = originalInvitationExists;
    DiscussionInvitationMute.findOne = originalMuteFindOne;
  }

  const buttons = replies.at(-1).extra.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(
    (button) => button.callback_data === `${callBacks.discussionInvitationMute}2`,
  ));
  assert.equal(ctx.user.activeDiscussionId, "active-room");
  assert.match(ctx.user.navigationMode, /^public_profile:invitations:/);
  assert.equal(ctx.user.publicProfileReturnNavigationMode, "discussion_room:active-room");
});

test("restricted-profile command retains the restrictions list and sends a closable profile card", async () => {
  const originalFindOne = User.findOne;
  const originalMuteFindOne = DiscussionInvitationMute.findOne;
  const deleteAttempts = [];
  const replies = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_3HNU",
    firstName: "Restricted",
    profileName: "Restricted",
    showActiveDiscussionOnProfile: false,
  });
  DiscussionInvitationMute.findOne = () => ({
    lean: async () => ({ muterUserId: 1, mutedUserId: 2 }),
  });

  const ctx = {
    text: "/restricted_u_3HNU",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      state: "idle",
      navigationMode: "profile_invitation_restrictions:0:1",
      profileInvitationRestrictionsLastMessageId: 44,
      savedProfileCodes: [],
    },
    deleteMessage: async (messageId) => {
      deleteAttempts.push(messageId);
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
    await handleUpdate(ctx);
  } finally {
    User.findOne = originalFindOne;
    DiscussionInvitationMute.findOne = originalMuteFindOne;
  }

  assert.deepEqual(deleteAttempts, []);
  const buttons = replies.at(-1).extra.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(
    (button) => button.callback_data === `${callBacks.profileInvitationAllow}u_3HNU`,
  ));
  assert.equal(buttons.at(-1).callback_data, callBacks.profileCloseDiscussionMember);
  assert.equal(ctx.user.profileInvitationRestrictionsLastMessageId, 44);
});

test("discussion member profile wins over stale People list context", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const replies = [];

  User.findOne = async () => ({
    userId: 2,
    publicProfileCode: "u_3HNU",
    firstName: "Member",
    profileName: "Member",
  });
  User.findOneAndUpdate = async () => ({});

  const ctx = {
    text: "/u_3HNU",
    userId: 1,
    user: {
      userId: 1,
      lang: "en",
      firstName: "Viewer",
      profileName: "Viewer",
      activeDiscussionId: "discussion-id",
      savedProfileCodes: [],
      discussionLastMembersMessageId: 88,
      peopleLastListMessageId: 42,
      peopleLastListMode: "browse",
      showActiveDiscussionOnProfile: false,
    },
    deleteMessage: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 100 };
    },
    replyWithPhoto: async () => {
      throw new Error("default profile should render as text");
    },
  };

  try {
    await handleUpdate(ctx);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const buttons = replies.at(-1).extra.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.callback_data === `${callBacks.profileSaveByCode}u_3HNU:members`));
  assert.ok(!buttons.some((button) => button.callback_data === `${callBacks.profileSaveByCode}u_3HNU`));
});

test("invitation commands preserve the earlier inbox card and its controls", async () => {
  const originalInvitationFindOne = DiscussionInvitation.findOne;
  const originalUserFindOneAndUpdate = User.findOneAndUpdate;
  DiscussionInvitation.findOne = async () => null;
  User.findOneAndUpdate = async () => ({});

  try {
    for (const text of ["/accept_inv_MISSING", "/remove_inv_MISSING"]) {
      const telegramOperations = [];
      const replies = [];
      const ctx = {
        text,
        userId: 1,
        user: {
          userId: 1,
          lang: "en",
          state: "idle",
          discussionLastListMessageId: 42,
          discussionLastListType: "invitations",
        },
        deleteMessage: async (messageId) => {
          telegramOperations.push(["delete", messageId]);
          return true;
        },
        editMessageReplyMarkup: async (messageId) => {
          telegramOperations.push(["edit", messageId]);
          return true;
        },
        reply: async (replyText, extra) => {
          replies.push({ text: replyText, extra });
          return { message_id: 100 };
        },
      };

      await handleUpdate(ctx);

      assert.deepEqual(telegramOperations, []);
      assert.equal(ctx.user.discussionLastListMessageId, null);
      assert.equal(ctx.user.discussionLastListType, "");
      assert.equal(replies.length, 1);
    }
  } finally {
    DiscussionInvitation.findOne = originalInvitationFindOne;
    User.findOneAndUpdate = originalUserFindOneAndUpdate;
  }
});

test("saved profile discussions command keeps retained saved-profile list", async () => {
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

  assert.deepEqual(deleteAttempts, []);
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
  const otherCreatedDiscussion = {
    _id: "disc_other",
    title: "Other room",
    publicDiscussionCode: "d_OTHER",
    creatorUserId: 2,
    memberUserIds: [],
    maxMembers: 20,
    status: "open",
    joinRule: { type: "open" },
  };

  Discussion.findOne = () => ({ lean: async () => activeDiscussion });
  Discussion.find = (query) => {
    assert.equal(query._id, undefined);
    return { limit: () => ({ lean: async () => [activeDiscussion, otherCreatedDiscussion] }) };
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

  assert.match(replies[0].text, /Current active discussion \(1\)/);
  assert.match(replies[0].text, /Discussions created by this user \(2\)/);
  assert.match(replies[0].text, /Current discussion — Active room/);
  assert.match(replies[0].text, /Other room/);
  assert.equal(replies[0].text.match(/Active room/g)?.length, 2);
  const callbacks = replies[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.equal(callbacks.filter((callback) => callback === `${callBacks.discussionOpen}disc_active`).length, 1);
  assert.equal(callbacks.filter((callback) => callback === `${callBacks.discussionOpen}disc_other`).length, 1);
  assert.ok(callbacks.includes(`${callBacks.profileDiscussionsBack}u_3HNU`));
  assert.equal(callbacks.at(-1), callBacks.profileDiscussionsClose);
  assert.equal(replies[0].extra.reply_markup.keyboard, undefined);
});

test("saved profile invite command leaves retained list surfaces untouched", async () => {
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

  assert.equal(deleteAttempts.includes(42), false);
  assert.equal(deleteAttempts.includes(44), false);
});
