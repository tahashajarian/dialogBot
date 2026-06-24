const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const DiscussionBoost = require("../src/models/discussion-boost");
const DiscussionBoostDelivery = require("../src/models/discussion-boost-delivery");
const DiscussionInvitationMute = require("../src/models/discussion-invitation-mute");
const User = require("../src/models/user");
const { starEconomy } = require("../src/services/star-settings");
const { generateBoostCode, selectBoostRecipients } = require("../src/services/discussion-boosts");
const {
  buildDiscussionListText,
  rankDiscussionsForDiscovery,
} = require("../src/services/discussion-ui");

test("discussion boost codes and schema are stable", () => {
  assert.match(generateBoostCode(), /^[A-F0-9]{12}$/);
  const boost = new DiscussionBoost({
    publicCode: "A1B2C3D4E5F6",
    discussionId: "507f1f77bcf86cd799439011",
    creatorUserId: 10,
    quotedCost: 10,
    quoteExpiresAt: new Date(Date.now() + 60000),
  });
  assert.equal(boost.validateSync(), undefined);
});

test("relevant active boosts receive only the configured reserved positions", async () => {
  const originalSlots = starEconomy.discussionBoostedSlotsPerPage;
  starEconomy.discussionBoostedSlotsPerPage = 1;
  try {
    const discussions = [
      { _id: "organic", title: "Organic", isJoinable: true, joinRule: { type: "top_ten_item" }, memberUserIds: [], createdAt: new Date() },
      { _id: "boosted", title: "Boosted", isBoosted: true, isJoinable: true, joinRule: { type: "open" }, memberUserIds: [], createdAt: new Date(0) },
      { _id: "locked", title: "Locked Boost", isBoosted: true, isJoinable: false, joinRule: { type: "open" }, memberUserIds: [], createdAt: new Date() },
    ];
    const ranked = await rankDiscussionsForDiscovery({ discussionMembershipIds: [] }, discussions, {
      savedCreatorUserIds: new Set(),
    });
    assert.equal(ranked[0]._id, "boosted");
    assert.notEqual(ranked[0]._id, "locked");
  } finally {
    starEconomy.discussionBoostedSlotsPerPage = originalSlots;
  }
});

test("discussion list labels boosted placement", () => {
  const text = buildDiscussionListText(messages, "en", "Discussions", [{
    _id: "boosted",
    title: "Movie night",
    description: "A room",
    isBoosted: true,
    isJoinable: true,
    joinRule: { type: "open" },
    memberUserIds: [],
    maxMembers: 20,
  }]);
  assert.match(text, /🚀 Boosted/);
});

test("my discussions list exposes Persian boost action when boosts are available", () => {
  const originalSettings = {
    economyEnabled: starEconomy.economyEnabled,
    spendingEnabled: starEconomy.spendingEnabled,
    boostEnabled: starEconomy.boostEnabled,
  };
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    boostEnabled: true,
  });
  try {
    const text = buildDiscussionListText(messages, "fa", "بحث‌های من", [{
      _id: "owned",
      title: "شب فیلم",
      description: "یک بحث",
      isJoinable: true,
      listAction: "close",
      publicDiscussionCode: "d_AB12",
      joinRule: { type: "open" },
      memberUserIds: [],
      maxMembers: 20,
    }]);
    assert.match(text, /ارتقا/);
    assert.match(text, /\/boost_AB12/);
  } finally {
    Object.assign(starEconomy, originalSettings);
  }
});

test("my discussions list hides boost action when spending is disabled", () => {
  const originalSettings = {
    economyEnabled: starEconomy.economyEnabled,
    spendingEnabled: starEconomy.spendingEnabled,
    boostEnabled: starEconomy.boostEnabled,
  };
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: false,
    boostEnabled: true,
  });
  try {
    const text = buildDiscussionListText(messages, "en", "My discussions", [{
      _id: "owned",
      title: "Movie night",
      description: "A room",
      isJoinable: true,
      listAction: "close",
      publicDiscussionCode: "d_AB12",
      joinRule: { type: "open" },
      memberUserIds: [],
      maxMembers: 20,
    }]);
    assert.doesNotMatch(text, /Boost/);
    assert.doesNotMatch(text, /\/boost_AB12/);
  } finally {
    Object.assign(starEconomy, originalSettings);
  }
});

