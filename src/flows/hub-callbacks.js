const messages = require("../messages");
const {
  discussionsMenuKeyboard,
  helpRulesKeyboard,
  mainMenuKeyboard,
} = require("../keyboards");
const { callBacks } = require("../constants");
const { formatOperationalLimitsText } = require("../services/operational-limits-ui");
const { sendNavigationFootprint } = require("../services/navigation-footprints");
const { MODES } = require("../services/reply-keyboard-navigation");
const {
  hasSectionTipBeenShown,
  markSectionTipShownForContext,
} = require("../services/users");
const { buildGuideReferralCard, sendGuideReferralCard } = require("./guide-referrals");
const { sendAiAssistantHub } = require("./ai-hub");
const { restoreGuideHubCard, sendGuideHub } = require("./guide-hub");
const { sendOwnProfile } = require("./profile-callbacks");
const {
  buildDiscussionsMenuText,
  getInvitationCount,
} = require("./discussion-invitations");
const {
  clearViewedPublicProfileMessage,
  forgetPeopleListMessage,
  forgetSavedProfilesListMessage,
} = require("./saved-profiles");
const { clearRememberedAiListMessage } = require("./ai-cards");
const { leaveDiscussionAndClearKeyboardForNavigation } = require("../services/bot-navigation");

const HUB_CALLBACKS = new Set([
  callBacks.menuMain,
  callBacks.help,
  callBacks.helpRules,
  callBacks.helpCardClose,
  callBacks.profile,
  callBacks.helpReferral,
  callBacks.helpReferralBack,
  callBacks.aiAssistant,
  callBacks.discussions,
]);

function isHubCallback(data = "") {
  return HUB_CALLBACKS.has(String(data || ""));
}

async function prepareHubNavigation(ctx, { clearAi = false } = {}) {
  await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
  await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
  if (clearAi) await clearRememberedAiListMessage(ctx);
  await forgetSavedProfilesListMessage(ctx);
  await forgetPeopleListMessage(ctx);
}

async function handleHubCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
  hasTemporaryReplyKeyboard,
  showBottomHub,
}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.menuMain) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await prepareHubNavigation(ctx);
    return showBottomHub(
      ctx,
      lang,
      "menu",
      MODES.GLOBAL,
      messages[lang].mainMenu,
      mainMenuKeyboard(lang),
      shouldClearKeyboard,
    );
  }

  if (data === callBacks.help) {
    await ctx.answerCb?.();
    return sendGuideHub(ctx, lang);
  }

  if (data === callBacks.helpRules) {
    await ctx.answerCb?.();
    return editCallbackMessageOrReply(
      ctx,
      formatOperationalLimitsText(messages[lang].helpRulesText),
      helpRulesKeyboard(lang),
    );
  }

  if (data === callBacks.helpCardClose) {
    await ctx.answerCb?.();
    return deleteCallbackMessageIfPossible(ctx);
  }

  if (data === callBacks.profile) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await prepareHubNavigation(ctx, { clearAi: true });
    await deleteCallbackMessageIfPossible(ctx);
    await sendNavigationFootprint(ctx, {
      lang,
      destination: "profile",
      ...(shouldClearKeyboard ? { removeKeyboard: true } : {}),
    });
    return sendOwnProfile(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.helpReferral || data === callBacks.helpReferralBack) {
    if (data === callBacks.helpReferralBack) {
      await ctx.answerCb?.();
      return restoreGuideHubCard(ctx, lang);
    }
    const card = await buildGuideReferralCard(ctx.userId, lang);
    if (!card.ok) return ctx.answerCb?.(messages[lang].unknownAction, { show_alert: true });
    await ctx.answerCb?.();
    return sendGuideReferralCard(ctx, card, editCallbackMessageOrReply);
  }

  if (data === callBacks.aiAssistant) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await prepareHubNavigation(ctx);
    const showFirstVisitTip = !hasSectionTipBeenShown(ctx.user, "favorites");
    await sendNavigationFootprint(ctx, { lang, destination: "taste", removeKeyboard: shouldClearKeyboard });
    const sent = await sendAiAssistantHub(ctx, lang, { showFirstVisitTip });
    if (showFirstVisitTip) {
      await markSectionTipShownForContext(ctx, "favorites", new Date()).catch(() => null);
    }
    return sent;
  }

  if (data === callBacks.discussions) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await prepareHubNavigation(ctx, { clearAi: true });
    const invitationCount = await getInvitationCount(ctx.userId);
    return showBottomHub(
      ctx,
      lang,
      "discussions",
      MODES.DISCUSSIONS,
      buildDiscussionsMenuText(lang, invitationCount),
      discussionsMenuKeyboard(lang),
      shouldClearKeyboard,
    );
  }

  return null;
}

module.exports = { handleHubCallback, isHubCallback };
