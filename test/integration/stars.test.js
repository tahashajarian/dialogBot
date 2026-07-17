const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../../src/models/user");
const Discussion = require("../../src/models/discussion");
const DiscussionBoost = require("../../src/models/discussion-boost");
const StarTransaction = require("../../src/models/star-transaction");
const StarReferralClaim = require("../../src/models/star-referral-claim");
const AccountDeletion = require("../../src/models/account-deletion");
const { confirmBoost, createBoostQuote } = require("../../src/services/discussion-boosts");
const {
  awardListMilestones,
  awardOnboardingCompletionMilestone,
  claimExistingProfileAndListMilestones,
} = require("../../src/services/star-milestones");
const {
  anonymizeReferralClaimInvitees,
  anonymizeStarTransactions,
  claimAccountRestart,
  identityFingerprint,
  prepareDeletion,
} = require("../../src/services/account-deletion");
const { starEconomy } = require("../../src/services/star-settings");
const { createStarsService } = require("../../src/services/stars");
const { addAiListItem } = require("../../src/services/users");
const {
  authorizePaidExtraDiscussion,
  refundPaidExtraDiscussionAuthorization,
} = require("../../src/services/discussion-paid-creation");

const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017";
const MONGODB_TEST_DB = `muze_stars_integration_${process.pid}_${Date.now()}`;
process.env.ACCOUNT_DELETION_SECRET ||= "integration-account-deletion-secret";
test.before(async () => {
  await mongoose.connect(MONGODB_TEST_URI, { dbName: MONGODB_TEST_DB });
  await Promise.all([User.init(), Discussion.init(), DiscussionBoost.init(), StarTransaction.init(), StarReferralClaim.init(), AccountDeletion.init()]);
}, { timeout: 120000 });

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Discussion.deleteMany({}),
    DiscussionBoost.deleteMany({}),
    StarTransaction.deleteMany({}),
    StarReferralClaim.deleteMany({}),
    AccountDeletion.deleteMany({}),
  ]);
});

test("Mongo wallet keeps concurrent reward idempotent", async () => {
  await User.create({ userId: 501, firstName: "Star User" });
  const service = createStarsService({
    settings: { economyEnabled: true, earningEnabled: true, spendingEnabled: true },
  });
  const request = {
    userId: 501,
    amount: 5,
    reason: "integration_reward",
    idempotencyKey: "integration:reward:501",
  };
  const results = await Promise.all([service.earnStars(request), service.earnStars(request)]);
  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal(await StarTransaction.countDocuments({ userId: 501 }), 1);
  assert.equal((await User.findOne({ userId: 501 }).lean()).starBalance, 5);
});

test("Mongo wallet prevents overspending and refunds once", async () => {
  await User.create({ userId: 502, firstName: "Star User", starBalance: 10 });
  await StarTransaction.create({
    userId: 502,
    amount: 10,
    balanceAfter: 10,
    status: "applied",
    bucket: "earned",
    type: "grant",
    reason: "seed",
    idempotencyKey: "integration:seed:502",
  });
  const service = createStarsService({
    settings: { economyEnabled: true, earningEnabled: true, spendingEnabled: true },
  });
  const [first, second] = await Promise.all([
    service.spendStars({ userId: 502, amount: 8, reason: "test_spend", idempotencyKey: "spend:502:a" }),
    service.spendStars({ userId: 502, amount: 8, reason: "test_spend", idempotencyKey: "spend:502:b" }),
  ]);
  const successful = [first, second].find((result) => result.ok);
  assert.ok(successful);
  assert.equal([first, second].filter((result) => result.ok).length, 1);
  const refunds = await Promise.all([
    service.refundStars({ transactionId: successful.transaction._id, idempotencyKey: "refund:502:a" }),
    service.refundStars({ transactionId: successful.transaction._id, idempotencyKey: "refund:502:b" }),
  ]);
  assert.equal(refunds.filter((result) => result.applied).length, 1);
  assert.equal((await User.findOne({ userId: 502 }).lean()).starBalance, 10);
});

