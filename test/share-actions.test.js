const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COPY_TEXT_LIMIT,
  buildNativeShareUrl,
  buildShareActionsKeyboard,
} = require("../src/services/share-actions");
const { callBacks } = require("../src/constants");

test("native share URL carries localized text and destination", () => {
  const url = buildNativeShareUrl({ url: "https://t.me/bot?start=x", text: "Join me" });
  assert.match(url, /^https:\/\/t\.me\/share\/url\?/);
  assert.match(url, /Join%20me/);
  assert.match(url, /start%3Dx/);
});

test("native share URL is omitted without a real destination URL", () => {
  assert.equal(buildNativeShareUrl({ text: "Share me" }), "");
});

test("share actions omit unsafe oversized copy text but preserve share and back", () => {
  const keyboard = buildShareActionsKeyboard({
    shareLabel: "Share",
    shareUrl: "https://t.me/share/url?url=x",
    copyLabel: "Copy",
    copyText: "x".repeat(COPY_TEXT_LIMIT + 1),
    backLabel: "Back",
    backCallback: "back",
  });
  const buttons = keyboard.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map((button) => button.text), ["Share", "Back"]);
});

test("discussion share Back action returns through the room acknowledgement route", () => {
  const keyboard = buildShareActionsKeyboard({
    shareLabel: "Share",
    shareUrl: "https://t.me/share/url?url=x",
    copyLabel: "Copy",
    copyText: "https://t.me/bot?start=ref_CODE",
    backLabel: "Back",
    backCallback: `${callBacks.discussionInvitationAck}room`,
  });
  const buttons = keyboard.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.at(-1).callback_data, `${callBacks.discussionInvitationAck}room`);
});
