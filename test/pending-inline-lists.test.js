const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PENDING_INLINE_ITEM_LIMIT,
  importPendingInlineListItems,
  normalizePendingSelection,
  stagePendingInlineListItem,
} = require("../src/services/pending-inline-lists");

test("pending inline selections are normalized and keyed without exposing the title", () => {
  const selection = normalizePendingSelection({
    userId: "42",
    section: "movies",
    title: "  Dune  ",
  });
  assert.equal(selection.userId, 42);
  assert.equal(selection.title, "Dune");
  assert.equal(selection.section, "movies");
  assert.match(selection.key, /^[a-f0-9]{64}$/);
  assert.equal(selection.key.includes("Dune"), false);
  assert.equal(normalizePendingSelection({ userId: 42, section: "random", title: "Dune" }), null);
});

test("staging creates a bounded pending record", async () => {
  const created = [];
  const model = {
    updateOne: async () => ({ matchedCount: 0 }),
    create: async (value) => created.push(value),
  };
  const result = await stagePendingInlineListItem({
    userId: 42,
    section: "books",
    title: "Piranesi",
  }, {
    model,
    now: new Date("2026-07-23T10:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].items.length, 1);
  assert.equal(created[0].items[0].title, "Piranesi");
  assert.equal(PENDING_INLINE_ITEM_LIMIT, 10);
});

test("pending import uses normal list mutation and removes only the imported revision", async () => {
  const addCalls = [];
  const deleteCalls = [];
  const model = {
    findOne: () => ({
      lean: async () => ({
        _id: "pending-1",
        revision: 3,
        items: [
          { section: "movies", title: "Dune" },
          { section: "books", title: "Piranesi" },
        ],
      }),
    }),
    deleteOne: async (filter) => {
      deleteCalls.push(filter);
      return { deletedCount: 1 };
    },
  };
  const result = await importPendingInlineListItems(42, {
    model,
    addListItem: async (...args) => {
      addCalls.push(args);
      return addCalls.length === 1 ? { ok: true } : { ok: false, reason: "exists" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.imported, 1);
  assert.equal(addCalls.length, 2);
  assert.deepEqual(addCalls.map((call) => call.slice(0, 3)), [
    [42, "movies", "watchlist"],
    [42, "books", "watchlist"],
  ]);
  assert.deepEqual(deleteCalls, [{ _id: "pending-1", revision: 3 }]);
});

test("a failed pending import remains available for retry", async () => {
  let deleted = false;
  const model = {
    findOne: () => ({
      lean: async () => ({
        _id: "pending-1",
        revision: 1,
        items: [{ section: "music", title: "Space Song" }],
      }),
    }),
    deleteOne: async () => {
      deleted = true;
    },
  };
  const result = await importPendingInlineListItems(42, {
    model,
    addListItem: async () => ({ ok: false, reason: "temporary_failure" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "temporary_failure");
  assert.equal(deleted, false);
});