test("paid extra discussion authorization charges once and cancellation refunds once", async () => {
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    paidExtraDiscussionsEnabled: true,
    paidExtraDiscussionCost: 5,
  });
  await User.create({ userId: 506, firstName: "Room Owner", starBalance: 8 });
  await StarTransaction.create({
    userId: 506,
    amount: 8,
    balanceAfter: 8,
    status: "applied",
    bucket: "earned",
    type: "grant",
    reason: "seed",
    idempotencyKey: "integration:seed:506",
  });

  const request = {
    userId: 506,
    activeOwnedCount: 3,
    quotedCost: 5,
    idempotencyKey: "discussion-extra-slot:506:card:3:5",
  };
  const first = await authorizePaidExtraDiscussion(request);
  const duplicate = await authorizePaidExtraDiscussion(request);
  const firstRefund = await refundPaidExtraDiscussionAuthorization(506);
  const duplicateRefund = await refundPaidExtraDiscussionAuthorization(506, {
    transactionId: first.transaction._id,
  });
  const user = await User.findOne({ userId: 506 }).lean();

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(first.balance, 3);
  assert.equal(duplicate.balance, 3);
  assert.equal(firstRefund.refunded, true);
  assert.equal(duplicateRefund.applied, false);
  assert.equal(user.starBalance, 8);
  assert.equal(user.discussionDraftPaidOwnedSlotAuthorized, false);
  assert.equal(await StarTransaction.countDocuments({ userId: 506 }), 3);
});

test("concurrent boost confirmations leave one active charge", async () => {
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    boostEnabled: true,
    discussionBoostCost: 10,
    discussionBoostDurationHours: 24,
    discussionBoostCooldownHours: 24,
  });
  await User.create({ userId: 503, firstName: "Boost Owner", starBalance: 20 });
  await StarTransaction.create({
    userId: 503,
    amount: 20,
    balanceAfter: 20,
    status: "applied",
    bucket: "earned",
    type: "grant",
    reason: "seed",
    idempotencyKey: "integration:seed:503",
  });
  const discussion = await Discussion.create({
    title: "Boost concurrency",
    description: "One creator should retain one active boost.",
    publicDiscussionCode: "d_BOOST503",
    creatorUserId: 503,
    memberUserIds: [503],
    status: "open",
    joinRule: { type: "open" },
  });
  const [firstQuote, secondQuote] = await Promise.all([
    createBoostQuote(503, discussion._id),
    createBoostQuote(503, discussion._id),
  ]);
  assert.equal(firstQuote.ok, true);
  assert.equal(secondQuote.ok, true);

  await Promise.all([
    confirmBoost(503, firstQuote.quote.publicCode),
    confirmBoost(503, secondQuote.quote.publicCode),
  ]);

  assert.equal(await DiscussionBoost.countDocuments({ creatorUserId: 503, status: "active" }), 1);
  assert.equal((await User.findOne({ userId: 503 }).lean()).starBalance, 10);
  const ledger = await StarTransaction.aggregate([
    { $match: { userId: 503, status: "applied" } },
    { $group: { _id: null, amount: { $sum: "$amount" } } },
  ]);
  assert.equal(ledger[0].amount, 10);
});

test("opening Stars lazily claims verifiable existing milestones once", async () => {
  Object.assign(starEconomy, { economyEnabled: true, earningEnabled: true });
  const user = await User.create({
    userId: 504,
    firstName: "Existing User",
    profileName: "Existing User",
    bio: "Books, films, and long conversations.",
    city: "Tehran",
    petPreference: "cats",
    aiLists: {
      movies: {
        watchlist: Array.from({ length: 5 }, (_, index) => ({ title: `Watch ${index}` })),
        topTen: Array.from({ length: 10 }, (_, index) => ({ title: `Top ${index}` })),
      },
    },
  });
  const first = await claimExistingProfileAndListMilestones(user);
  const second = await claimExistingProfileAndListMilestones(user);

  assert.equal(first.reduce((sum, reward) => sum + reward.amount, 0), 15);
  assert.equal(second.length, 0);
  assert.equal((await User.findOne({ userId: 504 }).lean()).starBalance, 15);
  assert.equal(await StarTransaction.countDocuments({ userId: 504, status: "applied" }), 3);
});

