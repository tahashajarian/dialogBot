const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const {
  addAiListItem,
  getAiListItemsFromUser,
  getOrCreateUser,
  hasSectionTipBeenShown,
  markSectionTipShown,
  markSectionTipShownForContext,
  normalizePlatformUserSource,
} = require("../src/services/users");
const { awardListMilestones } = require("../src/services/star-milestones");

test("normalizePlatformUserSource accepts Telegram and Bale-style user fields", () => {
  assert.deepEqual(
    normalizePlatformUserSource({
      id: 123,
      username: "alice",
      first_name: "Alice",
      language_code: "en",
    }),
    {
      id: 123,
      username: "alice",
      firstName: "Alice",
      languageCode: "en",
    },
  );

  assert.deepEqual(
    normalizePlatformUserSource({
      userId: "456",
      userName: "taha",
      firstName: "Taha",
      languageCode: "fa",
    }),
    {
      id: 456,
      username: "taha",
      firstName: "Taha",
      languageCode: "fa",
    },
  );
});

test("getAiListItemsFromUser canonicalizes built-in Interest chips", () => {
  const user = {
    aiLists: {
      random: {
        topTen: [
          { title: "فیلم" },
          { title: "زبان‌آموزی" },
          { title: "Custom typed thing" },
        ],
      },
    },
  };

  assert.deepEqual(
    getAiListItemsFromUser(user, "random", "topTen").map(
      (entry) => entry.title,
    ),
    ["Movies", "Languages", "Custom typed thing"],
  );
});

test("section-tip state defaults independently and rejects unknown keys", async () => {
  const user = new User({ userId: 321 });
  assert.deepEqual(user.sectionTipsShownAt.toObject(), {
    discussions: null,
    activeDiscussions: null,
    discussionLeaveRecent: null,
    favorites: null,
    forLaterInline: null,
    people: null,
    favoritesBanner: null,
    peopleBanner: null,
    discussionsBanner: null,
    moviesBanner: null,
    musicBanner: null,
    booksBanner: null,
  });
  assert.equal(hasSectionTipBeenShown(user, "discussions"), false);
  user.sectionTipsShownAt.discussions = new Date("2026-07-17T10:00:00.000Z");
  assert.equal(hasSectionTipBeenShown(user, "discussions"), true);
  assert.equal(hasSectionTipBeenShown(user, "favorites"), false);
  assert.equal(hasSectionTipBeenShown(user, "unknown"), false);

  const originalFindOneAndUpdate = User.findOneAndUpdate;
  let called = false;
  User.findOneAndUpdate = async () => {
    called = true;
    return null;
  };
  try {
    assert.equal(await markSectionTipShown(321, "unknown"), null);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
  assert.equal(called, false);
});

test("markSectionTipShown atomically sets only a missing stable tip key", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const shownAt = new Date("2026-07-17T11:00:00.000Z");
  let call = null;
  User.findOneAndUpdate = async (filter, update, options) => {
    call = { filter, update, options };
    return { userId: filter.userId, sectionTipsShownAt: { people: shownAt } };
  };

  try {
    await markSectionTipShown(654, "people", shownAt);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(call, {
    filter: { userId: 654, "sectionTipsShownAt.people": null },
    update: { $set: { "sectionTipsShownAt.people": shownAt } },
    options: { returnDocument: "after" },
  });
});

test("section-tip context helper keeps synthetic contexts local", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const ctx = { userId: 777, user: { userId: 777 } };
  let called = false;
  User.findOneAndUpdate = async () => {
    called = true;
    return null;
  };

  try {
    await markSectionTipShownForContext(
      ctx,
      "favorites",
      new Date("2026-07-17T14:00:00.000Z"),
    );
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(called, false);
  assert.equal(
    ctx.user.sectionTipsShownAt.favorites.toISOString(),
    "2026-07-17T14:00:00.000Z",
  );
});

test("addAiListItem rejects command-like titles before persistence", async () => {
  const originalFindOne = User.findOne;
  let findOneCalled = false;

  User.findOne = async () => {
    findOneCalled = true;
    return null;
  };

  try {
    const result = await addAiListItem(123, "random", "topTen", "/start", 10);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_item_quality");
    assert.equal(findOneCalled, false);
  } finally {
    User.findOne = originalFindOne;
  }
});

test("watchlist milestones do not award Stars or progress", async () => {
  const result = await awardListMilestones({
    userId: 123,
    section: "movies",
    listType: "watchlist",
    count: 100,
  });

  assert.deepEqual(result, { rewards: [], progress: null });
});

test("getOrCreateUser creates users from alternate name fields", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  let call = null;

  User.findOneAndUpdate = async (filter, update, options) => {
    call = { filter, update, options };
    return { userId: filter.userId };
  };

  try {
    await getOrCreateUser({
      userId: "456",
      userName: "taha",
      firstName: "Taha",
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(call.filter, { userId: 456 });
  assert.equal(call.update.$set.username, "taha");
  assert.equal(call.update.$set.firstName, "Taha");
  assert.equal(call.update.$setOnInsert.profileName, "");
  assert.equal(call.update.$setOnInsert.profileNameConfirmedAt, null);
  assert.equal(call.options.upsert, true);
  assert.equal(call.options.maxTimeMS, 2500);
});

test("getOrCreateUser still upserts when platform name sanitizes to empty", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  let call = null;

  User.findOneAndUpdate = async (filter, update, options) => {
    call = { filter, update, options };
    return { userId: filter.userId };
  };

  try {
    await getOrCreateUser({
      id: 789,
      username: "emoji_user",
      first_name: "😀",
    });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(call.filter, { userId: 789 });
  assert.equal(call.update.$set.username, "emoji_user");
  assert.equal(Object.hasOwn(call.update.$set, "firstName"), false);
  assert.equal(call.update.$setOnInsert.profileName, "");
  assert.equal(call.update.$setOnInsert.profileNameConfirmedAt, null);
});
