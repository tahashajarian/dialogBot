const messages = require("../messages");
const { helpReferralKeyboard } = require("../keyboards");
const { buildBotStartLink } = require("../services/invite-links");
const { createReferralLink } = require("../services/star-referrals");
const { starEconomy } = require("../services/star-settings");

function buildGuideReferralSharePayload(lang, link) {
  const shareText = messages[lang].helpReferralShareText;
  return {
    shareUrl: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`,
    copyText: `${shareText}\n\n${link}`,
  };
}

async function buildGuideReferralCard(userId, lang) {
  const created = await createReferralLink({ inviterUserId: userId, source: "general" });
  if (!created.ok) return { ok: false, reason: created.reason };
  const link = buildBotStartLink(`ref_${created.link.publicCode}`);
  if (!link) return { ok: false, reason: "link_unavailable" };
  const text = messages[lang].helpReferralText
    .replace("{qualification}", String(starEconomy.firstTopTenMilestoneItems))
    .replace("{reward}", String(starEconomy.rewardExternalReferral))
    .replace("{link}", link);
  const { shareUrl, copyText } = buildGuideReferralSharePayload(lang, link);
  return { ok: true, text, keyboard: helpReferralKeyboard(lang, shareUrl, copyText), link };
}

module.exports = { buildGuideReferralCard, buildGuideReferralSharePayload };
