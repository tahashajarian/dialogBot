const AppSetting = require("../models/app-setting");
const AppSettingAudit = require("../models/app-setting-audit");
const { operationalLimits } = require("./operational-limits");

const SETTINGS_KEY = "star-economy";

const STAR_SETTING_DEFINITIONS = Object.freeze({
  economyEnabled: {
    label: "Economy enabled", description: "Master switch for user-facing Star operations.", group: "Rollout", type: "boolean", default: true,
  },
  earningEnabled: {
    label: "Earning enabled", description: "Allow new milestone and invitation rewards.", group: "Rollout", type: "boolean", default: true,
  },
  spendingEnabled: {
    label: "Spending enabled", description: "Allow user-initiated Star spending.", group: "Rollout", type: "boolean", default: false,
  },
  boostEnabled: {
    label: "Discussion boosts enabled", description: "Allow discussion boost purchases and placement.", group: "Rollout", type: "boolean", default: false,
  },
  boostRecommendationsEnabled: {
    label: "Boost recommendations enabled", description: "Allow private delivery of relevant boosted discussions.", group: "Rollout", type: "boolean", default: false,
  },
  peopleTasteMatchesEnabled: {
    label: "Closer-taste people unlock", description: "Allow users to spend Stars on time-limited people discovery with 3+ shared items.", group: "Rollout", type: "boolean", default: false,
  },
  paidSuggestionsEnabled: {
    label: "Paid extra suggestions", description: "Allow users to spend Stars for one extra AI suggestion after the free limit.", group: "Rollout", type: "boolean", default: false,
  },
  advancedSearchPreviewEnabled: {
    label: "Advanced Search preview", description: "Show the honest coming-soon preview in People.", group: "Rollout", type: "boolean", default: true,
  },
  advancedSearchNotifyEnabled: {
    label: "Advanced Search notify signup", description: "Allow users to request a future launch notification.", group: "Rollout", type: "boolean", default: true,
  },
  advancedSearchPurchaseEnabled: {
    label: "Advanced Search purchase", description: "Reserved for the future reviewed filter product.", group: "Rollout", type: "boolean", default: false,
  },

  rewardRegularListPerSection: {
    label: "Regular-list milestone reward", description: "Stars awarded once per section at the regular-list milestone.", group: "Rewards", type: "number", unit: "Stars", default: 2, min: 0, max: 1000,
  },
  rewardFirstThreePerSection: {
    label: "First TopTen milestone reward", description: "Stars awarded once per section at the first TopTen milestone.", group: "Rewards", type: "number", unit: "Stars", default: 3, min: 0, max: 1000,
  },
  rewardFullTopTenPerSection: {
    label: "Full TopTen reward", description: "Additional Stars awarded once per completed TopTen section.", group: "Rewards", type: "number", unit: "Stars", default: 7, min: 0, max: 1000,
  },
  rewardProfileCompletion: {
    label: "Profile completion reward", description: "One-time privacy-safe profile milestone reward.", group: "Rewards", type: "number", unit: "Stars", default: 5, min: 0, max: 1000,
  },
  rewardFirstDiscussion: {
    label: "First discussion creation reward", description: "One-time reward after a user's first valid discussion is created.", group: "Rewards", type: "number", unit: "Stars", default: 3, min: 0, max: 1000,
  },
  rewardFirstDiscussionJoin: {
    label: "First discussion join reward", description: "One-time reward after a user's first successful discussion join.", group: "Rewards", type: "number", unit: "Stars", default: 2, min: 0, max: 1000,
  },
  rewardSavedInvitePair: {
    label: "First directed invite-pair reward", description: "Reward after the first successful stored invite for a directed user pair.", group: "Rewards", type: "number", unit: "Stars", default: 1, min: 0, max: 1000,
  },
  rewardExternalReferral: {
    label: "Qualified outside referral reward", description: "Reward when a genuinely new referred user qualifies.", group: "Rewards", type: "number", unit: "Stars", default: 10, min: 0, max: 10000,
  },

  externalReferralLinkExpiryDays: {
    label: "Outside referral link expiry", description: "Days an attributable outside link remains claimable.", group: "Reward limits", type: "number", unit: "days", default: 30, min: 1, max: 3650,
  },
  regularListMilestoneItems: {
    label: "Regular-list milestone", description: "Distinct items needed for the regular-list reward.", group: "Milestones", type: "number", unit: "items", default: 5, min: 1, max: 10000,
  },
  firstTopTenMilestoneItems: {
    label: "First TopTen milestone", description: "Distinct TopTen items needed for the first reward.", group: "Milestones", type: "number", unit: "items", default: 3, min: 1, max: 1000,
  },
  topTenCompletionItems: {
    label: "TopTen completion milestone", description: "TopTen items needed for the completion reward.", group: "Milestones", type: "number", unit: "items", default: 10, min: 1, max: 1000,
  },

  discussionBoostCost: {
    label: "Discussion boost cost", description: "Stars charged for one boost.", group: "Discussion boosts", type: "number", unit: "Stars", default: 10, min: 0, max: 1000000,
  },
  discussionBoostDurationHours: {
    label: "Boost duration", description: "How long an activated boost remains active.", group: "Discussion boosts", type: "number", unit: "hours", default: 24, min: 1, max: 8760,
  },
  discussionBoostCooldownHours: {
    label: "Boost cooldown", description: "Delay before the same creator/discussion can boost again.", group: "Discussion boosts", type: "number", unit: "hours", default: 24, min: 0, max: 8760,
  },
  discussionBoostsPerDiscussion: {
    label: "Active boosts per discussion", description: "Safety invariant; boost stacking is disabled.", group: "Discussion boosts", type: "number", unit: "boosts", default: 1, min: 1, max: 1,
  },
  discussionBoostsPerOwner: {
    label: "Active boosts per creator", description: "Safety invariant; each creator may boost one discussion.", group: "Discussion boosts", type: "number", unit: "boosts", default: 1, min: 1, max: 1,
  },
  discussionBoostedSlotsPerPage: {
    label: "Boosted positions per page", description: "Maximum relevant boosted discussions shown on one result page.", group: "Discussion boosts", type: "number", unit: "positions", default: 1, min: 1, max: 2,
  },
  discussionBoostRecipientCap: {
    label: "Recommendation recipients per boost", description: "Maximum eligible recipients selected for a boost.", group: "Discussion boosts", type: "number", unit: "users", default: 10, min: 0, max: 100000,
  },
  boostRecipientWindowHours: {
    label: "Recipient frequency window", description: "Rolling window for per-user boosted recommendation limits.", group: "Discussion boosts", type: "number", unit: "hours", default: 24, min: 1, max: 8760,
  },
  boostRecommendationsPerRecipientWindow: {
    label: "Recommendations per recipient/window", description: "Maximum boosted recommendations delivered to one user per window.", group: "Discussion boosts", type: "number", unit: "messages", default: 1, min: 0, max: 1000,
  },

  paidTwoPersonDiscussionsEnabled: {
    label: "Paid 2-person discussions", description: "Require Stars for focused 2-person discussion rooms.", group: "Paid discussion capacities", type: "boolean", default: true,
  },
  paidTwoPersonDiscussionCost: {
    label: "2-person discussion cost", description: "Stars charged when creating a 2-person discussion.", group: "Paid discussion capacities", type: "number", unit: "Stars", default: 3, min: 0, max: 1000000,
  },
  paidLargeDiscussionsEnabled: {
    label: "Paid large discussions", description: "Allow a larger paid room capacity.", group: "Paid discussion capacities", type: "boolean", default: true,
  },
  paidLargeDiscussionCapacity: {
    label: "Large discussion capacity", description: "Member cap offered as a paid large room.", group: "Paid discussion capacities", type: "number", unit: "members", default: 50, min: 21, max: 10000,
  },
  paidLargeDiscussionCost: {
    label: "Large discussion cost", description: "Stars charged when creating the large paid-capacity discussion.", group: "Paid discussion capacities", type: "number", unit: "Stars", default: 10, min: 0, max: 1000000,
  },

  peopleTasteMatchesCost: {
    label: "Closer-taste people cost", description: "Stars charged to unlock people with 3+ shared items.", group: "People discovery", type: "number", unit: "Stars", default: 5, min: 0, max: 1000000,
  },
  peopleTasteMatchesDurationHours: {
    label: "Closer-taste people duration", description: "How long the closer-taste people view stays unlocked after purchase.", group: "People discovery", type: "number", unit: "hours", default: 24, min: 1, max: 8760,
  },

  paidSuggestionCost: {
    label: "Extra suggestion cost", description: "Stars charged for one extra AI suggestion after the free limit.", group: "AI suggestions", type: "number", unit: "Stars", default: 1, min: 0, max: 1000000,
  },
  profileEmojiCost: {
    label: "Profile emoji cost", description: "Stars charged to choose a curated cosmetic profile emoji.", group: "Profile cosmetics", type: "number", unit: "Stars", default: 3, min: 0, max: 1000000,
  },

  advancedSearchCost: {
    label: "Future Advanced Search cost", description: "Inactive until the filter product receives a separate safety approval.", group: "Future Advanced Search", type: "number", unit: "Stars", default: 5, min: 0, max: 1000000,
  },
  advancedSearchDurationHours: {
    label: "Future Advanced Search duration", description: "Inactive future entitlement duration.", group: "Future Advanced Search", type: "number", unit: "hours", default: 24, min: 1, max: 8760,
  },
});

