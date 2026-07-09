const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  getOnboardingInterestChipTitle,
  onboardingCompleteKeyboard,
  onboardingCustomInterestKeyboard,
  onboardingInterestsKeyboard,
  onboardingLanguageKeyboard,
  onboardingTasteSetupNudgeKeyboard,
} = require("../keyboards");
const {
  addAiListItem,
  getAiListItemsFromUser,
  inferTasteLabel,
  removeAiListItem,
  updateProfileField,
  updateUserState,
} = require("../services/users");
const {
  getTasteLabelStyleHint,
  getTasteLabelTitle,
} = require("../services/ai-section");
const { localizeInterestChipTitle } = require("../services/interest-chips");
const {
  createOnboardingStarterInvitationsForUser,
} = require("../services/discussion-invitations");
const { operationalLimits } = require("../services/operational-limits");
const { EVENT_NAMES, trackEvent } = require("../services/analytics-events");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
  notifyExternalReferralReward,
} = require("../services/stars-ui");

const ONBOARDING_VERSION = 1;
const NEW_USER_WINDOW_MS = 10 * 60 * 1000;
const ONBOARDING_CHIPS_PER_PAGE = 9;
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

function getMessageId(messageOrId) {
  if (Number.isInteger(Number(messageOrId))) return Number(messageOrId);
  return Number(messageOrId?.message_id || messageOrId?.messageId) || null;
}

async function rememberOnboardingPrompt(ctx, messageOrId) {
  const messageId = getMessageId(messageOrId);
  if (!messageId) return false;
  await updateProfileField(ctx.userId, "onboardingPromptMessageId", messageId);
  if (ctx.user) ctx.user.onboardingPromptMessageId = messageId;
  return true;
}

async function renderRememberedPrompt(ctx, text, keyboard) {
  const messageId = Number(ctx.user?.onboardingPromptMessageId);
  if (messageId && ctx.editMessageText) {
    const edited = await ctx.editMessageText(messageId, text, keyboard);
    if (edited) return edited;
  }

  const sent = await ctx.reply(text, keyboard);
  await rememberOnboardingPrompt(ctx, sent);
  return sent;
}

async function retireOnboardingPrompt(ctx, { persist = true } = {}) {
  const messageId = Number(ctx.user?.onboardingPromptMessageId);
  if (Number.isInteger(messageId) && messageId > 0 && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }
  if (ctx.user) ctx.user.onboardingPromptMessageId = null;
  if (persist) {
    await updateProfileField(ctx.userId, "onboardingPromptMessageId", null);
  }
}

async function sendFreshOnboardingPrompt(ctx, text, keyboard) {
  await retireOnboardingPrompt(ctx);
  const sent = await ctx.reply(text, keyboard);
  await rememberOnboardingPrompt(ctx, sent);
  return sent;
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
    .replace("{goal}", String(getOnboardingInterestGoal()))
    .replace("{limit}", String(getOnboardingInterestLimit()));
}

function buildOnboardingCompleteText(lang, items = []) {
  const titles = items.map((entry) => entry.title).filter(Boolean);
  const displayTitles = titles.map((title) => localizeInterestChipTitle(title, lang));
  const taste = inferTasteLabel("random", titles);
  const label = getTasteLabelTitle(messages, lang, "random", taste.labelKey);
  const style = getTasteLabelStyleHint(messages, lang, "random", taste.labelKey);
  const itemLines = displayTitles.map((title) => `• ${title}`).join("\n");

  return messages[lang].onboardingComplete
    .replace("{items}", itemLines)
    .replace("{emoji}", taste.emoji)
    .replace("{label}", label)
    .replace("{style}", style);
}

