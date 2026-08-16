const messages = require("../messages");
const { setLanguage, normalizeLang } = require("../lang");
const {
  languageKeyboard,
  mainMenuKeyboard,
  onboardingWelcomeKeyboard,
} = require("../keyboards");
const { callBacks } = require("../constants");
const { MODES, setNavigationMode } = require("../services/reply-keyboard-navigation");
const { sendNavigationFootprint } = require("../services/navigation-footprints");
const { updateUserFields, updateUserState } = require("../services/users");
const { leaveDiscussionAndClearKeyboardForNavigation } = require("../services/bot-navigation");
const { clearRememberedAiListMessage } = require("./ai-cards");
const {
  clearViewedPublicProfileMessage,
  forgetPeopleListMessage,
  forgetSavedProfilesListMessage,
} = require("./saved-profiles");
const { sendMuzeWelcome } = require("./onboarding");

function isLanguageCallback(data = "") {
  const value = String(data || "");
  return value === callBacks.language
    || value === callBacks.languageClose
    || value.startsWith(callBacks.langSet);
}

async function replyUnknown(ctx, lang) {
  try {
    return await ctx.editMessageText(messages[lang].unknownAction);
  } catch {
    return ctx.reply(messages[lang].unknownAction);
  }
}

function buildOnboardingWelcome(user, lang) {
  const userName = String(user?.profileName || user?.firstName || "").trim().replace(/\s+/g, " ");
  if (!userName) return messages[lang].onboardingWelcome;
  const greeting = lang === "fa"
    ? `👩‍🦳 سلام ${userName}، من میوزم.`
    : `👩‍🦳 Hi ${userName}, I’m Muze.`;
  return messages[lang].onboardingWelcome.replace(/^👩‍🦳[^\n]+/, greeting);
}

async function handleLanguageCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.language) {
    await ctx.answerCb?.();
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await leaveDiscussionAndClearKeyboardForNavigation(ctx, { clearKeyboard: false });
    await clearRememberedAiListMessage(ctx);
    await forgetSavedProfilesListMessage(ctx);
    await forgetPeopleListMessage(ctx);
    await setNavigationMode(ctx, MODES.GLOBAL);
    return editCallbackMessageOrReply(ctx, messages[lang].chooseLanguage, languageKeyboard(lang));
  }

  if (data === callBacks.languageClose) {
    await ctx.answerCb?.();
    return deleteCallbackMessageIfPossible(ctx);
  }

  const selected = normalizeLang(data.split(":")[2]);
  await ctx.answerCb?.();
  if (!selected || !ctx.user?.userId) return replyUnknown(ctx, lang);

  const updated = await setLanguage(ctx.user.userId, selected);
  if (!updated) return replyUnknown(ctx, lang);

  if (ctx.user) ctx.user.lang = selected;
  const onboardingState = String(ctx.user?.state || "");
  if (onboardingState === "onboarding_language" || onboardingState.startsWith("onboarding_invite_language:")) {
    if (onboardingState.startsWith("onboarding_invite_language:")) {
      const inviteCode = onboardingState.slice("onboarding_invite_language:".length);
      if (ctx.user) ctx.user.pendingDiscussionShareCode = inviteCode;
      await updateUserFields(ctx.userId, { pendingDiscussionShareCode: inviteCode });
    }
    await updateUserState(ctx.userId, "onboarding_welcome");
    if (ctx.user) ctx.user.state = "onboarding_welcome";
    await setNavigationMode(ctx, "onboarding_welcome");
    await deleteCallbackMessageIfPossible(ctx);
    return sendMuzeWelcome(
      ctx,
      buildOnboardingWelcome(ctx.user, selected),
      onboardingWelcomeKeyboard(selected),
    );
  }

  await deleteCallbackMessageIfPossible(ctx);
  await ctx.reply(messages[selected].languageChanged);
  await sendNavigationFootprint(ctx, { lang: selected, destination: "menu" });
  await setNavigationMode(ctx, MODES.GLOBAL);
  return ctx.reply(messages[selected].mainMenu, mainMenuKeyboard(selected));
}

module.exports = { buildOnboardingWelcome, handleLanguageCallback, isLanguageCallback };
