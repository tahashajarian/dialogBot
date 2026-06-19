const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  getOnboardingInterestChipTitle,
  onboardingCompleteKeyboard,
  onboardingCustomInterestKeyboard,
  onboardingInterestsKeyboard,
  onboardingLanguageKeyboard,
} = require("../keyboards");
const {
  addAiListItem,
  getAiListItemsFromUser,
  inferTasteLabel,
  updateProfileField,
  updateUserState,
} = require("../services/users");
const {
  getTasteLabelStyleHint,
  getTasteLabelTitle,
} = require("../services/ai-section");
const {
  createOnboardingStarterInvitationsForUser,
} = require("../services/discussion-invitations");
const { AI_TOP_TEN_LIMIT } = require("../constants/ai");

const ONBOARDING_VERSION = 1;
const ONBOARDING_INTEREST_GOAL = 3;
const NEW_USER_WINDOW_MS = 10 * 60 * 1000;
const ONBOARDING_CHIPS_PER_PAGE = 9;

function isOnboardingCallback(data = "") {
  return data === callBacks.onboardingStart
    || data === callBacks.onboardingSkip
    || data.startsWith(callBacks.onboardingInterest)
    || data.startsWith(callBacks.onboardingMore)
    || data.startsWith(callBacks.onboardingCustom);
}

