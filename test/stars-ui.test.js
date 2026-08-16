const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const {
  buildStarRewardNotice,
  buildStarsOverviewText,
  formatStarNumber,
} = require("../src/services/stars-ui");
const { operationalLimits } = require("../src/services/operational-limits");

test("Stars overview uses live settings and a self-only balance", () => {
  const previousHardLimit = operationalLimits.ownedDiscussionHardLimit;
  operationalLimits.ownedDiscussionHardLimit = 3;
  const text = buildStarsOverviewText(messages, "en", { starBalance: 18 }, {
    firstTopTenMilestoneItems: 4,
    topTenCompletionItems: 9,
    rewardFirstThreePerSection: 3,
    rewardFullTopTenPerSection: 7,
    rewardProfileCompletion: 5,
    rewardFirstDiscussion: 3,
    rewardFirstDiscussionJoin: 2,
    rewardSavedInvitePair: 1,
    rewardExternalReferral: 10,
    discussionBoostCost: 12,
    paidSuggestionCost: 1,
    tasteLabelRecheckCost: 10,
    profileEmojiCost: 3,
    paidTwoPersonDiscussionCost: 6,
    paidLargeDiscussionCapacity: 40,
    paidLargeDiscussionCost: 14,
    paidExtraDiscussionCost: 8,
  });
  assert.match(text, /Balance: 18/);
  assert.match(text, /Watch Later, Listen Later, and Read Later lists do not award Stars/);
  assert.doesNotMatch(text, /Watchlists|playlists|reading lists are free/);
  assert.doesNotMatch(text, /Build the first/);
  operationalLimits.ownedDiscussionHardLimit = previousHardLimit;
  assert.match(text, /Profile emoji activation: 3 Stars; later changes need no Stars/);
  assert.match(text, /Extra suggestion: 1 Star/);
  assert.match(text, /Taste-label recheck: 10 Stars/);
  assert.match(text, /Discussion boost: 12 Stars/);
  assert.match(text, /Open discussions owned without Stars: 1; each additional one activates with 8 Stars \(up to 3 total\)/);
  assert.match(text, /First 4 favorites in each of Movies, Series, Music, and Books: 3/);
  assert.match(text, /All 9 favorites in each of Movies, Series, Music, and Books: 7/);
  assert.doesNotMatch(text, /Top 10/);
  assert.match(text, /2-person discussion: 6 Stars/);
  assert.match(text, /40-person discussion: 14 Stars/);
  assert.doesNotMatch(text, /Probably similar people/);
  assert.match(text, /Advanced Search is not available yet/);
});

test("Star numbers are localized for Persian", () => {
  assert.equal(formatStarNumber(1234, "fa"), "۱٬۲۳۴");
  assert.equal(formatStarNumber(-5, "en"), "0");
});

test("Persian Star copy uses required-Star language instead of transactional wording", () => {
  const persianCopy = Object.values(messages.fa)
    .filter((value) => typeof value === "string")
    .join("\n");

  assert.doesNotMatch(persianCopy, /هزینه|خرج|پرداخت|رایگان/);
  assert.match(messages.fa.discussionExtraSlotConfirmText, /ستاره موردنیاز: \{cost\}/);
  assert.match(messages.fa.discussionPaidCapacityConfirmText, /ستاره موردنیاز: \{cost\}/);
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
  assert.match(text, /music favorites/);
  assert.doesNotMatch(text, /Top 10/);
  assert.match(text, /Balance: 8/);
  assert.match(text, /Add 7 more to complete your music favorites/);
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

  assert.equal(fa, "👩‍🦳⭐ یک نفر با دعوت تو وارد گفت‌وگو شد؛ ۱ ستاره گرفتی.\nستاره‌ها: ۴");
  assert.equal(en, "👩‍🦳⭐ Someone joined a discussion through your invite; you earned 1 Stars.\nBalance: 4");
});
