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
  ["OperationalEvent", OperationalEvent],
  ["PeopleTasteUnlock", PeopleTasteUnlock],
  ["PendingInlineList", PendingInlineList],
  ["StarReferralClaim", StarReferralClaim],
  ["StarReferralLink", StarReferralLink],
  ["StarTransaction", StarTransaction],
  ["User", User],
  ["UserTasteIndex", UserTasteIndex],
];

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required to create indexes.");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "bot",
  });

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
    models: created,
  }, null, 2));

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("MongoDB index creation failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
