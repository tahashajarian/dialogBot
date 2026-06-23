const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  buildStarRewardNotice,
  buildStarsOverviewText,
  formatStarNumber,
} = require("../src/services/stars-ui");

test("Stars overview uses live settings and private balance", () => {
  const text = buildStarsOverviewText(messages, "en", { starBalance: 18 }, {
    rewardRegularListPerSection: 2,
    rewardFirstThreePerSection: 3,
    rewardFullTopTenPerSection: 7,
    rewardProfileCompletion: 5,
    rewardFirstDiscussion: 3,
    rewardFirstDiscussionJoin: 2,
    rewardSavedInvitePair: 1,
    rewardExternalReferral: 10,
    discussionBoostCost: 12,
    paidSuggestionCost: 1,
    peopleTasteMatchesCost: 4,
    peopleTasteMatchesDurationHours: 48,
  });
  assert.match(text, /Balance: 18/);
  assert.match(text, /Extra suggestion after the free limit: 1 Star/);
  assert.match(text, /Boost one discussion: 12 Stars/);
  assert.match(text, /Probably similar people: 4 Stars for 48 hours/);
  assert.match(text, /Advanced Search is not available yet/);
});

test("Star numbers are localized for Persian", () => {
  assert.equal(formatStarNumber(1234, "fa"), "۱٬۲۳۴");
  assert.equal(formatStarNumber(-5, "en"), "0");
});

test("Star reward notice combines balance and one next milestone", () => {
  const text = buildStarRewardNotice(messages, "en", [{
    milestone: "topten_first_milestone",
    amount: 3,
    balance: 8,
  }], {
    milestone: "topten_completed",
    remaining: 7,
    reward: 7,
  });
  assert.match(text, /earned 3 Stars/);
  assert.match(text, /Balance: 8/);
  assert.match(text, /Add 7 more/);
});
