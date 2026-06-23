const test = require("node:test");
const assert = require("node:assert/strict");

const StarReferralLink = require("../src/models/star-referral-link");
const StarReferralClaim = require("../src/models/star-referral-claim");
const {
  generateReferralCode,
  normalizeReferralCode,
} = require("../src/services/star-referrals");

test("outside referral codes are opaque fixed-length values", () => {
  const code = generateReferralCode();
  assert.match(code, /^[A-F0-9]{12}$/);
  assert.equal(normalizeReferralCode(`ref_${code.toLowerCase()}`), code);
  assert.equal(normalizeReferralCode("123"), "");
});

test("referral link and first-referrer claim schemas validate", () => {
  const link = new StarReferralLink({
    publicCode: "A1B2C3D4E5F6",
    inviterUserId: 10,
    discussionPublicCode: "d_ROOM12",
    source: "discussion_share",
  });
  assert.equal(link.validateSync(), undefined);

  const claim = new StarReferralClaim({
    referralLinkId: link._id,
    inviterUserId: 10,
    inviteeUserId: 20,
  });
  assert.equal(claim.validateSync(), undefined);
});
