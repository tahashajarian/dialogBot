const test = require("node:test");
const assert = require("node:assert/strict");

const Discussion = require("../src/models/discussion");
const { starEconomy } = require("../src/services/star-settings");
const {
  buildGeoPoint,
  buildNearbyGeoQuery,
  normalizeCoordinates,
  partitionNearby,
} = require("../src/services/nearby");
const { buildPeopleDiscoveryText } = require("../src/services/people-discovery-ui");
const messages = require("../src/messages");

test("nearby coordinates reject invalid bounds and build private GeoJSON points", () => {
  assert.equal(normalizeCoordinates({ latitude: 91, longitude: 0 }), null);
  assert.equal(normalizeCoordinates({ latitude: 0, longitude: -181 }), null);
  assert.deepEqual(buildGeoPoint({ latitude: 35.7, longitude: 51.4 }), {
    type: "Point",
    coordinates: [51.4, 35.7],
  });
  assert.ok(buildNearbyGeoQuery(
    { type: "Point", coordinates: [51.4, 35.7] },
    50,
  )?.$geoWithin?.$centerSphere);
});

test("nearby partition preserves normal order inside both groups", () => {
  const items = [{ userId: 1 }, { userId: 2 }, { userId: 3 }, { userId: 4 }];
  assert.deepEqual(
    partitionNearby(items, new Set(["2", "4"])).map((item) => [item.userId, item.isNearby === true]),
    [[2, true], [4, true], [1, false], [3, false]],
  );
});

test("nearby partition preserves fields from Mongoose-style discussion documents", () => {
  const discussion = {
    _id: "room-1",
    isJoinable: true,
    listAction: "close",
    toObject: () => ({
      _id: "room-1",
      title: "Local room",
      description: "Nearby discussion",
      publicDiscussionCode: "d_LOCAL1",
    }),
  };
  const [prepared] = partitionNearby(
    [discussion],
    new Set(["room-1"]),
    (entry) => entry._id,
  );
  assert.equal(prepared.title, "Local room");
  assert.equal(prepared.description, "Nearby discussion");
  assert.equal(prepared.publicDiscussionCode, "d_LOCAL1");
  assert.equal(prepared.isJoinable, true);
  assert.equal(prepared.listAction, "close");
  assert.equal(prepared.isNearby, true);
});

test("nearby rollout is off by default", () => {
  assert.equal(starEconomy.nearbyPeopleEnabled, false);
  assert.equal(starEconomy.localDiscussionsEnabled, false);
  assert.equal(starEconomy.nearbyRadiusKm, 50);
  assert.equal(new Discussion({
    creatorUserId: 1,
    title: "Test",
    language: "en",
  }).isLocal, false);
});

test("People marks only prepared nearby entries without exposing distance", () => {
  const text = buildPeopleDiscoveryText(messages, "en", [{
    code: "u_A1",
    name: "Nearby person",
    age: 28,
    isNearby: true,
  }]);
  assert.match(text, /👤 Nearby person — 🎂 28 📍/);
  assert.doesNotMatch(text, /\bkm\b|kilomet/i);
});
