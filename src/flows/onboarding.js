const path = require("node:path");
const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  onboardingCompleteKeyboard,
  getOnboardingInterestChipTitle,
  mainMenuKeyboard,
  onboardingInterestsKeyboard,
  onboardingLanguageKeyboard,
  onboardingSectionsKeyboard,
  onboardingWelcomeKeyboard,
} = require("../keyboards");
const {
  addAiListItem,
  getAiListItemsFromUser,
  removeAiListItem,
  updateProfileField,
  updateUserState,
} = require("../services/users");
const { operationalLimits } = require("../services/operational-limits");
const { starEconomy } = require("../services/star-settings");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
  formatStarNumber,
  notifyExternalReferralReward,
} = require("../services/stars-ui");
const { EVENT_NAMES, trackEvent } = require("../services/analytics-events");
const { MODES, setNavigationMode } = require("../services/reply-keyboard-navigation");
const { sendBannerPhoto } = require("../services/banner-media");
const { importPendingInlineListItems } = require("../services/pending-inline-lists");
const { preserveSharedLinkInvitation } = require("../services/discussion-invitations");
const { getSectionLabel } = require("../services/ai-section");

const ONBOARDING_VERSION = 1;
const NEW_USER_WINDOW_MS = 10 * 60 * 1000;
const ONBOARDING_SECTIONS_STATE = "onboarding_sections";
const ONBOARDING_FAVORITES_PREFIX = "onboarding_favorites:";
const ONBOARDING_COMPLETE_PREFIX = "onboarding_complete:";
const TASTE_SETUP_STATE = "onboarding_taste_setup_interests";
const ONBOARDING_GOAL = 3;
const MEDIA_SECTIONS = new Set(["movies", "music", "books"]);
const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
const MUZE_WELCOME_BANNER_PATH = path.join(
  __dirname,
  "../../assets/muze-welcome-banner-cinematic-v2.jpg",
);

function getOnboardingInterestGoal() {
  return ONBOARDING_GOAL;
}

function getOnboardingInterestLimit() {
  return ONBOARDING_GOAL;
}

function getStateSection(state = "", prefix = ONBOARDING_FAVORITES_PREFIX) {
  const section = String(state).startsWith(prefix) ? String(state).slice(prefix.length) : "";
  return MEDIA_SECTIONS.has(section) ? section : "";
}

function isOnboardingInProgress(user) {
  if (!user || Number(user.onboardingVersion) >= ONBOARDING_VERSION) return false;
  return String(user.state || "").startsWith("onboarding_");
}

