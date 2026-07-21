const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const DiscussionBoost = require("../src/models/discussion-boost");
const DiscussionBoostDelivery = require("../src/models/discussion-boost-delivery");
const DiscussionInvitationMute = require("../src/models/discussion-invitation-mute");
const User = require("../src/models/user");
const { starEconomy } = require("../src/services/star-settings");
const Discussion = require("../src/models/discussion");
const { generateBoostCode, getBoostEligibility, selectBoostRecipients } = require("../src/services/discussion-boosts");
const { callBacks } = require("../src/constants");
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
  const indexNames = DiscussionBoost.schema.indexes().map(([, options]) => options.name).filter(Boolean);
  assert.ok(indexNames.includes("one_active_boost_per_discussion"));
  assert.equal(indexNames.includes("one_active_boost_per_creator"), false);
});

test("boosts receive reserved positions only within their relevance tier", async () => {
  const originalSlots = starEconomy.discussionBoostedSlotsPerPage;
  starEconomy.discussionBoostedSlotsPerPage = 1;
  try {
    const discussions = [
      { _id: "organic", title: "Organic", isJoinable: true, joinRule: { type: "top_ten_item", section: "movies", itemTitle: "Arrival" }, memberUserIds: [], createdAt: new Date() },
      { _id: "boosted", title: "Boosted", isBoosted: true, isJoinable: true, joinRule: { type: "open" }, memberUserIds: [], createdAt: new Date(0) },
      { _id: "locked", title: "Locked Boost", isBoosted: true, isJoinable: false, joinRule: { type: "open" }, memberUserIds: [], createdAt: new Date() },
    ];
    const ranked = await rankDiscussionsForDiscovery({ discussionMembershipIds: [] }, discussions, {
      savedCreatorUserIds: new Set(),
    });
    assert.equal(ranked[0]._id, "organic");
    assert.equal(ranked[1]._id, "boosted");
    assert.notEqual(ranked[0]._id, "locked");
  } finally {
    starEconomy.discussionBoostedSlotsPerPage = originalSlots;
  }
});

test("full discussions cannot be quoted or charged for a boost", async () => {
  const originalFindById = Discussion.findById;
  const originalUpdateMany = DiscussionBoost.updateMany;
  const originalSettings = {
    economyEnabled: starEconomy.economyEnabled,
    spendingEnabled: starEconomy.spendingEnabled,
    boostEnabled: starEconomy.boostEnabled,
  };
  Object.assign(starEconomy, { economyEnabled: true, spendingEnabled: true, boostEnabled: true });
  Discussion.findById = async () => ({
    _id: "full-room",
    status: "open",
    creatorUserId: 10,
    memberUserIds: [10, 11],
    maxMembers: 2,
  });
  DiscussionBoost.updateMany = async () => ({ modifiedCount: 0 });
  try {
    const result = await getBoostEligibility(10, "full-room");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "discussion_full");
  } finally {
    Discussion.findById = originalFindById;
    DiscussionBoost.updateMany = originalUpdateMany;
    Object.assign(starEconomy, originalSettings);
  }
});

