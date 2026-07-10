const test = require("node:test");
const assert = require("node:assert/strict");
const Discussion = require("../src/models/discussion");
const User = require("../src/models/user");
const { buildBackfillPlan } = require("../scripts/backfill-discussion-languages");

test("discussion language backfill reports deterministic creator fallbacks", async () => {
  const originalDiscussionFind = Discussion.find;
  const originalUserFind = User.find;
  Discussion.find = () => ({
    select: () => ({
      lean: async () => [
        { _id: "a", creatorUserId: 1, isBotCreated: false },
        { _id: "b", creatorUserId: 2, isBotCreated: false },
        { _id: "c", creatorUserId: 3, isBotCreated: true },
      ],
    }),
  });
  User.find = () => ({
    select: () => ({
      lean: async () => [
        { userId: 1, lang: "en" },
        { userId: 2, lang: "invalid" },
      ],
    }),
  });

  try {
    const { report, updates } = await buildBackfillPlan();
    assert.deepEqual(report, {
      total: 3,
      fa: 2,
      en: 1,
      missingCreators: 1,
      invalidCreatorLanguage: 1,
      userCreatedRooms: 2,
      starterRooms: 1,
    });
    assert.deepEqual(updates.map((entry) => entry.updateOne.update.$set.language), ["en", "fa", "fa"]);
    assert.ok(updates.every((entry) => entry.updateOne.filter.language.$nin.includes("fa")));
  } finally {
    Discussion.find = originalDiscussionFind;
    User.find = originalUserFind;
  }
});