const starEconomy = Object.fromEntries(
  Object.entries(STAR_SETTING_DEFINITIONS).map(([key, definition]) => [key, definition.default]),
);
let settingsLoaded = false;
let loadPromise = null;
let settingsUpdatedAt = null;

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  if (["false", "0", "off", "no", ""].includes(normalized)) return false;
  return fallback;
}

function normalizeStarSettings(values = {}) {
  const normalized = Object.fromEntries(Object.entries(STAR_SETTING_DEFINITIONS).map(([key, definition]) => {
    if (definition.type === "boolean") {
      return [key, normalizeBoolean(values[key], definition.default)];
    }
    const parsed = Number(values[key]);
    const value = Number.isFinite(parsed) ? Math.round(parsed) : definition.default;
    return [key, Math.min(definition.max, Math.max(definition.min, value))];
  }));

  normalized.regularListMilestoneItems = Math.min(
    normalized.regularListMilestoneItems,
    operationalLimits.aiWatchlistItems,
  );
  normalized.firstTopTenMilestoneItems = Math.min(
    normalized.firstTopTenMilestoneItems,
    operationalLimits.aiTopTenItems,
  );
  normalized.topTenCompletionItems = Math.min(
    operationalLimits.aiTopTenItems,
    Math.max(normalized.firstTopTenMilestoneItems, normalized.topTenCompletionItems),
  );
  return normalized;
}

