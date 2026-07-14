const test = require("node:test");
const assert = require("node:assert/strict");

const {
  discussionInviteNoSavedProfilesKeyboard,
  discussionInvitationsBackKeyboard,
  profileInvitationBackKeyboard,
  savedProfilesListKeyboard,
} = require("../src/keyboards");
const { callBacks } = require("../src/constants");
const messages = require("../src/messages");

test("saved profiles keyboard includes next page button when paginated", () => {
  const keyboard = savedProfilesListKeyboard("en", { page: 0, totalPages: 2 });
  const rows = keyboard?.reply_markup?.keyboard || [];
  const flatButtons = rows.flat();
  const nextPageBtn = flatButtons.find((btn) => btn.text === `${messages.en.discussionListMorePage} ➡️`);

  assert.ok(nextPageBtn);
  assert.equal(keyboard.reply_markup.inline_keyboard, undefined);
});

test("saved profiles keyboard includes previous page button on later pages", () => {
  const keyboard = savedProfilesListKeyboard("en", { page: 1, totalPages: 2 });
  const rows = keyboard?.reply_markup?.keyboard || [];
  const flatButtons = rows.flat();
  const prevPageBtn = flatButtons.find((btn) => btn.text === `🔙 ${messages.en.discussionListPrevPage}`);

  assert.ok(prevPageBtn);
});

test("saved profiles keyboard returns to People hub", () => {
  const keyboard = savedProfilesListKeyboard("fa", { page: 0, totalPages: 1 });
  const rows = keyboard?.reply_markup?.keyboard || [];
  const backButton = rows.at(-1)?.[0];

  assert.equal(backButton.text, messages.fa.aiBack);
});

test("invitations list keyboard only goes back to discussions menu", () => {
  const keyboard = discussionInvitationsBackKeyboard("en");
  const rows = keyboard?.reply_markup?.keyboard || [];

  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 1);
  assert.equal(rows[0][0].text, messages.en.aiBack);
});

test("empty saved-profile invite state offers shareable invite", () => {
  const keyboard = discussionInviteNoSavedProfilesKeyboard("en");
  const rows = keyboard?.reply_markup?.inline_keyboard || [];

  assert.equal(rows.length, 2);
  assert.equal(rows[0][0].callback_data, callBacks.discussionInviteModeShare);
  assert.equal(rows[1][0].callback_data, `${callBacks.discussionInvitationAck}room`);
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
