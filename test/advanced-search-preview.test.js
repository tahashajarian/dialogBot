const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const {
  advancedSearchPreviewKeyboard,
  peopleHubKeyboard,
} = require("../src/keyboards");
const { starEconomy } = require("../src/services/star-settings");
const { isPeopleCallback } = require("../src/services/people-discovery-ui");

test("People hub exposes an honest Advanced Search preview", () => {
  const original = starEconomy.advancedSearchPreviewEnabled;
  starEconomy.advancedSearchPreviewEnabled = true;
  try {
    const buttons = peopleHubKeyboard("en").reply_markup.inline_keyboard.flat();
    const advanced = buttons.find((button) => button.callback_data === callBacks.peopleAdvancedSearch);
    assert.equal(advanced.text, messages.en.advancedSearchButton);
    assert.equal(isPeopleCallback(callBacks.peopleAdvancedSearch), true);
  } finally {
    starEconomy.advancedSearchPreviewEnabled = original;
  }
});

test("Advanced Search preview stays minimal while unavailable", () => {
  assert.equal(messages.fa.advancedSearchPreviewText, "👩‍🦳 جست‌وجوی پیشرفته هنوز آماده نیست.");
  assert.equal(messages.en.advancedSearchPreviewText, "👩‍🦳 Advanced Search is not available yet.");
});

test("Advanced Search notification request disappears after signup", () => {
  const before = advancedSearchPreviewKeyboard("en").reply_markup.inline_keyboard.flat();
  const after = advancedSearchPreviewKeyboard("en", { notified: true }).reply_markup.inline_keyboard.flat();
  assert.ok(before.some((button) => button.callback_data === callBacks.peopleAdvancedSearchNotify));
  assert.ok(!after.some((button) => button.callback_data === callBacks.peopleAdvancedSearchNotify));
  assert.ok(after.some((button) => button.callback_data === callBacks.peopleAdvancedSearchBack));
});
