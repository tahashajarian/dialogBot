const test = require("node:test");
const assert = require("node:assert/strict");
const { URL } = require("node:url");

const messages = require("../src/messages");
const { buildGuideReferralSharePayload, sendGuideReferralCard } = require("../src/flows/guide-referrals");

test("Guide referral Forward and Copy carry the same invitation copy", () => {
  const link = "https://t.me/MuzeBot?start=ref_ABC123";
  const shareText = messages.fa.helpReferralShareText;
  const payload = buildGuideReferralSharePayload("fa", link);
  const forward = new URL(payload.shareUrl);

  assert.equal(forward.searchParams.get("text"), shareText);
  assert.equal(forward.searchParams.get("url"), link);
  assert.equal(payload.copyText, `${shareText}\n\n${link}`);
  assert.doesNotMatch(shareText, /زنده/);
  const renderedInvite = messages.fa.helpReferralText.replace("{invitation}", payload.copyText);
  const renderedGuidance = messages.fa.helpReferralGuidance.replace("{reward}", "۱۰");
  assert.equal(renderedInvite, payload.copyText);
  assert.doesNotMatch(renderedInvite, /👩‍🦳|💡/);
  assert.match(renderedGuidance, /^👩‍🦳[\s\S]*👆[\s\S]*💡/);
  assert.doesNotMatch(renderedGuidance, new RegExp(shareText));
  assert.doesNotMatch(renderedGuidance, /واقعاً|واقعا/);
  assert.match(renderedGuidance, /خانه ← 👤 من ← 🔗 ساخت کارت اشتراک پروفایل/);
});

test("Guide referral edits one card with its content, guidance, and actions", async () => {
  const sent = [];
  const card = {
    text: "invitation and link",
    guidance: "guidance 👆",
    keyboard: { reply_markup: { inline_keyboard: [[{ text: "Share" }]] } },
  };
  const ctx = {};

  await sendGuideReferralCard(ctx, card, async (_ctx, text, extra) => {
    sent.push({ kind: "edit", text, extra });
  });

  assert.deepEqual(sent, [
    { kind: "edit", text: `${card.text}\n\n${card.guidance}`, extra: card.keyboard },
  ]);
});
