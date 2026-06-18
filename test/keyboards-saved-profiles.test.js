const test = require("node:test");
const assert = require("node:assert/strict");

const {
  discussionInvitationsBackKeyboard,
  profileInvitationBackKeyboard,
  savedProfilesListKeyboard,
} = require("../src/keyboards");
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

test("invitations list keyboard only goes back to discussions menu", () => {
  const keyboard = discussionInvitationsBackKeyboard("en");
  const rows = keyboard?.reply_markup?.inline_keyboard || [];

  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 1);
  assert.equal(rows[0][0].callback_data, callBacks.discussions);
});

test("inviter profile opened from invitations returns to invitations", () => {
  const keyboard = profileInvitationBackKeyboard("en");
  const rows = keyboard?.reply_markup?.inline_keyboard || [];

  assert.equal(rows.length, 1);
  assert.equal(rows[0][0].callback_data, callBacks.discussionInvitations);
});

test("inviter profile can offer invite mute action", () => {
  const keyboard = profileInvitationBackKeyboard("en", 42);
  const rows = keyboard?.reply_markup?.inline_keyboard || [];

  assert.equal(rows.length, 2);
  assert.equal(rows[0][0].callback_data, `${callBacks.discussionInvitationMute}42`);
  assert.equal(rows[1][0].callback_data, callBacks.discussionInvitations);
});