test("discussion list puts the boost icon beside the title without a separate label", () => {
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
  assert.match(text, /💬 🚀 Movie night/);
  assert.doesNotMatch(text, /🚀 Boosted/);
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
    const text = buildDiscussionListText(messages, "fa", "گفت‌وگوهای من", [{
      _id: "owned",
      title: "شب فیلم",
      description: "یک گفت‌وگو",
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

test("my discussions list hides boost action for an active boost", () => {
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
    const text = buildDiscussionListText(messages, "en", "My discussions", [
      {
        _id: "boosted-owned",
        title: "Movie night",
        description: "A room",
        isBoosted: true,
        isJoinable: true,
        listAction: "close",
        publicDiscussionCode: "d_AB12",
        joinRule: { type: "open" },
        memberUserIds: [],
        maxMembers: 20,
      },
      {
        _id: "other-owned",
        title: "Book night",
        description: "Another room",
        isBoosted: false,
        isJoinable: true,
        listAction: "close",
        publicDiscussionCode: "d_CD34",
        joinRule: { type: "open" },
        memberUserIds: [],
        maxMembers: 20,
      },
    ]);
    assert.doesNotMatch(text, /\/boost_AB12/);
    assert.match(text, /\/boost_CD34/);
  } finally {
    Object.assign(starEconomy, originalSettings);
  }
});

test("successful room boost removes the boost button from room controls", async () => {
  const boostService = require("../src/services/discussion-boosts");
  const originalConfirmBoost = boostService.confirmBoost;
  const originalSettings = {
    economyEnabled: starEconomy.economyEnabled,
    spendingEnabled: starEconomy.spendingEnabled,
    boostEnabled: starEconomy.boostEnabled,
  };
  const flowPath = require.resolve("../src/flows/discussion-boosts");
  delete require.cache[flowPath];
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    boostEnabled: true,
  });
  boostService.confirmBoost = async () => ({
    ok: true,
    applied: false,
    boost: { quotedCost: 10 },
    discussion: { creatorUserId: 10 },
    spend: { balance: 15 },
  });

  try {
    const { handleDiscussionBoostCallback } = require("../src/flows/discussion-boosts");
    const replies = [];
    const deletedIds = [];
    const ctx = {
      callbackData: `${callBacks.discussionBoostConfirm}room:ABC123`,
      callbackMessageId: 44,
      userId: 10,
      user: { userId: 10, activeDiscussionId: "discussion1", starBalance: 25 },
      answerCb: async () => true,
      reply: async (text, keyboard) => {
        replies.push({ text, keyboard });
        return true;
      },
    };

    await handleDiscussionBoostCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async (callbackCtx) => {
        deletedIds.push(callbackCtx.callbackMessageId);
        return true;
      },
    });

    assert.deepEqual(deletedIds, [44]);
    assert.match(replies[0].text, /Discussion boosted/);
    const labels = (replies[0].keyboard?.reply_markup?.keyboard || []).flat().map((button) => button.text);
    assert.equal(labels.includes(messages.en.discussionBoostButton), false);
    assert.ok(labels.includes(messages.en.discussionLeave));
  } finally {
    boostService.confirmBoost = originalConfirmBoost;
    Object.assign(starEconomy, originalSettings);
    delete require.cache[flowPath];
  }
});

test("room boost acknowledgement restores discussion bottom keyboard", async () => {
  const discussions = require("../src/services/discussions");
  const originalJoinOrOpenDiscussion = discussions.joinOrOpenDiscussion;
  const originalSettings = {
    economyEnabled: starEconomy.economyEnabled,
    spendingEnabled: starEconomy.spendingEnabled,
    boostEnabled: starEconomy.boostEnabled,
  };
  const flowPath = require.resolve("../src/flows/discussion-boosts");
  delete require.cache[flowPath];
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    boostEnabled: true,
  });
  discussions.joinOrOpenDiscussion = async () => ({
    ok: true,
    discussion: {
      _id: "discussion1",
      creatorUserId: 10,
      memberUserIds: [10],
    },
  });

  try {
    const { handleDiscussionBoostCallback } = require("../src/flows/discussion-boosts");
    const replies = [];
    const deletedIds = [];
    const ctx = {
      callbackData: callBacks.discussionBoostAck,
      callbackMessageId: 41,
      userId: 10,
      user: { userId: 10, activeDiscussionId: "discussion1" },
      answerCb: async () => true,
      reply: async (text, keyboard) => {
        replies.push({ text, keyboard });
        return true;
      },
    };

    await handleDiscussionBoostCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async (callbackCtx) => {
        deletedIds.push(callbackCtx.callbackMessageId);
        return true;
      },
    });

    assert.deepEqual(deletedIds, [41]);
    assert.equal(replies[0].text, messages.en.discussionBoostCanceled);
    const labels = (replies[0].keyboard?.reply_markup?.keyboard || []).flat().map((button) => button.text);
    assert.ok(labels.includes(messages.en.discussionBoostButton));
    assert.ok(labels.includes(messages.en.discussionLeave));
  } finally {
    Object.assign(starEconomy, originalSettings);
    discussions.joinOrOpenDiscussion = originalJoinOrOpenDiscussion;
    delete require.cache[flowPath];
  }
});

