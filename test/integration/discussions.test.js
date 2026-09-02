const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../../src/models/user");
const Discussion = require("../../src/models/discussion");
const DiscussionInvitation = require("../../src/models/discussion-invitation");
const DiscussionInvitationMute = require("../../src/models/discussion-invitation-mute");
const DiscussionOwnerJoinNotice = require("../../src/models/discussion-owner-join-notice");
const {
  DISCUSSION_MESSAGE_LIMIT,
  DISCUSSION_MESSAGE_WINDOW_MS,
  addRecentMessage,
  addSavedProfileCode,
  closeDiscussionAsOwner,
  createDiscussion,
  joinOrOpenDiscussion,
  leaveDiscussionAsMember,
  listMyDiscussions,
  listRecentJoinedDiscussions,
  removeMemberAsOwner,
  removeSavedProfileCode,
  reportDiscussionMember,
} = require("../../src/services/discussions");
const {
  countPendingReceivedInvitations,
  createDiscussionInvitation,
  createOnboardingStarterInvitationsForUser,
  preserveSharedLinkInvitation,
  markSharedLinkInvitationAccepted,
  getInvitationForUser,
  getInvitationDisplayState,
  isOwnerReentryInvitation,
  listReceivedInvitations,
  markInvitationsSeen,
  markInvitationAccepted,
  removeInvitationForUser,
  trimReceivedInvitationInbox,
} = require("../../src/services/discussion-invitations");
const {
  muteInviterForUser,
  unmuteInviterForUser,
} = require("../../src/services/discussion-invitation-mutes");
const {
  closeDiscussionAndNotify,
  leaveDiscussionAndNotify,
  reportDiscussionMemberAndNotify,
} = require("../../src/services/discussion-actions");
const {
  BOT_STARTER_INSTANCES,
  seedBotDiscussions,
} = require("../../src/services/discussion-starters");
const { handleOnboardingCallback, handleOnboardingText } = require("../../src/flows/onboarding");
const { callBacks } = require("../../src/constants");
const { renderActiveDiscussionList } = require("../../src/flows/discussions-callbacks");
const {
  hasSectionTipBeenShown,
  markSectionTipShown,
} = require("../../src/services/users");
const messages = require("../../src/messages");
const {
  NOTICE_WINDOW_MS,
  claimDueOwnerJoinNoticeSummary,
  claimOwnerJoinNotice,
  completeOwnerJoinNoticeClaim,
  flushDueOwnerJoinNoticeSummaries,
  notifyDiscussionOwnerOfJoin,
  restoreOwnerJoinNoticeClaim,
} = require("../../src/services/discussion-owner-join-notifications");

const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017";
const MONGODB_TEST_DB = `muze_integration_${process.pid}_${Date.now()}`;

async function createUser(userId, overrides = {}) {
  return User.create({
    userId,
    username: `user_${userId}`,
    firstName: `User ${userId}`,
    profileName: `User ${userId}`,
    ...overrides,
  });
}

async function createOpenDiscussion(creatorUserId, overrides = {}) {
  return Discussion.create({
    title: `Discussion ${creatorUserId}`,
    description: "A useful integration-test discussion",
    publicDiscussionCode: `d_TEST${creatorUserId}`,
    creatorUserId,
    status: "open",
    joinRule: { type: "open" },
    memberUserIds: [creatorUserId],
    maxMembers: 20,
    ...overrides,
  });
}

test.before(async () => {
  if (!MONGODB_TEST_DB.startsWith("muze_integration_")) {
    throw new Error("Refusing to run integration tests against a non-test database.");
  }

  await mongoose.connect(MONGODB_TEST_URI, {
    dbName: MONGODB_TEST_DB,
  });
  await Promise.all([
    User.init(),
    Discussion.init(),
    DiscussionInvitation.init(),
    DiscussionInvitationMute.init(),
    DiscussionOwnerJoinNotice.init(),
  ]);
}, { timeout: 120000 });

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Discussion.deleteMany({}),
    DiscussionInvitation.deleteMany({}),
    DiscussionInvitationMute.deleteMany({}),
    DiscussionOwnerJoinNotice.deleteMany({}),
  ]);
});

test("concurrent distinct owner join notice claims produce one send and exact unique pending users", async () => {
  const discussion = await createOpenDiscussion(1, { publicDiscussionCode: "d_NOTICE1" });
  const now = new Date("2026-01-01T00:00:00.000Z");
  const claims = await Promise.all(
    Array.from({ length: 8 }, (_, index) => claimOwnerJoinNotice({
      discussionId: discussion._id,
      ownerUserId: 1,
      joinerUserId: index + 2,
      now,
    })),
  );
  const state = await DiscussionOwnerJoinNotice.findOne({ discussionId: discussion._id }).lean();

  assert.equal(claims.filter((entry) => entry.action === "send").length, 1);
  assert.equal(claims.filter((entry) => entry.action === "throttled").length, 7);
  assert.equal(state.claimedCount, 1);
  assert.equal(state.pendingCount, 7);
  assert.equal(new Set(state.pendingUserIds).size, 7);
});

test("repeated rejoins by one account count as one person per notification window", async () => {
  const discussion = await createOpenDiscussion(1, { publicDiscussionCode: "d_NOTICE7" });
  const now = new Date("2026-01-01T00:00:00.000Z");
  const claims = await Promise.all(
    Array.from({ length: 8 }, () => claimOwnerJoinNotice({
      discussionId: discussion._id,
      ownerUserId: 1,
      joinerUserId: 2,
      now,
    })),
  );
  const state = await DiscussionOwnerJoinNotice.findOne({ discussionId: discussion._id }).lean();

  assert.equal(claims.filter((entry) => entry.action === "send").length, 1);
  assert.equal(claims.filter((entry) => entry.action === "duplicate").length, 7);
  assert.equal(state.claimedCount, 1);
  assert.equal(state.pendingCount, 0);
});

test("owner join notice batching survives persisted state and summarizes at the boundary", async () => {
  const discussion = await createOpenDiscussion(1, { publicDiscussionCode: "d_NOTICE2" });
  const firstAt = new Date("2026-01-01T00:00:00.000Z");
  const first = await claimOwnerJoinNotice({
    discussionId: discussion._id,
    ownerUserId: 1,
    joinerUserId: 2,
    now: firstAt,
  });
  await completeOwnerJoinNoticeClaim(discussion._id, first.claimToken, firstAt);

  for (let index = 1; index <= 3; index += 1) {
    const throttled = await claimOwnerJoinNotice({
      discussionId: discussion._id,
      ownerUserId: 1,
      joinerUserId: index + 2,
      now: new Date(firstAt.getTime() + index * 1000),
    });
    assert.equal(throttled.action, "throttled");
  }

  const summary = await claimDueOwnerJoinNoticeSummary(
    discussion._id,
    new Date(firstAt.getTime() + NOTICE_WINDOW_MS),
  );
  assert.equal(summary.action, "send");
  assert.equal(summary.count, 3);
  assert.equal(summary.claimKind, "summary");
});

test("due owner join summaries flush without waiting for another join", async () => {
  const previousSwitch = process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED;
  process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED = "true";
  try {
    const discussion = await createOpenDiscussion(1, {
      publicDiscussionCode: "d_NOTICE8",
      memberUserIds: [2, 3],
    });
    await createUser(1, { lang: "en", activeDiscussionId: null });
    const firstAt = new Date("2026-01-01T00:00:00.000Z");
    const first = await claimOwnerJoinNotice({
      discussionId: discussion._id,
      ownerUserId: 1,
      joinerUserId: 2,
      now: firstAt,
    });
    await completeOwnerJoinNoticeClaim(discussion._id, first.claimToken, firstAt);
    const pending = await claimOwnerJoinNotice({
      discussionId: discussion._id,
      ownerUserId: 1,
      joinerUserId: 3,
      now: new Date(firstAt.getTime() + 1000),
    });
    assert.equal(pending.action, "throttled");

    const sent = [];
    const flushed = await flushDueOwnerJoinNoticeSummaries({
      messages,
      now: new Date(firstAt.getTime() + NOTICE_WINDOW_MS),
      sendToUser: async (...args) => {
        sent.push(args);
        return { message_id: 1 };
      },
    });
    const state = await DiscussionOwnerJoinNotice.findOne({ discussionId: discussion._id }).lean();

    assert.deepEqual(flushed, { checked: 1, delivered: 1 });
    assert.equal(sent.length, 1);
    assert.match(sent[0][1], /1 more person joined/);
    assert.equal(state.pendingCount, 0);
    assert.deepEqual(state.windowUserIds, [3]);
  } finally {
    if (previousSwitch === undefined) delete process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED;
    else process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED = previousSwitch;
  }
});

