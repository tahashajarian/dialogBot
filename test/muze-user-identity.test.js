const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const {
  backfillMissingMuzeUserIds,
  generateMuzeUserId,
} = require("../src/services/muze-user-identity");
const { parseArgs } = require("../scripts/backfill-muze-user-ids");

test("new users receive distinct immutable Muze identities", () => {
  const first = new User({ userId: 1001 });
  const second = new User({ userId: 1002 });

  assert.match(first.muzeUserId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first.muzeUserId, second.muzeUserId);
  assert.equal(User.schema.path("muzeUserId").options.immutable, true);
  assert.notEqual(generateMuzeUserId(), generateMuzeUserId());
});

test("Muze identity uses a unique partial index for legacy users", () => {
  const index = User.schema.indexes().find(([fields]) => fields.muzeUserId === 1);
  assert.deepEqual(index, [
    { muzeUserId: 1 },
    {
      name: "muzeUserId_unique_when_present",
      unique: true,
      partialFilterExpression: { muzeUserId: { $type: "string" } },
    },
  ]);
});

test("backfill dry-run reports missing users without writing", async () => {
  let writes = 0;
  const FakeUser = {
    countDocuments: async (filter) => {
      assert.deepEqual(filter, { muzeUserId: { $exists: false } });
      return 3;
    },
    updateOne: async () => { writes += 1; },
  };

  assert.deepEqual(await backfillMissingMuzeUserIds(FakeUser), { missing: 3, updated: 0 });
  assert.equal(writes, 0);
});

test("backfill only updates users whose Muze identity is still missing", async () => {
  let findCalls = 0;
  const updates = [];
  const FakeUser = {
    countDocuments: async () => 2,
    find: () => ({
      select: () => ({
        limit: () => ({
          lean: async () => (findCalls++ === 0 ? [{ _id: "a" }, { _id: "b" }] : []),
        }),
      }),
    }),
    updateOne: async (filter, update, options) => {
      updates.push({ filter, update, options });
      return { modifiedCount: 1 };
    },
  };

  assert.deepEqual(
    await backfillMissingMuzeUserIds(FakeUser, { apply: true, batchSize: 2 }),
    { missing: 2, updated: 2 },
  );
  assert.equal(updates.length, 2);
  for (const entry of updates) {
    assert.deepEqual(entry.filter.muzeUserId, { $exists: false });
    assert.match(entry.update.$set.muzeUserId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(entry.options, { strict: false });
  }
});

test("backfill arguments default to dry-run and require explicit apply", () => {
  assert.deepEqual(parseArgs([]), { apply: false, batchSize: 200 });
  assert.deepEqual(parseArgs(["--apply", "--batch-size=50"]), { apply: true, batchSize: 50 });
});
