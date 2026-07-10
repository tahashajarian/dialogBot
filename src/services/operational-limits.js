const AppSetting = require("../models/app-setting");

const SETTINGS_KEY = "operational-limits";
const CACHE_TTL_MS = 60 * 1000;

const LIMIT_DEFINITIONS = Object.freeze({
  aiTopTenItems: { label: "Top 10 items", group: "Lists and suggestions", default: 10, min: 1, max: 1000 },
  aiWatchlistItems: { label: "Regular list items", group: "Lists and suggestions", default: 100, min: 1, max: 10000 },
  savedProfiles: { label: "Saved profiles", group: "Profiles", default: 50, min: 1, max: 10000 },
  aiSuggestionsPerWindow: { label: "Suggestions per section / window", group: "Lists and suggestions", default: 10, min: 1, max: 10000 },
  aiSuggestionWindowMinutes: { label: "Suggestion window (minutes)", group: "Lists and suggestions", default: 60, min: 1, max: 10080 },
  profileInterestItems: { label: "Profile interests", description: "Maximum interests a user can keep on their profile.", group: "Profile interests", default: 5, min: 1, max: 100 },
  profileInterestCustomMaxLength: { label: "Profile custom interest length", description: "Maximum characters for one typed profile interest.", group: "Profile interests", default: 24, min: 3, max: 120 },
  onboardingInterestMinItems: { label: "Onboarding target interests", description: "Onboarding completes after this many selected interests.", group: "Onboarding", default: 3, min: 1, max: 100 },
  onboardingInterestMaxItems: { label: "Onboarding interest limit", description: "Maximum interests accepted by the onboarding picker.", group: "Onboarding", default: 3, min: 1, max: 100 },
  onboardingCustomInterestMaxLength: { label: "Onboarding custom interest length", description: "Maximum characters for one typed onboarding interest.", group: "Onboarding", default: 24, min: 3, max: 120 },
  activeOwnedDiscussions: { label: "Active discussions created", group: "Discussions", default: 3, min: 1, max: 1000 },
  discussionMessagesPerWindow: { label: "Discussion messages / window", group: "Discussions", default: 30, min: 1, max: 10000 },
  discussionMessageWindowMinutes: { label: "Discussion message window (minutes)", group: "Discussions", default: 10, min: 1, max: 10080 },
  discussionMessageBurstSeconds: { label: "Minimum seconds between messages", group: "Discussions", default: 1, min: 0, max: 3600 },
  discussionMaxMembers: { label: "Maximum members per discussion", group: "Discussions", default: 20, min: 2, max: 10000 },
  directInvitationsPerWindow: { label: "In-bot saved-profile invitations / window", description: "Applies only to stored user-to-user invites inside the bot; public share links are unlimited.", group: "Invitations", default: 3, min: 1, max: 10000 },
  directInvitationWindowHours: { label: "In-bot invitation window (hours)", description: "Rolling window for stored saved-profile invitations only.", group: "Invitations", default: 24, min: 1, max: 8760 },
});

const operationalLimits = Object.fromEntries(
  Object.entries(LIMIT_DEFINITIONS).map(([key, definition]) => [key, definition.default]),
);
let cacheExpiresAt = 0;
let refreshPromise = null;
let limitsUpdatedAt = null;

function normalizeLimits(values = {}) {
  const normalized = Object.fromEntries(Object.entries(LIMIT_DEFINITIONS).map(([key, definition]) => {
    const parsed = Number(values[key]);
    const value = Number.isFinite(parsed) ? Math.round(parsed) : definition.default;
    return [key, Math.min(definition.max, Math.max(definition.min, value))];
  }));
  normalized.onboardingInterestMaxItems = Math.min(
    normalized.profileInterestItems,
    Math.max(normalized.onboardingInterestMinItems, normalized.onboardingInterestMaxItems),
  );
  normalized.onboardingInterestMinItems = Math.min(
    normalized.onboardingInterestMinItems,
    normalized.onboardingInterestMaxItems,
  );
  return normalized;
}

function applyLimits(values) {
  Object.assign(operationalLimits, normalizeLimits(values));
  return operationalLimits;
}

async function refreshOperationalLimits({ force = false } = {}) {
  if (!force && Date.now() < cacheExpiresAt) return operationalLimits;
  if (refreshPromise) return refreshPromise;
  refreshPromise = AppSetting.findOne({ key: SETTINGS_KEY }).lean()
    .then((setting) => {
      applyLimits(setting?.values || {});
      limitsUpdatedAt = setting?.updatedAt || null;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return operationalLimits;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

async function updateOperationalLimits(values) {
  const normalized = normalizeLimits(values);
  const updatedAt = new Date();
  await AppSetting.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { values: normalized, updatedAt } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  limitsUpdatedAt = updatedAt;
  return { ...applyLimits(normalized) };
}

function getOperationalLimitsState() {
  return {
    values: { ...operationalLimits },
    updatedAt: limitsUpdatedAt ? new Date(limitsUpdatedAt).toISOString() : null,
  };
}

module.exports = {
  LIMIT_DEFINITIONS,
  operationalLimits,
  normalizeLimits,
  getOperationalLimitsState,
  refreshOperationalLimits,
  updateOperationalLimits,
};