function userWithMusic(userId, items, extra = {}) {
  return {
    userId,
    publicProfileCode: `u_${userId}`,
    firstName: `User ${userId}`,
    profileName: `User ${userId}`,
    aiLists: {
      music: {
        topTen: items.map((title) => ({ title })),
        watchlist: [],
      },
    },
    ...extra,
  };
}

function chainLean(value) {
  return {
    select: () => ({
      lean: async () => value,
    }),
  };
}

test("boost recipient selection batches mute and delivery checks", async () => {
  const originalSettings = {
    boostRecommendationsEnabled: starEconomy.boostRecommendationsEnabled,
    discussionBoostRecipientCap: starEconomy.discussionBoostRecipientCap,
    boostRecipientWindowHours: starEconomy.boostRecipientWindowHours,
    boostRecommendationsPerRecipientWindow: starEconomy.boostRecommendationsPerRecipientWindow,
  };
  const originals = {
    userFindOne: User.findOne,
    userFind: User.find,
    muteFind: DiscussionInvitationMute.find,
    deliveryDeleteMany: DiscussionBoostDelivery.deleteMany,
    deliveryFind: DiscussionBoostDelivery.find,
    deliveryCountDocuments: DiscussionBoostDelivery.countDocuments,
    deliveryExists: DiscussionBoostDelivery.exists,
  };

  Object.assign(starEconomy, {
    boostRecommendationsEnabled: true,
    discussionBoostRecipientCap: 3,
    boostRecipientWindowHours: 24,
    boostRecommendationsPerRecipientWindow: 1,
  });

  let deliveryFindCalls = 0;
  DiscussionBoostDelivery.deleteMany = async () => ({ deletedCount: 0 });
  DiscussionBoostDelivery.countDocuments = async () => {
    throw new Error("unexpected per-candidate countDocuments");
  };
  DiscussionBoostDelivery.exists = async () => {
    throw new Error("unexpected per-candidate exists");
  };
  DiscussionInvitationMute.find = () => chainLean([{ muterUserId: 3, mutedUserId: 1 }]);
  DiscussionBoostDelivery.find = (query) => {
    deliveryFindCalls += 1;
    if (query.discussionId) return chainLean([{ recipientUserId: 5 }]);
    return chainLean([{ recipientUserId: 4 }]);
  };
  User.findOne = () => ({
    lean: async () => userWithMusic(1, ["metallica", "nirvana", "queen"]),
  });
  User.find = () => ({
    limit: () => ({
      lean: async () => [
        userWithMusic(2, ["metallica", "nirvana", "queen"]),
        userWithMusic(3, ["metallica", "nirvana", "queen"]),
        userWithMusic(4, ["metallica", "nirvana", "queen"]),
        userWithMusic(5, ["metallica", "nirvana", "queen"]),
        userWithMusic(6, ["radiohead", "blur", "pulp"]),
      ],
    }),
  });

  try {
    const recipients = await selectBoostRecipients(
      { _id: "boost1", creatorUserId: 1 },
      { _id: "discussion1", memberUserIds: [1], joinRule: { type: "open" } },
      { now: new Date("2026-06-24T00:00:00.000Z") },
    );

    assert.deepEqual(recipients.map(({ user }) => user.userId), [2]);
    assert.equal(deliveryFindCalls, 2);
  } finally {
    Object.assign(starEconomy, originalSettings);
    User.findOne = originals.userFindOne;
    User.find = originals.userFind;
    DiscussionInvitationMute.find = originals.muteFind;
    DiscussionBoostDelivery.deleteMany = originals.deliveryDeleteMany;
    DiscussionBoostDelivery.find = originals.deliveryFind;
    DiscussionBoostDelivery.countDocuments = originals.deliveryCountDocuments;
    DiscussionBoostDelivery.exists = originals.deliveryExists;
  }
});
