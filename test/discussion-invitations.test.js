const test = require("node:test");
const assert = require("node:assert/strict");

const { USER_LIMITS, getUserLimits } = require("../src/constants/limits");
const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  buildInvitationSentText,
  buildInvitationPreviewText,
  buildReceivedInvitationsText,
  filterSavedInviteTargets,
  shouldShowDiscussionInvitationFirstTimeTip,
} = require("../src/services/discussion-invitations-ui");
const {
  acceptInvitationCommand,
  buildInvitationAcceptStatusText,
  buildSavedInviteTargets,
  handleDiscussionInvitationCallback,
  isDiscussionInvitationCallback,
  notifyInviteeOfInvitation,
} = require("../src/flows/discussion-invitations");
const {
  normalizePublicInvitationCode,
  createDiscussionInvitation,
  getInvitationDisplayState,
  countPendingReceivedInvitations,
  countUnseenPendingReceivedInvitations,
  dedupeInvitationsByInviterAndDiscussion,
} = require("../src/services/discussion-invitations");
const DiscussionInvitation = require("../src/models/discussion-invitation");
const DiscussionInvitationMute = require("../src/models/discussion-invitation-mute");
const Discussion = require("../src/models/discussion");
const User = require("../src/models/user");
const {
  discussionJoinLockedKeyboard,
  discussionLeaveCurrentNoticeKeyboard,
  discussionInvitationPreviewKeyboard,
} = require("../src/keyboards");
const {
  listInvitationRestrictions,
  unmuteInvitationRestrictionById,
  unmuteInvitationRestrictionByProfileCode,
  unmuteInviterForUser,
} = require("../src/services/discussion-invitation-mutes");

test("centralized free-tier invitation limit is 3 per 24h", () => {
  assert.equal(USER_LIMITS.free.discussionInvitationsPer24h, 3);
  assert.equal(getUserLimits({}).discussionInvitationsPer24h, 3);
});

test("normalizes invitation codes", () => {
  assert.equal(normalizePublicInvitationCode("abc123"), "i_ABC123");
  assert.equal(normalizePublicInvitationCode("i_abc-123"), "i_ABC123");
  assert.equal(normalizePublicInvitationCode("/i_ab12"), "i_AB12");
});

test("discussion invitation schema accepts pending invitation", async () => {
  const invitation = new DiscussionInvitation({
    publicInvitationCode: "i_TEST123",
    discussionId: new Discussion()._id,
    discussionPublicCode: "d_ROOM1",
    inviterUserId: 1,
    inviteeUserId: 2,
    inviteePublicProfileCode: "u_ABCD",
  });

  await invitation.validate();
  assert.equal(invitation.status, "pending");
  assert.equal(invitation.source, "room");
});

test("invitation join conflict offers an identity-bound leave-and-join action", () => {
  const keyboard = discussionLeaveCurrentNoticeKeyboard("fa", "i_INV1", {
    invitation: true,
  });
  assert.equal(keyboard.reply_markup.keyboard, undefined);
  assert.equal(
    keyboard.reply_markup.inline_keyboard[0][0].text,
    messages.fa.discussionInviteSwitchJoinButton,
  );
  assert.equal(
    keyboard.reply_markup.inline_keyboard[0][0].callback_data,
    `${callBacks.discussionInvitationSwitchJoin}INV1`,
  );
  assert.equal(
    isDiscussionInvitationCallback(`${callBacks.discussionInvitationSwitchJoin}INV1`),
    true,
  );
});

test("invitation room entry never follows Joined with a redundant Opened status", () => {
  assert.equal(
    buildInvitationAcceptStatusText("fa", { joined: true, opensRoom: true }),
    messages.fa.discussionJoined,
  );
  assert.equal(
    buildInvitationAcceptStatusText("fa", { joined: false, opensRoom: true }),
    "",
  );
  assert.equal(
    buildInvitationAcceptStatusText("en", {
      joined: false,
      opensRoom: true,
      starNotice: "Star reward",
    }),
    "Star reward",
  );
  assert.equal(
    buildInvitationAcceptStatusText("en", { joined: false, opensRoom: false }),
    messages.en.discussionOpened,
  );
});

