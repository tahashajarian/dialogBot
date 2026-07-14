const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  ONBOARDING_CHIPS_PER_PAGE,
  getOnboardingInterestChipTitle,
  onboardingCompleteKeyboard,
  onboardingCustomInterestKeyboard,
  onboardingInterestsKeyboard,
  onboardingLanguageKeyboard,
  onboardingTasteSetupNudgeKeyboard,
  mainMenuKeyboard,
} = require("../keyboards");
const {
  addAiListItem,
  getAiListItemsFromUser,
  removeAiListItem,
  updateProfileField,
  updateUserState,
} = require("../services/users");
const { operationalLimits } = require("../services/operational-limits");
const { EVENT_NAMES, trackEvent } = require("../services/analytics-events");
const { createOnboardingStarterInvitationsForUser } = require("../services/discussion-invitations");
const { MODES, setNavigationMode } = require("../services/reply-keyboard-navigation");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
  notifyExternalReferralReward,
} = require("../services/stars-ui");

const ONBOARDING_VERSION = 1;
const NEW_USER_WINDOW_MS = 10 * 60 * 1000;
const ONBOARDING_INTERESTS_STATE = "onboarding_interests";
const TASTE_SETUP_INTERESTS_STATE = "onboarding_taste_setup_interests";
const ONBOARDING_CUSTOM_PREFIX = "onboarding_custom_interest:";
const TASTE_SETUP_CUSTOM_PREFIX = "onboarding_taste_setup_custom_interest:";

function getOnboardingInterestGoal() {
  return Math.min(operationalLimits.onboardingInterestMinItems, operationalLimits.onboardingInterestMaxItems);
}

function getOnboardingInterestLimit() {
  return Math.max(getOnboardingInterestGoal(), operationalLimits.onboardingInterestMaxItems);
}

function isOnboardingCallback(data = "") {
  return data === callBacks.onboardingStart
    || data === callBacks.onboardingContinue
    || data === callBacks.onboardingTasteSetupStart
    || data === callBacks.onboardingTasteSetupDismiss
    || data.startsWith(callBacks.onboardingInterest)
    || data.startsWith(callBacks.onboardingInterestRemove)
    || data.startsWith(callBacks.onboardingMore)
    || data.startsWith(callBacks.onboardingCustom);
}

function getOnboardingPage(value = "") {
  const page = Number(String(value).split(":").at(-1));
  return Number.isInteger(page) && page >= 0 ? page : 0;
}

