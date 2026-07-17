const test = require("node:test");
const assert = require("node:assert/strict");

const { EVENT_NAMES, sanitizeMetadata } = require("../src/services/analytics-events");

test("analytics metadata keeps only small safe fields", () => {
  assert.deepEqual(
    sanitizeMetadata({
      section: "music",
      count: 4,
      joinRuleType: "taste_label",
      userText: "do not store this",
      title: "do not store item titles",
      reason: "ok",
      destination: "favorites",
      tipKey: "people",
    }),
    {
      count: 4,
      joinRuleType: "taste_label",
      reason: "ok",
      destination: "favorites",
      tipKey: "people",
    },
  );
});

test("guided-journey analytics use fixed privacy-light event names", () => {
  assert.deepEqual({
    onboardingStarted: EVENT_NAMES.onboardingStarted,
    onboardingDestinationChosen: EVENT_NAMES.onboardingDestinationChosen,
    sectionTipExposed: EVENT_NAMES.sectionTipExposed,
    starterInvitationPrepared: EVENT_NAMES.starterInvitationPrepared,
    starterInvitationOpened: EVENT_NAMES.starterInvitationOpened,
  }, {
    onboardingStarted: "onboarding_started",
    onboardingDestinationChosen: "onboarding_destination_chosen",
    sectionTipExposed: "section_tip_exposed",
    starterInvitationPrepared: "starter_invitation_prepared",
    starterInvitationOpened: "starter_invitation_opened",
  });
});
