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
    profileEmojiCost: 3,
    peopleTasteMatchesCost: 4,
    peopleTasteMatchesDurationHours: 48,
  });
  assert.match(text, /Balance: 18/);
  assert.match(text, /Profile emoji: 3 Stars/);
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
    section: "music",
    listType: "topTen",
  }], {
    milestone: "topten_completed",
    section: "music",
    listType: "topTen",
    remaining: 7,
    reward: 7,
  });
  assert.match(text, /earned 3 Stars/);
  assert.match(text, /Music Top 10/);
  assert.match(text, /Balance: 8/);
  assert.match(text, /Add 7 more to complete your Music Top 10/);
});

test("Star progress names regular lists by section", () => {
  const fa = buildStarRewardNotice(messages, "fa", [], {
    milestone: "regular_list_milestone",
    section: "movies",
    listType: "watchlist",
    remaining: 1,
    reward: 2,
  }, { alwaysShowProgress: true });
  const en = buildStarRewardNotice(messages, "en", [], {
    milestone: "regular_list_milestone",
    section: "music",
    listType: "watchlist",
    remaining: 1,
    reward: 2,
  }, { alwaysShowProgress: true });

  assert.match(fa, /واچ‌لیست فیلم‌ها/);
  assert.match(en, /Music playlist/);
});

test("invite Star reward notice uses a natural accepted-invite sentence", () => {
  const fa = buildStarRewardNotice(messages, "fa", [{
    milestone: "invite_pair_reward",
    amount: 1,
    balance: 4,
  }]);
  const en = buildStarRewardNotice(messages, "en", [{
    milestone: "invite_pair_reward",
    amount: 1,
    balance: 4,
  }]);

  assert.equal(fa, "👩‍🦳⭐ یک نفر با دعوت تو وارد بحث شد؛ ۱ ستاره گرفتی.\nستاره‌ها: ۴");
  assert.equal(en, "👩‍🦳⭐ Someone joined a discussion through your invite; you earned 1 Stars.\nBalance: 4");
});
