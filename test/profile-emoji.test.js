const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROFILE_EMOJI_CATALOG,
  getProfileEmojiSelectionCost,
  isProfileEmojiUnlocked,
} = require("../src/services/profile-emoji");

test("profile emoji catalog has broad meaningful choices without duplicates", () => {
  assert.equal(new Set(PROFILE_EMOJI_CATALOG).size, PROFILE_EMOJI_CATALOG.length);
  assert.equal(PROFILE_EMOJI_CATALOG.length >= 100, true);
  for (const emoji of ["🎬", "🎭", "📚", "🧠", "♟️", "☕", "✈️", "🎮", "🚀", "🫶"]) {
    assert.equal(PROFILE_EMOJI_CATALOG.includes(emoji), true);
  }
});

test("profile emoji unlock recognizes explicit and legacy ownership", () => {
  assert.equal(isProfileEmojiUnlocked({}), false);
  assert.equal(isProfileEmojiUnlocked({ profileEmojiUnlockedAt: new Date() }), true);
  assert.equal(isProfileEmojiUnlocked({ profileEmoji: "🎧" }), true);
  assert.equal(getProfileEmojiSelectionCost({}), 3);
  assert.equal(getProfileEmojiSelectionCost({ profileEmoji: "🎧" }), 0);
});