test("invitation rule failure uses inline Got it without replacing the reply keyboard", () => {
  const keyboard = discussionJoinLockedKeyboard("fa");
  assert.equal(keyboard.reply_markup.keyboard, undefined);
  assert.equal(keyboard.reply_markup.inline_keyboard[0][0].text, messages.fa.acknowledgeButton);
  assert.equal(keyboard.reply_markup.inline_keyboard[0][0].callback_data, callBacks.discussionJoinLockedClose);
});

test("unavailable invitation uses inline delete-only Got it without replacing the reply keyboard", async () => {
  const originalFindOne = DiscussionInvitation.findOne;
  const replies = [];
  DiscussionInvitation.findOne = async () => null;
  const ctx = {
    userId: 17,
    user: {
      userId: 17,
      state: "editing_bio",
      navigationMode: "profile",
    },
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
  };

  try {
    await acceptInvitationCommand(ctx, "fa", "/accept_inv_GONE");
  } finally {
    DiscussionInvitation.findOne = originalFindOne;
  }

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, messages.fa.discussionInvitationUnavailable);
  assert.equal(replies[0].extra.reply_markup.keyboard, undefined);
  assert.equal(replies[0].extra.reply_markup.remove_keyboard, undefined);
  assert.equal(
    replies[0].extra.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.discussionUnavailableClose,
  );
  assert.equal(ctx.user.state, "editing_bio");
  assert.equal(ctx.user.navigationMode, "profile");
});

test("sent invitation confirmation is bot-authored without speculative Star copy", () => {
  const fa = buildInvitationSentText(messages, "fa", { profileName: "Lina" });
  const en = buildInvitationSentText(messages, "en", { profileName: "Lina" });
  const reentryFa = buildInvitationSentText(messages, "fa", { profileName: "Lina" }, {
    restoresOwnerRemoval: true,
  });
  const reentryEn = buildInvitationSentText(messages, "en", { profileName: "Lina" }, {
    restoresOwnerRemoval: true,
  });

  assert.equal(fa, "👩‍🦳 دعوت برای Lina ارسال شد.");
  assert.equal(en, "👩‍🦳 Invitation sent to Lina.");
  assert.match(reentryFa, /دوباره وارد این گفت‌وگو بشه/);
  assert.match(reentryEn, /join this discussion again/);
  assert.doesNotMatch(fa, /⭐|متوجه شدم/);
  assert.doesNotMatch(en, /⭐|Got it/);
});

test("saved-profile invite targets exclude current discussion members", () => {
  const targets = [
    { userId: 2, name: "Already here" },
    { userId: 3, name: "Can invite" },
    { userId: 4, name: "Also here" },
  ];

  assert.deepEqual(
    filterSavedInviteTargets(targets, [2, 4]),
    [{ userId: 3, name: "Can invite" }],
  );
});

