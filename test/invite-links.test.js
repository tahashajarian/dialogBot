const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildBotBaseLink,
  buildBotStartLink,
  normalizeBotUsername,
  resolveBotUsername,
} = require("../src/services/invite-links");

test("normalizes bot username for public invite links", () => {
  assert.equal(normalizeBotUsername("@Likely_Bot!"), "Likely_Bot");
});

test("resolves the runtime bot username before the configured fallback", () => {
  assert.equal(
    resolveBotUsername({ botInfo: { username: "@Runtime_Bot" } }, { BOT_USERNAME: "Config_Bot" }),
    "Runtime_Bot",
  );
  assert.equal(resolveBotUsername(null, { BOT_USERNAME: "@Config_Bot" }), "Config_Bot");
});

test("buildBotStartLink uses explicit public URL", () => {
  const link = buildBotStartLink("join_AB12", {
    BOT_DEEP_LINK_BASE_URL: "https://ble.ir/@LikelyBot",
  });

  assert.equal(link, "https://ble.ir/@LikelyBot?start=join_AB12");
});

test("buildBotBaseLink uses configured deep link base URL", () => {
  const link = buildBotBaseLink({
    BOT_DEEP_LINK_BASE_URL: "https://ble.ir/@LikelyBot",
  });

  assert.equal(link, "https://ble.ir/@LikelyBot");
});

test("buildBotStartLink can use Telegram base URL", () => {
  const link = buildBotStartLink("join_AB12", {
    BOT_DEEP_LINK_BASE_URL: "https://t.me/LikelyBot",
  });

  assert.equal(link, "https://t.me/LikelyBot?start=join_AB12");
});

test("buildBotStartLink treats BOT_PUBLIC_URL username shorthand as Bale URL", () => {
  const link = buildBotStartLink("join_AB12", {
    BOT_PUBLIC_URL: "@dialogtestBot",
  });

  assert.equal(link, "https://ble.ir/@dialogtestBot?start=join_AB12");
});

test("buildBotStartLink supports payload templates", () => {
  const link = buildBotStartLink("join_AB12", {
    BOT_PUBLIC_URL: "https://example.com/open/{payload}",
  });

  assert.equal(link, "https://example.com/open/join_AB12");
});

test("buildBotStartLink falls back to BOT_USERNAME", () => {
  const link = buildBotStartLink("join_AB12", {
    BOT_USERNAME: "LikelyBot",
  });

  assert.equal(link, "https://ble.ir/@LikelyBot?start=join_AB12");
});
