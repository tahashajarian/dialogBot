const { starEconomy } = require("./star-settings");

function formatStarNumber(value, lang = "en") {
  const normalized = Math.max(0, Math.round(Number(value) || 0));
  return normalized.toLocaleString(lang === "fa" ? "fa-IR" : "en-US");
}

function buildStarsOverviewText(messages, lang, user, settings = starEconomy) {
  const values = {
    balance: formatStarNumber(user?.starBalance, lang),
    regularListGoal: formatStarNumber(settings.regularListMilestoneItems, lang),
    regularListReward: formatStarNumber(settings.rewardRegularListPerSection, lang),
    firstTopTenGoal: formatStarNumber(settings.firstTopTenMilestoneItems, lang),
    firstTopTenReward: formatStarNumber(settings.rewardFirstThreePerSection, lang),
    fullTopTenGoal: formatStarNumber(settings.topTenCompletionItems, lang),
    fullTopTenReward: formatStarNumber(settings.rewardFullTopTenPerSection, lang),
    profileReward: formatStarNumber(settings.rewardProfileCompletion, lang),
    firstDiscussionReward: formatStarNumber(settings.rewardFirstDiscussion, lang),
    firstDiscussionJoinReward: formatStarNumber(settings.rewardFirstDiscussionJoin, lang),
    inviteReward: formatStarNumber(settings.rewardSavedInvitePair, lang),
    referralReward: formatStarNumber(settings.rewardExternalReferral, lang),
    boostCost: formatStarNumber(settings.discussionBoostCost, lang),
    tasteMatchCost: formatStarNumber(settings.peopleTasteMatchesCost, lang),
    tasteMatchHours: formatStarNumber(settings.peopleTasteMatchesDurationHours, lang),
    paidSuggestionCost: formatStarNumber(settings.paidSuggestionCost, lang),
    profileEmojiCost: formatStarNumber(settings.profileEmojiCost, lang),
  };
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    messages[lang].starsOverviewText,
  );
}

function buildStarRewardNotice(messages, lang, rewards = [], progress = null, { alwaysShowProgress = false } = {}) {
  const applied = Array.isArray(rewards) ? rewards.filter((reward) => Number(reward?.amount) > 0) : [];
  const total = applied.reduce((sum, reward) => sum + Number(reward.amount || 0), 0);
  const lastBalance = applied.length ? applied.at(-1).balance : null;
  const reasonLabels = applied.map((reward) => (
    messages[lang][`starsReason_${reward.milestone}`] || messages[lang].starsReason_generic
  ));
  const blocks = [];

  if (applied.length) {
    const rewardTemplate = applied.length === 1 && applied[0].milestone === "invite_pair_reward"
      ? messages[lang].starsInvitePairRewardNotice
      : messages[lang].starsEarnedNotice;
    blocks.push(rewardTemplate
      .replace("{amount}", formatStarNumber(total, lang))
      .replace("{balance}", formatStarNumber(lastBalance, lang))
      .replace("{reason}", reasonLabels.join(lang === "fa" ? " و " : " and ")));
  }

  if (
    progress &&
    Number(progress.reward) > 0 &&
    (alwaysShowProgress || applied.length > 0 || Number(progress.remaining) === 1)
  ) {
    blocks.push(messages[lang].starsNextMilestone
      .replace("{remaining}", formatStarNumber(progress.remaining, lang))
      .replace("{amount}", formatStarNumber(progress.reward, lang))
      .replace(
        "{milestone}",
        messages[lang][`starsNext_${progress.milestone}`] || messages[lang].starsNext_generic,
      ));
  }

  return blocks.join("\n\n");
}

function applyStarRewardsToContext(ctx, rewards = []) {
  const applied = Array.isArray(rewards) ? rewards.filter((reward) => Number.isFinite(Number(reward?.balance))) : [];
  if (ctx?.user && applied.length) ctx.user.starBalance = Number(applied.at(-1).balance) || 0;
  return ctx?.user?.starBalance;
}

async function notifyExternalReferralReward(ctx, messages, reward) {
  if (!reward?.ok || !reward.applied || !reward.inviterUserId) return false;
  const lang = messages[reward.inviterLang] ? reward.inviterLang : "fa";
  const text = buildStarRewardNotice(messages, lang, [{
    milestone: "external_referral_reward",
    amount: reward.amount,
    balance: reward.balance,
  }]);
  if (!text) return false;
  return ctx.sendToUser?.(reward.inviterUserId, text) || false;
}

module.exports = {
  applyStarRewardsToContext,
  buildStarRewardNotice,
  buildStarsOverviewText,
  formatStarNumber,
  notifyExternalReferralReward,
};
