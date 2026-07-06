require("dotenv").config();

const mongoose = require("mongoose");
const AiPaidSuggestion = require("../src/models/ai-paid-suggestion");
const AnalyticsEvent = require("../src/models/analytics-event");
const DiscussionBoost = require("../src/models/discussion-boost");
const DiscussionBoostDelivery = require("../src/models/discussion-boost-delivery");
const DiscussionInvitation = require("../src/models/discussion-invitation");
const DiscussionInvitationMute = require("../src/models/discussion-invitation-mute");
const Discussion = require("../src/models/discussion");
const PeopleTasteUnlock = require("../src/models/people-taste-unlock");
const StarReferralClaim = require("../src/models/star-referral-claim");
const StarReferralLink = require("../src/models/star-referral-link");
const StarTransaction = require("../src/models/star-transaction");
const UserTasteIndex = require("../src/models/user-taste-index");
const User = require("../src/models/user");

function getArgFlag(name) {
  return process.argv.includes(name);
}

const MODELS_TO_CLEAR = [
  ["users", User],
  ["userTasteIndexes", UserTasteIndex],
  ["discussions", Discussion],
  ["discussionInvitations", DiscussionInvitation],
  ["discussionInvitationMutes", DiscussionInvitationMute],
  ["discussionBoosts", DiscussionBoost],
  ["discussionBoostDeliveries", DiscussionBoostDelivery],
  ["peopleTasteUnlocks", PeopleTasteUnlock],
  ["aiPaidSuggestions", AiPaidSuggestion],
  ["starTransactions", StarTransaction],
  ["starReferralClaims", StarReferralClaim],
  ["starReferralLinks", StarReferralLink],
  ["analyticsEvents", AnalyticsEvent],
];

async function summarize() {
  const entries = await Promise.all(
    MODELS_TO_CLEAR.map(async ([name, model]) => [name, await model.countDocuments({})]),
  );
  return Object.fromEntries(entries);
}

async function clear() {
  const entries = await Promise.all(
    MODELS_TO_CLEAR.map(async ([name, model]) => {
      const result = await model.deleteMany({});
      return [name, result.deletedCount || 0];
    }),
  );
  return Object.fromEntries(entries);
}

async function run() {
  const dryRun = getArgFlag("--dry-run");

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "bot",
  });

  if (dryRun) {
    console.log("User/product data cleanup dry-run summary:");
    console.log(JSON.stringify({
      mode: "dry-run",
      preservedCollections: [
        "aiResponseCaches",
        "appSettings",
        "appSettingAudits",
        "operationalEvents",
      ],
      wouldDelete: await summarize(),
    }, null, 2));
  } else {
    console.log("User/product data cleanup summary:");
    console.log(JSON.stringify({
      mode: "apply",
      preservedCollections: [
        "aiResponseCaches",
        "appSettings",
        "appSettingAudits",
        "operationalEvents",
      ],
      deleted: await clear(),
    }, null, 2));
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("User/product data cleanup failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
