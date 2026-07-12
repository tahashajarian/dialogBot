const test = require("node:test");
const assert = require("node:assert/strict");

const { USER_LIMITS, getUserLimits } = require("../src/constants/limits");
const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const { buildReceivedInvitationsText } = require("../src/services/discussion-invitations-ui");
const {
  handleDiscussionInvitationCallback,
  notifyInviteeOfInvitation,
} = require("../src/flows/discussion-invitations");
const {
  normalizePublicInvitationCode,
  createDiscussionInvitation,
  getInvitationDisplayState,
  countPendingReceivedInvitations,
  dedupeInvitationsByInviterAndDiscussion,
} = require("../src/services/discussion-invitations");
const DiscussionInvitation = require("../src/models/discussion-invitation");
const DiscussionInvitationMute = require("../src/models/discussion-invitation-mute");
const Discussion = require("../src/models/discussion");
const User = require("../src/models/user");

test("centralized free-tier invitation limit is 3 per 24h", () => {
  assert.equal(USER_LIMITS.free.discussionInvitationsPer24h, 3);
  assert.equal(getUserLimits({}).discussionInvitationsPer24h, 3);
});

test("normalizes invitation codes", () => {
  assert.equal(normalizePublicInvitationCode("abc123"), "i_ABC123");
  assert.equal(normalizePublicInvitationCode("i_abc-123"), "i_ABC123");
  assert.equal(normalizePublicInvitationCode("/i_ab12"), "i_AB12");
});

test("discussion invitation schema accepts pending invitation", () => {
  const invitation = new DiscussionInvitation({
    publicInvitationCode: "i_TEST123",
    discussionId: new Discussion()._id,
    discussionPublicCode: "d_ROOM1",
    inviterUserId: 1,
    inviteeUserId: 2,
    inviteePublicProfileCode: "u_ABCD",
  });

  assert.equal(invitation.validateSync(), undefined);
  assert.equal(invitation.status, "pending");
  assert.equal(invitation.source, "room");
});

test("discussion invitation schema indexes inbox and rate-limit queries", () => {
  const indexes = DiscussionInvitation.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => (
    options?.name === "received_invitation_seen_state" &&
    fields.inviteeUserId === 1 &&
    fields.status === 1 &&
    fields.seenAt === 1 &&
    fields.createdAt === -1
  )));
  assert.ok(indexes.some(([fields, options]) => (
    options?.name === "inviter_invitation_rate_limit" &&
    fields.inviterUserId === 1 &&
    fields.createdAt === -1
  )));
});

test("pending invitation count includes seen pending invitations", async () => {
  const originalAggregate = DiscussionInvitation.aggregate;
  let pipeline = null;

  DiscussionInvitation.aggregate = async (nextPipeline) => {
    pipeline = nextPipeline;
    return [{ count: 2 }];
  };

  try {
    assert.equal(await countPendingReceivedInvitations(7), 2);
  } finally {
    DiscussionInvitation.aggregate = originalAggregate;
  }

  assert.deepEqual(pipeline[0], {
    $match: {
      inviteeUserId: 7,
      status: "pending",
    },
  });
  assert.deepEqual(pipeline[1], {
    $group: {
      _id: {
        inviterUserId: "$inviterUserId",
        discussionId: "$discussionId",
      },
    },
  });
});

test("dedupes invitation rows by inviter and discussion", () => {
  const discussionId = new Discussion()._id;
  const otherDiscussionId = new Discussion()._id;

  const deduped = dedupeInvitationsByInviterAndDiscussion([
    { publicInvitationCode: "i_NEW", inviterUserId: 1, discussionId },
    { publicInvitationCode: "i_OLD", inviterUserId: 1, discussionId },
    { publicInvitationCode: "i_OTHER_INVITER", inviterUserId: 2, discussionId },
    { publicInvitationCode: "i_OTHER_DISCUSSION", inviterUserId: 1, discussionId: otherDiscussionId },
  ]);

  assert.deepEqual(deduped.map((entry) => entry.publicInvitationCode), [
    "i_NEW",
    "i_OTHER_INVITER",
    "i_OTHER_DISCUSSION",
  ]);
});

