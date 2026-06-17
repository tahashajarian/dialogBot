const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../../src/models/user");
const Discussion = require("../../src/models/discussion");
const {
  DISCUSSION_MESSAGE_LIMIT,
  DISCUSSION_MESSAGE_WINDOW_MS,
  addRecentMessage,
  addSavedProfileCode,
  closeDiscussionAsOwner,
  createDiscussion,
  joinOrOpenDiscussion,
  leaveDiscussionAsMember,
  removeMemberAsOwner,
  removeSavedProfileCode,
} = require("../../src/services/discussions");

const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017";
const MONGODB_TEST_DB = `dialogbot_integration_${process.pid}_${Date.now()}`;

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
  if (!MONGODB_TEST_DB.startsWith("dialogbot_integration_")) {
    throw new Error("Refusing to run integration tests against a non-test database.");
  }

  await mongoose.connect(MONGODB_TEST_URI, {
    dbName: MONGODB_TEST_DB,
  });
  await Promise.all([User.init(), Discussion.init()]);
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
  ]);
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

  assert.equal(created.length, 3);
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every((result) => result.reason === "active_owned_limit"));
  assert.equal(discussions.length, 3);
  assert.equal(user.ownedOpenDiscussionIds.length, 3);
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
    recentMessages: oldMessages,
  });
  await createUser(1, {
    activeDiscussionId: discussion._id,
    discussionMembershipIds: [discussion._id],
  });

  const result = await addRecentMessage({
    discussionId: discussion._id,
    senderUserId: 1,
    senderDisplayName: "Sender",
    text: "newest-message",
  });
  const persisted = await Discussion.findById(discussion._id).lean();

  assert.equal(result.ok, true);
  assert.equal(persisted.recentMessages.length, 10);
  assert.equal(persisted.recentMessages[0].text, "old-message-2");
  assert.equal(persisted.recentMessages[9].text, "newest-message");
});
