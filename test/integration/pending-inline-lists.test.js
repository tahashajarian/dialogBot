const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const PendingInlineList = require("../../src/models/pending-inline-list");
const User = require("../../src/models/user");
const {
  importPendingInlineListItems,
  stagePendingInlineListItem,
} = require("../../src/services/pending-inline-lists");
const { addAiListItem } = require("../../src/services/users");

const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017";
const MONGODB_TEST_DB = `muze_pending_inline_integration_${process.pid}_${Date.now()}`;

test.before(async () => {
  await mongoose.connect(MONGODB_TEST_URI, { dbName: MONGODB_TEST_DB });
  await Promise.all([PendingInlineList.init(), User.init()]);
}, { timeout: 120000 });

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test.beforeEach(async () => {
  await Promise.all([
    PendingInlineList.deleteMany({}),
    User.deleteMany({}),
  ]);
});

test("pending inline capture is idempotent, bounded, and expiring", async () => {
  for (let index = 0; index < 12; index += 1) {
    const result = await stagePendingInlineListItem({
      userId: 700,
      section: "movies",
      title: `Movie ${index}`,
    });
    assert.equal(result.ok, true);
  }

  const beforeDuplicate = await PendingInlineList.findOne({ userId: 700 }).lean();
  assert.equal(beforeDuplicate.items.length, 10);
  assert.deepEqual(
    beforeDuplicate.items.map((item) => item.title),
    Array.from({ length: 10 }, (_, index) => `Movie ${index + 2}`),
  );
  assert.ok(beforeDuplicate.expiresAt > new Date());

  const duplicate = await stagePendingInlineListItem({
    userId: 700,
    section: "movies",
    title: "Movie 11",
  });
  assert.equal(duplicate.status, "already_staged");

  const afterDuplicate = await PendingInlineList.findOne({ userId: 700 }).lean();
  assert.equal(afterDuplicate.items.length, 10);
  assert.equal(afterDuplicate.revision, beforeDuplicate.revision);
});

test("onboarding import preserves a selection added concurrently and retries safely", async () => {
  await User.create({ userId: 701, firstName: "Inline User" });
  await stagePendingInlineListItem({ userId: 701, section: "movies", title: "Dune" });

  let stagedDuringImport = false;
  const firstImport = await importPendingInlineListItems(701, {
    addListItem: async (...args) => {
      const result = await addAiListItem(...args);
      if (!stagedDuringImport) {
        stagedDuringImport = true;
        await stagePendingInlineListItem({
          userId: 701,
          section: "books",
          title: "Piranesi",
        });
      }
      return result;
    },
  });
  assert.equal(firstImport.ok, true);
  assert.equal(firstImport.pendingChanged, true);
  assert.ok(await PendingInlineList.exists({ userId: 701 }));

  const retry = await importPendingInlineListItems(701);
  assert.equal(retry.ok, true);
  assert.equal(retry.pendingChanged, false);
  assert.equal(await PendingInlineList.exists({ userId: 701 }), null);

  const user = await User.findOne({ userId: 701 }).lean();
  assert.deepEqual(user.aiLists.movies.watchlist.map((item) => item.title), ["Dune"]);
  assert.deepEqual(user.aiLists.books.watchlist.map((item) => item.title), ["Piranesi"]);
});

test("concurrent For Later additions cannot exceed one section's capacity", async () => {
  await User.create({ userId: 702, firstName: "Capacity User" });

  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => (
      addAiListItem(702, "movies", "watchlist", { title: `Movie ${index}` }, 1)
    )),
  );

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.reason === "limit").length, 7);
  const user = await User.findOne({ userId: 702 }).lean();
  assert.equal(user.aiLists.movies.watchlist.length, 1);
  assert.equal(user.aiLists.music.watchlist.length, 0);
});

test("For Later can append to a legacy structured list missing newer item fields", async () => {
  await User.collection.insertOne({
    userId: 704,
    firstName: "Existing List User",
    __v: 0,
    aiLists: {
      books: {
        watchlist: [{
          title: "سمفونی مردگان",
          comment: "یک کامنت",
          watched: false,
        }],
      },
    },
  });

  const result = await addAiListItem(
    704,
    "books",
    "watchlist",
    { title: "تماما مخصوص عباس معروفی" },
    100,
  );

  assert.equal(result.ok, true);
  const user = await User.findOne({ userId: 704 }).lean();
  assert.deepEqual(
    user.aiLists.books.watchlist.map((item) => item.title),
    ["سمفونی مردگان", "تماما مخصوص عباس معروفی"],
  );
});

test("pending inline imports discard capacity overflow instead of retrying forever", async () => {
  await User.create({
    userId: 703,
    firstName: "Full User",
    aiLists: {
      movies: {
        watchlist: Array.from({ length: 100 }, (_, index) => ({ title: `Movie ${index}` })),
      },
    },
  });
  await stagePendingInlineListItem({ userId: 703, section: "movies", title: "Movie 101" });

  const result = await importPendingInlineListItems(703);

  assert.equal(result.ok, true);
  assert.equal(result.imported, 0);
  assert.equal(result.skippedAtCapacity, 1);
  assert.equal(result.pendingChanged, false);
  assert.equal(await PendingInlineList.exists({ userId: 703 }), null);
  const user = await User.findOne({ userId: 703 }).lean();
  assert.equal(user.aiLists.movies.watchlist.length, 100);
});