test("adding the third favorite awards the first Top Ten milestone immediately", async () => {
  Object.assign(starEconomy, {
    economyEnabled: true,
    earningEnabled: true,
    firstTopTenMilestoneItems: 3,
    rewardFirstThreePerSection: 3,
  });
  await User.create({ userId: 505, firstName: "New Favorite User" });

  const first = await addAiListItem(505, "movies", "topTen", { title: "Arrival" }, 10);
  const second = await addAiListItem(505, "movies", "topTen", { title: "Moonlight" }, 10);
  const third = await addAiListItem(505, "movies", "topTen", { title: "Parasite" }, 10);

  assert.deepEqual(first.starRewards, []);
  assert.deepEqual(second.starRewards, []);
  assert.equal(third.starRewards.length, 1);
  assert.equal(third.starRewards[0].milestone, "topten_first_milestone");
  assert.equal(third.starRewards[0].amount, 3);
  assert.equal(third.starRewards[0].balance, 3);
  assert.equal((await User.findOne({ userId: 505 }).lean()).starBalance, 3);
  assert.equal(await StarTransaction.countDocuments({
    userId: 505,
    reason: "topten_first_milestone",
    status: "applied",
  }), 1);
});

test("onboarding awards its configurable reward once without stacking the Interests milestone", async () => {
  Object.assign(starEconomy, {
    economyEnabled: true,
    earningEnabled: true,
    rewardOnboardingCompletion: 10,
    rewardFirstThreePerSection: 3,
  });
  await User.create({ userId: 507, firstName: "Onboarding User" });

  const first = await awardOnboardingCompletionMilestone(507);
  const duplicate = await awardOnboardingCompletionMilestone(507);
  const interests = await awardListMilestones({
    userId: 507,
    section: "random",
    listType: "topTen",
    count: 3,
  });

  assert.equal(first[0].milestone, "onboarding_completed");
  assert.equal(first[0].amount, 10);
  assert.deepEqual(duplicate, []);
  assert.deepEqual(interests.rewards, []);
  assert.equal((await User.findOne({ userId: 507 }).lean()).starBalance, 10);
});

test("anonymized deleted-account ledger keys do not block rewards on a recreated account", async () => {
  Object.assign(starEconomy, {
    economyEnabled: true,
    earningEnabled: true,
    rewardOnboardingCompletion: 5,
  });
  await User.create({ userId: 508, firstName: "First Account" });
  await awardOnboardingCompletionMilestone(508);

  await anonymizeStarTransactions(508, -508);
  await User.deleteOne({ userId: 508 });
  await User.create({ userId: 508, firstName: "Recreated Account" });
  const recreatedReward = await awardOnboardingCompletionMilestone(508);
  const ledger = await StarTransaction.find({}).sort({ createdAt: 1 }).lean();

  assert.equal(recreatedReward[0].amount, 5);
  assert.equal((await User.findOne({ userId: 508 }).lean()).starBalance, 5);
  assert.equal(ledger.length, 2);
  assert.match(ledger[0].idempotencyKey, /^deleted:/);
  assert.equal(ledger[1].idempotencyKey, "milestone:topten-first:508:random");
});

test("repeated account deletion gives referral invitees collision-free tombstones", async () => {
  const referralLinkId = new mongoose.Types.ObjectId();
  await StarReferralClaim.create({
    referralLinkId,
    inviterUserId: 700,
    inviteeUserId: -509,
  });
  await StarReferralClaim.create({
    referralLinkId: new mongoose.Types.ObjectId(),
    inviterUserId: 701,
    inviteeUserId: 509,
  });

  await anonymizeReferralClaimInvitees(509, -509);
  const claims = await StarReferralClaim.find({}).sort({ inviterUserId: 1 }).lean();

  assert.equal(claims.some((claim) => claim.inviteeUserId === 509), false);
  assert.equal(claims.every((claim) => claim.inviteeUserId < 0), true);
  assert.equal(new Set(claims.map((claim) => claim.inviteeUserId)).size, 2);
});

test("an active user resets an older completed deletion even when restart was not recorded", async () => {
  await User.create({ userId: 510, firstName: "Recreated User" });
  await AccountDeletion.create({
    identityFingerprint: identityFingerprint(510),
    tombstoneUserId: -510,
    status: "complete",
    step: "complete",
    completedAt: new Date(),
  });

  const operation = await prepareDeletion(510);

  assert.equal(operation.status, "pending");
  assert.equal(operation.step, "prepared");
});

test("a slash-start recreation can claim the completed deletion lifecycle", async () => {
  await AccountDeletion.create({
    identityFingerprint: identityFingerprint(511),
    tombstoneUserId: -511,
    status: "complete",
    step: "complete",
    completedAt: new Date(),
  });

  const claim = await claimAccountRestart(511);

  assert.ok(claim.restartedAt instanceof Date);
});