test("saved-profile invite picker query includes user ids for membership filtering", async () => {
  const originalFind = User.find;
  let selectedFields = "";
  User.find = () => ({
    select(fields) {
      selectedFields = fields;
      return { lean: async () => [] };
    },
  });

  try {
    await buildSavedInviteTargets({
      user: {
        savedProfileCodes: ["u_TEST"],
      },
    });
  } finally {
    User.find = originalFind;
  }

  assert.match(selectedFields, /\buserId\b/);
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
  assert.ok(indexes.some(([fields, options]) => (
    options?.name === "closed_discussion_invitation_cleanup" &&
    fields.discussionId === 1
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

test("discussion menu invitation badge counts only unseen pending invitations", async () => {
  const originalAggregate = DiscussionInvitation.aggregate;
  let pipeline = null;
  DiscussionInvitation.aggregate = async (nextPipeline) => {
    pipeline = nextPipeline;
    return [{ count: 1 }];
  };

  try {
    assert.equal(await countUnseenPendingReceivedInvitations(7), 1);
  } finally {
    DiscussionInvitation.aggregate = originalAggregate;
  }

  assert.deepEqual(pipeline[0], {
    $match: {
      inviteeUserId: 7,
      status: "pending",
      seenAt: null,
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

test("only an exact owner re-entry invitation makes a removed room joinable", async () => {
  const discussion = {
    creatorUserId: 1,
    status: "open",
    memberUserIds: [1],
    removedUserIds: [2],
    joinRule: { type: "open" },
  };
  const oldInvitation = {
    inviterUserId: 1,
    inviteeUserId: 2,
    restoresOwnerRemoval: false,
  };
  const ownerReentryInvitation = {
    ...oldInvitation,
    restoresOwnerRemoval: true,
  };
  const memberInvitation = {
    ...ownerReentryInvitation,
    inviterUserId: 3,
  };

  assert.equal((await getInvitationDisplayState({ userId: 2 }, discussion, oldInvitation)).state, "blocked");
  assert.equal((await getInvitationDisplayState({ userId: 2 }, discussion, memberInvitation)).state, "blocked");
  assert.equal((await getInvitationDisplayState({ userId: 2 }, discussion, ownerReentryInvitation)).state, "joinable");
});

test("starter invitation state uses capacity 100 without relaxing user-created rooms", async () => {
  const starter = {
    status: "open",
    creatorUserId: 1,
    isBotCreated: true,
    botSeedKey: "free-discussion:en",
    maxMembers: 100,
    memberUserIds: Array.from({ length: 99 }, (_, index) => index + 10),
    removedUserIds: [],
    joinRule: { type: "open" },
  };
  assert.equal((await getInvitationDisplayState({ userId: 2 }, starter)).state, "joinable");
  starter.memberUserIds.push(999);
  assert.equal((await getInvitationDisplayState({ userId: 2 }, starter)).state, "full");

  const userCreated = {
    ...starter,
    isBotCreated: false,
    memberUserIds: Array.from({ length: 20 }, (_, index) => index + 10),
  };
  assert.equal((await getInvitationDisplayState({ userId: 2 }, userCreated)).state, "full");
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
  assert.match(text, /^از طرف: Sara — دیدن پروفایل 👈 \/inviter_u_SARA1$/m);
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

test("locked shared-link invitations stay in the inbox without an inviter profile or Join action", async () => {
  const text = await buildReceivedInvitationsText(messages, "en", { userId: 2, discussionMembershipIds: [] }, [{
    invitation: {
      publicInvitationCode: "i_SHARED1",
      source: "shared_link",
      seenAt: null,
    },
    discussion: {
      title: "Arrival fans",
      description: "A room for Arrival",
      memberUserIds: [1],
      maxMembers: 20,
      joinRule: { type: "top_ten_item", section: "movies", itemTitle: "Arrival" },
    },
    inviter: { profileName: "Sara", publicProfileCode: "u_SARA1" },
    state: { state: "locked", reason: "requires_top_ten_item" },
  }]);

  assert.match(text, /From: Shared link/);
  assert.match(text, new RegExp(messages.en.discussionInvitationStateLocked));
  assert.doesNotMatch(text, /Join 👉/);
  assert.doesNotMatch(text, /Inviter profile/);
  assert.ok(text.includes(`${messages.en.discussionInvitationRemove} 👉 /remove_inv_SHARED1`));
});

test("single invitation previews keep every action out of message links", () => {
  const entry = {
    invitation: {
      publicInvitationCode: "i_ONLY123",
      status: "pending",
      source: "saved_profile",
    },
    discussion: {
      title: "Movie night",
      description: "A room for films",
      memberUserIds: [1],
      maxMembers: 20,
      joinRule: { type: "open" },
    },
    inviter: {
      profileName: "Sara",
      publicProfileCode: "u_SARA1",
    },
    state: { state: "joinable" },
  };
  const text = buildInvitationPreviewText(messages, "en", entry);
  const buttons = discussionInvitationPreviewKeyboard("en", entry)
    .reply_markup.inline_keyboard.flat();

  assert.match(text, /Discussion invitation/);
  assert.match(text, /Movie night/);
  assert.doesNotMatch(text, /\/accept_inv_|\/inviter_|\/remove_inv_/);
  assert.deepEqual(buttons.map((button) => button.callback_data), [
    `${callBacks.discussionInvitationPreviewAccept}ONLY123`,
    `${callBacks.discussionInvitationPreviewProfile}ONLY123:u_SARA1`,
    `${callBacks.discussionInvitationPreviewRemove}ONLY123`,
    callBacks.discussionInvitationNoticeClose,
  ]);
});

test("invitation guidance shares the durable Discussions tip state", () => {
  const entry = { invitation: { publicInvitationCode: "i_TIP123" } };
  assert.equal(shouldShowDiscussionInvitationFirstTimeTip({ discussionMembershipIds: [] }, [entry]), true);
  assert.equal(shouldShowDiscussionInvitationFirstTimeTip({
    discussionMembershipIds: [],
    sectionTipsShownAt: { discussions: new Date() },
  }, [entry]), false);
  assert.equal(shouldShowDiscussionInvitationFirstTimeTip({ discussionMembershipIds: [1] }, [entry]), false);
});

test("createDiscussionInvitation rejects an empty discussion id before database lookup", async () => {
  const originalFindById = Discussion.findById;
  let queried = false;
  Discussion.findById = () => {
    queried = true;
    throw new Error("should not query");
  };

  try {
    const result = await createDiscussionInvitation({
      inviterUserId: 1,
      inviteePublicProfileCode: "u_TEST",
      discussionId: "",
    });

    assert.deepEqual(result, { ok: false, reason: "missing_discussion" });
    assert.equal(queried, false);
  } finally {
    Discussion.findById = originalFindById;
  }
});

test("stale saved-profile target retires after leaving without sending an invite", async () => {
  const deleted = [];
  const handled = await handleDiscussionInvitationCallback({
    callbackData: `${callBacks.discussionInviteSavedTarget}u_TEST`,
    callbackMessageId: 91,
    userId: 1,
    user: { userId: 1, activeDiscussionId: null },
    answerCb: async () => true,
  }, "en", {
    deleteCallbackMessageIfPossible: async (ctx) => {
      deleted.push(ctx.callbackMessageId);
      return true;
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(deleted, [91]);
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

test("received invitations keep accepted invites in the unified newest-first list", async () => {
  const text = await buildReceivedInvitationsText(messages, "en", { userId: 2, discussionMembershipIds: [] }, [{
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
  }], { startIndex: 5 });

  assert.doesNotMatch(text, /No invitations right now/);
  assert.doesNotMatch(text, /Recently joined/);
  assert.match(text, /✉️ Invitations \(1\)/);
  assert.match(text, /Newest invitations appear first/);
  assert.match(text, /6\. ✅ Movie Chat/);
  assert.match(text, /^From: Sara — View profile 👉 \/inviter_u_SARA1$/m);
  assert.match(text, /Join 👉 \/accept_inv_DONE123/);
  assert.match(text, /Remove from list 👉 \/remove_inv_DONE123/);
});

test("empty invitations text includes a useful next-step tip", async () => {
  const text = await buildReceivedInvitationsText(messages, "en", { userId: 2 }, []);

  assert.match(text, /No invitations right now/);
  assert.match(text, /✉️ Invitations \(0\)/);
  assert.match(text, /newest first/);
});

test("new invitation notification opens only its identity-bound preview", async () => {
  const sent = [];
  const notified = await notifyInviteeOfInvitation({
    sendToUser: async (userId, text, extra) => {
      sent.push({ userId, text, extra });
      return true;
    },
  }, {
    invitee: { userId: 2, lang: "en" },
    invitation: { publicInvitationCode: "i_ONLY123" },
  });

  assert.equal(notified, true);
  assert.equal(sent[0].userId, 2);
  assert.equal(sent[0].text, messages.en.discussionInvitationReceivedNotice);
  assert.equal(
    sent[0].extra.reply_markup.inline_keyboard[0][0].callback_data,
    `${callBacks.discussionInvitationPreview}ONLY123`,
  );
  assert.equal(
    sent[0].extra.reply_markup.inline_keyboard[0][1].callback_data,
    callBacks.discussionInvitationNoticeClose,
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

test("invitation notification Close deletes only that notification", async () => {
  const deletedIds = [];
  const handled = await handleDiscussionInvitationCallback({
    callbackData: callBacks.discussionInvitationNoticeClose,
    callbackMessageId: 54,
    answerCb: async () => true,
  }, "en", {
    deleteCallbackMessageIfPossible: async (ctx) => {
      deletedIds.push(ctx.callbackMessageId);
      return true;
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(deletedIds, [54]);
});

test("opening a notification inside a discussion edits it into one inline-only invitation", async () => {
  const originalInvitationFindOne = DiscussionInvitation.findOne;
  const originalInvitationUpdateMany = DiscussionInvitation.updateMany;
  const originalDiscussionFindById = Discussion.findById;
  const originalUserFindOne = User.findOne;
  const edits = [];
  const answers = [];
  const invitation = {
    _id: "invite-1",
    publicInvitationCode: "i_ONLY123",
    inviteeUserId: 2,
    inviterUserId: 1,
    status: "pending",
    source: "saved_profile",
    discussionId: "room-2",
    save: async () => true,
  };
  DiscussionInvitation.findOne = async () => invitation;
  DiscussionInvitation.updateMany = async () => ({ modifiedCount: 1 });
  Discussion.findById = async () => ({
    _id: "room-2",
    title: "Movie night",
    description: "A room for films",
    status: "open",
    creatorUserId: 1,
    memberUserIds: [1],
    removedUserIds: [],
    maxMembers: 20,
    joinRule: { type: "open" },
  });
  User.findOne = () => ({
    select: () => ({
      lean: async () => ({
        userId: 1,
        profileName: "Sara",
        publicProfileCode: "u_SARA1",
      }),
    }),
  });

  const ctx = {
    callbackData: `${callBacks.discussionInvitationPreview}ONLY123`,
    callbackMessageId: 44,
    userId: 2,
    user: {
      userId: 2,
      activeDiscussionId: "room-1",
      navigationMode: "discussion_room:room-1",
    },
    answerCb: async (text) => {
      answers.push(text);
      return true;
    },
    reply: async () => assert.fail("the notification should edit in place"),
  };

  try {
    await handleDiscussionInvitationCallback(ctx, "en", {
      editCallbackMessageOrReply: async (_ctx, text, keyboard) => {
        edits.push({ text, keyboard });
        return { message_id: 44 };
      },
    });
  } finally {
    DiscussionInvitation.findOne = originalInvitationFindOne;
    DiscussionInvitation.updateMany = originalInvitationUpdateMany;
    Discussion.findById = originalDiscussionFindById;
    User.findOne = originalUserFindOne;
  }

  assert.deepEqual(answers, [undefined]);
  assert.equal(edits.length, 1);
  assert.doesNotMatch(edits[0].text, /\/accept_inv_|\/inviter_|\/remove_inv_/);
  assert.equal(ctx.user.navigationMode, "discussion_room:room-1");
  assert.equal(ctx.user.activeDiscussionId, "room-1");
  assert.deepEqual(
    edits[0].keyboard.reply_markup.inline_keyboard.flat().map((button) => button.callback_data),
    [
      `${callBacks.discussionInvitationPreviewAccept}ONLY123`,
      `${callBacks.discussionInvitationPreviewProfile}ONLY123:u_SARA1`,
      `${callBacks.discussionInvitationPreviewRemove}ONLY123`,
      callBacks.discussionInvitationNoticeClose,
    ],
  );
});

test("restrict inviter is one tap and refreshes the inviter profile in place", async () => {
  const originalExists = DiscussionInvitation.exists;
  const originalFindOneAndUpdate = DiscussionInvitationMute.findOneAndUpdate;
  const originalUpdateMany = DiscussionInvitation.updateMany;
  const originalUserFindOne = User.findOne;
  const deletedIds = [];
  const answers = [];
  const refreshed = [];

  DiscussionInvitation.exists = async () => ({ _id: "invite" });
  DiscussionInvitationMute.findOneAndUpdate = async () => ({ muterUserId: 2, mutedUserId: 1 });
  DiscussionInvitation.updateMany = async () => ({ modifiedCount: 1 });
  User.findOne = () => ({
    select: () => ({ lean: async () => ({ userId: 1 }) }),
  });

  try {
    const ctx = {
      callbackData: `${callBacks.discussionInvitationMute}1`,
      callbackMessageId: 55,
      userId: 2,
      user: {
        userId: 2,
        navigationMode: "public_profile:invitations:u_INVITER:0:unsaved:0",
      },
      answerCb: async (text) => {
        answers.push(text);
        return true;
      },
      deleteMessage: async (messageId) => {
        deletedIds.push(messageId);
        return true;
      },
    };
    const dependencies = {
      deleteCallbackMessageIfPossible: (ctx) => ctx.deleteMessage(ctx.callbackMessageId),
      sendPublicProfileByCode: async (_ctx, lang, code, options) => {
        refreshed.push({ lang, code, options });
        return { message_id: 55 };
      },
    };

    const restricted = await handleDiscussionInvitationCallback(ctx, "en", dependencies);
    assert.ok(restricted);
    assert.deepEqual(deletedIds, []);
    assert.deepEqual(answers, [messages.en.discussionInvitationMuted]);
    assert.deepEqual(refreshed, [{
      lang: "en",
      code: "u_INVITER",
      options: { fromInvitationList: true, editCurrent: true },
    }]);
  } finally {
    DiscussionInvitation.exists = originalExists;
    DiscussionInvitationMute.findOneAndUpdate = originalFindOneAndUpdate;
    DiscussionInvitation.updateMany = originalUpdateMany;
    User.findOne = originalUserFindOne;
  }
});

test("restricting from a notification profile refreshes that temporary card in place", async () => {
  const originalExists = DiscussionInvitation.exists;
  const originalFindOneAndUpdate = DiscussionInvitationMute.findOneAndUpdate;
  const originalUpdateMany = DiscussionInvitation.updateMany;
  const originalUserFindOne = User.findOne;
  const refreshed = [];

  DiscussionInvitation.exists = async () => ({ _id: "invite" });
  DiscussionInvitationMute.findOneAndUpdate = async () => ({ muterUserId: 2, mutedUserId: 1 });
  DiscussionInvitation.updateMany = async () => ({ modifiedCount: 1 });
  User.findOne = () => ({
    select: () => ({ lean: async () => ({ userId: 1 }) }),
  });

  try {
    const handled = await handleDiscussionInvitationCallback({
      callbackData: `${callBacks.discussionInvitationMute}1`,
      callbackMessageId: 55,
      userId: 2,
      user: {
        userId: 2,
        navigationMode: "public_profile:invitation_preview:u_INVITER:0:unsaved:0",
      },
      answerCb: async () => true,
    }, "en", {
      sendPublicProfileByCode: async (_ctx, lang, code, options) => {
        refreshed.push({ lang, code, options });
        return { message_id: 55 };
      },
    });

    assert.ok(handled);
    assert.deepEqual(refreshed, [{
      lang: "en",
      code: "u_INVITER",
      options: {
        fromInvitationPreview: true,
        editCurrent: true,
      },
    }]);
  } finally {
    DiscussionInvitation.exists = originalExists;
    DiscussionInvitationMute.findOneAndUpdate = originalFindOneAndUpdate;
    DiscussionInvitation.updateMany = originalUpdateMany;
    User.findOne = originalUserFindOne;
  }
});

test("restrict inviter rejects a callback that does not match the displayed profile", async () => {
  const originalFindOne = User.findOne;
  const answers = [];
  User.findOne = () => ({
    select: () => ({ lean: async () => ({ userId: 99 }) }),
  });

  try {
    const handled = await handleDiscussionInvitationCallback({
      callbackData: `${callBacks.discussionInvitationMute}1`,
      userId: 2,
      user: {
        navigationMode: "public_profile:invitations:u_OTHER:0:unsaved:0",
      },
      answerCb: async (text) => {
        answers.push(text);
        return true;
      },
    }, "en");

    assert.equal(handled, false);
    assert.deepEqual(answers, [messages.en.discussionInvitationUnavailable]);
  } finally {
    User.findOne = originalFindOne;
  }
});

test("invitation restrictions hydrate available profiles and keep dangling rows reversible", async () => {
  const originalMuteFind = DiscussionInvitationMute.find;
  const originalUserFind = User.find;
  let muteQuery;
  let userQuery;

  DiscussionInvitationMute.find = (query) => {
    muteQuery = query;
    return {
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => [
              { mutedUserId: 10, createdAt: new Date("2026-01-02") },
              { mutedUserId: 11, createdAt: new Date("2026-01-01") },
            ],
          }),
        }),
      }),
    };
  };
  User.find = (query) => {
    userQuery = query;
    return {
      select: () => ({ lean: async () => [{ userId: 10, profileName: "Available" }] }),
    };
  };

  try {
    const result = await listInvitationRestrictions(2, { limit: 5, skip: 0 });
    assert.equal(result.ok, true);
    assert.deepEqual(muteQuery, { muterUserId: 2 });
    assert.deepEqual(userQuery, { userId: { $in: [10, 11] } });
    assert.equal(result.restrictions[0].user.profileName, "Available");
    assert.equal(result.restrictions[1].user, null);
  } finally {
    DiscussionInvitationMute.find = originalMuteFind;
    User.find = originalUserFind;
  }
});

test("allow invitations again deletes only the exact directional restriction", async () => {
  const originalDeleteOne = DiscussionInvitationMute.deleteOne;
  let query;
  DiscussionInvitationMute.deleteOne = async (value) => {
    query = value;
    return { deletedCount: 1 };
  };

  try {
    const result = await unmuteInviterForUser({ muterUserId: 2, mutedUserId: 1 });
    assert.deepEqual(query, { muterUserId: 2, mutedUserId: 1 });
    assert.deepEqual(result, { ok: true, removed: true });
  } finally {
    DiscussionInvitationMute.deleteOne = originalDeleteOne;
  }
});

test("command-style allow action binds the restriction id to the current user", async () => {
  const originalDeleteOne = DiscussionInvitationMute.deleteOne;
  let query;
  DiscussionInvitationMute.deleteOne = async (value) => {
    query = value;
    return { deletedCount: 1 };
  };

  try {
    const result = await unmuteInvitationRestrictionById({
      muterUserId: 2,
      restrictionId: "64f000000000000000000001",
    });
    assert.deepEqual(query, {
      _id: "64f000000000000000000001",
      muterUserId: 2,
    });
    assert.deepEqual(result, { ok: true, removed: true });
  } finally {
    DiscussionInvitationMute.deleteOne = originalDeleteOne;
  }
});

test("short allow command resolves a public profile code before deleting the directional pair", async () => {
  const originalFindOne = User.findOne;
  const originalDeleteOne = DiscussionInvitationMute.deleteOne;
  let profileQuery;
  let deleteQuery;
  User.findOne = (value) => {
    profileQuery = value;
    return { select: () => ({ lean: async () => ({ userId: 9 }) }) };
  };
  DiscussionInvitationMute.deleteOne = async (value) => {
    deleteQuery = value;
    return { deletedCount: 1 };
  };

  try {
    const result = await unmuteInvitationRestrictionByProfileCode({
      muterUserId: 2,
      publicProfileCode: "u_ab12",
    });
    assert.deepEqual(profileQuery, { publicProfileCode: "u_AB12" });
    assert.deepEqual(deleteQuery, { muterUserId: 2, mutedUserId: 9 });
    assert.equal(result.removed, true);
  } finally {
    User.findOne = originalFindOne;
    DiscussionInvitationMute.deleteOne = originalDeleteOne;
  }
});