test("failed owner join notice delivery restores the full claimed count", async () => {
  const discussion = await createOpenDiscussion(1, { publicDiscussionCode: "d_NOTICE3" });
  const now = new Date("2026-01-01T00:00:00.000Z");
  const claim = await claimOwnerJoinNotice({
    discussionId: discussion._id,
    ownerUserId: 1,
    joinerUserId: 2,
    now,
  });
  await DiscussionOwnerJoinNotice.updateOne(
    { discussionId: discussion._id },
    {
      $set: {
        claimedUserIds: [2, 3, 4, 5],
        claimedCount: 4,
        pendingUserIds: [6, 7],
        pendingCount: 2,
      },
    },
  );

  const restored = await restoreOwnerJoinNoticeClaim(discussion._id, claim.claimToken);
  assert.equal(restored.pendingCount, 6);
  assert.equal(restored.claimToken, "");
  assert.equal(restored.claimedCount, 0);
  const retried = await claimDueOwnerJoinNoticeSummary(discussion._id, now);
  assert.equal(retried.count, 6);
});

test("a stale owner join notice claim is recovered into the next summary", async () => {
  const discussion = await createOpenDiscussion(1, { publicDiscussionCode: "d_NOTICE6" });
  const firstAt = new Date("2026-01-01T00:00:00.000Z");
  const first = await claimOwnerJoinNotice({
    discussionId: discussion._id,
    ownerUserId: 1,
    joinerUserId: 2,
    now: firstAt,
  });
  await DiscussionOwnerJoinNotice.updateOne(
    { discussionId: discussion._id, claimToken: first.claimToken },
    {
      $set: {
        claimedUserIds: [2, 3, 4],
        claimedCount: 3,
        pendingUserIds: [5, 6],
        pendingCount: 2,
      },
    },
  );

  const recovered = await claimDueOwnerJoinNoticeSummary(
    discussion._id,
    new Date(firstAt.getTime() + 61 * 1000),
  );
  assert.equal(recovered.action, "send");
  assert.equal(recovered.count, 5);
});

test("an inactive owner who left their room receives one private join card", async () => {
  const previousSwitch = process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED;
  process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED = "true";
  try {
    const discussion = await createOpenDiscussion(1, {
      publicDiscussionCode: "d_NOTICE4",
      memberUserIds: [2],
    });
    await createUser(1, { lang: "en", activeDiscussionId: null, discussionMembershipIds: [] });
    const sent = [];
    const result = await notifyDiscussionOwnerOfJoin({
      ctx: {
        userId: 2,
        sendToUser: async (...args) => {
          sent.push(args);
          return { message_id: 1 };
        },
      },
      messages,
      joined: {
        joined: true,
        joinerName: "Sara",
        discussion,
      },
    });
    const state = await DiscussionOwnerJoinNotice.findOne({ discussionId: discussion._id }).lean();

    assert.equal(result.action, "sent");
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 1);
    assert.match(sent[0][1], /"Sara" joined your discussion/);
    assert.match(sent[0][1], /1 members/);
    assert.equal(sent[0][2].reply_markup.inline_keyboard[0][0].callback_data,
      "discussion:owner-join:open:d_NOTICE4");
    assert.ok(state.lastSuccessfulSendAt instanceof Date);
  } finally {
    if (previousSwitch === undefined) delete process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED;
    else process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED = previousSwitch;
  }
});

test("same-room owners get only the live notice and failed private delivery restores pending", async () => {
  const previousSwitch = process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED;
  process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED = "true";
  try {
    const liveDiscussion = await createOpenDiscussion(1, { publicDiscussionCode: "d_NOTICE5" });
    await createUser(1, {
      activeDiscussionId: liveDiscussion._id,
      discussionMembershipIds: [liveDiscussion._id],
    });
    let sends = 0;
    const live = await notifyDiscussionOwnerOfJoin({
      ctx: { userId: 2, sendToUser: async () => { sends += 1; return true; } },
      messages,
      joined: { joined: true, joinerName: "Sara", discussion: liveDiscussion },
    });
    assert.equal(live.action, "live");
    assert.equal(sends, 0);
    assert.equal(await DiscussionOwnerJoinNotice.countDocuments({ discussionId: liveDiscussion._id }), 0);

    await User.updateOne({ userId: 1 }, { $set: { activeDiscussionId: null } });
    const failed = await notifyDiscussionOwnerOfJoin({
      ctx: { userId: 2, sendToUser: async () => false },
      messages,
      joined: { joined: true, joinerName: "Sara", discussion: liveDiscussion },
    });
    const restored = await DiscussionOwnerJoinNotice.findOne({ discussionId: liveDiscussion._id }).lean();
    assert.equal(failed.action, "failed");
    assert.equal(restored.pendingCount, 1);
    assert.equal(restored.claimToken, "");
  } finally {
    if (previousSwitch === undefined) delete process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED;
    else process.env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED = previousSwitch;
  }
});

test("create discussion persists creator membership and active room", async () => {
  await createUser(1);

  const result = await createDiscussion({
    creatorUserId: 1,
    title: "Best opening tracks",
    description: "Talk about great album openers",
    joinRule: { type: "open" },
    maxMembers: 5,
  });

  assert.equal(result.ok, true);
  assert.match(result.discussion.publicDiscussionCode, /^d_[A-Z0-9]{6}$/);

  const [user, discussion] = await Promise.all([
    User.findOne({ userId: 1 }).lean(),
    Discussion.findById(result.discussion._id).lean(),
  ]);

  assert.equal(String(user.activeDiscussionId), String(discussion._id));
  assert.deepEqual(user.discussionMembershipIds.map(String), [String(discussion._id)]);
  assert.deepEqual(discussion.memberUserIds, [1]);
  assert.equal(discussion.maxMembers, 5);
  assert.equal(discussion.language, "fa");
});

test("My Discussions lists only rooms the user created", async () => {
  const [owned, joined] = await Promise.all([
    createOpenDiscussion(1, { publicDiscussionCode: "d_MYOWN1" }),
    createOpenDiscussion(2, { publicDiscussionCode: "d_JOINED1", memberUserIds: [1, 2] }),
  ]);
  await createUser(1, {
    activeDiscussionId: joined._id,
    discussionMembershipIds: [owned._id, joined._id],
  });

  const result = await listMyDiscussions(1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.discussions.map((discussion) => String(discussion._id)), [String(owned._id)]);
});

test("leave waits until every remaining member has received an independent notice attempt", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_LEAVE1",
    memberUserIds: [1, 2, 3, 4],
  });
  await Promise.all([
    createUser(1, { activeDiscussionId: discussion._id, discussionMembershipIds: [discussion._id] }),
    createUser(2, { lang: "en", activeDiscussionId: discussion._id, discussionMembershipIds: [discussion._id] }),
    createUser(3, { lang: "fa", activeDiscussionId: discussion._id, discussionMembershipIds: [discussion._id] }),
    createUser(4, { lang: "en", activeDiscussionId: discussion._id, discussionMembershipIds: [discussion._id] }),
  ]);
  const completed = [];
  const ctx = {
    userId: 1,
    user: { userId: 1, activeDiscussionId: discussion._id },
    sendToUser: async (userId) => {
      await Promise.resolve();
      completed.push(userId);
      return { message_id: userId };
    },
  };

  const result = await leaveDiscussionAndNotify({
    ctx,
    messages,
    discussionId: discussion._id,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(completed.sort((a, b) => a - b), [2, 3, 4]);
});

test("recent joined discussions are unique, capped, ordered, and hide unavailable rooms", async () => {
  await createUser(1);
  const rooms = await Promise.all([
    createOpenDiscussion(10, { publicDiscussionCode: "d_RECENT1" }),
    createOpenDiscussion(20, { publicDiscussionCode: "d_RECENT2" }),
    createOpenDiscussion(30, { publicDiscussionCode: "d_RECENT3" }),
    createOpenDiscussion(40, { publicDiscussionCode: "d_RECENT4" }),
  ]);

  for (const room of rooms) {
    const joined = await joinOrOpenDiscussion(1, room._id);
    assert.equal(joined.ok, true);
    assert.equal(joined.joined, true);
    await leaveDiscussionAsMember(1, room._id);
  }

  await joinOrOpenDiscussion(1, rooms[1]._id);
  await leaveDiscussionAsMember(1, rooms[1]._id);

  let result = await listRecentJoinedDiscussions(1);
  assert.deepEqual(result.discussions.map((room) => String(room._id)), [
    String(rooms[1]._id),
    String(rooms[3]._id),
    String(rooms[2]._id),
  ]);

  const user = await User.findOne({ userId: 1 }).lean();
  assert.deepEqual(user.recentJoinedDiscussionIds.map(String), [
    String(rooms[1]._id),
    String(rooms[3]._id),
    String(rooms[2]._id),
  ]);

  await Promise.all([
    Discussion.updateOne({ _id: rooms[1]._id }, { $set: { status: "closed" } }),
    Discussion.updateOne({ _id: rooms[3]._id }, { $addToSet: { removedUserIds: 1 } }),
  ]);
  result = await listRecentJoinedDiscussions(1);
  assert.deepEqual(result.discussions.map((room) => String(room._id)), [String(rooms[2]._id)]);
});

