const messages = require("../messages");
const { helpReferralKeyboard } = require("../keyboards");
const { buildBotStartLink } = require("../services/invite-links");
const { createReferralLink } = require("../services/star-referrals");
const { starEconomy } = require("../services/star-settings");

async function buildGuideReferralCard(userId, lang) {
  const created = await createReferralLink({ inviterUserId: userId, source: "general" });
  if (!created.ok) return { ok: false, reason: created.reason };
  const link = buildBotStartLink(`ref_${created.link.publicCode}`);
  if (!link) return { ok: false, reason: "link_unavailable" };
  const text = messages[lang].helpReferralText
    .replace("{qualification}", String(starEconomy.firstTopTenMilestoneItems))
    .replace("{reward}", String(starEconomy.rewardExternalReferral))
    .replace("{link}", link);
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(messages[lang].helpReferralShareText)}`;
  return { ok: true, text, keyboard: helpReferralKeyboard(lang, shareUrl, link), link };
}

module.exports = { buildGuideReferralCard };
