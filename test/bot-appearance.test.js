const test = require("node:test");
const assert = require("node:assert/strict");
const messages = require("../src/messages");

const {
  DEFAULT_BOT_EMOJI,
  botAppearance,
  formatBotText,
  normalizeBotAppearance,
} = require("../src/services/bot-appearance");

test("bot appearance normalizes emoji and falls back safely", () => {
  assert.deepEqual(normalizeBotAppearance({ botEmoji: "🪷" }), { botEmoji: "🪷" });
  assert.deepEqual(normalizeBotAppearance({ botEmoji: "not emoji" }), { botEmoji: DEFAULT_BOT_EMOJI });
  assert.deepEqual(normalizeBotAppearance({ botEmoji: "🪷 Muze" }), { botEmoji: DEFAULT_BOT_EMOJI });
});

test("formatBotText swaps only the default bot marker", () => {
  const previous = botAppearance.botEmoji;
  botAppearance.botEmoji = "🪷";
  try {
    assert.equal(formatBotText("👩‍🦳 سلام ⭐"), "🪷 سلام ⭐");
  } finally {
    botAppearance.botEmoji = previous;
  }
});

test("configurable marker applies to AI confirmation templates", () => {
  const previous = botAppearance.botEmoji;
  botAppearance.botEmoji = "🪷";
  try {
    assert.equal(formatBotText(messages.fa.aiWatchlistWatchedOnMusic), "🪷 «{item}» به‌عنوان گوش‌داده‌شده ثبت شد.");
    assert.equal(formatBotText(messages.fa.aiSuggestionAddedDoneMusic), "🪷 در 🎵📋 آرشیو موسیقی ذخیره شد. (گوش‌داده‌شده)");
    assert.equal(formatBotText(messages.en.aiWatchlistPromotedToTopTen), "🪷 Moved to your favorites.");
  } finally {
    botAppearance.botEmoji = previous;
  }
});
