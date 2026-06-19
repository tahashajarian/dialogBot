const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const {
  getOrCreateUser,
  normalizePlatformUserSource,
} = require("../src/services/users");

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
  assert.equal(call.update.$setOnInsert.profileName, "Taha");
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
    await getOrCreateUser({ id: 789, username: "emoji_user", first_name: "🤖" });
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.deepEqual(call.filter, { userId: 789 });
  assert.equal(call.update.$set.username, "emoji_user");
  assert.equal(Object.hasOwn(call.update.$set, "firstName"), false);
  assert.equal(call.update.$setOnInsert.profileName, "");
});
