const test = require("node:test");
const assert = require("node:assert/strict");

const {
  discussionInviteNoSavedProfilesKeyboard,
  discussionInvitationsBackKeyboard,
  profileInvitationViewKeyboard,
  profileRestrictionViewKeyboard,
  savedProfilesListKeyboard,
} = require("../src/keyboards");
const { callBacks } = require("../src/constants");
const messages = require("../src/messages");

test("saved profiles keyboard includes next page button when paginated", () => {
  const keyboard = savedProfilesListKeyboard("en", { page: 0, totalPages: 2 });
  const rows = keyboard?.reply_markup?.inline_keyboard || [];
  const flatButtons = rows.flat();
  const nextPageBtn = flatButtons.find((btn) => btn.text === `${messages.en.discussionListMorePage} ➡️`);

  assert.ok(nextPageBtn);
  assert.equal(nextPageBtn.callback_data, `${callBacks.savedProfilesPage}1`);
  assert.equal(keyboard.reply_markup.keyboard, undefined);
});

test("saved profiles keyboard includes previous page button on later pages", () => {
  const keyboard = savedProfilesListKeyboard("en", { page: 1, totalPages: 2 });
  const rows = keyboard?.reply_markup?.inline_keyboard || [];
  const flatButtons = rows.flat();
  const prevPageBtn = flatButtons.find((btn) => btn.text === `🔙 ${messages.en.discussionListPrevPage}`);

  assert.ok(prevPageBtn);
  assert.equal(prevPageBtn.callback_data, `${callBacks.savedProfilesPage}0`);
});

test("saved profiles keyboard ends with delete-only Close", () => {
  const keyboard = savedProfilesListKeyboard("fa", { page: 0, totalPages: 1 });
  const rows = keyboard?.reply_markup?.inline_keyboard || [];
  const closeButton = rows.at(-1)?.[0];

  assert.equal(closeButton.text, messages.fa.discussionShareClose);
  assert.equal(closeButton.callback_data, callBacks.peopleListClose);
});

test("invitations list keyboard is inline and only closes its card", () => {
  const keyboard = discussionInvitationsBackKeyboard("en");
  const rows = keyboard?.reply_markup?.inline_keyboard || [];

  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 1);
  assert.equal(rows[0][0].text, messages.en.discussionShareClose);
  assert.equal(rows[0][0].callback_data, callBacks.discussionListClose);
  assert.equal(keyboard.reply_markup.keyboard, undefined);
});

test("empty saved-profile invite state offers shareable invite", () => {
  const keyboard = discussionInviteNoSavedProfilesKeyboard("en");
  const rows = keyboard?.reply_markup?.inline_keyboard || [];

  assert.equal(rows.length, 2);
  assert.equal(rows[0][0].callback_data, callBacks.discussionInviteModeShare);
  assert.equal(rows[1][0].callback_data, `${callBacks.discussionInvitationAck}room`);
});

test("inviter profile opened from invitations closes without recreating the list", () => {
  const keyboard = profileInvitationViewKeyboard("en");
  const rows = keyboard?.reply_markup?.inline_keyboard || [];

  assert.equal(rows.length, 1);
  assert.equal(rows[0][0].callback_data, callBacks.profileCloseDiscussionMember);
});

test("inviter profile can offer invite mute action", () => {
  const keyboard = profileInvitationViewKeyboard("en", 42, { canRestrictInviter: true });
  const rows = keyboard?.reply_markup?.inline_keyboard || [];

  assert.equal(rows.length, 2);
  assert.equal(rows[0][0].callback_data, `${callBacks.discussionInvitationMute}42`);
  assert.equal(rows[1][0].callback_data, callBacks.profileCloseDiscussionMember);
});

test("restricted inviter profile offers one-tap allow and delete-only Close", () => {
  const keyboard = profileRestrictionViewKeyboard("en", {
    profileCode: "u_AB12",
    canAllowInvitations: true,
  });
  const rows = keyboard.reply_markup.inline_keyboard;

  assert.equal(rows[0][0].callback_data, `${callBacks.profileInvitationAllow}u_AB12`);
  assert.equal(rows[1][0].callback_data, callBacks.profileCloseDiscussionMember);
});
