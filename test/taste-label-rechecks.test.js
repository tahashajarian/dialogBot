const test = require("node:test");
const assert = require("node:assert/strict");

const AiTasteRecheck = require("../src/models/ai-taste-recheck");
const User = require("../src/models/user");
const { starEconomy } = require("../src/services/star-settings");
const {
  completeTasteLabelRecheck,
  createTasteLabelRecheckQuote,
  isTasteLabelRecheckAvailable,
} = require("../src/services/taste-label-rechecks");

function completedUser(count = 10, status = "confirmed") {
  return {
    userId: 42,
    starBalance: 24,
    aiLists: {
      books: {
        topTen: Array.from({ length: count }, (_, index) => ({ title: `Book ${index + 1}` })),
      },
    },
    aiTaste: {
      books: { labelKey: "novel_reader", classificationStatus: status },
    },
  };
}

test("taste-label recheck quote costs 10 Stars and snapshots the completed list", async () => {
  const originalFindOne = User.findOne;
  const originalCreate = AiTasteRecheck.create;
  const originalSettings = { ...starEconomy };
  let created = null;
  User.findOne = async () => completedUser();
  AiTasteRecheck.create = async (value) => {
    created = value;
    return { _id: "quote-1", ...value };
  };
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    tasteLabelRecheckEnabled: true,
    tasteLabelRecheckCost: 10,
  });

  try {
    const result = await createTasteLabelRecheckQuote(42, "books", { now: new Date("2026-01-01T00:00:00Z") });
    assert.equal(result.ok, true);
    assert.equal(result.balance, 24);
    assert.equal(created.quotedCost, 10);
    assert.equal(created.previousLabelKey, "novel_reader");
    assert.equal(created.previousClassificationStatus, "confirmed");
    assert.ok(created.inputFingerprint);
    assert.deepEqual(created.settingsSnapshot, { tasteLabelRecheckCost: 10 });
  } finally {
    User.findOne = originalFindOne;
    AiTasteRecheck.create = originalCreate;
    Object.assign(starEconomy, originalSettings);
  }
});

test("a completed No-label choice can request a paid recheck", async () => {
  const originalFindOne = User.findOne;
  const originalCreate = AiTasteRecheck.create;
  const originalSettings = { ...starEconomy };
  let created = null;
  User.findOne = async () => ({
    ...completedUser(),
    aiTaste: {
      books: {
        labelKey: "",
        classificationStatus: "skipped",
        freeClassificationUsedAt: new Date("2026-01-01T00:00:00Z"),
      },
    },
  });
  AiTasteRecheck.create = async (value) => {
    created = value;
    return { _id: "quote-no-label", ...value };
  };
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    tasteLabelRecheckEnabled: true,
    tasteLabelRecheckCost: 10,
  });

  try {
    const result = await createTasteLabelRecheckQuote(42, "books");
    assert.equal(result.ok, true);
    assert.equal(created.previousLabelKey, "");
    assert.equal(created.previousClassificationStatus, "skipped");
  } finally {
    User.findOne = originalFindOne;
    AiTasteRecheck.create = originalCreate;
    Object.assign(starEconomy, originalSettings);
  }
});

test("completed rechecks persist the ranked shortlist", async () => {
  const originalFindOneAndUpdate = AiTasteRecheck.findOneAndUpdate;
  let update = null;
  AiTasteRecheck.findOneAndUpdate = async (_filter, nextUpdate) => {
    update = nextUpdate;
    return { _id: "quote-1", status: "completed", ...nextUpdate.$set };
  };
  try {
    const labelKeys = ["poetic_soul", "old_soul", "novel_reader", "book_buff"];
    const insight = "Your choices lean toward poetic and established literary works.";
    const result = await completeTasteLabelRecheck("quote-1", labelKeys, insight);
    assert.equal(result.ok, true);
    assert.deepEqual(update.$set.suggestedLabelKeys, labelKeys);
    assert.equal(update.$set.suggestionInsight, insight);
  } finally {
    AiTasteRecheck.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("taste-label recheck requires exactly 10 items, dashboard availability, and no pending result", async () => {
  const originalFindOne = User.findOne;
  const originalCreate = AiTasteRecheck.create;
  const originalSettings = { ...starEconomy };
  let user = completedUser(9);
  User.findOne = async () => user;
  AiTasteRecheck.create = async () => {
    throw new Error("ineligible lists must not create a quote");
  };
  Object.assign(starEconomy, {
    economyEnabled: true,
    spendingEnabled: true,
    tasteLabelRecheckEnabled: true,
  });

  try {
    const incomplete = await createTasteLabelRecheckQuote(42, "books");
    assert.equal(incomplete.reason, "incomplete_list");

    user = completedUser(11);
    const overfilled = await createTasteLabelRecheckQuote(42, "books");
    assert.equal(overfilled.reason, "incomplete_list");

    user = completedUser(10, "confirmed_review");
    const pending = await createTasteLabelRecheckQuote(42, "books");
    assert.equal(pending.reason, "missing_confirmed_label");

    starEconomy.tasteLabelRecheckEnabled = false;
    assert.equal(isTasteLabelRecheckAvailable(), false);
    const disabled = await createTasteLabelRecheckQuote(42, "books");
    assert.equal(disabled.reason, "disabled");
  } finally {
    User.findOne = originalFindOne;
    AiTasteRecheck.create = originalCreate;
    Object.assign(starEconomy, originalSettings);
  }
});
