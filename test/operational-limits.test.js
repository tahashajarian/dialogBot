const test = require("node:test");
const assert = require("node:assert/strict");
const messages = require("../src/messages");
const { operationalLimits, normalizeLimits } = require("../src/services/operational-limits");
const { formatOperationalLimitsText } = require("../src/services/operational-limits-ui");

test("limit messages use the startup-loaded values", () => {
  const original = { ...operationalLimits };
  Object.assign(operationalLimits, {
    aiTopTenItems: 12,
    aiWatchlistItems: 150,
    savedProfiles: 75,
    aiSuggestionsPerWindow: 7,
    aiSuggestionWindowMinutes: 90,
    activeOwnedDiscussions: 4,
    discussionMessagesPerWindow: 45,
    discussionMessageWindowMinutes: 15,
    directInvitationsPerWindow: 5,
    directInvitationWindowHours: 48,
  });

  try {
    const suggestion = formatOperationalLimitsText(messages.en.aiSuggestionHourlyLimit, { minutes: 37 });
    assert.match(suggestion, /7 per 90 minutes/);
    assert.match(suggestion, /about 37 minutes/);

    const rules = formatOperationalLimitsText(messages.en.helpRulesText);
    assert.match(rules, /Top 10: 12 items; regular list: 150 items; saved profiles: 75/);
    assert.match(rules, /45 messages per 15 minutes/);
    assert.match(rules, /In-bot saved-profile invitations: 5 per 48 hours/);
  } finally {
    Object.assign(operationalLimits, original);
  }
});

test("interest onboarding/profile limits normalize impossible admin values", () => {
  const normalized = normalizeLimits({
    profileInterestItems: 4,
    onboardingInterestMinItems: 6,
    onboardingInterestMaxItems: 9,
    profileInterestCustomMaxLength: 1,
    onboardingCustomInterestMaxLength: 200,
  });

  assert.equal(normalized.profileInterestItems, 4);
  assert.equal(normalized.onboardingInterestMaxItems, 4);
  assert.equal(normalized.onboardingInterestMinItems, 4);
  assert.equal(normalized.profileInterestCustomMaxLength, 3);
  assert.equal(normalized.onboardingCustomInterestMaxLength, 120);
});
