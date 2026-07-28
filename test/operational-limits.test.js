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
    ownedDiscussionHardLimit: 13,
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
    assert.match(rules, /Favorites per section: 12; For Later list: 150; saved profiles: 75/);
    assert.match(rules, /new user adds \d+ Interests/);
    assert.match(rules, /You can create 4 open discussions; with \d+ Stars, each additional one can be unlocked, up to 13 total/);
    assert.match(rules, /Discussion messages: 45 per 15 minutes/);
    assert.match(rules, /in-bot saved-profile invitations: 5 per 48 hours/);
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

test("the database-backed overall discussion cap also bounds the free allowance", () => {
  const normalized = normalizeLimits({
    activeOwnedDiscussions: 12,
    ownedDiscussionHardLimit: 7,
  });

  assert.equal(normalized.activeOwnedDiscussions, 7);
  assert.equal(normalized.ownedDiscussionHardLimit, 7);
});

test("People discovery minimum defaults to 2 and respects admin boundaries", () => {
  assert.equal(normalizeLimits({}).peopleDiscoveryMinSharedItems, 2);
  assert.equal(normalizeLimits({ peopleDiscoveryMinSharedItems: 0 }).peopleDiscoveryMinSharedItems, 1);
  assert.equal(normalizeLimits({ peopleDiscoveryMinSharedItems: 999 }).peopleDiscoveryMinSharedItems, 100);
});

test("similar-people inactivity days are configurable from one to ninety days", () => {
  assert.equal(normalizeLimits({}).similarPeopleReengagementEnabled, false);
  assert.equal(
    normalizeLimits({ similarPeopleReengagementEnabled: "true" }).similarPeopleReengagementEnabled,
    true,
  );
  assert.equal(normalizeLimits({}).similarPeopleReengagementRolloutPercent, 10);
  assert.equal(
    normalizeLimits({ similarPeopleReengagementRolloutPercent: 0 }).similarPeopleReengagementRolloutPercent,
    1,
  );
  assert.equal(
    normalizeLimits({ similarPeopleReengagementRolloutPercent: 120 }).similarPeopleReengagementRolloutPercent,
    100,
  );
  assert.equal(normalizeLimits({}).similarPeopleInactiveDays, 3);
  assert.equal(normalizeLimits({ similarPeopleInactiveDays: 0 }).similarPeopleInactiveDays, 1);
  assert.equal(normalizeLimits({ similarPeopleInactiveDays: 120 }).similarPeopleInactiveDays, 90);
  assert.equal(normalizeLimits({}).similarPeopleNotificationCooldownDays, 3);
  assert.equal(
    normalizeLimits({ similarPeopleNotificationCooldownDays: 0 }).similarPeopleNotificationCooldownDays,
    1,
  );
  assert.equal(
    normalizeLimits({ similarPeopleNotificationCooldownDays: 120 }).similarPeopleNotificationCooldownDays,
    90,
  );
});