test("dedupe leaves malformed invitation rows visible", () => {
  const deduped = dedupeInvitationsByInviterAndDiscussion([
    { publicInvitationCode: "i_MISSING_DISCUSSION", inviterUserId: 1 },
    { publicInvitationCode: "i_MISSING_INVITER", discussionId: new Discussion()._id },
  ]);

  assert.deepEqual(deduped.map((entry) => entry.publicInvitationCode), [
    "i_MISSING_DISCUSSION",
    "i_MISSING_INVITER",
  ]);
});

test("createDiscussionInvitation blocks pending duplicates before daily limit", async () => {
  const originalUserFindOne = User.findOne;
  const originalDiscussionFindById = Discussion.findById;
  const originalInvitationFindOne = DiscussionInvitation.findOne;
  const originalMuteFindOne = DiscussionInvitationMute.findOne;
  const originalCountDocuments = DiscussionInvitation.countDocuments;

  const discussionId = new Discussion()._id;
  User.findOne = async (filter) => {
    if (filter.userId === 1) {
      return { userId: 1, savedProfileCodes: ["u_BBBB"] };
    }
    if (filter.publicProfileCode === "u_BBBB") {
      return { userId: 2, publicProfileCode: "u_BBBB" };
    }
    return null;
  };
  Discussion.findById = async () => ({
    _id: discussionId,
    status: "open",
    memberUserIds: [1],
    removedUserIds: [],
  });
  DiscussionInvitation.findOne = async () => ({
    publicInvitationCode: "i_EXISTS",
  });
  DiscussionInvitationMute.findOne = () => ({
    lean: async () => null,
  });
  DiscussionInvitation.countDocuments = async () => {
    throw new Error("daily limit should not be checked for duplicate pending invites");
  };

  try {
    const result = await createDiscussionInvitation({
      inviterUserId: 1,
      inviteePublicProfileCode: "u_BBBB",
      discussionId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "duplicate");
  } finally {
    User.findOne = originalUserFindOne;
    Discussion.findById = originalDiscussionFindById;
    DiscussionInvitation.findOne = originalInvitationFindOne;
    DiscussionInvitationMute.findOne = originalMuteFindOne;
    DiscussionInvitation.countDocuments = originalCountDocuments;
  }
});

test("getInvitationDisplayState treats muted creator rooms as unavailable through join service mapping", async () => {
  const state = await getInvitationDisplayState({ userId: 2 }, null);
  assert.equal(state.state, "unavailable");
});

test("received invitations localize bot-created discussion title and description", async () => {
  const text = await buildReceivedInvitationsText(messages, "fa", { userId: 2, discussionMembershipIds: [1] }, [{
    invitation: {
      publicInvitationCode: "i_TEST123",
      seenAt: null,
    },
    discussion: {
      title: "Free Discussion",
      description: "A simple place to start chatting.",
      isBotCreated: true,
      botSeedKey: "free-discussion",
      memberUserIds: [1],
      maxMembers: 20,
      joinRule: { type: "open" },
    },
    inviter: {
      profileName: "Sara",
      publicProfileCode: "u_SARA1",
    },
    state: { state: "joinable" },
  }]);

  assert.match(text, /👩‍🦳 گفت‌وگوی آزاد/);
  assert.match(text, /یه جای ساده برای شروع گپ با بقیه/);
  assert.doesNotMatch(text, /Free Discussion/);
  assert.doesNotMatch(text, /A simple place to start chatting/);
});

test("bot onboarding invitations do not show an inviter profile link", async () => {
  const text = await buildReceivedInvitationsText(messages, "en", { userId: 2, discussionMembershipIds: [] }, [{
    invitation: {
      publicInvitationCode: "i_BOT123",
      source: "bot_onboarding",
      seenAt: null,
    },
    discussion: {
      title: "Free Discussion",
      description: "A simple place to start chatting.",
      isBotCreated: true,
      botSeedKey: "free-discussion",
      memberUserIds: [1],
      maxMembers: 20,
      joinRule: { type: "open" },
    },
    inviter: null,
    state: { state: "joinable" },
  }]);

  assert.match(text, /From: Muze/);
  assert.match(text, /🔐 Join condition:\n🌍 Everyone ✅/);
  assert.doesNotMatch(text, /^✅ Available$/m);
  assert.match(text, /Join 👉 \/accept_inv_BOT123/);
  assert.doesNotMatch(text, /Inviter profile/);
  assert.doesNotMatch(text, /\/u_/);
});

test("locked invitations keep explicit locked state", async () => {
  const text = await buildReceivedInvitationsText(messages, "en", { userId: 2, discussionMembershipIds: [1] }, [{
    invitation: {
      publicInvitationCode: "i_LOCKED1",
      seenAt: new Date(),
    },
    discussion: {
      title: "Metalheads",
      description: "Heavy music chat.",
      memberUserIds: [1],
      maxMembers: 20,
      joinRule: { type: "taste_label", section: "music", labelKey: "metalhead" },
    },
    inviter: {
      profileName: "Sara",
      publicProfileCode: "u_SARA1",
    },
    state: { state: "locked" },
  }]);

  assert.match(text, /🔐 Join condition:\n🏷/);
  assert.match(text, /^🔒 Join condition not completed yet$/m);
});

test("received invitations can show accepted invites as recent shortcuts", async () => {
  const text = await buildReceivedInvitationsText(messages, "en", { userId: 2, discussionMembershipIds: [] }, [], [{
    invitation: {
      publicInvitationCode: "i_DONE123",
      status: "accepted",
      seenAt: new Date(),
    },
    discussion: {
      title: "Movie Chat",
      description: "Chat about films.",
      memberUserIds: [1, 2],
      maxMembers: 20,
      joinRule: { type: "open" },
    },
    inviter: {
      profileName: "Sara",
      publicProfileCode: "u_SARA1",
    },
    state: { state: "joinable" },
  }]);

  assert.match(text, /No invitations right now/);
  assert.match(text, /Recently joined from invitations:/);
  assert.match(text, /✅ Movie Chat/);
  assert.match(text, /Join 👉 \/accept_inv_DONE123/);
  assert.match(text, /Remove invitation 👉 \/remove_inv_DONE123/);
  assert.doesNotMatch(text, /Inviter profile/);
});

test("empty invitations text includes a useful next-step tip", async () => {
  const text = await buildReceivedInvitationsText(messages, "en", { userId: 2 }, []);

  assert.match(text, /No invitations right now/);
  assert.match(text, /recent shortcuts/);
});

test("new invitation notification points invitee to invitations inbox", async () => {
  const sent = [];
  const notified = await notifyInviteeOfInvitation({
    sendToUser: async (userId, text, extra) => {
      sent.push({ userId, text, extra });
      return true;
    },
  }, {
    invitee: { userId: 2, lang: "en" },
  });

  assert.equal(notified, true);
  assert.equal(sent[0].userId, 2);
  assert.equal(sent[0].text, messages.en.discussionInvitationReceivedNotice);
  assert.equal(
    sent[0].extra.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.discussionInvitations,
  );
});

test("new invitation notification fails open", async () => {
  const notified = await notifyInviteeOfInvitation({
    sendToUser: async () => {
      throw new Error("delivery failed");
    },
  }, {
    invitee: { userId: 2, lang: "en" },
  });

  assert.equal(notified, false);
});

test("mute inviter callback removes profile card before acknowledgement", async () => {
  const originalFindOneAndUpdate = DiscussionInvitationMute.findOneAndUpdate;
  const originalUpdateMany = DiscussionInvitation.updateMany;
  const deletedIds = [];
  const replies = [];

  DiscussionInvitationMute.findOneAndUpdate = () => ({
    lean: async () => ({ muterUserId: 2, mutedUserId: 1 }),
  });
  DiscussionInvitation.updateMany = async () => ({ modifiedCount: 1 });

  try {
    const handled = await handleDiscussionInvitationCallback({
      callbackData: `${callBacks.discussionInvitationMute}1`,
      callbackMessageId: 55,
      userId: 2,
      user: { userId: 2 },
      answerCb: async () => true,
      deleteMessage: async (messageId) => {
        deletedIds.push(messageId);
        return true;
      },
      reply: async (text, keyboard) => {
        replies.push({ text, keyboard });
        return { message_id: 56 };
      },
    }, "en", {
      deleteCallbackMessageIfPossible: (ctx) => ctx.deleteMessage(ctx.callbackMessageId),
    });

    assert.ok(handled);
    assert.deepEqual(deletedIds, [55]);
    assert.equal(replies[0].text, messages.en.discussionInvitationMuted);
    assert.equal(
      replies[0].keyboard.reply_markup.inline_keyboard[0][0].callback_data,
      `${callBacks.discussionInvitationAck}invitations`,
    );
  } finally {
    DiscussionInvitationMute.findOneAndUpdate = originalFindOneAndUpdate;
    DiscussionInvitation.updateMany = originalUpdateMany;
  }
});
