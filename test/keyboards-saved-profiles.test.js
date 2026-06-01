const test = require("node:test");
const assert = require("node:assert/strict");

const { savedProfilesListKeyboard } = require("../src/keyboards");
const { callBacks } = require("../src/constants");

test("saved profiles keyboard includes next page button when paginated", () => {
  const keyboard = savedProfilesListKeyboard("en", { page: 0, totalPages: 2 });
  const rows = keyboard?.reply_markup?.inline_keyboard || [];
  const flatButtons = rows.flat();
  const nextPageBtn = flatButtons.find((btn) => btn.callback_data === `${callBacks.savedProfilesPage}1`);

  assert.ok(nextPageBtn);
});

test("saved profiles keyboard includes previous page button on later pages", () => {
  const keyboard = savedProfilesListKeyboard("en", { page: 1, totalPages: 2 });
  const rows = keyboard?.reply_markup?.inline_keyboard || [];
  const flatButtons = rows.flat();
  const prevPageBtn = flatButtons.find((btn) => btn.callback_data === `${callBacks.savedProfilesPage}0`);

  assert.ok(prevPageBtn);
});