test("discussion creation defaults to the creator interface language", async () => {
  await createUser(2, { lang: "en" });
  const result = await createDiscussion({
    creatorUserId: 2,
    title: "English room",
    description: "A room created with the interface default",
    joinRule: { type: "open" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.discussion.language, "en");
});

test("concurrent discussion creation respects active owned limit", async () => {
  await createUser(1);

  const results = await Promise.all(
    [1, 2, 3, 4, 5].map((index) => createDiscussion({
      creatorUserId: 1,
      title: `Create race ${index}`,
      description: `Useful discussion ${index}`,
      joinRule: { type: "open" },
      maxMembers: 5,
    })),
  );
  const created = results.filter((result) => result.ok);
  const rejected = results.filter((result) => !result.ok);
  const [user, discussions] = await Promise.all([
    User.findOne({ userId: 1 }).lean(),
    Discussion.find({ creatorUserId: 1, status: "open" }).lean(),
  ]);

  assert.equal(created.length, 1);
  assert.equal(rejected.length, 4);
  assert.ok(rejected.every((result) => result.reason === "active_owned_limit"));
  assert.equal(discussions.length, 1);
  assert.equal(user.ownedOpenDiscussionIds.length, 1);
});

test("a server-authorized paid slot permits exactly one room beyond the normal owned limit", async () => {
  await createUser(1);
  for (let index = 1; index <= 1; index += 1) {
    const result = await createDiscussion({
      creatorUserId: 1,
      title: `Normal room ${index}`,
      description: `Useful normal room ${index}`,
      joinRule: { type: "open" },
      maxMembers: 5,
    });
    assert.equal(result.ok, true);
  }

  await User.updateOne(
    { userId: 1 },
    {
      $set: {
        discussionDraftPaidOwnedSlotAuthorized: true,
        discussionDraftPaidOwnedSlotCap: 2,
        discussionDraftPaidOwnedSlotCost: 5,
      },
    },
  );
  const paid = await createDiscussion({
    creatorUserId: 1,
    title: "Paid second room",
    description: "Useful paid overflow room",
    joinRule: { type: "open" },
    maxMembers: 5,
  });
  const extra = await createDiscussion({
    creatorUserId: 1,
    title: "Unpaid third room",
    description: "This room must not be created",
    joinRule: { type: "open" },
    maxMembers: 5,
  });
  const user = await User.findOne({ userId: 1 }).lean();

  assert.equal(paid.ok, true);
  assert.equal(paid.paidOwnedSlotUsed, true);
  assert.equal(extra.ok, false);
  assert.equal(extra.reason, "active_owned_limit");
  assert.equal(user.ownedOpenDiscussionIds.length, 2);
});

test("user must leave the active room before joining another", async () => {
  const first = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_FIRST1",
  });
  const second = await createOpenDiscussion(2, {
    publicDiscussionCode: "d_SECOND",
  });
  await createUser(1, {
    activeDiscussionId: first._id,
    discussionMembershipIds: [first._id],
  });
  await createUser(2, {
    activeDiscussionId: second._id,
    discussionMembershipIds: [second._id],
  });

  const blocked = await joinOrOpenDiscussion(1, second._id);
  assert.deepEqual(blocked, { ok: false, reason: "leave_current_first" });

  const left = await leaveDiscussionAsMember(1, first._id);
  assert.equal(left.ok, true);

  const joined = await joinOrOpenDiscussion(1, second._id);
  assert.equal(joined.ok, true);
  assert.equal(joined.joined, true);

  const [user, firstAfter, secondAfter] = await Promise.all([
    User.findOne({ userId: 1 }).lean(),
    Discussion.findById(first._id).lean(),
    Discussion.findById(second._id).lean(),
  ]);

  assert.equal(String(user.activeDiscussionId), String(second._id));
  assert.deepEqual(user.discussionMembershipIds.map(String), [String(second._id)]);
  assert.equal(firstAfter.memberUserIds.includes(1), false);
  assert.equal(secondAfter.memberUserIds.includes(1), true);
});

test("concurrent joins never exceed discussion capacity", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_CAP002",
    maxMembers: 2,
  });
  await createUser(1, {
    activeDiscussionId: discussion._id,
    discussionMembershipIds: [discussion._id],
  });
  await Promise.all([2, 3, 4, 5].map((userId) => createUser(userId)));

  const results = await Promise.all(
    [2, 3, 4, 5].map((userId) => joinOrOpenDiscussion(userId, discussion._id)),
  );
  const joined = results.filter((result) => result.ok && result.joined);
  const rejected = results.filter((result) => !result.ok);
  const persisted = await Discussion.findById(discussion._id).lean();

  assert.equal(joined.length, 1);
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((result) => result.reason === "discussion_full"));
  assert.equal(persisted.memberUserIds.length, 2);
});

test("a language-specific bot starter accepts members beyond 20 and preserves capacity 100", async () => {
  const memberUserIds = Array.from({ length: 20 }, (_, index) => index + 1);
  const discussion = await createOpenDiscussion(999, {
    publicDiscussionCode: "d_START100",
    isBotCreated: true,
    botSeedKey: "free-discussion:en",
    language: "en",
    memberUserIds,
    maxMembers: 100,
  });
  await createUser(1000, { lang: "en" });

  const result = await joinOrOpenDiscussion(1000, discussion._id);
  const persisted = await Discussion.findById(discussion._id).lean();

  assert.equal(result.ok, true);
  assert.equal(result.joined, true);
  assert.equal(persisted.memberUserIds.length, 21);
  assert.equal(persisted.maxMembers, 100);
});

test("startup reseeding updates all eight starter capacities without destructive changes", async () => {
  const createdAt = new Date("2025-01-02T03:04:05.000Z");
  const protectedState = new Map();

  for (const [index, starter] of BOT_STARTER_INSTANCES.entries()) {
    const discussion = await Discussion.create({
      title: `Legacy starter ${index}`,
      description: `Legacy description ${index}`,
      publicDiscussionCode: `d_KEEP${index}`,
      creatorUserId: 7000,
      isBotCreated: true,
      botSeedKey: starter.botSeedKey,
      language: starter.language,
      status: index === 0 ? "closed" : "open",
      joinRule: { type: "open" },
      memberUserIds: [100 + index],
      removedUserIds: [200 + index],
      maxMembers: 20,
      recentMessages: [{
        senderUserId: 100 + index,
        senderDisplayName: `Member ${index}`,
        text: `Existing message ${index}`,
        sentAt: createdAt,
      }],
      reports: [{
        reporterUserId: 300 + index,
        targetUserId: 400 + index,
        status: "open",
        createdAt,
      }],
      replyCount: index + 1,
      lastActivityAt: createdAt,
      createdAt,
      closedAt: index === 0 ? createdAt : null,
    });
    protectedState.set(starter.botSeedKey, JSON.parse(JSON.stringify({
      publicDiscussionCode: discussion.publicDiscussionCode,
      status: discussion.status,
      memberUserIds: discussion.memberUserIds,
      removedUserIds: discussion.removedUserIds,
      recentMessages: discussion.recentMessages,
      reports: discussion.reports,
      replyCount: discussion.replyCount,
      lastActivityAt: discussion.lastActivityAt,
      createdAt: discussion.createdAt,
      closedAt: discussion.closedAt,
    })));
  }

  const userCreated = await createOpenDiscussion(8000, {
    publicDiscussionCode: "d_USERKEEP",
    title: "User room must remain unchanged",
    memberUserIds: [8000, 8001],
    maxMembers: 15,
    recentMessages: [{
      senderUserId: 8000,
      senderDisplayName: "User 8000",
      text: "User room message",
      sentAt: createdAt,
    }],
  });
  const userCreatedBefore = JSON.parse(JSON.stringify(userCreated.toObject()));

  const result = await seedBotDiscussions(9001);
  assert.equal(result.ok, true);
  assert.equal(result.discussions.length, 8);

  const reseeded = await Discussion.find({
    botSeedKey: { $in: BOT_STARTER_INSTANCES.map((starter) => starter.botSeedKey) },
  }).lean();
  assert.equal(reseeded.length, 8);
  for (const discussion of reseeded) {
    assert.equal(discussion.maxMembers, 100);
    assert.equal(discussion.creatorUserId, 9001);
    assert.equal(discussion.isBotCreated, true);
    assert.deepEqual(JSON.parse(JSON.stringify({
      publicDiscussionCode: discussion.publicDiscussionCode,
      status: discussion.status,
      memberUserIds: discussion.memberUserIds,
      removedUserIds: discussion.removedUserIds,
      recentMessages: discussion.recentMessages,
      reports: discussion.reports,
      replyCount: discussion.replyCount,
      lastActivityAt: discussion.lastActivityAt,
      createdAt: discussion.createdAt,
      closedAt: discussion.closedAt,
    })), protectedState.get(discussion.botSeedKey));
  }

  const userCreatedAfter = await Discussion.findById(userCreated._id).lean();
  assert.deepEqual(JSON.parse(JSON.stringify(userCreatedAfter)), userCreatedBefore);
});

