const test = require("node:test");
const assert = require("node:assert/strict");

const { inferTasteLabel } = require("../src/services/users");

test("infers music label from common song titles", () => {
  const taste = inferTasteLabel("music", ["Enter Sandman", "Master of Puppets", "Metallica"]);

  assert.equal(taste.labelKey, "metalhead");
  assert.equal(taste.emoji, "🤘");
  assert.ok(taste.confidence >= 0.5);
});

test("infers metalhead from metal and hard-rock music variants", () => {
  const taste = inferTasteLabel("music", [
    "killing in the name of",
    "enter sand man metalica",
    "highway to the hell",
    "pulp fiction tarantino",
    "toranj mohsen namjoo",
    "جبر جغرافیایی محسن نامجو",
    "bleeding me metalica",
    "nothing else matter metalica",
    "stand by me sting",
    "welocme to the jungle - guns and roses",
  ]);

  assert.equal(taste.labelKey, "metalhead");
  assert.equal(taste.emoji, "🤘");
});

test("infers movie label from common drama titles and misspellings", () => {
  const taste = inferTasteLabel("movies", ["forest gump", "The Green Mile", "Whiplash"]);

  assert.equal(taste.labelKey, "drama_seeker");
  assert.equal(taste.emoji, "🎭");
  assert.ok(taste.confidence >= 0.5);
});

test("uses default label with lower confidence when no signal matches", () => {
  const taste = inferTasteLabel("movies", ["unknown title one", "unknown title two"]);

  assert.equal(taste.labelKey, "eclectic_watcher");
  assert.equal(taste.emoji, "🎬");
  assert.equal(taste.confidence, 0.45);
});
