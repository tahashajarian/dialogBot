const test = require("node:test");
const assert = require("node:assert/strict");

const {
  reconcileNearbyPeopleLocationIndex,
  reconcilePendingInlineListTtlIndex,
} = require("../scripts/create-indexes");

function fakeModel(indexes) {
  const commands = [];
  return {
    commands,
    collection: {
      name: "pendinginlinelists",
      listIndexes: () => ({ toArray: async () => indexes }),
    },
    db: {
      db: {
        command: async (command) => commands.push(command),
      },
    },
  };
}

test("index setup upgrades the legacy expiresAt index to TTL", async () => {
  const model = fakeModel([{ name: "expiresAt_1", key: { expiresAt: 1 } }]);

  assert.equal(await reconcilePendingInlineListTtlIndex(model), true);
  assert.deepEqual(model.commands, [{
    collMod: "pendinginlinelists",
    index: { name: "expiresAt_1", expireAfterSeconds: 0 },
  }]);
});

test("index setup replaces the legacy nearby-location partial filter", async () => {
  const operations = [];
  const model = {
    collection: {
      listIndexes: () => ({
        toArray: async () => [{
          name: "nearby_people_location",
          key: { "location.point": "2dsphere" },
          partialFilterExpression: {
            nearbyPeopleOptIn: true,
            "location.point.type": "Point",
          },
        }],
      }),
      dropIndex: async (name) => operations.push(["drop", name]),
      createIndex: async (key, options) => operations.push(["create", key, options]),
    },
  };

  assert.equal(await reconcileNearbyPeopleLocationIndex(model), true);
  assert.deepEqual(operations, [
    ["drop", "nearby_people_location"],
    ["create", { "location.point": "2dsphere" }, {
      name: "nearby_people_location",
      partialFilterExpression: { "location.point.type": "Point" },
    }],
  ]);
});

test("index setup leaves an existing TTL index unchanged", async () => {
  const model = fakeModel([{
    name: "expiresAt_1",
    key: { expiresAt: 1 },
    expireAfterSeconds: 0,
  }]);

  assert.equal(await reconcilePendingInlineListTtlIndex(model), false);
  assert.deepEqual(model.commands, []);
});
