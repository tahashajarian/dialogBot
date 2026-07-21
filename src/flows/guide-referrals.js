const messages = require("../messages");
const { helpReferralKeyboard } = require("../keyboards");
const { buildBotStartLink } = require("../services/invite-links");
const { buildNativeShareUrl } = require("../services/share-actions");
const { createReferralLink } = require("../services/star-referrals");
const { starEconomy } = require("../services/star-settings");
const { formatStarNumber } = require("../services/stars-ui");

function buildGuideReferralSharePayload(lang, link) {
  const shareText = messages[lang].helpReferralShareText;
  return {
    shareUrl: buildNativeShareUrl({ url: link, text: shareText }),
    copyText: `${shareText}\n\n${link}`,
  };
}

async function buildGuideReferralCard(userId, lang) {
  const created = await createReferralLink({ inviterUserId: userId, source: "general" });
  if (!created.ok) return { ok: false, reason: created.reason };
  const link = buildBotStartLink(`ref_${created.link.publicCode}`);
  if (!link) return { ok: false, reason: "link_unavailable" };
  const { shareUrl, copyText } = buildGuideReferralSharePayload(lang, link);
  const text = messages[lang].helpReferralText.replace("{invitation}", copyText);
  const guidance = messages[lang].helpReferralGuidance
    .replace("{reward}", formatStarNumber(starEconomy.rewardExternalReferral, lang));
  return { ok: true, text, guidance, keyboard: helpReferralKeyboard(lang, shareUrl, copyText), link };
}

async function sendGuideReferralCard(ctx, card, editCallbackMessageOrReply) {
  const text = [card.text, card.guidance].filter(Boolean).join("\n\n");
  return editCallbackMessageOrReply(ctx, text, card.keyboard);
}

module.exports = { buildGuideReferralCard, buildGuideReferralSharePayload, sendGuideReferralCard };
