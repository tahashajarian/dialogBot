const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const DiscussionBoost = require("../src/models/discussion-boost");
const { starEconomy } = require("../src/services/star-settings");
const { generateBoostCode } = require("../src/services/discussion-boosts");
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

test("my discussions list exposes Persian boost action when boosts are enabled", () => {
  const originalEnabled = starEconomy.boostEnabled;
  starEconomy.boostEnabled = true;
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
    starEconomy.boostEnabled = originalEnabled;
  }
});
