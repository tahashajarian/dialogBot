require("dotenv").config();

const mongoose = require("mongoose");
const AccountDeletion = require("../src/models/account-deletion");
const AiPaidSuggestion = require("../src/models/ai-paid-suggestion");
const AnalyticsEvent = require("../src/models/analytics-event");
const AppSetting = require("../src/models/app-setting");
const AppSettingAudit = require("../src/models/app-setting-audit");
const Discussion = require("../src/models/discussion");
const DiscussionBoost = require("../src/models/discussion-boost");
const DiscussionBoostDelivery = require("../src/models/discussion-boost-delivery");
const DiscussionInvitation = require("../src/models/discussion-invitation");
const DiscussionInvitationMute = require("../src/models/discussion-invitation-mute");
const DiscussionOwnerJoinNotice = require("../src/models/discussion-owner-join-notice");
const ModerationAction = require("../src/models/moderation-action");
const OperationalEvent = require("../src/models/operational-event");
const PeopleTasteUnlock = require("../src/models/people-taste-unlock");
const PendingInlineList = require("../src/models/pending-inline-list");
const StarReferralClaim = require("../src/models/star-referral-claim");
const StarReferralLink = require("../src/models/star-referral-link");
const StarTransaction = require("../src/models/star-transaction");
const User = require("../src/models/user");
const UserTasteIndex = require("../src/models/user-taste-index");

const MODELS = [
  ["AccountDeletion", AccountDeletion],
  ["AiPaidSuggestion", AiPaidSuggestion],
  ["AnalyticsEvent", AnalyticsEvent],
  ["AppSetting", AppSetting],
  ["AppSettingAudit", AppSettingAudit],
  ["Discussion", Discussion],
  ["DiscussionBoost", DiscussionBoost],
  ["DiscussionBoostDelivery", DiscussionBoostDelivery],
  ["DiscussionInvitation", DiscussionInvitation],
  ["DiscussionInvitationMute", DiscussionInvitationMute],
  ["DiscussionOwnerJoinNotice", DiscussionOwnerJoinNotice],
  ["ModerationAction", ModerationAction],
  ["OperationalEvent", OperationalEvent],
  ["PeopleTasteUnlock", PeopleTasteUnlock],
  ["PendingInlineList", PendingInlineList],
  ["StarReferralClaim", StarReferralClaim],
  ["StarReferralLink", StarReferralLink],
  ["StarTransaction", StarTransaction],
  ["User", User],
  ["UserTasteIndex", UserTasteIndex],
];

async function reconcilePendingInlineListTtlIndex(model = PendingInlineList) {
  let indexes;
  try {
    indexes = await model.collection.listIndexes().toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") return false;
    throw error;
  }

  const existing = indexes.find((index) => index.name === "expiresAt_1");
  if (!existing || existing.expireAfterSeconds === 0) return false;
  if (existing.key?.expiresAt !== 1 || Object.keys(existing.key).length !== 1) {
    throw new Error("PendingInlineList expiresAt_1 has an unexpected key definition.");
  }

  await model.db.db.command({
    collMod: model.collection.name,
    index: { name: "expiresAt_1", expireAfterSeconds: 0 },
  });
  return true;
}

async function reconcileNearbyPeopleLocationIndex(model = User) {
  let indexes;
  try {
    indexes = await model.collection.listIndexes().toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") return false;
    throw error;
  }

  const existing = indexes.find((index) => index.name === "nearby_people_location");
  const expectedFilter = { "location.point.type": "Point" };
  if (!existing || JSON.stringify(existing.partialFilterExpression) === JSON.stringify(expectedFilter)) return false;
  if (existing.key?.["location.point"] !== "2dsphere" || Object.keys(existing.key).length !== 1) {
    throw new Error("nearby_people_location has an unexpected key definition.");
  }

  await model.collection.dropIndex("nearby_people_location");
  await model.collection.createIndex(
    { "location.point": "2dsphere" },
    { name: "nearby_people_location", partialFilterExpression: expectedFilter },
  );
  return true;
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required to create indexes.");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "bot",
  });

  const repairedPendingInlineListTtl = await reconcilePendingInlineListTtlIndex();
  const repairedNearbyPeopleLocation = await reconcileNearbyPeopleLocationIndex();
  const created = [];
  for (const [name, model] of MODELS) {
    await model.createIndexes();
    created.push({
      model: name,
      collection: model.collection.name,
      indexes: model.schema.indexes().length,
    });
  }

  console.log("MongoDB indexes ensured:");
  console.log(JSON.stringify({
    dbName: mongoose.connection.name,
    repairedPendingInlineListTtl,
    repairedNearbyPeopleLocation,
    models: created,
  }, null, 2));

  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error("MongoDB index creation failed:", error?.message || error);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  });
}

module.exports = {
  reconcileNearbyPeopleLocationIndex,
  reconcilePendingInlineListTtlIndex,
};
