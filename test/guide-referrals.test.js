const test = require("node:test");
const assert = require("node:assert/strict");
const { URL } = require("node:url");

const messages = require("../src/messages");
const { buildGuideReferralSharePayload } = require("../src/flows/guide-referrals");

test("Guide referral Forward and Copy carry the same invitation copy", () => {
  const link = "https://t.me/MuzeBot?start=ref_ABC123";
  const shareText = messages.fa.helpReferralShareText;
  const payload = buildGuideReferralSharePayload("fa", link);
  const forward = new URL(payload.shareUrl);

  assert.equal(forward.searchParams.get("text"), shareText);
  assert.equal(forward.searchParams.get("url"), link);
  assert.equal(payload.copyText, `${shareText}\n\n${link}`);
  assert.doesNotMatch(shareText, /زنده/);
});