function getOnboardingIndex(value = "", prefix = "") {
  const index = Number(String(value).replace(prefix, "").split(":")[0]);
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

function isTasteSetupState(state = "") {
  return state === TASTE_SETUP_INTERESTS_STATE || state.startsWith(TASTE_SETUP_CUSTOM_PREFIX);
}

function isInterestPickerState(state = "") {
  return state === ONBOARDING_INTERESTS_STATE || state === TASTE_SETUP_INTERESTS_STATE;
}

function getCustomInterestPrefixForState(state = "") {
  return isTasteSetupState(state) ? TASTE_SETUP_CUSTOM_PREFIX : ONBOARDING_CUSTOM_PREFIX;
}

async function sendFreshOnboardingPrompt(ctx, text, keyboard) {
  return ctx.reply(text, keyboard);
}

async function setOnboardingPickerMode(ctx, state, page = 0) {
  const taste = isTasteSetupState(state);
  const custom = state.startsWith(ONBOARDING_CUSTOM_PREFIX) || state.startsWith(TASTE_SETUP_CUSTOM_PREFIX);
  return setNavigationMode(ctx, `onboarding_${taste ? "taste_" : ""}${custom ? "custom" : "interests"}:${Number(page) || 0}`);
}

function shouldOfferOnboarding(user, now = new Date()) {
  if (!user || Number(user.onboardingVersion) >= ONBOARDING_VERSION) return false;
  const hasListActivity = ["movies", "music", "books", "random"].some((section) => (
    getAiListItemsFromUser(user, section, "topTen").length > 0
    || getAiListItemsFromUser(user, section, "watchlist").length > 0
  ));
  const hasSocialActivity = Boolean(
    user.activeDiscussionId
    || user.bio
    || user.city
    || (user.savedProfileCodes || []).length,
  );
  if (hasListActivity || hasSocialActivity) return false;

  const createdAt = new Date(user.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  const accountAge = now.getTime() - createdAt;
  return accountAge >= 0 && accountAge <= NEW_USER_WINDOW_MS;
}

function shouldOfferTasteSetupNudge(user) {
  if (!user || Number(user.onboardingVersion) >= ONBOARDING_VERSION) return false;
  if (user.onboardingTasteSetupNudgedAt) return false;
  if (String(user.state || "").startsWith("onboarding_")) return false;
  return getAiListItemsFromUser(user, "random", "topTen").length < getOnboardingInterestGoal();
}

function buildOnboardingPrompt(lang, count = 0, item = "") {
  const key = item ? "onboardingInterestAdded" : "onboardingInterestsPrompt";
  return messages[lang][key]
    .replace("{item}", item)
    .replace("{count}", String(count))
    .replaceAll("{goal}", String(getOnboardingInterestGoal()))
    .replace("{limit}", String(getOnboardingInterestLimit()));
}

function buildOnboardingCompleteText(lang, { hasInvitation = false } = {}) {
  const base = messages[lang].onboardingComplete
    .replace("{goal}", String(getOnboardingInterestGoal()));
  if (!hasInvitation) return base;
  const paragraphs = base.split("\n\n");
  paragraphs.splice(Math.max(1, paragraphs.length - 1), 0, messages[lang].onboardingInvitationReady);
  return paragraphs.join("\n\n");
}

async function prepareOnboardingCompletion(ctx, lang) {
  const discussionContinuation = Boolean(ctx.user?.pendingDiscussionShareCode);
  const invitationResult = discussionContinuation
    ? { count: 0 }
    : await createOnboardingStarterInvitationsForUser(ctx.userId).catch(() => ({ count: 0 }));
  const hasInvitation = Number(invitationResult?.count) > 0;
  await setNavigationMode(ctx, `onboarding_complete:${hasInvitation ? 1 : 0}:${discussionContinuation ? 1 : 0}`);
  return {
    text: buildOnboardingCompleteText(lang, { hasInvitation }),
    keyboard: onboardingCompleteKeyboard(lang, { hasInvitation, discussionContinuation }),
  };
}

function buildOnboardingStarNotice(lang, rewards = []) {
  return buildStarRewardNotice({
    ...messages,
    [lang]: {
      ...messages[lang],
      starsReason_topten_first_milestone: messages[lang].onboardingStarsReasonInterests
        .replace("{goal}", String(getOnboardingInterestGoal())),
    },
  }, lang, rewards);
}

async function completeOnboardingForState(ctx, state, skipped = false) {
  await completeOnboarding(ctx, skipped);
}

async function sendTasteSetupNudge(ctx, lang) {
  if (!shouldOfferTasteSetupNudge(ctx.user)) return null;
  const nudgedAt = new Date();
  if (ctx.user) ctx.user.onboardingTasteSetupNudgedAt = nudgedAt;
  await updateProfileField(ctx.userId, "onboardingTasteSetupNudgedAt", nudgedAt);
  await setNavigationMode(ctx, "onboarding_taste_nudge");
  return ctx.reply(
    messages[lang].onboardingTasteSetupNudge,
    onboardingTasteSetupNudgeKeyboard(lang),
  );
}

async function startOnboardingLanguage(ctx, lang, inviteCode = "", { removeReplyKeyboard = false } = {}) {
  const state = inviteCode
    ? `onboarding_invite_language:${inviteCode}`
    : "onboarding_language";
  await updateUserState(ctx.userId, state);
  await setNavigationMode(ctx, "onboarding_language");
  return ctx.reply(messages[lang].chooseLanguage, onboardingLanguageKeyboard());
}

async function completeOnboarding(ctx, skipped = false) {
  await updateProfileField(ctx.userId, "onboardingVersion", ONBOARDING_VERSION);
  await updateProfileField(
    ctx.userId,
    skipped ? "onboardingSkippedAt" : "onboardingCompletedAt",
    new Date(),
  );
  await updateProfileField(ctx.userId, "onboardingPromptMessageId", null);
  if (ctx.user) ctx.user.onboardingPromptMessageId = null;
  await updateUserState(ctx.userId, "idle");
  void trackEvent({
    name: skipped ? EVENT_NAMES.onboardingSkipped : EVENT_NAMES.onboardingCompleted,
    userId: ctx.userId,
    source: "onboarding",
  });
}

async function handleOnboardingCallback(ctx, lang, helpers = {}) {
  const data = ctx.callbackData || "";
  const state = String(ctx.user?.state || "");
  await ctx.answerCb?.();

  if (data === callBacks.onboardingTasteSetupDismiss) {
    if (!ctx.user?.onboardingTasteSetupNudgedAt) {
      await updateProfileField(ctx.userId, "onboardingTasteSetupNudgedAt", new Date());
    }
    await setNavigationMode(ctx, MODES.GLOBAL);
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  if (data === callBacks.onboardingTasteSetupStart) {
    if (Number(ctx.user?.onboardingVersion) >= ONBOARDING_VERSION) {
      return helpers.deleteCallbackMessageIfPossible?.(ctx);
    }
    const items = getAiListItemsFromUser(ctx.user, "random", "topTen");
    await updateUserState(ctx.userId, TASTE_SETUP_INTERESTS_STATE);
    await setOnboardingPickerMode(ctx, TASTE_SETUP_INTERESTS_STATE, 0);
    return helpers.editCallbackMessageOrReply(
      ctx,
      buildOnboardingPrompt(lang, items.length),
      onboardingInterestsKeyboard(lang, items.map((entry) => entry.title)),
    );
  }

  if (!state.startsWith("onboarding_")) {
    return helpers.deleteCallbackMessageIfPossible?.(ctx);
  }

  if (data === callBacks.onboardingStart) {
    if (state !== "onboarding_welcome") {
      return helpers.deleteCallbackMessageIfPossible?.(ctx);
    }
    await updateUserState(ctx.userId, "onboarding_interests");
    await setOnboardingPickerMode(ctx, ONBOARDING_INTERESTS_STATE, 0);
    return helpers.editCallbackMessageOrReply(
      ctx,
      buildOnboardingPrompt(lang),
      onboardingInterestsKeyboard(lang),
    );
  }

  if (data === callBacks.onboardingSkip) {
    return helpers.deleteCallbackMessageIfPossible?.(ctx);
  }

  if (data.startsWith(callBacks.onboardingCustomCancel)) {
    if (!state.startsWith(ONBOARDING_CUSTOM_PREFIX) && !state.startsWith(TASTE_SETUP_CUSTOM_PREFIX)) {
      return helpers.deleteCallbackMessageIfPossible?.(ctx);
    }
    const page = getOnboardingPage(data);
    const items = getAiListItemsFromUser(ctx.user, "random", "topTen");
    await updateUserState(ctx.userId, isTasteSetupState(state) ? TASTE_SETUP_INTERESTS_STATE : ONBOARDING_INTERESTS_STATE);
    await setOnboardingPickerMode(ctx, state, page);
    return helpers.editCallbackMessageOrReply(
      ctx,
      buildOnboardingPrompt(lang, items.length),
      onboardingInterestsKeyboard(lang, items.map((entry) => entry.title), page),
    );
  }

  if (!isInterestPickerState(state)) {
    return helpers.deleteCallbackMessageIfPossible?.(ctx);
  }

  if (data.startsWith(callBacks.onboardingMore)) {
    const page = getOnboardingPage(data);
    const items = getAiListItemsFromUser(ctx.user, "random", "topTen");
    await setOnboardingPickerMode(ctx, state, page);
    return helpers.editCallbackMessageOrReply(
      ctx,
      buildOnboardingPrompt(lang, items.length),
      onboardingInterestsKeyboard(lang, items.map((entry) => entry.title), page),
    );
  }

  if (data === callBacks.onboardingContinue) {
    const items = getAiListItemsFromUser(ctx.user, "random", "topTen");
    const goal = getOnboardingInterestGoal();
    if (items.length < goal) {
      return ctx.answerCb?.(
        messages[lang].onboardingNeedMoreInterests.replace("{goal}", String(goal)),
        { show_alert: true },
      );
    }
    await completeOnboardingForState(ctx, state);
    const completion = await prepareOnboardingCompletion(ctx, lang);
    return helpers.editCallbackMessageOrReply(
      ctx,
      completion.text,
      completion.keyboard,
    );
  }

  if (data.startsWith(callBacks.onboardingInterestRemove)) {
    const index = getOnboardingIndex(data, callBacks.onboardingInterestRemove);
    const page = getOnboardingPage(data);
    const items = getAiListItemsFromUser(ctx.user, "random", "topTen");
    const item = items[index]?.title;
    if (!item) return ctx.reply(messages[lang].unknownAction);
    const result = await removeAiListItem(ctx.userId, "random", "topTen", item);
    if (ctx.user?.aiLists?.random) ctx.user.aiLists.random.topTen = result.items || [];
    await setOnboardingPickerMode(ctx, state, page);
    return helpers.editCallbackMessageOrReply(
      ctx,
      buildOnboardingPrompt(lang, (result.items || []).length),
      onboardingInterestsKeyboard(lang, (result.items || []).map((entry) => entry.title), page),
    );
  }

  if (data.startsWith(callBacks.onboardingCustom)) {
    const page = getOnboardingPage(data);
    await updateUserState(ctx.userId, `${getCustomInterestPrefixForState(state)}${page}`);
    await setOnboardingPickerMode(ctx, `${getCustomInterestPrefixForState(state)}${page}`, page);
    return helpers.editCallbackMessageOrReply(
      ctx,
      messages[lang].onboardingCustomPrompt,
      onboardingCustomInterestKeyboard(lang, page),
    );
  }

  const chipIndex = getOnboardingIndex(data, callBacks.onboardingInterest);
  const item = getOnboardingInterestChipTitle(chipIndex, lang);
  if (!item) {
    return ctx.reply(messages[lang].unknownAction);
  }

  const result = await addAiListItem(
    ctx.userId,
    "random",
    "topTen",
    { title: item, comment: "" },
    getOnboardingInterestLimit(),
  );
  const items = result.ok
    ? result.items
    : getAiListItemsFromUser(ctx.user, "random", "topTen");
  applyStarRewardsToContext(ctx, result.starRewards);
  await notifyExternalReferralReward(ctx, messages, result.externalReferralReward);
  const starNotice = buildOnboardingStarNotice(lang, result.starRewards);

  if (!result.ok && result.reason !== "exists") {
    return ctx.reply(
      result.reason === "limit"
        ? messages[lang].onboardingInterestLimitReached.replace("{limit}", String(getOnboardingInterestLimit()))
        : messages[lang].unknownAction,
    );
  }

  if (result.ok && items.length >= getOnboardingInterestGoal()) {
    await completeOnboardingForState(ctx, state);
    const completion = await prepareOnboardingCompletion(ctx, lang);
    return helpers.editCallbackMessageOrReply(
      ctx,
      [completion.text, starNotice]
        .filter(Boolean)
        .join("\n\n"),
      completion.keyboard,
    );
  }

  const page = getOnboardingPage(data) || Math.floor(chipIndex / ONBOARDING_CHIPS_PER_PAGE);
  await setOnboardingPickerMode(ctx, state, page);
  return helpers.editCallbackMessageOrReply(
    ctx,
    [buildOnboardingPrompt(lang, items.length, result.ok ? item : ""), starNotice]
      .filter(Boolean)
      .join("\n\n"),
    onboardingInterestsKeyboard(lang, items.map((entry) => entry.title), page),
  );
}

async function handleOnboardingText(ctx, lang) {
  const state = String(ctx.user?.state || "");
  const items = getAiListItemsFromUser(ctx.user, "random", "topTen");

  if (state.startsWith(ONBOARDING_CUSTOM_PREFIX) || state.startsWith(TASTE_SETUP_CUSTOM_PREFIX)) {
    const page = getOnboardingPage(state);
    const item = String(ctx.text || "").trim().replace(/\s+/g, " ");
    if (!item || Array.from(item).length > operationalLimits.onboardingCustomInterestMaxLength) {
      await setOnboardingPickerMode(ctx, state, page);
      return sendFreshOnboardingPrompt(
        ctx,
        `${messages[lang].onboardingCustomInvalid}\n\n${messages[lang].onboardingCustomPrompt}`,
        onboardingCustomInterestKeyboard(lang, page),
      );
    }
    const result = await addAiListItem(
      ctx.userId,
      "random",
      "topTen",
      { title: item, comment: "" },
      getOnboardingInterestLimit(),
    );

    if (!result.ok) {
      const errorKey = result.reason === "exists"
        ? "onboardingCustomDuplicate"
        : result.reason === "limit"
          ? "onboardingInterestLimitReached"
        : "onboardingCustomInvalid";
      const errorText = messages[lang][errorKey]
        .replace("{item}", result.duplicate?.title || item)
        .replace("{limit}", String(getOnboardingInterestLimit()));
      await setOnboardingPickerMode(ctx, state, page);
      return sendFreshOnboardingPrompt(
        ctx,
        `${errorText}\n\n${messages[lang].onboardingCustomPrompt}`,
        onboardingCustomInterestKeyboard(lang, page),
      );
    }

    applyStarRewardsToContext(ctx, result.starRewards);
    await notifyExternalReferralReward(ctx, messages, result.externalReferralReward);
    const starNotice = buildOnboardingStarNotice(lang, result.starRewards);

    if (result.items.length >= getOnboardingInterestGoal()) {
      await completeOnboardingForState(ctx, state);
      const completion = await prepareOnboardingCompletion(ctx, lang);
      return ctx.reply(
        [completion.text, starNotice].filter(Boolean).join("\n\n"),
        completion.keyboard,
      );
    }

    await updateUserState(ctx.userId, isTasteSetupState(state) ? TASTE_SETUP_INTERESTS_STATE : ONBOARDING_INTERESTS_STATE);
    await setOnboardingPickerMode(ctx, state, page);
    return sendFreshOnboardingPrompt(
      ctx,
      [buildOnboardingPrompt(lang, result.items.length, item), starNotice]
        .filter(Boolean)
        .join("\n\n"),
      onboardingInterestsKeyboard(
        lang,
        result.items.map((entry) => entry.title),
        page,
      ),
    );
  }

  return undefined;
}

module.exports = {
  NEW_USER_WINDOW_MS,
  ONBOARDING_VERSION,
  buildOnboardingCompleteText,
  buildOnboardingPrompt,
  getOnboardingInterestGoal,
  getOnboardingInterestLimit,
  getOnboardingPage,
  handleOnboardingCallback,
  handleOnboardingText,
  isOnboardingCallback,
  shouldOfferOnboarding,
  shouldOfferTasteSetupNudge,
  sendTasteSetupNudge,
  startOnboardingLanguage,
};
