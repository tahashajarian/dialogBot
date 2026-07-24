const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SEED_USER_ID_START,
  buildSeedUser,
  clusters,
} = require("../scripts/seed-people-test-data");
const { isAllowedTasteLabel } = require("../src/services/taste-label-classifier");

test("People seed profiles contain valid confirmed taste labels for all media sections", () => {
  const users = clusters.map((_, index) => buildSeedUser(index));

  for (const [index, user] of users.entries()) {
    assert.equal(user.userId, SEED_USER_ID_START - index);
    for (const section of ["movies", "music", "books"]) {
      const taste = user.aiTaste[section];
      assert.equal(isAllowedTasteLabel(section, taste.labelKey), true);
      assert.equal(taste.classificationStatus, "confirmed");
      assert.equal(taste.source, "seed");
      assert.ok(taste.emoji);
      assert.ok(taste.sampleCount > 0);
      assert.ok(taste.confirmedAt instanceof Date);
    }
  }
});

test("People seed clusters include repeated labels for same-label discovery testing", () => {
  const users = Array.from({ length: clusters.length * 2 }, (_, index) => buildSeedUser(index));
  const signatures = users.map((user) => [
    user.aiTaste.movies.labelKey,
    user.aiTaste.music.labelKey,
    user.aiTaste.books.labelKey,
  ].join(":"));

  assert.ok(new Set(signatures).size < signatures.length);
});