test("owner removal and closing clear persisted user membership", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_REMOVE",
    memberUserIds: [1, 2, 3],
  });
  await Promise.all([
    createUser(1, {
      activeDiscussionId: discussion._id,
      discussionMembershipIds: [discussion._id],
    }),
    createUser(2, {
      activeDiscussionId: discussion._id,
      discussionMembershipIds: [discussion._id],
    }),
    createUser(3, {
      activeDiscussionId: discussion._id,
      discussionMembershipIds: [discussion._id],
    }),
  ]);

  const removed = await removeMemberAsOwner(1, discussion._id, 2);
  assert.equal(removed.ok, true);
  assert.equal(removed.wasActive, true);

  const removedUser = await User.findOne({ userId: 2 }).lean();
  const afterRemoval = await Discussion.findById(discussion._id).lean();
  assert.equal(removedUser.activeDiscussionId, null);
  assert.deepEqual(removedUser.discussionMembershipIds, []);
  assert.equal(afterRemoval.memberUserIds.includes(2), false);
  assert.equal(afterRemoval.removedUserIds.includes(2), true);

  const closed = await closeDiscussionAsOwner(1, discussion._id);
  assert.equal(closed.ok, true);

  const [owner, remainingMember, closedDiscussion] = await Promise.all([
    User.findOne({ userId: 1 }).lean(),
    User.findOne({ userId: 3 }).lean(),
    Discussion.findById(discussion._id).lean(),
  ]);
  assert.equal(owner.activeDiscussionId, null);
  assert.equal(remainingMember.activeDiscussionId, null);
  assert.deepEqual(owner.discussionMembershipIds, []);
  assert.deepEqual(remainingMember.discussionMembershipIds, []);
  assert.equal(closedDiscussion.status, "closed");
});

test("closing a discussion deletes all of its pending and accepted invitations", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_CLOSEIV",
    memberUserIds: [1],
  });
  await createUser(1, {
    activeDiscussionId: discussion._id,
    discussionMembershipIds: [discussion._id],
  });
  await DiscussionInvitation.insertMany([
    {
      publicInvitationCode: "i_CLOSEP1",
      discussionId: discussion._id,
      inviterUserId: 1,
      inviteeUserId: 2,
      status: "pending",
    },
    {
      publicInvitationCode: "i_CLOSEA1",
      discussionId: discussion._id,
      inviterUserId: 1,
      inviteeUserId: 3,
      status: "accepted",
      acceptedAt: new Date(),
    },
  ]);

  const result = await closeDiscussionAndNotify({
    ctx: { userId: 1 },
    messages,
    discussionId: discussion._id,
    discussionsMenuKeyboard: () => ({}),
  });

  assert.equal(result.ok, true);
  assert.equal(await DiscussionInvitation.countDocuments({ discussionId: discussion._id }), 0);
});

test("unique discussion reports ban user and remove them from active discussions", async () => {
  const previousThreshold = process.env.REPORT_BAN_THRESHOLD;
  process.env.REPORT_BAN_THRESHOLD = "2";

  try {
    const discussion = await createOpenDiscussion(1, {
      publicDiscussionCode: "d_REPORTBAN",
      memberUserIds: [1, 2, 3],
    });
    await Promise.all([
      createUser(1, {
        activeDiscussionId: discussion._id,
        discussionMembershipIds: [discussion._id],
      }),
      createUser(2, {
        activeDiscussionId: discussion._id,
        discussionMembershipIds: [discussion._id],
      }),
      createUser(3, {
        activeDiscussionId: discussion._id,
        discussionMembershipIds: [discussion._id],
      }),
    ]);

    const first = await reportDiscussionMember(1, discussion._id, 2);
    assert.equal(first.ok, true);
    assert.equal(first.reportCount, 1);
    assert.equal(first.reportsLeft, 1);
    assert.equal(first.banned, false);

    const duplicate = await reportDiscussionMember(1, discussion._id, 2);
    assert.deepEqual(duplicate, { ok: false, reason: "duplicate_report" });

    const second = await reportDiscussionMember(3, discussion._id, 2);
    assert.equal(second.ok, true);
    assert.equal(second.reportCount, 2);
    assert.equal(second.reportsLeft, 0);
    assert.equal(second.banned, true);
    assert.equal(second.affectedDiscussionIds.length, 1);

    const [target, persistedDiscussion] = await Promise.all([
      User.findOne({ userId: 2 }).lean(),
      Discussion.findById(discussion._id).lean(),
    ]);

    assert.ok(target.bannedAt);
    assert.equal(target.banReason, "report_threshold");
    assert.equal(target.activeDiscussionId, null);
    assert.deepEqual(target.discussionMembershipIds, []);
    assert.deepEqual(target.reportReporterUserIds.sort(), [1, 3]);
    assert.equal(persistedDiscussion.memberUserIds.includes(2), false);
    assert.equal(persistedDiscussion.reports.length, 2);
  } finally {
    if (previousThreshold === undefined) {
      delete process.env.REPORT_BAN_THRESHOLD;
    } else {
      process.env.REPORT_BAN_THRESHOLD = previousThreshold;
    }
  }
});

test("report notifications warn target and announce auto-removal on ban", async () => {
  const previousThreshold = process.env.REPORT_BAN_THRESHOLD;
  process.env.REPORT_BAN_THRESHOLD = "2";

  try {
    const discussion = await createOpenDiscussion(1, {
      publicDiscussionCode: "d_REPORTNOTIFY",
      memberUserIds: [1, 2, 3],
    });
    await Promise.all([
      createUser(1, {
        lang: "en",
        activeDiscussionId: discussion._id,
        discussionMembershipIds: [discussion._id],
      }),
      createUser(2, {
        lang: "en",
        profileName: "Reported User",
        activeDiscussionId: discussion._id,
        discussionMembershipIds: [discussion._id],
      }),
      createUser(3, {
        lang: "en",
        activeDiscussionId: discussion._id,
        discussionMembershipIds: [discussion._id],
      }),
    ]);

    const sent = [];
    const ctx = {
      userId: 1,
      sendToUser: async (userId, text, extra) => {
        sent.push({ userId, text, extra });
      },
    };

    const first = await reportDiscussionMemberAndNotify({
      ctx,
      messages,
      discussionId: discussion._id,
      memberUserId: 2,
    });
    assert.equal(first.ok, true);
    assert.equal(first.banned, false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].userId, 2);
    assert.match(sent[0].text, /Reports: 1\/2/);
    assert.deepEqual(sent[0].extra, {});

    ctx.userId = 3;
    const second = await reportDiscussionMemberAndNotify({
      ctx,
      messages,
      discussionId: discussion._id,
      memberUserId: 2,
    });
    assert.equal(second.ok, true);
    assert.equal(second.banned, true);

    assert.equal(sent[1].userId, 2);
    assert.match(sent[1].text, /account was banned/);
    assert.equal(sent[1].extra.reply_markup.remove_keyboard, true);
    const roomNotices = sent.slice(2);
    assert.deepEqual(roomNotices.map((entry) => entry.userId).sort(), [1, 3]);
    assert.ok(roomNotices.every((entry) => entry.text.includes('"Reported User" was removed')));
  } finally {
    if (previousThreshold === undefined) {
      delete process.env.REPORT_BAN_THRESHOLD;
    } else {
      process.env.REPORT_BAN_THRESHOLD = previousThreshold;
    }
  }
});