function getOnboardingPage(value = "") {
  const page = Number(String(value).split(":").at(-1));
  return Number.isInteger(page) && page >= 0 ? page : 0;
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

function buildOnboardingPrompt(lang, count = 0, item = "") {
  const key = item ? "onboardingInterestAdded" : "onboardingInterestsPrompt";
  return messages[lang][key]
    .replace("{item}", item)
    .replace("{count}", String(count));
}

function buildOnboardingCompleteText(lang, items = []) {
  const titles = items.map((entry) => entry.title).filter(Boolean);
  const taste = inferTasteLabel("random", titles);
  const label = getTasteLabelTitle(messages, lang, "random", taste.labelKey);
  const style = getTasteLabelStyleHint(messages, lang, "random", taste.labelKey);
  const itemLines = titles.map((title) => `• ${title}`).join("\n");

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

async function completeOnboardingAndCreateStarterInvites(ctx, skipped = false, {
  firstInterestTitle = "",
} = {}) {
  await completeOnboarding(ctx, skipped);
  try {
    return await createOnboardingStarterInvitationsForUser(ctx.userId, { firstInterestTitle });
  } catch {
    return { ok: false, count: 0 };
  }
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
}

async function handleOnboardingCallback(ctx, lang, helpers = {}) {
  const data = ctx.callbackData || "";
  const state = String(ctx.user?.state || "");
  await ctx.answerCb?.();

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
    const starterInvites = await completeOnboardingAndCreateStarterInvites(ctx, true);
    return helpers.editCallbackMessageOrReply(
      ctx,
      appendStarterInvitationsText(lang, messages[lang].onboardingSkipped, starterInvites.count),
      onboardingCompleteKeyboard(lang),
    );
  }

  if (data.startsWith(callBacks.onboardingCustomCancel)) {
    if (!state.startsWith("onboarding_custom_interest:")) {
      return helpers.deleteCallbackMessageIfPossible?.(ctx);
    }
    const page = getOnboardingPage(data);
    const items = getAiListItemsFromUser(ctx.user, "random", "topTen");
    await updateUserState(ctx.userId, "onboarding_interests");
    return helpers.editCallbackMessageOrReply(
      ctx,
      buildOnboardingPrompt(lang, items.length),
      onboardingInterestsKeyboard(lang, items.map((entry) => entry.title), page),
    );
  }

  if (state !== "onboarding_interests") {
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

  if (data.startsWith(callBacks.onboardingCustom)) {
    const page = getOnboardingPage(data);
    await updateUserState(ctx.userId, `onboarding_custom_interest:${page}`);
    await rememberOnboardingPrompt(ctx, ctx.callbackMessageId);
    return helpers.editCallbackMessageOrReply(
      ctx,
      messages[lang].onboardingCustomPrompt,
      onboardingCustomInterestKeyboard(lang, page),
    );
  }

  const chipIndex = Number(data.replace(callBacks.onboardingInterest, ""));
  const item = getOnboardingInterestChipTitle(chipIndex, lang);
  if (!item) {
    return ctx.reply(messages[lang].unknownAction);
  }

  const result = await addAiListItem(
    ctx.userId,
    "random",
    "topTen",
    { title: item, comment: "" },
    AI_TOP_TEN_LIMIT,
  );
  const items = result.ok
    ? result.items
    : getAiListItemsFromUser(ctx.user, "random", "topTen");

  if (!result.ok && result.reason !== "exists") {
    return ctx.reply(messages[lang].unknownAction);
  }

  if (items.length >= ONBOARDING_INTEREST_GOAL) {
    const starterInvites = await completeOnboardingAndCreateStarterInvites(ctx, false, {
      firstInterestTitle: items[0]?.title || "",
    });
    return helpers.editCallbackMessageOrReply(
      ctx,
      appendStarterInvitationsText(
        lang,
        buildOnboardingCompleteText(lang, items.slice(0, ONBOARDING_INTEREST_GOAL)),
        starterInvites.count,
      ),
      onboardingCompleteKeyboard(lang),
    );
  }

  const page = Math.floor(chipIndex / ONBOARDING_CHIPS_PER_PAGE);
  return helpers.editCallbackMessageOrReply(
    ctx,
    buildOnboardingPrompt(lang, items.length, result.ok ? item : ""),
    onboardingInterestsKeyboard(lang, items.map((entry) => entry.title), page),
  );
}

async function handleOnboardingText(ctx, lang) {
  const state = String(ctx.user?.state || "");
  const items = getAiListItemsFromUser(ctx.user, "random", "topTen");

  if (state.startsWith("onboarding_custom_interest:")) {
    const page = getOnboardingPage(state);
    const item = String(ctx.text || "").trim();
    const result = await addAiListItem(
      ctx.userId,
      "random",
      "topTen",
      { title: item, comment: "" },
      AI_TOP_TEN_LIMIT,
    );

    if (!result.ok) {
      const errorKey = result.reason === "exists"
        ? "onboardingCustomDuplicate"
        : "onboardingCustomInvalid";
      const errorText = messages[lang][errorKey].replace(
        "{item}",
        result.duplicate?.title || item,
      );
      return sendFreshOnboardingPrompt(
        ctx,
        `${errorText}\n\n${messages[lang].onboardingCustomPrompt}`,
        onboardingCustomInterestKeyboard(lang, page),
      );
    }

    if (result.items.length >= ONBOARDING_INTEREST_GOAL) {
      const completeText = buildOnboardingCompleteText(
        lang,
        result.items.slice(0, ONBOARDING_INTEREST_GOAL),
      );
      await retireOnboardingPrompt(ctx);
      const starterInvites = await completeOnboardingAndCreateStarterInvites(ctx, false, {
        firstInterestTitle: result.items[0]?.title || "",
      });
      return ctx.reply(
        appendStarterInvitationsText(lang, completeText, starterInvites.count),
        onboardingCompleteKeyboard(lang),
      );
    }

    await updateUserState(ctx.userId, "onboarding_interests");
    return sendFreshOnboardingPrompt(
      ctx,
      buildOnboardingPrompt(lang, result.items.length, item),
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
  ONBOARDING_INTEREST_GOAL,
  ONBOARDING_VERSION,
  appendStarterInvitationsText,
  buildOnboardingCompleteText,
  buildOnboardingPrompt,
  completeOnboardingAndCreateStarterInvites,
  getOnboardingPage,
  handleOnboardingCallback,
  handleOnboardingText,
  isOnboardingCallback,
  retireOnboardingPrompt,
  shouldOfferOnboarding,
  startOnboardingLanguage,
};
