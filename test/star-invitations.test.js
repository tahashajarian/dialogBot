const test = require("node:test");
const assert = require("node:assert/strict");

const {
  awardSavedInvitePair,
  savedInvitePairKey,
} = require("../src/services/star-invitations");

test("stored invitation reward identity is directed and discussion-independent", () => {
  assert.equal(savedInvitePairKey(10, 20), "invite-pair:first-accepted:10:20");
  assert.notEqual(savedInvitePairKey(10, 20), savedInvitePairKey(20, 10));
});

test("stored invitation reward ignores self invites", async () => {
  const result = await awardSavedInvitePair({
    inviterUserId: 10,
    inviteeUserId: 10,
    source: "discussion_share",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "self_invite");
});

test("shared discussion links cannot award the directed-pair reward", async () => {
  const result = await awardSavedInvitePair({
    inviterUserId: 10,
    inviteeUserId: 20,
    source: "discussion_share",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "excluded_source");
});

test("People profile invitations cannot award the saved-profile reward", async () => {
  const result = await awardSavedInvitePair({
    inviterUserId: 10,
    inviteeUserId: 20,
    source: "people_profile",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "excluded_source");
});

test("automated onboarding invitations cannot award the directed-pair reward", async () => {
  for (const source of ["bot_onboarding", "onboarding_match"]) {
    const result = await awardSavedInvitePair({
      inviterUserId: 10,
      inviteeUserId: 20,
      invitationId: `invitation-${source}`,
      source,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "excluded_source");
  }
});