function applyStarSettings(values) {
  Object.assign(starEconomy, normalizeStarSettings(values));
  return starEconomy;
}

function isDiscussionBoostAvailable(settings = starEconomy) {
  return Boolean(settings.economyEnabled && settings.spendingEnabled && settings.boostEnabled);
}

async function refreshStarSettings({ force = false } = {}) {
  if (!force && settingsLoaded) return starEconomy;
  if (loadPromise) return loadPromise;
  loadPromise = AppSetting.findOne({ key: SETTINGS_KEY }).lean()
    .then((setting) => {
      applyStarSettings(setting?.values || {});
      settingsUpdatedAt = setting?.updatedAt || null;
      settingsLoaded = true;
      return starEconomy;
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

async function updateStarSettings(values, { actor = "dashboard" } = {}) {
  const normalized = normalizeStarSettings(values);
  const existing = await AppSetting.findOne({ key: SETTINGS_KEY }).lean();
  const previousValues = normalizeStarSettings(existing?.values || {});
  const updatedAt = new Date();
  await AppSetting.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { values: normalized, updatedAt } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  await AppSettingAudit.create({
    key: SETTINGS_KEY,
    actor: String(actor || "dashboard").slice(0, 120),
    previousValues,
    nextValues: normalized,
  });
  settingsLoaded = true;
  settingsUpdatedAt = updatedAt;
  return { ...applyStarSettings(normalized) };
}

function getStarSettingsState() {
  return {
    values: { ...starEconomy },
    updatedAt: settingsUpdatedAt ? new Date(settingsUpdatedAt).toISOString() : null,
    activationRequiresRestart: true,
  };
}

module.exports = {
  SETTINGS_KEY,
  STAR_SETTING_DEFINITIONS,
  starEconomy,
  isDiscussionBoostAvailable,
  normalizeStarSettings,
  getStarSettingsState,
  refreshStarSettings,
  updateStarSettings,
};
