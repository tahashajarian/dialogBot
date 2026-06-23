const test = require("node:test");
const assert = require("node:assert/strict");

const { savedInvitePairKey } = require("../src/services/star-invitations");

test("stored invitation reward identity is directed and discussion-independent", () => {
  assert.equal(savedInvitePairKey(10, 20), "invite-pair:first-accepted:10:20");
  assert.notEqual(savedInvitePairKey(10, 20), savedInvitePairKey(20, 10));
});
