const test = require("node:test");
const assert = require("node:assert/strict");

const { getStartInviteCode } = require("../src/bot");

test("start invite parser accepts deep-link payload variants", () => {
  assert.equal(getStartInviteCode("/start join_ab12"), "d_AB12");
  assert.equal(getStartInviteCode("/start@LikelyBot join_ab12"), "d_AB12");
  assert.equal(getStartInviteCode("/start?join_ab12"), "d_AB12");
  assert.equal(getStartInviteCode("/start=d_ab12"), "d_AB12");
});

test("start invite parser ignores normal start and unrelated payloads", () => {
  assert.equal(getStartInviteCode("/start"), "");
  assert.equal(getStartInviteCode("/start profile_ab12"), "");
});