test("saved profile mutations preserve concurrent updates", async () => {
  await createUser(1);

  const saveResults = await Promise.all(
    ["u_AAA1", "u_BBB2", "u_CCC3"].map((code) => addSavedProfileCode(1, code)),
  );
  assert.ok(saveResults.every((result) => result.ok));

  const savedUser = await User.findOne({ userId: 1 }).lean();
  assert.deepEqual(savedUser.savedProfileCodes.sort(), ["u_AAA1", "u_BBB2", "u_CCC3"]);

  const removeResults = await Promise.all([
    removeSavedProfileCode(1, "u_aaa1"),
    removeSavedProfileCode(1, "u_BBB2"),
  ]);
  assert.ok(removeResults.every((result) => result.ok));

  const updatedUser = await User.findOne({ userId: 1 }).lean();
  assert.deepEqual(updatedUser.savedProfileCodes, ["u_CCC3"]);
});

test("saved profiles stop atomically at the 50-profile product cap", async () => {
  const existingCodes = Array.from({ length: 49 }, (_, index) => `u_CAP${String(index).padStart(2, "0")}`);
  await createUser(1, { savedProfileCodes: existingCodes });

  const results = await Promise.all([
    addSavedProfileCode(1, "u_CAP49"),
    addSavedProfileCode(1, "u_CAP50"),
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  const rejected = results.find((result) => !result.ok);
  assert.equal(rejected.reason, "saved_profiles_limit");
  assert.equal(rejected.cap, 50);

  const savedUser = await User.findOne({ userId: 1 }).lean();
  assert.equal(savedUser.savedProfileCodes.length, 50);
});

test("section-tip timestamps persist independently and only accept the first mark", async () => {
  await createUser(490);
  const discussionsAt = new Date("2026-07-17T12:00:00.000Z");
  const laterAt = new Date("2026-07-17T13:00:00.000Z");

  const first = await markSectionTipShown(490, "discussions", discussionsAt);
  const repeated = await markSectionTipShown(490, "discussions", laterAt);
  const persisted = await User.findOne({ userId: 490 }).lean();

  assert.ok(first);
  assert.equal(repeated, null);
  assert.equal(persisted.sectionTipsShownAt.discussions.toISOString(), discussionsAt.toISOString());
  assert.equal(persisted.sectionTipsShownAt.activeDiscussions, null);
  assert.equal(persisted.sectionTipsShownAt.favorites, null);
  assert.equal(persisted.sectionTipsShownAt.people, null);
  assert.equal(hasSectionTipBeenShown(persisted, "discussions"), true);
  assert.equal(hasSectionTipBeenShown(persisted, "favorites"), false);
});

test("Active Discussions shows its new browsing tip once to an older guided user", async () => {
  const priorDiscussionTip = new Date("2026-07-17T12:00:00.000Z");
  const user = await createUser(491, {
    lang: "en",
    discussionLanguageFilter: "en",
    sectionTipsShownAt: { discussions: priorDiscussionTip },
  });
  await createOpenDiscussion(492, {
    title: "A live room",
    language: "en",
    memberUserIds: [492],
  });
  const rendered = [];
  const ctx = {
    userId: 491,
    user,
    answerCb: async () => true,
    reply: async () => ({ message_id: 1 }),
  };
  const render = async (_ctx, text, keyboard) => {
    rendered.push({ text, keyboard });
    return { message_id: rendered.length + 1 };
  };

  await renderActiveDiscussionList(ctx, "en", 0, false, "en", {
    editCallbackMessageOrReply: render,
    freshDestination: true,
  });
  const persisted = await User.findOne({ userId: 491 });
  const secondCtx = { ...ctx, user: persisted };
  await renderActiveDiscussionList(secondCtx, "en", 0, false, "en", {
    editCallbackMessageOrReply: render,
    freshDestination: true,
  });

  assert.match(rendered[0].text, /^🟢 Active discussions \(1\)/);
  assert.match(rendered[0].text, new RegExp(messages.en.discussionActiveListFirstVisitTip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(
    rendered[0].text.indexOf("🟢 Active discussions")
      < rendered[0].text.indexOf(messages.en.discussionActiveListFirstVisitTip),
  );
  assert.doesNotMatch(rendered[1].text, /Active discussions are ranked/);
  assert.match(rendered[0].text, /You can use the Join command below any discussion to enter it/);
  assert.match(rendered[1].text, /You can use the Join command below any discussion to enter it/);
  assert.doesNotMatch(rendered[0].text, /preview/i);
  assert.doesNotMatch(rendered[1].text, /preview/i);
  assert.equal(persisted.sectionTipsShownAt.discussions.toISOString(), priorDiscussionTip.toISOString());
  assert.ok(persisted.sectionTipsShownAt.activeDiscussions instanceof Date);
  assert.equal(persisted.sectionTipsShownAt.favorites, null);
  assert.equal(persisted.sectionTipsShownAt.people, null);
});

test("discussion invitations create, count, dedupe, and accept cleanly", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_INVITE",
  });
  await createUser(1, {
    activeDiscussionId: discussion._id,
    discussionMembershipIds: [discussion._id],
    savedProfileCodes: ["u_BBBB"],
  });
  await createUser(2, {
    publicProfileCode: "u_BBBB",
  });

  const created = await createDiscussionInvitation({
    inviterUserId: 1,
    inviteePublicProfileCode: "u_BBBB",
    discussionId: discussion._id,
    source: "room",
  });
  assert.equal(created.ok, true);
  assert.match(created.invitation.publicInvitationCode, /^i_[A-Z0-9]{7}$/);

  const duplicate = await createDiscussionInvitation({
    inviterUserId: 1,
    inviteePublicProfileCode: "u_BBBB",
    discussionId: discussion._id,
    source: "room",
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(await countPendingReceivedInvitations(2), 1);
  await markInvitationsSeen([created.invitation._id]);
  assert.equal(await countPendingReceivedInvitations(2), 1);

  const joined = await joinOrOpenDiscussion(2, discussion._id);
  assert.equal(joined.ok, true);
  assert.equal(joined.joined, true);
  await markInvitationAccepted(created.invitation);

  const [count, invitation, invitee, updatedDiscussion] = await Promise.all([
    countPendingReceivedInvitations(2),
    DiscussionInvitation.findOne({ inviteeUserId: 2 }).lean(),
    User.findOne({ userId: 2 }).lean(),
    Discussion.findById(discussion._id).lean(),
  ]);

  assert.equal(count, 0);
  assert.equal(invitation.status, "accepted");
  assert.ok(invitation.acceptedAt instanceof Date);
  assert.equal(String(invitee.activeDiscussionId), String(discussion._id));
  assert.equal(updatedDiscussion.memberUserIds.includes(2), true);

  const acceptedList = await listReceivedInvitations(2, { statuses: ["accepted"] });
  assert.equal(acceptedList.invitations.length, 1);
  assert.equal(acceptedList.invitations[0].invitation.publicInvitationCode, invitation.publicInvitationCode);

  const reopened = await getInvitationForUser(invitation.publicInvitationCode, 2, { statuses: ["accepted"] });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.invitation.status, "accepted");

  const removed = await removeInvitationForUser(invitation.publicInvitationCode, 2);
  assert.equal(removed.ok, true);
  const hiddenList = await listReceivedInvitations(2, { statuses: ["accepted"] });
  assert.equal(hiddenList.invitations.length, 0);
});

test("a creator can invite an unsaved People profile while outside their open discussion", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_PEOPLE",
    memberUserIds: [],
  });
  await Promise.all([
    createUser(1, { savedProfileCodes: [] }),
    createUser(2, { publicProfileCode: "u_PEOPLE" }),
  ]);

  const direct = await createDiscussionInvitation({
    inviterUserId: 1,
    inviteePublicProfileCode: "u_PEOPLE",
    discussionId: discussion._id,
    source: "people_profile",
  });
  assert.equal(direct.ok, true);
  assert.equal(direct.invitation.source, "people_profile");

  await DiscussionInvitation.deleteMany({ discussionId: discussion._id });
  const savedOnly = await createDiscussionInvitation({
    inviterUserId: 1,
    inviteePublicProfileCode: "u_PEOPLE",
    discussionId: discussion._id,
    source: "saved_profile",
  });
  assert.equal(savedOnly.ok, false);
  assert.equal(savedOnly.reason, "not_saved");
});

