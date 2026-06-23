const test = require("node:test");
const assert = require("node:assert/strict");

const { operationalLimits } = require("../src/services/operational-limits");
const {
  STAR_SETTING_DEFINITIONS,
  normalizeStarSettings,
} = require("../src/services/star-settings");

test("Star settings expose safe launch defaults", () => {
  const values = normalizeStarSettings({});
  assert.equal(values.economyEnabled, true);
  assert.equal(values.earningEnabled, true);
  assert.equal(values.spendingEnabled, false);
  assert.equal(values.boostEnabled, false);
  assert.equal(values.peopleTasteMatchesEnabled, false);
  assert.equal(values.paidSuggestionsEnabled, false);
  assert.equal(values.advancedSearchPreviewEnabled, true);
  assert.equal(values.discussionBoostCost, 10);
  assert.equal(values.paidSuggestionCost, 1);
  assert.equal(values.profileEmojiCost, 3);
  assert.equal(values.peopleTasteMatchesCost, 5);
  assert.equal(values.peopleTasteMatchesDurationHours, 24);
  assert.equal(values.discussionBoostsPerOwner, 1);
  assert.equal(values.discussionBoostsPerDiscussion, 1);
  assert.equal(values.discussionBoostedSlotsPerPage, 1);
});

test("Star settings normalize form booleans and numeric boundaries", () => {
  const values = normalizeStarSettings({
    economyEnabled: "false",
    earningEnabled: "on",
    rewardProfileCompletion: "-20",
    discussionBoostCost: "99999999",
    paidSuggestionCost: "99999999",
    profileEmojiCost: "99999999",
    peopleTasteMatchesCost: "-1",
    peopleTasteMatchesDurationHours: "99999",
    discussionBoostsPerOwner: "50",
    discussionBoostedSlotsPerPage: "8",
  });
  assert.equal(values.economyEnabled, false);
  assert.equal(values.earningEnabled, true);
  assert.equal(values.rewardProfileCompletion, 0);
  assert.equal(values.discussionBoostCost, STAR_SETTING_DEFINITIONS.discussionBoostCost.max);
  assert.equal(values.paidSuggestionCost, STAR_SETTING_DEFINITIONS.paidSuggestionCost.max);
  assert.equal(values.profileEmojiCost, STAR_SETTING_DEFINITIONS.profileEmojiCost.max);
  assert.equal(values.peopleTasteMatchesCost, 0);
  assert.equal(values.peopleTasteMatchesDurationHours, STAR_SETTING_DEFINITIONS.peopleTasteMatchesDurationHours.max);
  assert.equal(values.discussionBoostsPerOwner, 1);
  assert.equal(values.discussionBoostedSlotsPerPage, 2);
});

test("Star milestone thresholds respect current list limits", () => {
  const original = { ...operationalLimits };
  Object.assign(operationalLimits, { aiTopTenItems: 8, aiWatchlistItems: 4 });
  try {
    const values = normalizeStarSettings({
      regularListMilestoneItems: 50,
      firstTopTenMilestoneItems: 7,
      topTenCompletionItems: 2,
    });
    assert.equal(values.regularListMilestoneItems, 4);
    assert.equal(values.firstTopTenMilestoneItems, 7);
    assert.equal(values.topTenCompletionItems, 7);
  } finally {
    Object.assign(operationalLimits, original);
  }
});
