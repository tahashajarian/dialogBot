const test = require("node:test");
const assert = require("node:assert/strict");

const StarReferralLink = require("../src/models/star-referral-link");
const StarReferralClaim = require("../src/models/star-referral-claim");
const {
  claimReferral,
  generateReferralCode,
  normalizeReferralCode,
  resolveReferralLink,
} = require("../src/services/star-referrals");

test("outside referral codes are opaque fixed-length values", () => {
  const code = generateReferralCode();
  assert.match(code, /^[A-F0-9]{12}$/);
  assert.equal(normalizeReferralCode(`ref_${code.toLowerCase()}`), code);
  assert.equal(normalizeReferralCode("123"), "");
});

test("referral link and first-referrer claim schemas validate", async () => {
  const link = new StarReferralLink({
    publicCode: "A1B2C3D4E5F6",
    inviterUserId: 10,
    discussionPublicCode: "d_ROOM12",
    source: "discussion_share",
  });
  await link.validate();

  const claim = new StarReferralClaim({
    referralLinkId: link._id,
    inviterUserId: 10,
    inviteeUserId: 20,
  });
  await claim.validate();

  const profileLink = new StarReferralLink({
    publicCode: "F6E5D4C3B2A1",
    inviterUserId: 10,
    profilePublicCode: "u_PROFILE1",
    source: "profile_share",
  });
  await profileLink.validate();
});

test("non-rewarding profile referrals retain their public destination", async () => {
  const originalFindOne = StarReferralLink.findOne;
  const link = {
    _id: "link-id",
    publicCode: "A1B2C3D4E5F6",
    inviterUserId: 10,
    profilePublicCode: "u_SHARED",
    source: "profile_share",
    expiresAt: new Date(Date.now() + 60_000),
  };
  StarReferralLink.findOne = async () => link;
  try {
    const existing = await claimReferral({
      code: link.publicCode,
      inviteeUserId: 20,
      wasUserCreated: false,
    });
    const self = await claimReferral({
      code: link.publicCode,
      inviteeUserId: 10,
      wasUserCreated: true,
    });
    link.expiresAt = new Date(Date.now() - 60_000);
    const expired = await resolveReferralLink(link.publicCode);

    assert.equal(existing.reason, "existing_user");
    assert.equal(existing.link.profilePublicCode, "u_SHARED");
    assert.equal(self.reason, "self_referral");
    assert.equal(self.link.profilePublicCode, "u_SHARED");
    assert.equal(expired.reason, "expired_referral");
    assert.equal(expired.link.profilePublicCode, "u_SHARED");
  } finally {
    StarReferralLink.findOne = originalFindOne;
  }
});