test("only a new owner invitation lets a removed member rejoin", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_REENTRY",
    memberUserIds: [1, 3],
  });
  await Promise.all([
    createUser(1, {
      activeDiscussionId: discussion._id,
      discussionMembershipIds: [discussion._id],
      savedProfileCodes: ["u_REJOIN"],
    }),
    createUser(2, { publicProfileCode: "u_REJOIN" }),
    createUser(3, {
      activeDiscussionId: discussion._id,
      discussionMembershipIds: [discussion._id],
      savedProfileCodes: ["u_REJOIN"],
    }),
  ]);

  const oldInvitation = await createDiscussionInvitation({
    inviterUserId: 1,
    inviteePublicProfileCode: "u_REJOIN",
    discussionId: discussion._id,
    source: "room",
  });
  assert.equal(oldInvitation.ok, true);
  assert.equal(oldInvitation.invitation.restoresOwnerRemoval, false);

  assert.equal((await joinOrOpenDiscussion(2, discussion._id)).ok, true);
  assert.equal((await removeMemberAsOwner(1, discussion._id, 2)).ok, true);
  const removedDiscussion = await Discussion.findById(discussion._id);

  const oldState = await getInvitationDisplayState(
    { userId: 2 },
    removedDiscussion,
    oldInvitation.invitation,
  );
  assert.equal(oldState.state, "blocked");
  assert.equal((await joinOrOpenDiscussion(2, discussion._id)).reason, "removed_by_owner");

  const memberInvite = await createDiscussionInvitation({
    inviterUserId: 3,
    inviteePublicProfileCode: "u_REJOIN",
    discussionId: discussion._id,
    source: "room",
  });
  assert.equal(memberInvite.ok, false);
  assert.equal(memberInvite.reason, "removed_by_owner");

  const ownerInvite = await createDiscussionInvitation({
    inviterUserId: 1,
    inviteePublicProfileCode: "u_REJOIN",
    discussionId: discussion._id,
    source: "room",
  });
  assert.equal(ownerInvite.ok, true);
  assert.equal(String(ownerInvite.replacedInvitationId), String(oldInvitation.invitation._id));
  assert.notEqual(String(ownerInvite.invitation._id), String(oldInvitation.invitation._id));
  assert.equal(ownerInvite.invitation.restoresOwnerRemoval, true);
  const expiredOldInvitation = await DiscussionInvitation.findById(oldInvitation.invitation._id).lean();
  assert.equal(expiredOldInvitation.status, "expired");
  const visibleInvitations = await listReceivedInvitations(2, { statuses: ["pending", "accepted"] });
  assert.equal(visibleInvitations.invitations.length, 1);
  assert.equal(
    String(visibleInvitations.invitations[0].invitation._id),
    String(ownerInvite.invitation._id),
  );
  assert.equal(isOwnerReentryInvitation(ownerInvite.invitation, removedDiscussion, 2), true);
  assert.equal(
    (await getInvitationDisplayState({ userId: 2 }, removedDiscussion, ownerInvite.invitation)).state,
    "joinable",
  );

  const publicJoinAfterInvite = await joinOrOpenDiscussion(2, discussion._id);
  assert.equal(publicJoinAfterInvite.ok, false);
  assert.equal(publicJoinAfterInvite.reason, "removed_by_owner");

  const rejoined = await joinOrOpenDiscussion(2, discussion._id, { allowOwnerReentry: true });
  assert.equal(rejoined.ok, true);
  assert.equal(rejoined.joined, true);
  const afterRejoin = await Discussion.findById(discussion._id).lean();
  assert.equal(afterRejoin.memberUserIds.includes(2), true);
  assert.equal(afterRejoin.removedUserIds.includes(2), false);

  await markInvitationAccepted(ownerInvite.invitation);
  assert.equal(ownerInvite.invitation.restoresOwnerRemoval, false);
  assert.equal((await removeMemberAsOwner(1, discussion._id, 2)).ok, true);
  const removedAgain = await Discussion.findById(discussion._id);
  assert.equal(
    (await getInvitationDisplayState({ userId: 2 }, removedAgain, ownerInvite.invitation)).state,
    "blocked",
  );
});

test("received invitation inbox keeps the newest 20 visible records", async () => {
  const discussionId = new mongoose.Types.ObjectId();
  const invitations = Array.from({ length: 22 }, (_, index) => ({
    publicInvitationCode: `i_CAP${String(index).padStart(4, "0")}`,
    discussionId,
    inviterUserId: 100 + index,
    inviteeUserId: 1,
    status: "accepted",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
  }));
  await DiscussionInvitation.insertMany(invitations);

  const result = await trimReceivedInvitationInbox(1, new Date("2026-01-02T00:00:00.000Z"));
  assert.equal(result.retiredCount, 2);

  const visible = await DiscussionInvitation.find({
    inviteeUserId: 1,
    status: { $in: ["pending", "accepted"] },
  }).sort({ createdAt: -1 }).lean();
  const expired = await DiscussionInvitation.find({ inviteeUserId: 1, status: "expired" })
    .sort({ createdAt: 1 })
    .lean();
  assert.equal(visible.length, 20);
  assert.deepEqual(expired.map((entry) => entry.publicInvitationCode), ["i_CAP0000", "i_CAP0001"]);
});

test("onboarding starter invitations include only the open free discussion", async () => {
  await createUser(500);
  await Promise.all([
    createOpenDiscussion(999, {
      title: "Free Discussion",
      publicDiscussionCode: "d_BOTFREE",
      isBotCreated: true,
      botSeedKey: "free-discussion:fa",
      language: "fa",
      memberUserIds: [],
    }),
    createOpenDiscussion(999, {
      title: "Gaming Hangout",
      publicDiscussionCode: "d_BOTGAME",
      isBotCreated: true,
      botSeedKey: "whats-up:fa",
      language: "fa",
      memberUserIds: [42],
      joinRule: {
        type: "top_ten_item",
        section: "random",
        itemTitle: "Gaming",
        itemAliases: ["Gaming"],
      },
    }),
  ]);

  const created = await createOnboardingStarterInvitationsForUser(500);
  assert.equal(created.ok, true);
  assert.equal(created.count, 1);
  assert.equal(created.invitation.kind, "free");
  assert.equal(created.invitation.discussionPublicCode, "d_BOTFREE");

  const invitations = await DiscussionInvitation.find({ inviteeUserId: 500, source: "bot_onboarding" }).lean();
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].discussionPublicCode, "d_BOTFREE");

  const repeated = await createOnboardingStarterInvitationsForUser(500);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.skipped, true);
  assert.equal(repeated.invitation.kind, "free");
  assert.equal(repeated.invitation.discussionPublicCode, "d_BOTFREE");
  assert.equal(await DiscussionInvitation.countDocuments({ inviteeUserId: 500, source: "bot_onboarding" }), 1);

  const user = await User.findOne({ userId: 500 }).lean();
  assert.ok(user.onboardingStarterInvitationsAt instanceof Date);
});

test("onboarding with no available room creates no invitation or durable claim", async () => {
  await createUser(505, { lang: "fa" });

  const result = await createOnboardingStarterInvitationsForUser(505);
  const invitations = await DiscussionInvitation.find({ inviteeUserId: 505 }).lean();
  const user = await User.findOne({ userId: 505 }).lean();

  assert.deepEqual(result, { ok: true, count: 0 });
  assert.deepEqual(invitations, []);
  assert.equal(user.onboardingStarterInvitationsAt, null);
});

test("shared-discussion onboarding preserves its preview without preparing a starter invitation", async () => {
  const user = await createUser(506, {
    lang: "en",
    state: "onboarding_favorites:movies",
    navigationMode: "onboarding_favorites:movies",
    pendingDiscussionShareCode: "d_SHARED506",
    aiLists: {
      movies: {
        topTen: [
          { title: "Stalker" },
          { title: "Nostalghia" },
        ],
      },
    },
  });
  await createOpenDiscussion(999, {
    title: "Free Discussion",
    publicDiscussionCode: "d_FREE506",
    isBotCreated: true,
    botSeedKey: "free-discussion:en",
    language: "en",
    memberUserIds: [],
    maxMembers: 100,
  });
  await createOpenDiscussion(998, {
    title: "Locked shared room",
    publicDiscussionCode: "d_SHARED506",
    language: "en",
    joinRule: {
      type: "top_ten_item",
      section: "movies",
      itemTitle: "Arrival",
      itemAliases: ["Arrival"],
    },
  });
  const replies = [];
  const previewCodes = [];

  await handleOnboardingText({
    userId: 506,
    user,
    text: "Solaris",
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 1 };
    },
  }, "en", {
    showSharedDiscussionPreview: async (code) => {
      previewCodes.push(code);
      return { ok: true };
    },
  });

  const persisted = await User.findOne({ userId: 506 }).lean();
  const invitations = await DiscussionInvitation.find({ inviteeUserId: 506 }).lean();
  const buttons = replies[0].extra.reply_markup.keyboard.flat();

  assert.equal(replies.length, 1);
  assert.equal(persisted.pendingDiscussionShareCode, "d_SHARED506");
  assert.equal(persisted.onboardingVersion, 1);
  assert.equal(persisted.state, "idle");
  assert.equal(persisted.navigationMode, "onboarding_complete:movies");
  assert.equal(invitations.length, 1);
  assert.ok(invitations.some((entry) => (
    entry.discussionPublicCode === "d_SHARED506" && entry.source === "shared_link"
  )));
  assert.deepEqual(previewCodes, ["d_SHARED506"]);
  assert.equal(buttons[0].text, messages.en.onboardingSuggestionButton);
  assert.equal(buttons[1].text, messages.en.onboardingMainMenuButton);
});