function appendStarterInvitationsText(lang, text, count = 0) {
  const normalizedCount = Number(count) || 0;
  if (normalizedCount <= 0) return text;
  return `${text}\n\n${messages[lang].onboardingStarterInvitationsReady.replace("{count}", String(normalizedCount))}`;
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

async function completeOnboardingAndCreateStarterInvites(ctx, skipped = false) {
  await completeOnboarding(ctx, skipped);
  try {
    return await createOnboardingStarterInvitationsForUser(ctx.userId);
  } catch {
    return { ok: false, count: 0 };
  }
}

async function completeOnboardingForState(ctx, state, skipped = false) {
  if (!isTasteSetupState(state)) {
    return completeOnboardingAndCreateStarterInvites(ctx, skipped);
  }
  await completeOnboarding(ctx, skipped);
  return { ok: true, count: 0 };
}

async function sendTasteSetupNudge(ctx, lang) {
  if (!shouldOfferTasteSetupNudge(ctx.user)) return null;
  const nudgedAt = new Date();
  if (ctx.user) ctx.user.onboardingTasteSetupNudgedAt = nudgedAt;
  await updateProfileField(ctx.userId, "onboardingTasteSetupNudgedAt", nudgedAt);
  return ctx.reply(
    messages[lang].onboardingTasteSetupNudge,
    onboardingTasteSetupNudgeKeyboard(lang),
  );
}

async function startOnboardingLanguage(ctx, lang, inviteCode = "") {
  const state = inviteCode
    ? `onboarding_invite_language:${inviteCode}`
    : "onboarding_language";
  await updateUserState(ctx.userId, state);
  const prompt = await ctx.reply(
    messages[lang].chooseLanguage,
    onboardingLanguageKeyboard(),
  );
  await rememberOnboardingPrompt(ctx, prompt);
  return prompt;
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
    return helpers.deleteCallbackMessageIfPossible?.(ctx);
  }

  if (data === callBacks.onboardingTasteSetupStart) {
    if (Number(ctx.user?.onboardingVersion) >= ONBOARDING_VERSION) {
      return helpers.deleteCallbackMessageIfPossible?.(ctx);
    }
    const items = getAiListItemsFromUser(ctx.user, "random", "topTen");
    await updateUserState(ctx.userId, TASTE_SETUP_INTERESTS_STATE);
    await rememberOnboardingPrompt(ctx, ctx.callbackMessageId);
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
    const starterInvites = await completeOnboardingForState(ctx, state);
    return helpers.editCallbackMessageOrReply(
      ctx,
      appendStarterInvitationsText(
        lang,
        buildOnboardingCompleteText(lang, items),
        starterInvites.count,
      ),
      onboardingCompleteKeyboard(lang, { invitationCount: starterInvites.count }),
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
    return helpers.editCallbackMessageOrReply(
      ctx,
      buildOnboardingPrompt(lang, (result.items || []).length),
      onboardingInterestsKeyboard(lang, (result.items || []).map((entry) => entry.title), page),
    );
  }

  if (data.startsWith(callBacks.onboardingCustom)) {
    const page = getOnboardingPage(data);
    await updateUserState(ctx.userId, `${getCustomInterestPrefixForState(state)}${page}`);
    await rememberOnboardingPrompt(ctx, ctx.callbackMessageId);
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

  if (result.ok && items.length >= getOnboardingInterestLimit()) {
    const starterInvites = await completeOnboardingForState(ctx, state);
    return helpers.editCallbackMessageOrReply(
      ctx,
      appendStarterInvitationsText(
        lang,
        [buildOnboardingCompleteText(lang, items), starNotice]
          .filter(Boolean)
          .join("\n\n"),
        starterInvites.count,
      ),
      onboardingCompleteKeyboard(lang, { invitationCount: starterInvites.count }),
    );
  }

  const page = getOnboardingPage(data) || Math.floor(chipIndex / ONBOARDING_CHIPS_PER_PAGE);
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
      return sendFreshOnboardingPrompt(
        ctx,
        `${errorText}\n\n${messages[lang].onboardingCustomPrompt}`,
        onboardingCustomInterestKeyboard(lang, page),
      );
    }

    applyStarRewardsToContext(ctx, result.starRewards);
    await notifyExternalReferralReward(ctx, messages, result.externalReferralReward);
    const starNotice = buildOnboardingStarNotice(lang, result.starRewards);

    if (result.items.length >= getOnboardingInterestLimit()) {
      const completeText = [
        buildOnboardingCompleteText(lang, result.items),
        starNotice,
      ].filter(Boolean).join("\n\n");
      await retireOnboardingPrompt(ctx);
      const starterInvites = await completeOnboardingForState(ctx, state);
      return ctx.reply(
        appendStarterInvitationsText(lang, completeText, starterInvites.count),
        onboardingCompleteKeyboard(lang, { invitationCount: starterInvites.count }),
      );
    }

    await updateUserState(ctx.userId, isTasteSetupState(state) ? TASTE_SETUP_INTERESTS_STATE : ONBOARDING_INTERESTS_STATE);
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

  return renderRememberedPrompt(
    ctx,
    buildOnboardingPrompt(lang, items.length),
    onboardingInterestsKeyboard(lang, items.map((entry) => entry.title)),
  );
}

module.exports = {
  NEW_USER_WINDOW_MS,
  ONBOARDING_VERSION,
  appendStarterInvitationsText,
  buildOnboardingCompleteText,
  buildOnboardingPrompt,
  getOnboardingInterestGoal,
  getOnboardingInterestLimit,
  completeOnboardingAndCreateStarterInvites,
  getOnboardingPage,
  handleOnboardingCallback,
  handleOnboardingText,
  isOnboardingCallback,
  retireOnboardingPrompt,
  shouldOfferOnboarding,
  shouldOfferTasteSetupNudge,
  sendTasteSetupNudge,
  startOnboardingLanguage,
};
