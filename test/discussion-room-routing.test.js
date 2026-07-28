const test = require("node:test");
const assert = require("node:assert/strict");

const { callBacks } = require("../src/constants");
const { isDiscussionRoomCallback } = require("../src/flows/discussion-room-callbacks");

test("discussion room routing owns room lifecycle callbacks", () => {
  const roomCallbacks = [
    `${callBacks.discussionOwnerJoinNoticeOpen}d_ROOM01`,
    `${callBacks.discussionOpen}room-1`,
    `${callBacks.discussionInviteJoin}d_ROOM01`,
    `${callBacks.discussionInviteSwitchJoin}d_ROOM01`,
    `${callBacks.discussionInviteCancel}d_ROOM01`,
    `${callBacks.discussionLeave}room-1`,
    `${callBacks.discussionClose}room-1`,
    `${callBacks.discussionCloseConfirm}room-1:room`,
    `${callBacks.discussionCloseCancel}room-1:room`,
    `${callBacks.discussionMembers}room-1`,
    `${callBacks.discussionMembersPage}room-1:1`,
    callBacks.discussionRemoveMemberCancel,
    `${callBacks.discussionRemoveMemberConfirm}room-1:u_ABC123`,
  ];

  for (const callback of roomCallbacks) {
    assert.equal(isDiscussionRoomCallback(callback), true, callback);
  }
});

test("discussion room routing leaves list and members-card close callbacks to housekeeping", () => {
  assert.equal(isDiscussionRoomCallback(callBacks.discussionMembersClose), false);
  assert.equal(isDiscussionRoomCallback(callBacks.discussionsActive), false);
  assert.equal(isDiscussionRoomCallback(callBacks.discussionCreate), false);
  assert.equal(isDiscussionRoomCallback(callBacks.menuMain), false);
});