test("early onboarding completion preserves and opens the original shared discussion", async () => {
  const user = await createUser(1506, {
    lang: "en",
    state: "onboarding_favorites:books",
    navigationMode: "onboarding_favorites:books",
    pendingDiscussionShareCode: "d_SHARED1506",
    aiLists: { books: { topTen: [{ title: "The Blind Owl" }] } },
  });
  await createOpenDiscussion(1507, {
    title: "Shared book room",
    publicDiscussionCode: "d_SHARED1506",
    language: "en",
  });
  const replies = [];
  const previewCodes = [];

  await handleOnboardingCallback({
    userId: 1506,
    user,
    callbackData: callBacks.onboardingFinishLater,
    answerCb: async () => true,
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 1 };
    },
  }, "en", {
    showSharedDiscussionPreview: async (code) => {
      previewCodes.push(code);
      return { ok: true };
    },
  });

  const persisted = await User.findOne({ userId: 1506 }).lean();
  const invitation = await DiscussionInvitation.findOne({
    inviteeUserId: 1506,
    discussionPublicCode: "d_SHARED1506",
  }).lean();
  const buttons = replies[0].extra.reply_markup.keyboard.flat();

  assert.equal(persisted.onboardingVersion, 1);
  assert.ok(persisted.onboardingCompletedAt);
  assert.equal(persisted.state, "idle");
  assert.equal(persisted.navigationMode, "global");
  assert.equal(persisted.aiLists.books.topTen.length, 1);
  assert.equal(invitation.source, "shared_link");
  assert.deepEqual(previewCodes, ["d_SHARED1506"]);
  assert.ok(buttons.some(({ text }) => text === messages.en.mainMenuMe));
});

test("a joinable shared-link destination is also preserved in the invitations inbox", async () => {
  await createUser(507, { lang: "en" });
  await createOpenDiscussion(997, {
    title: "Joinable shared room",
    publicDiscussionCode: "d_SHARED507",
    language: "en",
    joinRule: { type: "open" },
  });

  const result = await preserveSharedLinkInvitation({
    userId: 507,
    discussionPublicCode: "d_SHARED507",
    inviterUserId: 997,
  });
  const invitation = await DiscussionInvitation.findOne({
    inviteeUserId: 507,
    discussionPublicCode: "d_SHARED507",
  }).lean();

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(invitation.source, "shared_link");
  assert.equal(invitation.status, "pending");

  const accepted = await markSharedLinkInvitationAccepted(507, invitation.discussionId);
  const persisted = await DiscussionInvitation.findById(invitation._id).lean();
  assert.equal(accepted.ok, true);
  assert.equal(persisted.status, "accepted");
  assert.ok(persisted.acceptedAt instanceof Date);
});

test("onboarding prefers a matching Interest room over Free Discussion", async () => {
  await createUser(530, {
    lang: "en",
    aiLists: { random: { topTen: [{ title: "Gaming" }] } },
  });
  await createOpenDiscussion(999, {
    title: "Free Discussion",
    publicDiscussionCode: "d_FREE530",
    isBotCreated: true,
    botSeedKey: "free-discussion:en",
    language: "en",
    memberUserIds: [],
    maxMembers: 100,
  });
  await createOpenDiscussion(700, {
    title: "Gaming room",
    publicDiscussionCode: "d_MATCH530",
    language: "en",
    joinRule: {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Gaming",
      itemAliases: ["Gaming", "Games"],
    },
  });

  const result = await createOnboardingStarterInvitationsForUser(530);
  const invitation = await DiscussionInvitation.findOne({ inviteeUserId: 530 }).lean();

  assert.equal(result.count, 1);
  assert.equal(result.invitation.kind, "match");
  assert.equal(result.invitation.discussionPublicCode, "d_MATCH530");
  assert.equal(invitation.discussionPublicCode, "d_MATCH530");
  assert.equal(invitation.source, "onboarding_match");
});

test("a full matching Interest room falls back to Free Discussion", async () => {
  await createUser(540, {
    lang: "en",
    aiLists: { random: { topTen: [{ title: "Gaming" }] } },
  });
  await createOpenDiscussion(700, {
    title: "Full Gaming room",
    publicDiscussionCode: "d_FULL540",
    language: "en",
    memberUserIds: [700, 701, 702],
    maxMembers: 3,
    joinRule: {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Gaming",
      itemAliases: ["Gaming", "Games"],
    },
  });
  await createOpenDiscussion(999, {
    title: "Free Discussion",
    publicDiscussionCode: "d_FREE540",
    isBotCreated: true,
    botSeedKey: "free-discussion:en",
    language: "en",
    memberUserIds: [],
    maxMembers: 100,
  });

  const result = await createOnboardingStarterInvitationsForUser(540);
  const invitation = await DiscussionInvitation.findOne({ inviteeUserId: 540 }).lean();

  assert.equal(result.count, 1);
  assert.equal(result.invitation.kind, "free");
  assert.equal(result.invitation.discussionPublicCode, "d_FREE540");
  assert.equal(invitation.discussionPublicCode, "d_FREE540");
  assert.equal(invitation.source, "bot_onboarding");
});

test("a full Free Discussion creates no onboarding invitation", async () => {
  await createUser(550, { lang: "fa" });
  await createOpenDiscussion(999, {
    title: "Free Discussion",
    publicDiscussionCode: "d_FULL550",
    isBotCreated: true,
    botSeedKey: "free-discussion:fa",
    language: "fa",
    memberUserIds: Array.from({ length: 100 }, (_, index) => index + 1),
    maxMembers: 100,
  });

  const result = await createOnboardingStarterInvitationsForUser(550);
  const invitations = await DiscussionInvitation.find({ inviteeUserId: 550 }).lean();
  const user = await User.findOne({ userId: 550 }).lean();

  assert.deepEqual(result, { ok: true, count: 0 });
  assert.deepEqual(invitations, []);
  assert.equal(user.onboardingStarterInvitationsAt, null);
});

test("onboarding starter invitations stay isolated to the user's language", async () => {
  await Promise.all([
    createUser(560, { lang: "fa" }),
    createUser(561, { lang: "en" }),
    createOpenDiscussion(998, {
      title: "Free Discussion",
      publicDiscussionCode: "d_FREE560FA",
      isBotCreated: true,
      botSeedKey: "free-discussion:fa",
      language: "fa",
      memberUserIds: [],
      maxMembers: 100,
    }),
    createOpenDiscussion(999, {
      title: "Free Discussion",
      publicDiscussionCode: "d_FREE561EN",
      isBotCreated: true,
      botSeedKey: "free-discussion:en",
      language: "en",
      memberUserIds: [],
      maxMembers: 100,
    }),
  ]);

  const [faResult, enResult] = await Promise.all([
    createOnboardingStarterInvitationsForUser(560),
    createOnboardingStarterInvitationsForUser(561),
  ]);
  const invitations = await DiscussionInvitation.find({
    inviteeUserId: { $in: [560, 561] },
  }).lean();
  const byInvitee = new Map(invitations.map((invitation) => [invitation.inviteeUserId, invitation]));

  assert.equal(faResult.count, 1);
  assert.equal(enResult.count, 1);
  assert.equal(byInvitee.get(560).discussionPublicCode, "d_FREE560FA");
  assert.equal(byInvitee.get(561).discussionPublicCode, "d_FREE561EN");
});

test("concurrent onboarding completions create at most one starter invitation", async () => {
  await createUser(510, { lang: "en" });
  await createOpenDiscussion(999, {
    title: "Free Discussion",
    publicDiscussionCode: "d_BOTCONC",
    isBotCreated: true,
    botSeedKey: "free-discussion:en",
    language: "en",
    memberUserIds: [],
    maxMembers: 100,
  });

  const results = await Promise.all(
    Array.from({ length: 8 }, () => createOnboardingStarterInvitationsForUser(510)),
  );
  const invitations = await DiscussionInvitation.find({
    inviteeUserId: 510,
    source: { $in: ["bot_onboarding", "onboarding_match"] },
    status: "pending",
  }).lean();
  const user = await User.findOne({ userId: 510 }).lean();

  assert.equal(results.every((result) => result.ok), true);
  assert.equal(results.some((result) => result.count === 1), true);
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].discussionPublicCode, "d_BOTCONC");
  assert.ok(user.onboardingStarterInvitationsAt instanceof Date);
});

