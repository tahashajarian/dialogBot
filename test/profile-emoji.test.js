const test = require("node:test");
const assert = require("node:assert/strict");

const { PROFILE_EMOJI_CATALOG } = require("../src/services/profile-emoji");

test("profile emoji catalog has broad meaningful choices without duplicates", () => {
  assert.equal(new Set(PROFILE_EMOJI_CATALOG).size, PROFILE_EMOJI_CATALOG.length);
  assert.equal(PROFILE_EMOJI_CATALOG.length >= 100, true);
  for (const emoji of ["🎬", "🎭", "📚", "🧠", "♟️", "☕", "✈️", "🎮", "🚀", "🫶"]) {
    assert.equal(PROFILE_EMOJI_CATALOG.includes(emoji), true);
  }
});