test("room boost cancel restores keyboard with canceled message", async () => {
  const discussions = require("../src/services/discussions");
  const originalJoinOrOpenDiscussion = discussions.joinOrOpenDiscussion;
  const originalSettings = {
    economyEnabled: starEconomy.economyEnabled,
    spendingEnabled: starEconomy.spendingEnabled,
    boostEnabled: starEconomy.boostEnabled,
  };
  const flowPath = require.resolve("../src/flows/discussion-boosts");
  delete require.cache[flowPath];
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    boostEnabled: true,
  });
  discussions.joinOrOpenDiscussion = async () => ({
    ok: true,
    discussion: {
      _id: "discussion1",
      creatorUserId: 10,
      memberUserIds: [10],
    },
  });

  try {
    const { handleDiscussionBoostCallback } = require("../src/flows/discussion-boosts");
    const replies = [];
    const ctx = {
      callbackData: `${callBacks.discussionBoostCancel}room:ABC123`,
      callbackMessageId: 42,
      userId: 10,
      user: { userId: 10, activeDiscussionId: "discussion1" },
      answerCb: async () => true,
      reply: async (text, keyboard) => {
        replies.push({ text, keyboard });
        return true;
      },
    };

    await handleDiscussionBoostCallback(ctx, "en", {
      deleteCallbackMessageIfPossible: async () => true,
    });

    assert.equal(replies[0].text, messages.en.discussionBoostCanceled);
    const labels = (replies[0].keyboard?.reply_markup?.keyboard || []).flat().map((button) => button.text);
    assert.ok(labels.includes(messages.en.discussionBoostButton));
    assert.ok(labels.includes(messages.en.discussionLeave));
  } finally {
    Object.assign(starEconomy, originalSettings);
    discussions.joinOrOpenDiscussion = originalJoinOrOpenDiscussion;
    delete require.cache[flowPath];
  }
});

test("my discussions boost insufficient balance returns to my discussions acknowledgement", async () => {
  const boostService = require("../src/services/discussion-boosts");
  const originalConfirmBoost = boostService.confirmBoost;
  const flowPath = require.resolve("../src/flows/discussion-boosts");
  delete require.cache[flowPath];
  boostService.confirmBoost = async () => ({
    ok: false,
    reason: "insufficient_balance",
    amount: 10,
    balance: 2,
  });

  try {
    const { handleDiscussionBoostCallback } = require("../src/flows/discussion-boosts");
    const edits = [];
    const ctx = {
      callbackData: `${callBacks.discussionBoostConfirm}mine:ABC123`,
      callbackMessageId: 43,
      userId: 10,
      user: { userId: 10, activeDiscussionId: "discussion1" },
      answerCb: async () => true,
      editMessageText: async (messageId, text, keyboard) => {
        edits.push({ messageId, text, keyboard });
        return true;
      },
      reply: async () => {
        throw new Error("my discussions boost error should edit the confirmation card");
      },
    };

    await handleDiscussionBoostCallback(ctx, "en");

    assert.equal(edits[0].messageId, 43);
    assert.match(edits[0].text, /not have enough Stars/);
    const button = edits[0].keyboard?.reply_markup?.inline_keyboard?.flat()?.[0];
    assert.equal(button?.text, messages.en.acknowledgeButton);
  } finally {
    boostService.confirmBoost = originalConfirmBoost;
    delete require.cache[flowPath];
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