test("starter invitation acceptance revalidates capacity after creation", async () => {
  await createUser(520, { lang: "en" });
  const discussion = await createOpenDiscussion(999, {
    title: "Free Discussion",
    publicDiscussionCode: "d_BOTFILL",
    isBotCreated: true,
    botSeedKey: "free-discussion:en",
    language: "en",
    memberUserIds: Array.from({ length: 99 }, (_, index) => index + 1),
    maxMembers: 100,
  });
  const created = await createOnboardingStarterInvitationsForUser(520);
  assert.equal(created.count, 1);

  await Discussion.updateOne(
    { _id: discussion._id },
    { $push: { memberUserIds: 1000 } },
  );
  const joined = await joinOrOpenDiscussion(520, discussion._id);
  const invitation = await DiscussionInvitation.findOne({ inviteeUserId: 520 }).lean();

  assert.equal(joined.ok, false);
  assert.equal(joined.reason, "discussion_full");
  assert.equal(invitation.status, "pending");
});

test("invitation restrictions remove pending invites, block new ones, and can be lifted without restoring old invites", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_MUTE01",
  });
  await createUser(1, {
    activeDiscussionId: discussion._id,
    discussionMembershipIds: [discussion._id],
    savedProfileCodes: ["u_BBBB"],
  });
  await createUser(2, {
    publicProfileCode: "u_BBBB",
  });

  const created = await createDiscussionInvitation({
    inviterUserId: 1,
    inviteePublicProfileCode: "u_BBBB",
    discussionId: discussion._id,
  });
  assert.equal(created.ok, true);

  const muted = await muteInviterForUser({
    muterUserId: 2,
    mutedUserId: 1,
    sourceInvitationId: created.invitation._id,
  });
  assert.equal(muted.ok, true);

  const removedInvite = await DiscussionInvitation.findById(created.invitation._id).lean();
  assert.equal(removedInvite.status, "removed");
  assert.equal(await countPendingReceivedInvitations(2), 0);

  const next = await createDiscussionInvitation({
    inviterUserId: 1,
    inviteePublicProfileCode: "u_BBBB",
    discussionId: discussion._id,
  });
  assert.equal(next.ok, false);
  assert.equal(next.reason, "inviter_muted");

  const unmuted = await unmuteInviterForUser({ muterUserId: 2, mutedUserId: 1 });
  assert.equal(unmuted.ok, true);
  assert.equal(unmuted.removed, true);
  assert.equal((await DiscussionInvitation.findById(created.invitation._id).lean()).status, "removed");

  const afterUnmute = await createDiscussionInvitation({
    inviterUserId: 1,
    inviteePublicProfileCode: "u_BBBB",
    discussionId: discussion._id,
  });
  assert.equal(afterUnmute.ok, true);
});

test("restricted users cannot join discussions created by the restricting user until allowed again", async () => {
  const discussion = await createOpenDiscussion(2, {
    publicDiscussionCode: "d_MUTE02",
  });
  await createUser(2, {
    activeDiscussionId: discussion._id,
    discussionMembershipIds: [discussion._id],
  });
  await createUser(1);
  await muteInviterForUser({
    muterUserId: 2,
    mutedUserId: 1,
  });

  const joined = await joinOrOpenDiscussion(1, discussion._id);
  assert.equal(joined.ok, false);
  assert.equal(joined.reason, "discussion_unavailable");

  await unmuteInviterForUser({ muterUserId: 2, mutedUserId: 1 });
  const joinedAfterUnmute = await joinOrOpenDiscussion(1, discussion._id);
  assert.equal(joinedAfterUnmute.ok, true);
});

test("discussion invitations enforce the centralized daily limit", async () => {
  await createUser(1, {
    savedProfileCodes: ["u_BB01", "u_BB02", "u_BB03", "u_BB04"],
  });
  await Promise.all([2, 3, 4, 5].map((userId) => createUser(userId, {
    publicProfileCode: `u_BB0${userId - 1}`,
  })));

  const discussions = await Promise.all([1, 2, 3, 4].map((index) => createOpenDiscussion(1, {
    publicDiscussionCode: `d_LIM00${index}`,
    title: `Limit room ${index}`,
  })));
  await User.findOneAndUpdate(
    { userId: 1 },
    {
      $set: {
        activeDiscussionId: discussions[0]._id,
        discussionMembershipIds: discussions.map((discussion) => discussion._id),
      },
    },
  );

  const results = [];
  for (let index = 0; index < 4; index += 1) {
    results.push(await createDiscussionInvitation({
      inviterUserId: 1,
      inviteePublicProfileCode: `u_BB0${index + 1}`,
      discussionId: discussions[index]._id,
      source: "saved_profile",
    }));
  }

  assert.deepEqual(results.map((result) => result.ok), [true, true, true, false]);
  assert.equal(results[3].reason, "daily_limit");
  assert.equal(await DiscussionInvitation.countDocuments({ inviterUserId: 1 }), 3);
});

test("concurrent messages enforce the one-second burst limit", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_MSG030",
  });
  await createUser(1, {
    activeDiscussionId: discussion._id,
    discussionMembershipIds: [discussion._id],
  });

  const results = await Promise.all([
    addRecentMessage({
      discussionId: discussion._id,
      senderUserId: 1,
      senderDisplayName: "Sender",
      text: "message-1",
    }),
    addRecentMessage({
      discussionId: discussion._id,
      senderUserId: 1,
      senderDisplayName: "Sender",
      text: "message-2",
    }),
  ]);
  const accepted = results.filter((result) => result.ok);
  const rejected = results.filter((result) => !result.ok);
  const [user, persisted] = await Promise.all([
    User.findOne({ userId: 1 }).lean(),
    Discussion.findById(discussion._id).lean(),
  ]);

  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, "message_burst_limit");
  assert.equal(user.discussionMessageUsage.length, 1);
  assert.equal(persisted.replyCount, 1);
  assert.equal(persisted.recentMessages.length, 1);
});

test("ten-minute discussion quota rejects the thirty-first message", async () => {
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_MSG031",
  });
  const now = Date.now();
  await createUser(1, {
    activeDiscussionId: discussion._id,
    discussionMembershipIds: [discussion._id],
    discussionMessageUsage: Array.from(
      { length: DISCUSSION_MESSAGE_LIMIT },
      (_, index) => new Date(now - 2000 - index),
    ),
  });

  const result = await addRecentMessage({
    discussionId: discussion._id,
    senderUserId: 1,
    senderDisplayName: "Sender",
    text: "message-31",
  });
  const [user, persisted] = await Promise.all([
    User.findOne({ userId: 1 }).lean(),
    Discussion.findById(discussion._id).lean(),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "message_rate_limit");
  assert.equal(user.discussionMessageUsage.length, DISCUSSION_MESSAGE_LIMIT);
  assert.ok(user.discussionMessageUsage.every(
    (usedAt) => usedAt.getTime() > now - DISCUSSION_MESSAGE_WINDOW_MS,
  ));
  assert.equal(persisted.replyCount, 0);
  assert.equal(persisted.recentMessages.length, 0);
});

test("accepted discussion messages retain only the latest ten", async () => {
  const oldMessages = Array.from({ length: 10 }, (_, index) => ({
    senderUserId: 1,
    senderDisplayName: "Sender",
    text: `old-message-${index + 1}`,
    sentAt: new Date(Date.now() - 10000 + index),
  }));
  const discussion = await createOpenDiscussion(1, {
    publicDiscussionCode: "d_MSGCAP",
    memberUserIds: [1, 2],
    recentMessages: oldMessages,
  });
  await Promise.all([
    createUser(1, {
      activeDiscussionId: discussion._id,
      discussionMembershipIds: [discussion._id],
    }),
    createUser(2, {
      activeDiscussionId: discussion._id,
      discussionMembershipIds: [discussion._id],
    }),
  ]);

  const result = await addRecentMessage({
    discussionId: discussion._id,
    senderUserId: 1,
    senderDisplayName: "Sender",
    text: "newest-message",
  });
  const persisted = await Discussion.findById(discussion._id).lean();

  assert.equal(result.ok, true);
  assert.deepEqual(result.recipients, [2]);
  assert.equal(persisted.recentMessages.length, 10);
  assert.equal(persisted.recentMessages[0].text, "old-message-2");
  assert.equal(persisted.recentMessages[9].text, "newest-message");
});