function shouldOfferOnboarding(user, now = new Date()) {
  if (!user || Number(user.onboardingVersion) >= ONBOARDING_VERSION) return false;
  if (isOnboardingInProgress(user)) return true;
  const hasListActivity = ["movies", "music", "books", "random"].some((section) => (
    getAiListItemsFromUser(user, section, "topTen").length > 0
    || getAiListItemsFromUser(user, section, "watchlist").length > 0
  ));
  const hasSocialActivity = Boolean(
    user.activeDiscussionId || user.bio || user.city || (user.savedProfileCodes || []).length
  );
  if (hasListActivity || hasSocialActivity) return false;
  const createdAt = new Date(user.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  const age = now.getTime() - createdAt;
  return age >= 0 && age <= NEW_USER_WINDOW_MS;
}

function shouldRunOnboardingForSharedDiscussion(user) {
  return Boolean(user) && Number(user.onboardingVersion) < ONBOARDING_VERSION;
}

function isOnboardingCallback(data = "") {
  return data === callBacks.onboardingStart
    || data === callBacks.onboardingTasteSetupStart
    || data === callBacks.onboardingTasteSetupDismiss
    || data.startsWith(callBacks.onboardingInterest)
    || data.startsWith(callBacks.onboardingInterestRemove)
    || data.startsWith(callBacks.onboardingMore)
    || data.startsWith(callBacks.onboardingSection)
    || data.startsWith(callBacks.onboardingSuggestion);
}

async function sendMuzeWelcome(ctx, text, keyboard) {
  if (!ctx.replyWithPhoto || text.length > TELEGRAM_CAPTION_MAX_LENGTH) {
    return ctx.reply(text, keyboard);
  }
  try {
    return await sendBannerPhoto(ctx, {
      bannerKey: "muze_welcome_v3",
      localSource: MUZE_WELCOME_BANNER_PATH,
      configuredFileId: process.env.MUZE_WELCOME_BANNER_V3_FILE_ID,
      extra: { ...keyboard, caption: text },
    });
  } catch {
    return ctx.reply(text, keyboard);
  }
}

async function showSectionPicker(ctx, lang) {
  await updateUserState(ctx.userId, ONBOARDING_SECTIONS_STATE);
  if (ctx.user) ctx.user.state = ONBOARDING_SECTIONS_STATE;
  await setNavigationMode(ctx, ONBOARDING_SECTIONS_STATE);
  return ctx.reply(messages[lang].onboardingSectionPrompt, onboardingSectionsKeyboard(lang));
}

function getFavoritesPrompt(lang, section) {
  const key = section === "movies"
    ? "aiMovieFavoritesAddPrompt"
    : section === "music"
      ? "aiMusicFavoritesAddPrompt"
      : "aiBookFavoritesAddPrompt";
  return messages[lang][key];
}

async function enterFavoritesStep(ctx, lang, section, { resume = false } = {}) {
  if (!MEDIA_SECTIONS.has(section)) return null;
  const state = `${ONBOARDING_FAVORITES_PREFIX}${section}`;
  await updateUserState(ctx.userId, state);
  if (ctx.user) ctx.user.state = state;
  await setNavigationMode(ctx, state);
  const count = Math.min(
    ONBOARDING_GOAL,
    getAiListItemsFromUser(ctx.user, section, "topTen").length,
  );
  const reminder = resume && count > 0
    ? messages[lang][count === 1 ? "onboardingResumeOne" : "onboardingResumeTwo"]
      .replace("{section}", getSectionLabel(messages, lang, section))
    : getFavoritesPrompt(lang, section);
  return ctx.reply(reminder, { reply_markup: { remove_keyboard: true } });
}

async function startOnboardingLanguage(ctx, lang, inviteCode = "") {
  const currentState = String(ctx.user?.state || "");
  if (
    currentState === "onboarding_welcome"
    || currentState === ONBOARDING_SECTIONS_STATE
    || getStateSection(currentState)
  ) {
    if (inviteCode) {
      await updateProfileField(ctx.userId, "pendingDiscussionShareCode", inviteCode);
      if (ctx.user) ctx.user.pendingDiscussionShareCode = inviteCode;
    }
    return resumeOnboarding(ctx, lang);
  }
  const state = inviteCode ? `onboarding_invite_language:${inviteCode}` : "onboarding_language";
  await updateUserState(ctx.userId, state);
  if (ctx.user) ctx.user.state = state;
  await setNavigationMode(ctx, "onboarding_language");
  void trackEvent({
    name: EVENT_NAMES.onboardingStarted,
    userId: ctx.userId,
    source: inviteCode ? "shared_discussion" : "direct",
  });
  return ctx.reply(messages[lang].chooseLanguage, onboardingLanguageKeyboard());
}

async function resumeOnboarding(ctx, lang) {
  const state = String(ctx.user?.state || "");
  const section = getStateSection(state);
  if (section) return enterFavoritesStep(ctx, lang, section, { resume: true });
  if (state === "onboarding_welcome") {
    await setNavigationMode(ctx, "onboarding_welcome");
    return sendMuzeWelcome(ctx, messages[lang].onboardingWelcome, onboardingWelcomeKeyboard(lang));
  }
  if (state === ONBOARDING_SECTIONS_STATE || state.startsWith("onboarding_interests")) {
    return showSectionPicker(ctx, lang);
  }
  await setNavigationMode(ctx, "onboarding_language");
  return ctx.reply(messages[lang].chooseLanguage, onboardingLanguageKeyboard());
}

async function completeOnboarding(ctx, section) {
  await updateProfileField(ctx.userId, "onboardingVersion", ONBOARDING_VERSION);
  await updateProfileField(ctx.userId, "onboardingCompletedAt", new Date());
  await updateProfileField(ctx.userId, "onboardingPromptMessageId", null);
  await updateUserState(ctx.userId, "idle");
  if (ctx.user) {
    ctx.user.onboardingVersion = ONBOARDING_VERSION;
    ctx.user.onboardingCompletedAt = new Date();
    ctx.user.onboardingPromptMessageId = null;
    ctx.user.state = "idle";
  }
  await setNavigationMode(ctx, `${ONBOARDING_COMPLETE_PREFIX}${section}`);
  await importPendingInlineListItems(ctx.userId).catch(() => null);
  if (ctx.user?.pendingDiscussionShareCode) {
    await preserveSharedLinkInvitation({
      userId: ctx.userId,
      discussionPublicCode: ctx.user.pendingDiscussionShareCode,
      inviterUserId: ctx.user.pendingDiscussionShareInviterUserId,
    }).catch(() => null);
  }
  void trackEvent({
    name: EVENT_NAMES.onboardingCompleted,
    userId: ctx.userId,
    source: "onboarding",
    section,
  });
}

function buildSavedText(lang, item, count, result) {
  if (count === 1) {
    return messages[lang].onboardingFirstSaved
      .replace("{item}", item)
      .replace("{amount}", formatStarNumber(starEconomy.rewardFirstThreePerSection, lang));
  }
  if (count === 2) {
    return messages[lang].onboardingSecondSaved.replace("{item}", item);
  }
  const notice = buildStarRewardNotice(messages, lang, result.starRewards);
  return messages[lang].onboardingThirdSaved
    .replace("{item}", item)
    .replace("{starNotice}", notice ? `${notice}\n\n` : "");
}

async function handleOnboardingCallback(ctx, lang, helpers = {}) {
  const data = String(ctx.callbackData || "");
  const state = String(ctx.user?.state || "");
  await ctx.answerCb?.();

  if (data === callBacks.onboardingTasteSetupDismiss) {
    const at = new Date();
    await updateProfileField(ctx.userId, "onboardingTasteSetupNudgedAt", at);
    if (ctx.user) ctx.user.onboardingTasteSetupNudgedAt = at;
    await setNavigationMode(ctx, MODES.GLOBAL);
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === callBacks.onboardingTasteSetupStart) {
    if (Number(ctx.user?.onboardingVersion) >= ONBOARDING_VERSION) {
      return helpers.deleteCallbackMessageIfPossible?.(ctx);
    }
    await updateUserState(ctx.userId, TASTE_SETUP_STATE);
    if (ctx.user) ctx.user.state = TASTE_SETUP_STATE;
    await setNavigationMode(ctx, "onboarding_taste_interests:0");
    return ctx.reply(
      buildTasteSetupPrompt(lang, getAiListItemsFromUser(ctx.user, "random", "topTen")),
      onboardingInterestsKeyboard(lang),
    );
  }

  if (state === TASTE_SETUP_STATE) {
    const current = getAiListItemsFromUser(ctx.user, "random", "topTen");
    if (data.startsWith(callBacks.onboardingMore)) {
      const page = Math.max(0, Number(data.slice(callBacks.onboardingMore.length)) || 0);
      await setNavigationMode(ctx, `onboarding_taste_interests:${page}`);
      return ctx.reply(
        buildTasteSetupPrompt(lang, current),
        onboardingInterestsKeyboard(lang, current.map((entry) => entry.title), page),
      );
    }
    if (data.startsWith(callBacks.onboardingInterestRemove)) {
      const index = Math.max(0, Number(data.slice(callBacks.onboardingInterestRemove.length).split(":")[0]) || 0);
      const title = current[index]?.title;
      if (!title) return null;
      const removed = await removeAiListItem(ctx.userId, "random", "topTen", title);
      if (ctx.user?.aiLists?.random) ctx.user.aiLists.random.topTen = removed.items || [];
      return ctx.reply(
        buildTasteSetupPrompt(lang, removed.items || []),
        onboardingInterestsKeyboard(lang, (removed.items || []).map((entry) => entry.title)),
      );
    }
    if (data.startsWith(callBacks.onboardingInterest)) {
      const index = Number(data.slice(callBacks.onboardingInterest.length).split(":")[0]);
      const title = getOnboardingInterestChipTitle(index, lang);
      if (!title) return null;
      return saveTasteSetupItem(ctx, lang, title);
    }
  }

  if (data === callBacks.onboardingStart) {
    if (state !== "onboarding_welcome") return helpers.deleteCallbackMessageIfPossible?.(ctx);
    await helpers.deleteCallbackMessageIfPossible?.(ctx);
    return showSectionPicker(ctx, lang);
  }

  if (data.startsWith(callBacks.onboardingSection)) {
    if (state !== ONBOARDING_SECTIONS_STATE) return helpers.deleteCallbackMessageIfPossible?.(ctx);
    const section = data.slice(callBacks.onboardingSection.length);
    if (!MEDIA_SECTIONS.has(section)) return helpers.deleteCallbackMessageIfPossible?.(ctx);
    return enterFavoritesStep(ctx, lang, section);
  }

  if (data.startsWith(callBacks.onboardingSuggestion)) {
    const section = data.slice(callBacks.onboardingSuggestion.length);
    if (
      state !== "idle"
      || ctx.user?.navigationMode !== `${ONBOARDING_COMPLETE_PREFIX}${section}`
      || !MEDIA_SECTIONS.has(section)
    ) {
      return helpers.deleteCallbackMessageIfPossible?.(ctx);
    }
    const { promptSuggestionMode } = require("./ai-text");
    return promptSuggestionMode(ctx, lang, section);
  }
  return null;
}

async function handleOnboardingText(ctx, lang, helpers = {}) {
  const state = String(ctx.user?.state || "");
  if (state === TASTE_SETUP_STATE) {
    return saveTasteSetupItem(ctx, lang, String(ctx.text || "").trim().replace(/\s+/g, " "));
  }
  if (state === ONBOARDING_SECTIONS_STATE) {
    return ctx.reply(messages[lang].sectionTextUseBottomButtons, onboardingSectionsKeyboard(lang));
  }
  const section = getStateSection(state);
  if (!section) return undefined;
  const item = String(ctx.text || "").trim().replace(/\s+/g, " ");
  const result = await addAiListItem(
    ctx.userId,
    section,
    "topTen",
    { title: item, comment: "" },
    operationalLimits.aiTopTenItems,
  );
  if (!result.ok) {
    const sectionKey = section.charAt(0).toUpperCase() + section.slice(1);
    const error = result.reason === "exists"
      ? messages[lang].aiListDuplicateMatch.replace("{item}", result.duplicate?.title || item)
      : result.reason === "limit"
        ? messages[lang].aiTopTenLimitReached
          .replaceAll("{topTenLimit}", String(operationalLimits.aiTopTenItems))
        : messages[lang][`aiTopTenInvalidItemQuality${sectionKey}`]
          || messages[lang].aiTopTenInvalidItemQuality;
    return ctx.reply(error, { reply_markup: { remove_keyboard: true } });
  }
  if (ctx.user) {
    ctx.user.aiLists ||= {};
    ctx.user.aiLists[section] ||= {};
    ctx.user.aiLists[section].topTen = result.items;
  }
  applyStarRewardsToContext(ctx, result.starRewards);
  await notifyExternalReferralReward(ctx, messages, result.externalReferralReward);
  const count = Math.min(ONBOARDING_GOAL, result.items.length);
  const response = buildSavedText(lang, item, count, result);
  if (count < ONBOARDING_GOAL) {
    return ctx.reply(response, { reply_markup: { remove_keyboard: true } });
  }

  await completeOnboarding(ctx, section);
  await ctx.reply(response, onboardingCompleteKeyboard(lang, { section }));
  const discussionCode = String(ctx.user?.pendingDiscussionShareCode || "");
  if (discussionCode && typeof helpers.showSharedDiscussionPreview === "function") {
    return helpers.showSharedDiscussionPreview(discussionCode);
  }
  const profileCode = String(ctx.user?.pendingProfileShareCode || "");
  if (profileCode && typeof helpers.showSharedProfile === "function") {
    await updateProfileField(ctx.userId, "pendingProfileShareCode", "");
    if (ctx.user) ctx.user.pendingProfileShareCode = "";
    return helpers.showSharedProfile(profileCode);
  }
  return null;
}

function getOnboardingCompletionDestination(ctx, data) {
  if (!ctx?.isReplyKeyboardAction) return "";
  if (!String(ctx.user?.navigationMode || "").startsWith(ONBOARDING_COMPLETE_PREFIX)) return "";
  if (data === callBacks.menuMain) return "main_menu";
  if (data.startsWith(callBacks.onboardingSuggestion)) return "suggestion";
  return "";
}

function trackOnboardingCompletionDestination(ctx, data) {
  const destination = getOnboardingCompletionDestination(ctx, data);
  if (destination) {
    void trackEvent({
      name: EVENT_NAMES.onboardingDestinationChosen,
      userId: ctx.userId,
      source: "onboarding_complete",
      section: destination,
      metadata: { destination },
    });
  }
  return destination;
}

function buildTasteSetupPrompt(lang, items = []) {
  return messages[lang].onboardingInterestsPrompt
    .replace("{selected}", items.length
      ? messages[lang].onboardingInterestsSelected.replace(
        "{items}",
        items.map((entry) => `- ${entry.title}`).join("\n"),
      )
      : "")
    .replace("{count}", String(items.length))
    .replaceAll("{goal}", String(ONBOARDING_GOAL))
    .replace("{limit}", String(ONBOARDING_GOAL));
}

async function saveTasteSetupItem(ctx, lang, title) {
  const result = await addAiListItem(
    ctx.userId,
    "random",
    "topTen",
    { title, comment: "" },
    ONBOARDING_GOAL,
    { awardStars: false },
  );
  const items = result.ok ? result.items : getAiListItemsFromUser(ctx.user, "random", "topTen");
  if (result.ok && ctx.user?.aiLists?.random) ctx.user.aiLists.random.topTen = items;
  if (!result.ok && result.reason !== "exists") {
    return ctx.reply(messages[lang].onboardingCustomInvalid, onboardingInterestsKeyboard(lang));
  }
  if (items.length >= ONBOARDING_GOAL) {
    const at = new Date();
    await updateProfileField(ctx.userId, "onboardingTasteSetupNudgedAt", at);
    await updateUserState(ctx.userId, "idle");
    if (ctx.user) {
      ctx.user.onboardingTasteSetupNudgedAt = at;
      ctx.user.state = "idle";
    }
    await setNavigationMode(ctx, MODES.GLOBAL);
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }
  return ctx.reply(
    buildTasteSetupPrompt(lang, items),
    onboardingInterestsKeyboard(lang, items.map((entry) => entry.title)),
  );
}

function shouldOfferTasteSetupNudge(user) {
  if (!user || Number(user.onboardingVersion) >= ONBOARDING_VERSION) return false;
  if (user.onboardingTasteSetupNudgedAt) return false;
  if (String(user.state || "").startsWith("onboarding_")) return false;
  return getAiListItemsFromUser(user, "random", "topTen").length < ONBOARDING_GOAL;
}

async function sendTasteSetupNudge(ctx, lang) {
  if (!shouldOfferTasteSetupNudge(ctx.user)) return null;
  const { onboardingTasteSetupNudgeKeyboard } = require("../keyboards");
  const at = new Date();
  await updateProfileField(ctx.userId, "onboardingTasteSetupNudgedAt", at);
  if (ctx.user) ctx.user.onboardingTasteSetupNudgedAt = at;
  await setNavigationMode(ctx, "onboarding_taste_nudge");
  return ctx.reply(messages[lang].onboardingTasteSetupNudge, onboardingTasteSetupNudgeKeyboard(lang));
}

function buildOnboardingPrompt(lang) {
  return messages[lang].onboardingSectionPrompt;
}

function buildOnboardingCompleteText(lang) {
  return messages[lang].onboardingThirdSaved;
}

function getOnboardingPage() {
  return 0;
}

module.exports = {
  NEW_USER_WINDOW_MS,
  ONBOARDING_VERSION,
  buildOnboardingCompleteText,
  buildOnboardingPrompt,
  getOnboardingInterestGoal,
  getOnboardingInterestLimit,
  getOnboardingCompletionDestination,
  getOnboardingPage,
  handleOnboardingCallback,
  handleOnboardingText,
  isOnboardingCallback,
  isOnboardingInProgress,
  resumeOnboarding,
  shouldOfferOnboarding,
  shouldRunOnboardingForSharedDiscussion,
  shouldOfferTasteSetupNudge,
  sendTasteSetupNudge,
  sendMuzeWelcome,
  startOnboardingLanguage,
  trackOnboardingCompletionDestination,
};
