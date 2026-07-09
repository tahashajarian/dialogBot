const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const {
  addAiListItem,
  getAiListItemsFromUser,
  getOrCreateUser,
  normalizePlatformUserSource,
} = require("../src/services/users");
const { awardListMilestones } = require("../src/services/star-milestones");

test("normalizePlatformUserSource accepts Telegram and Bale-style user fields", () => {
  assert.deepEqual(normalizePlatformUserSource({
    id: 123,
    username: "alice",
    first_name: "Alice",
    language_code: "en",
  }), {
    id: 123,
    username: "alice",
    firstName: "Alice",
    languageCode: "en",
  });

  assert.deepEqual(normalizePlatformUserSource({
    userId: "456",
    userName: "taha",
    firstName: "Taha",
    languageCode: "fa",
  }), {
    id: 456,
    username: "taha",
    firstName: "Taha",
    languageCode: "fa",
  });
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
    getAiListItemsFromUser(user, "random", "topTen").map((entry) => entry.title),
    ["Movies", "Languages", "Custom typed thing"],
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
    await getOrCreateUser({ userId: "456", userName: "taha", firstName: "Taha" });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(call.filter, { userId: 456 });
  assert.equal(call.update.$set.username, "taha");
  assert.equal(call.update.$set.firstName, "Taha");
  assert.equal(call.update.$setOnInsert.profileName, "");
  assert.equal(call.update.$setOnInsert.profileNameConfirmedAt, null);
  assert.equal(call.options.upsert, true);
});

test("getOrCreateUser still upserts when platform name sanitizes to empty", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  let call = null;

  User.findOneAndUpdate = async (filter, update, options) => {
    call = { filter, update, options };
    return { userId: filter.userId };
  };

  try {
    await getOrCreateUser({ id: 789, username: "emoji_user", first_name: "😀" });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(call.filter, { userId: 789 });
  assert.equal(call.update.$set.username, "emoji_user");
  assert.equal(Object.hasOwn(call.update.$set, "firstName"), false);
  assert.equal(call.update.$setOnInsert.profileName, "");
  assert.equal(call.update.$setOnInsert.profileNameConfirmedAt, null);
});
