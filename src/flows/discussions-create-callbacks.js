const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  discussionsMenuKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionSectionKeyboard,
  discussionCreateConfirmKeyboard,
  discussionCreateLanguagePickerKeyboard,
  discussionCreateCapacityKeyboard,
  discussionPaidCapacityConfirmKeyboard,
  discussionPaidCapacityAckKeyboard,
  discussionExtraSlotConfirmKeyboard,
  discussionExtraSlotAckKeyboard,
  discussionTasteLabelsKeyboard,
  discussionSelectItemKeyboard,
} = require("../keyboards");
const {
  updateProfileField,
  resetDiscussionDraft,
  updateUserState,
  getAiListItemsFromUser,
  getAiTasteFromUser,
} = require("../services/users");
const { hasValidLocation, toPlainUser } = require("../services/profile");
const { normalizeDiscussionLanguage } = require("../services/discussion-language");
const {
  getSectionLabel,
} = require("../services/ai-section");
const {
  getDiscussionErrorMessage,
  buildDiscussionPreviewText,
} = require("../services/discussion-ui");
const {
  checkActiveOwnedDiscussionsLimit,
  normalizeMaxMembers,
  createDiscussion,
} = require("../services/discussions");
const { isDiscussionCreateFlowCallback } = require("./discussions-callbacks");
const { operationalLimits } = require("../services/operational-limits");
const { getPaidDiscussionCapacity } = require("../services/discussion-capacities");
const { spendStars, refundStars } = require("../services/stars");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
  formatStarNumber,
} = require("../services/stars-ui");
const { requireDiscussionProfileName } = require("./discussion-name-gate");
const { setNavigationMode } = require("../services/reply-keyboard-navigation");
const { starEconomy } = require("../services/star-settings");
const {
  isPaidExtraDiscussionAvailable,
  authorizePaidExtraDiscussion,
  refundPaidExtraDiscussionAuthorization,
} = require("../services/discussion-paid-creation");

function isDiscussionCreateCallback(data = "") {
  return (
    data === callBacks.discussionCreateStart ||
    isDiscussionCreateFlowCallback(data)
  );
}

function buildDiscussionPreviewForCurrentDraft(ctx, lang, joinRule, description = undefined) {
  const draft = {
    ...toPlainUser(ctx.user),
    discussionDraftJoinRule: joinRule,
  };
  if (description !== undefined) {
    draft.discussionDraftDescription = description;
  }
  return buildDiscussionPreviewText(messages, lang, draft);
}

function buildDiscussionPreviewForCurrentUser(ctx, lang, overrides = {}) {
  return buildDiscussionPreviewText(messages, lang, {
    ...toPlainUser(ctx.user),
    ...overrides,
  });
}

function buildDiscussionCreateConfirmKeyboard(ctx, lang, isLocal = ctx.user?.discussionDraftIsLocal) {
  return discussionCreateConfirmKeyboard(
    lang,
    ctx.user?.discussionDraftLanguage || ctx.user?.lang,
    isLocal,
    { canMakeLocal: hasValidLocation(ctx.user?.location) },
  );
}

async function resumeDiscussionCreatePreview(ctx, lang) {
  await updateUserState(ctx.userId, "discussion_create_preview");
  if (ctx.user) ctx.user.state = "discussion_create_preview";
  await setNavigationMode(ctx, "discussion_create");
  return ctx.reply(
    buildDiscussionPreviewForCurrentUser(ctx, lang),
    buildDiscussionCreateConfirmKeyboard(ctx, lang),
  );
}

function isEditingDiscussionRuleFromPreview(ctx) {
  return ctx.user?.state === "discussion_create_join_rule_edit";
}

function createStepBackButton(_messages, lang, callbackData) {
  return {
    text: messages[lang].discussionBack,
    callback_data: callbackData,
  };
}

function getNoEligibleItemMessage(lang, section) {
  const key = section === "random"
    ? "discussionRuleNoEligibleProfileInterestItem"
    : "discussionRuleNoEligibleItem";
  return messages[lang][key].replace("{section}", getSectionLabel(messages, lang, section));
}

function fillPaidCapacityText(template, lang, values = {}) {
  return String(template || "")
    .replaceAll("{capacity}", formatStarNumber(values.capacity, lang))
    .replaceAll("{cost}", formatStarNumber(values.cost, lang))
    .replaceAll("{balance}", formatStarNumber(values.balance, lang));
}

function fillExtraSlotText(template, lang, values = {}) {
  return String(template || "")
    .replaceAll("{count}", formatStarNumber(values.count, lang))
    .replaceAll("{cost}", formatStarNumber(values.cost, lang))
    .replaceAll("{balance}", formatStarNumber(values.balance, lang));
}

function getPaidCapacityCallbackMessage(lang, capacityOption, balance) {
  return fillPaidCapacityText(messages[lang].discussionPaidCapacityConfirmText, lang, {
    capacity: capacityOption.capacity,
    cost: capacityOption.cost,
    balance,
  });
}

function parsePaidCapacityConfirmPayload(data = "") {
  const raw = data.replace(callBacks.discussionCreatePaidCapacityConfirm, "");
  const [capacityRaw, costRaw] = raw.split(":");
  return {
    capacity: Number(capacityRaw) || 0,
    cost: Number(costRaw) || 0,
  };
}

function getJoinRulePromptOptions(ctx, lang, { includeState = true } = {}) {
  const editMode = isEditingDiscussionRuleFromPreview(ctx);
  return {
    state: includeState ? (editMode ? "discussion_create_join_rule_edit" : "discussion_create_join_rule") : null,
    cancelCallback: editMode ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
    cancelText: editMode ? messages[lang].discussionCancelEdit : messages[lang].discussionCreateCancel,
    backButton: editMode
      ? null
      : createStepBackButton(messages, lang, callBacks.discussionCreateBackToTitle),
  };
}

async function clearDiscussionDraft(userId) {
  await resetDiscussionDraft(userId);
}

async function askDiscussionDescription(ctx, lang, joinRule, {
  state = "discussion_create_description",
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
  rememberDiscussionMenuNotice,
} = {}) {
  await updateProfileField(ctx.userId, "discussionDraftJoinRule", joinRule);
  await updateUserState(ctx.userId, state);
  const sent = await ctx.reply(
    messages[lang].discussionCreateAskDescription,
    joinRule.type === "open"
      ? discussionCreateCancelKeyboard(lang, cancelCallback, cancelText, backButton)
      : discussionCreateDescriptionKeyboard(lang, { cancelCallback, cancelText, backButton }),
  );
  await rememberDiscussionMenuNotice(ctx, sent);
  return sent;
}

async function sendDiscussionCreateTitlePrompt(ctx, lang, {
  state = "discussion_create_title",
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  rememberDiscussionMenuNotice,
} = {}) {
  await updateUserState(ctx.userId, state);
  const sent = await ctx.reply(
    messages[lang].discussionCreateAskTitle,
    discussionCreateCancelKeyboard(lang, cancelCallback, cancelText),
  );
  await rememberDiscussionMenuNotice(ctx, sent);
  return sent;
}

async function sendDiscussionJoinRulePrompt(ctx, lang, {
  state = null,
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
  editCallbackMessageOrReply,
} = {}) {
  if (state) {
    await updateUserState(ctx.userId, state);
  }
  return editCallbackMessageOrReply(
    ctx,
    messages[lang].discussionJoinRulePrompt,
    discussionJoinRuleKeyboard(lang, { cancelCallback, cancelText, backButton }),
  );
}

async function startDiscussionCreateFlow(ctx, lang, helpers = {}) {
  const {
    editCallbackMessageOrReply = (_ctx, text, keyboard) => _ctx.reply(text, keyboard),
    rememberDiscussionMenuNotice = async () => {},
  } = helpers;

  const activeLimit = await checkActiveOwnedDiscussionsLimit(ctx.userId);
  if (!activeLimit.ok) {
    if (isPaidExtraDiscussionAvailable() && activeLimit.count < operationalLimits.ownedDiscussionHardLimit) {
      const previousRefund = await refundPaidExtraDiscussionAuthorization(ctx.userId);
      if (ctx.user && previousRefund.refunded) {
        ctx.user.starBalance = previousRefund.balance;
        ctx.user.discussionDraftPaidOwnedSlotTransactionId = null;
        ctx.user.discussionDraftPaidOwnedSlotAuthorized = false;
      }
      const cost = Number(starEconomy.paidExtraDiscussionCost) || 0;
      await setNavigationMode(ctx, "discussions");
      return editCallbackMessageOrReply(
        ctx,
        fillExtraSlotText(messages[lang].discussionExtraSlotConfirmText, lang, {
          count: activeLimit.count,
          cost,
          balance: ctx.user?.starBalance || 0,
        }),
        discussionExtraSlotConfirmKeyboard(lang, cost),
      );
    }
    await refundPaidExtraDiscussionAuthorization(ctx.userId);
    await clearDiscussionDraft(ctx.userId);
    await updateUserState(ctx.userId, "idle");
    return editCallbackMessageOrReply(
      ctx,
      getDiscussionErrorMessage(messages, lang, activeLimit.reason) || messages[lang].discussionActiveOwnedLimit,
      discussionJoinErrorAckKeyboard(lang, "discussions"),
    );
  }

  await refundPaidExtraDiscussionAuthorization(ctx.userId);
  await clearDiscussionDraft(ctx.userId);
  const defaultLanguage = normalizeDiscussionLanguage(ctx.user?.lang, lang);
  await updateProfileField(ctx.userId, "discussionDraftLanguage", defaultLanguage);
  if (ctx.user) ctx.user.discussionDraftLanguage = defaultLanguage;
  return sendDiscussionCreateTitlePrompt(ctx, lang, {
    rememberDiscussionMenuNotice,
  });
}

async function handleDiscussionCreateCallback(ctx, lang, helpers) {
  const data = ctx.callbackData || "";
  const {
    editCallbackMessageOrReply,
    clearDiscussionMenuNotice,
    rememberDiscussionMenuNotice,
    sendDiscussionRoom,
    deleteCallbackMessageIfPossible = async () => {},
  } = helpers;

  const askDescription = (joinRule, options = {}) => askDiscussionDescription(ctx, lang, joinRule, {
    ...options,
    rememberDiscussionMenuNotice,
  });
  const sendTitlePrompt = (options = {}) => sendDiscussionCreateTitlePrompt(ctx, lang, {
    ...options,
    rememberDiscussionMenuNotice,
  });
  const sendJoinRulePrompt = (options = {}) => sendDiscussionJoinRulePrompt(ctx, lang, {
    ...options,
    editCallbackMessageOrReply,
  });
  const pauseOnJoinRuleGuidance = async (text) => {
    const options = getJoinRulePromptOptions(ctx, lang);
    await updateUserState(ctx.userId, options.state);
    await setNavigationMode(ctx, "discussion_create");
    return ctx.reply(
      `${text}\n\n${messages[lang].discussionJoinRulePrompt}`,
      discussionJoinRuleKeyboard(lang, options),
    );
  };
  const getEarnedTasteLabels = () => ["movies", "music", "books"]
    .map((section) => ({ section, labelKey: getAiTasteFromUser(ctx.user, section).labelKey }))
    .filter((entry) => entry.labelKey);
  const showTasteLabelPicker = async () => {
    const tasteLabels = getEarnedTasteLabels();
    if (!tasteLabels.length) {
      return pauseOnJoinRuleGuidance(messages[lang].discussionRuleNoBadgesAtAll);
    }
    const editMode = isEditingDiscussionRuleFromPreview(ctx);
    const draftRule = { type: "taste_label" };
    await updateProfileField(ctx.userId, "discussionDraftJoinRule", draftRule);
    if (ctx.user) ctx.user.discussionDraftJoinRule = draftRule;
    await setNavigationMode(ctx, "discussion_create_taste_labels");
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionChooseTasteLabel,
      discussionTasteLabelsKeyboard(lang, tasteLabels, {
        cancelCallback: editMode ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
        cancelText: editMode ? messages[lang].discussionCancelEdit : null,
        backButton: editMode
          ? createStepBackButton(messages, lang, callBacks.discussionCreatePreview)
          : createStepBackButton(messages, lang, callBacks.discussionCreateBackToJoinRule),
      }),
    );
  };

  const returnToDraftPreview = async () => {
    await setNavigationMode(ctx, "discussion_create");
    return editCallbackMessageOrReply(
      ctx,
      buildDiscussionPreviewForCurrentUser(ctx, lang),
      buildDiscussionCreateConfirmKeyboard(ctx, lang),
    );
  };

  const createCurrentDraft = (paidCapacityAuthorized = false) => createDiscussion({
    creatorUserId: ctx.userId,
    title: ctx.user?.discussionDraftTitle || "",
    description: ctx.user?.discussionDraftDescription || "",
    joinRule: ctx.user?.discussionDraftJoinRule || { type: "open" },
    maxMembers: ctx.user?.discussionDraftMaxMembers || operationalLimits.discussionMaxMembers,
    paidCapacityAuthorized,
    language: ctx.user?.discussionDraftLanguage || ctx.user?.lang,
    isLocal: ctx.user?.discussionDraftIsLocal === true,
  });

  const showPaidCapacityQuote = async (capacityOption) => {
    const navigationMode = `discussion_create_paid_capacity:${capacityOption.capacity}:${capacityOption.cost}`;
    await setNavigationMode(ctx, navigationMode);
    return editCallbackMessageOrReply(
      ctx,
      getPaidCapacityCallbackMessage(lang, capacityOption, ctx.user?.starBalance || 0),
      discussionPaidCapacityConfirmKeyboard(lang, capacityOption.capacity, capacityOption.cost),
    );
  };

  const showPaidCapacityError = async (text) => {
    await setNavigationMode(ctx, "discussion_create_paid_capacity_error");
    return editCallbackMessageOrReply(ctx, text, discussionPaidCapacityAckKeyboard(lang));
  };

  const refundExtraSlotAuthorization = async (reason) => {
    const refund = await refundPaidExtraDiscussionAuthorization(ctx.userId, { reason });
    if (ctx.user && refund.refunded) ctx.user.starBalance = refund.balance;
    return refund;
  };

  const beginPaidExtraDiscussionDraft = async (authorization) => {
    if (ctx.user) {
      if (Number.isFinite(Number(authorization.balance))) ctx.user.starBalance = Number(authorization.balance);
      ctx.user.discussionDraftPaidOwnedSlotTransactionId = authorization.transaction?._id || null;
      ctx.user.discussionDraftPaidOwnedSlotAuthorized = true;
      ctx.user.discussionDraftPaidOwnedSlotCap = authorization.paidOwnedSlotCap;
      ctx.user.discussionDraftPaidOwnedSlotCost = Number(starEconomy.paidExtraDiscussionCost) || 0;
    }
    await deleteCallbackMessageIfPossible(ctx);
    const defaultLanguage = normalizeDiscussionLanguage(ctx.user?.lang, lang);
    await updateProfileField(ctx.userId, "discussionDraftLanguage", defaultLanguage);
    if (ctx.user) ctx.user.discussionDraftLanguage = defaultLanguage;
    return sendDiscussionCreateTitlePrompt(ctx, lang, {
      rememberDiscussionMenuNotice,
    });
  };

  if (data === callBacks.discussionCreateExtraSlotCancel || data === callBacks.discussionCreateExtraSlotAck) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "idle");
    await setNavigationMode(ctx, "discussions");
    return deleteCallbackMessageIfPossible(ctx);
  }

  if (data.startsWith(callBacks.discussionCreateExtraSlotConfirm)) {
    await ctx.answerCb?.();
    const quotedCost = Number(data.replace(callBacks.discussionCreateExtraSlotConfirm, ""));
    const activeLimit = await checkActiveOwnedDiscussionsLimit(ctx.userId);
    if (activeLimit.ok) {
      await deleteCallbackMessageIfPossible(ctx);
      return startDiscussionCreateFlow(ctx, lang, {
        editCallbackMessageOrReply,
        rememberDiscussionMenuNotice,
      });
    }
    if (!isPaidExtraDiscussionAvailable() || activeLimit.count >= operationalLimits.ownedDiscussionHardLimit) {
      return editCallbackMessageOrReply(ctx, messages[lang].discussionExtraSlotUnavailable, discussionExtraSlotAckKeyboard(lang));
    }
    const currentCost = Number(starEconomy.paidExtraDiscussionCost) || 0;
    if (quotedCost !== currentCost) {
      return editCallbackMessageOrReply(
        ctx,
        [messages[lang].discussionExtraSlotStale, fillExtraSlotText(messages[lang].discussionExtraSlotConfirmText, lang, {
          count: activeLimit.count,
          cost: currentCost,
          balance: ctx.user?.starBalance || 0,
        })].join("\n\n"),
        discussionExtraSlotConfirmKeyboard(lang, currentCost),
      );
    }
    await clearDiscussionDraft(ctx.userId);
    const authorization = await authorizePaidExtraDiscussion({
      userId: ctx.userId,
      activeOwnedCount: activeLimit.count,
      quotedCost,
      idempotencyKey: `discussion-extra-slot:${ctx.userId}:${ctx.callbackMessageId || "message"}:${activeLimit.count}:${quotedCost}`,
    });
    if (!authorization.ok) {
      const text = authorization.reason === "insufficient_balance"
        ? fillExtraSlotText(messages[lang].discussionExtraSlotInsufficient, lang, {
          cost: quotedCost,
          balance: authorization.balance ?? ctx.user?.starBalance ?? 0,
        })
        : messages[lang].discussionExtraSlotUnavailable;
      await updateUserState(ctx.userId, "idle");
      await setNavigationMode(ctx, "discussions");
      return editCallbackMessageOrReply(ctx, text, discussionExtraSlotAckKeyboard(lang));
    }
    return beginPaidExtraDiscussionDraft(authorization);
  }

  if (data === callBacks.discussionCreateGuidanceAck) {
    await ctx.answerCb?.();
    return sendJoinRulePrompt(getJoinRulePromptOptions(ctx, lang, { includeState: false }));
  }

  if (data === callBacks.discussionCreatePaidCapacityCancel) {
    await ctx.answerCb?.(messages[lang].discussionPaidCapacityCanceled.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
    return returnToDraftPreview();
  }

  if (data === callBacks.discussionCreatePaidCapacityAck) {
    await ctx.answerCb?.();
    return returnToDraftPreview();
  }

  if (data === callBacks.discussionCreateStart) {
    await ctx.answerCb?.();
    return startDiscussionCreateFlow(ctx, lang, {
      editCallbackMessageOrReply,
      rememberDiscussionMenuNotice,
    });
  }

  if (data === callBacks.discussionCreateToggleLanguage) {
    await ctx.answerCb?.();
    const current = normalizeDiscussionLanguage(ctx.user?.discussionDraftLanguage, ctx.user?.lang || lang);
    await setNavigationMode(ctx, "discussion_create_language");
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionCreateLanguagePickerTitle,
      discussionCreateLanguagePickerKeyboard(lang, current),
    );
  }

  if (data.startsWith(callBacks.discussionCreateSetLanguage)) {
    await ctx.answerCb?.();
    const selected = data.replace(callBacks.discussionCreateSetLanguage, "");
    if (!["fa", "en"].includes(selected)) {
      return editCallbackMessageOrReply(
        ctx,
        messages[lang].discussionCreateLanguagePickerTitle,
        discussionCreateLanguagePickerKeyboard(lang, ctx.user?.discussionDraftLanguage),
      );
    }
    await updateProfileField(ctx.userId, "discussionDraftLanguage", selected);
    if (ctx.user) ctx.user.discussionDraftLanguage = selected;
    await updateUserState(ctx.userId, "discussion_create_preview");
    return editCallbackMessageOrReply(ctx, buildDiscussionPreviewForCurrentUser(ctx, lang), buildDiscussionCreateConfirmKeyboard(ctx, lang));
  }

  if (data === callBacks.discussionCreateLanguageBack) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "discussion_create_preview");
    return editCallbackMessageOrReply(ctx, buildDiscussionPreviewForCurrentUser(ctx, lang), buildDiscussionCreateConfirmKeyboard(ctx, lang));
  }

  if (data === callBacks.discussionCreateCancelEdit) {
    await ctx.answerCb?.();
    await updateUserState(ctx.userId, "discussion_create_preview");
    await clearDiscussionMenuNotice(ctx);
    return editCallbackMessageOrReply(
      ctx,
      buildDiscussionPreviewForCurrentUser(ctx, lang),
      buildDiscussionCreateConfirmKeyboard(ctx, lang),
    );
  }

  if (data === callBacks.discussionCreateBackToTitle) {
    await ctx.answerCb?.();
    return sendTitlePrompt();
  }

  if (data === callBacks.discussionCreateCancel) {
    await ctx.answerCb?.(messages[lang].discussionCreateCanceled.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
    await refundExtraSlotAuthorization("discussion_extra_slot_cancelled");
    await clearDiscussionDraft(ctx.userId);
    await updateUserState(ctx.userId, "idle");
    await clearDiscussionMenuNotice(ctx);
    await ctx.reply(messages[lang].discussionCreateCanceled, {
      reply_markup: { remove_keyboard: true },
    });
    return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
  }

  if (data === callBacks.discussionCreateSkipDescription) {
    await ctx.answerCb?.();
    const joinRule = ctx.user?.discussionDraftJoinRule || { type: "open" };
    if (joinRule.type === "open") {
      return ctx.reply(messages[lang].discussionOpenNeedsDescription, discussionCreateCancelKeyboard(lang));
    }
    await updateProfileField(ctx.userId, "discussionDraftDescription", "");
    await updateUserState(ctx.userId, "discussion_create_preview");
    return editCallbackMessageOrReply(
      ctx,
      buildDiscussionPreviewForCurrentDraft(ctx, lang, joinRule, ""),
      buildDiscussionCreateConfirmKeyboard(ctx, lang),
    );
  }

  if (data === callBacks.discussionCreateRuleOpen) {
    await ctx.answerCb?.();
    const joinRule = { type: "open" };
    if (isEditingDiscussionRuleFromPreview(ctx)) {
      await updateProfileField(ctx.userId, "discussionDraftJoinRule", joinRule);
      await updateUserState(ctx.userId, "discussion_create_preview");
      return editCallbackMessageOrReply(
        ctx,
        buildDiscussionPreviewForCurrentUser(ctx, lang, { discussionDraftJoinRule: joinRule }),
      buildDiscussionCreateConfirmKeyboard(ctx, lang),
      );
    }
    return askDescription(joinRule, {
      cancelCallback: callBacks.discussionCreateCancel,
      backButton: createStepBackButton(messages, lang, callBacks.discussionCreateBackToJoinRule),
    });
  }

  if (data === callBacks.discussionCreateRuleTopTen) {
    await ctx.answerCb?.();
    return sendJoinRulePrompt();
  }

  if (data === callBacks.discussionCreateRuleTaste || data === callBacks.discussionCreateRuleItem) {
    await ctx.answerCb?.();
    const type = data === callBacks.discussionCreateRuleTaste ? "taste_label" : "top_ten_item";
    if (type === "taste_label") {
      return showTasteLabelPicker();
    }

    const sections = ["movies", "music", "books", "random"];
    if (type === "top_ten_item") {
      const hasItem = sections.some((section) => {
        const topTen = getAiListItemsFromUser(ctx.user, section, "topTen");
        return topTen.length > 0;
      });
      if (!hasItem) {
        return pauseOnJoinRuleGuidance(messages[lang].discussionRuleNoItemsAtAll);
      }
    }
    
    await updateProfileField(ctx.userId, "discussionDraftJoinRule", { type });
    await setNavigationMode(ctx, "discussion_create_section");
    const editMode = isEditingDiscussionRuleFromPreview(ctx);
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionChooseSection,
      discussionSectionKeyboard(lang, callBacks.discussionCreateRuleSection, {
        cancelCallback: editMode ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
        cancelText: editMode ? messages[lang].discussionCancelEdit : null,
        backButton: editMode
          ? createStepBackButton(messages, lang, callBacks.discussionCreatePreview)
          : createStepBackButton(messages, lang, callBacks.discussionCreateBackToJoinRule),
      }),
    );
  }

  if (data === callBacks.discussionCreateBackToJoinRule) {
    await ctx.answerCb?.();
    return sendJoinRulePrompt({
      state: "discussion_create_join_rule",
      cancelCallback: callBacks.discussionCreateCancel,
      cancelText: messages[lang].discussionCreateCancel,
      backButton: createStepBackButton(messages, lang, callBacks.discussionCreateBackToTitle),
    });
  }

  if (data === callBacks.discussionCreateBackToSection) {
    await ctx.answerCb?.();
    await setNavigationMode(ctx, "discussion_create_section");
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionChooseSection,
      discussionSectionKeyboard(lang, callBacks.discussionCreateRuleSection, {
        cancelCallback: callBacks.discussionCreateCancel,
        cancelText: messages[lang].discussionCreateCancel,
        backButton: createStepBackButton(messages, lang, callBacks.discussionCreateBackToJoinRule),
      }),
    );
  }

  if (data.startsWith(callBacks.discussionCreateRuleSection)) {
    await ctx.answerCb?.();
    const section = data.replace(callBacks.discussionCreateRuleSection, "");
    const baseRule = ctx.user?.discussionDraftJoinRule || {};
    const nextRule = { ...baseRule, section };
    if (baseRule.type === "taste_label") return showTasteLabelPicker();

    if (baseRule.type === "top_ten_item") {
      const topTen = getAiListItemsFromUser(ctx.user, section, "topTen");
      if (!topTen.length) {
        return pauseOnJoinRuleGuidance(getNoEligibleItemMessage(lang, section));
      }
      await updateProfileField(ctx.userId, "discussionDraftJoinRule", nextRule);
      await setNavigationMode(ctx, `discussion_create_item:${section}`);
      if (isEditingDiscussionRuleFromPreview(ctx)) {
        return editCallbackMessageOrReply(
          ctx,
          messages[lang].discussionChooseTopTenItem,
          discussionSelectItemKeyboard(lang, section, topTen, {
            cancelCallback: callBacks.discussionCreateCancelEdit,
            cancelText: messages[lang].discussionCancelEdit,
            backButton: createStepBackButton(messages, lang, callBacks.discussionCreatePreview),
          }),
        );
      }
      return editCallbackMessageOrReply(
        ctx,
        messages[lang].discussionChooseTopTenItem,
        discussionSelectItemKeyboard(lang, section, topTen, {
          cancelCallback: callBacks.discussionCreateCancel,
          cancelText: messages[lang].discussionCreateCancel,
          backButton: createStepBackButton(messages, lang, callBacks.discussionCreateBackToSection),
        }),
      );
    }

    if (baseRule.type === "top_ten_completed") {
      const topTen = getAiListItemsFromUser(ctx.user, section, "topTen");
      if (topTen.length < operationalLimits.aiTopTenItems) return ctx.reply(getDiscussionErrorMessage(messages, lang, "requires_top_ten_completed"));
    }
    return askDescription(nextRule, {
      cancelCallback: callBacks.discussionCreateCancel,
      cancelText: messages[lang].discussionCreateCancel,
      backButton: createStepBackButton(messages, lang, callBacks.discussionCreateBackToJoinRule),
    });
  }

  if (data.startsWith(callBacks.discussionCreateSelectTaste)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.discussionCreateSelectTaste, "");
    const [section = "", tasteLabelKey = ""] = payload.split(":");
    if (!["movies", "music", "books"].includes(section)) return ctx.reply(messages[lang].unknownAction);
    const currentTaste = getAiTasteFromUser(ctx.user, section);
    if (!currentTaste.labelKey || currentTaste.labelKey !== tasteLabelKey) {
      return showTasteLabelPicker();
    }
    const nextRule = {
      type: "taste_label",
      section,
      tasteLabelKey,
    };
    if (isEditingDiscussionRuleFromPreview(ctx)) {
      await updateProfileField(ctx.userId, "discussionDraftJoinRule", nextRule);
      await updateUserState(ctx.userId, "discussion_create_preview");
      return editCallbackMessageOrReply(
        ctx,
        buildDiscussionPreviewForCurrentUser(ctx, lang, { discussionDraftJoinRule: nextRule }),
      buildDiscussionCreateConfirmKeyboard(ctx, lang),
      );
    }
    return askDescription(nextRule, {
      cancelCallback: callBacks.discussionCreateCancel,
      cancelText: messages[lang].discussionCreateCancel,
      backButton: createStepBackButton(messages, lang, callBacks.discussionCreateBackToJoinRule),
    });
  }

  if (data.startsWith(callBacks.discussionCreateSelectItem)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.discussionCreateSelectItem, "");
    const [section = "", itemIndexRaw = ""] = payload.split(":");
    const itemIndex = Number(itemIndexRaw);
    const topTen = getAiListItemsFromUser(ctx.user, section, "topTen");
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || !topTen[itemIndex]) {
      return ctx.reply(getDiscussionErrorMessage(messages, lang, "requires_top_ten_item"));
    }
    const nextRule = {
      ...(ctx.user?.discussionDraftJoinRule || {}),
      type: "top_ten_item",
      section,
      itemTitle: topTen[itemIndex].title,
    };
    if (isEditingDiscussionRuleFromPreview(ctx)) {
      await updateProfileField(ctx.userId, "discussionDraftJoinRule", nextRule);
      await updateUserState(ctx.userId, "discussion_create_preview");
      return editCallbackMessageOrReply(
        ctx,
        buildDiscussionPreviewForCurrentUser(ctx, lang, { discussionDraftJoinRule: nextRule }),
      buildDiscussionCreateConfirmKeyboard(ctx, lang),
      );
    }
    return askDescription(nextRule, {
      cancelCallback: callBacks.discussionCreateCancel,
      cancelText: messages[lang].discussionCreateCancel,
      backButton: createStepBackButton(messages, lang, callBacks.discussionCreateBackToJoinRule),
    });
  }

  if (data === callBacks.discussionCreateEditTitle) {
    await ctx.answerCb?.();
    return sendTitlePrompt({
      state: "discussion_create_title_edit",
      cancelCallback: callBacks.discussionCreateCancelEdit,
      cancelText: messages[lang].discussionCancelEdit,
    });
  }

  if (data === callBacks.discussionCreateEditDescription) {
    await ctx.answerCb?.();
    const joinRule = ctx.user?.discussionDraftJoinRule || { type: "open" };
    return askDescription(joinRule, {
      state: "discussion_create_description_edit",
      cancelCallback: callBacks.discussionCreateCancelEdit,
      cancelText: messages[lang].discussionCancelEdit,
      backButton: createStepBackButton(messages, lang, callBacks.discussionCreatePreview),
    });
  }

  if (data === callBacks.discussionCreateEditRule) {
    await ctx.answerCb?.();
    return sendJoinRulePrompt({
      state: "discussion_create_join_rule_edit",
      cancelCallback: callBacks.discussionCreateCancelEdit,
      cancelText: messages[lang].discussionCancelEdit,
    });
  }

  if (data === callBacks.discussionCreatePreview) {
    await ctx.answerCb?.();
    return editCallbackMessageOrReply(
      ctx,
      buildDiscussionPreviewForCurrentUser(ctx, lang),
      buildDiscussionCreateConfirmKeyboard(ctx, lang),
    );
  }

  if (data === callBacks.discussionCreateToggleLocal) {
    if (!starEconomy.localDiscussionsEnabled) return false;
    if (!ctx.user?.discussionDraftIsLocal && !hasValidLocation(ctx.user?.location)) {
      if (ctx.isReplyKeyboardAction) {
        await ctx.reply(messages[lang].discussionLocalNeedsLocation);
      } else {
        await ctx.answerCb?.(messages[lang].discussionLocalNeedsLocation, { show_alert: true });
      }
      return true;
    }
    const nextValue = !ctx.user?.discussionDraftIsLocal;
    await updateProfileField(ctx.userId, "discussionDraftIsLocal", nextValue);
    if (ctx.user) ctx.user.discussionDraftIsLocal = nextValue;
    await ctx.answerCb?.();
    return editCallbackMessageOrReply(
      ctx,
      buildDiscussionPreviewForCurrentUser(ctx, lang),
      buildDiscussionCreateConfirmKeyboard(ctx, lang, nextValue),
    );
  }

  if (data === callBacks.discussionCreateEditCapacity) {
    await ctx.answerCb?.();
    await setNavigationMode(ctx, "discussion_create_capacity");
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionChooseCapacity,
      discussionCreateCapacityKeyboard(lang, ctx.user?.discussionDraftMaxMembers),
    );
  }

  if (data.startsWith(callBacks.discussionCreateSetCapacity)) {
    await ctx.answerCb?.();
    const capacity = normalizeMaxMembers(data.replace(callBacks.discussionCreateSetCapacity, ""));
    await updateProfileField(ctx.userId, "discussionDraftMaxMembers", capacity);
    return editCallbackMessageOrReply(
      ctx,
      buildDiscussionPreviewForCurrentUser(ctx, lang, { discussionDraftMaxMembers: capacity }),
      buildDiscussionCreateConfirmKeyboard(ctx, lang),
    );
  }

  if (data === callBacks.discussionCreateConfirm) {
    await ctx.answerCb?.();
    const hasName = await requireDiscussionProfileName(ctx, lang, {
      source: "create",
      token: "confirm",
    });
    if (!hasName) return true;
    const capacity = Number(ctx.user?.discussionDraftMaxMembers || operationalLimits.discussionMaxMembers);
    const paidCapacity = getPaidDiscussionCapacity(capacity);
    if (paidCapacity) {
      if (!paidCapacity.available) {
        return showPaidCapacityError(messages[lang].discussionPaidCapacityUnavailable);
      }
      return showPaidCapacityQuote(paidCapacity);
    }
    const created = await createCurrentDraft(false);
    if (!created.ok) {
      await refundExtraSlotAuthorization("discussion_extra_slot_create_failed");
      return ctx.reply(getDiscussionErrorMessage(messages, lang, created.reason) || messages[lang].discussionCreateFailed);
    }
    if (!created.paidOwnedSlotUsed) {
      await refundExtraSlotAuthorization("discussion_extra_slot_not_needed");
    }
    await clearDiscussionMenuNotice(ctx);
    await clearDiscussionDraft(ctx.userId);
    await updateUserState(ctx.userId, "idle");
    applyStarRewardsToContext(ctx, created.starRewards);
    const starNotice = buildStarRewardNotice(messages, lang, created.starRewards);
    await ctx.reply([messages[lang].discussionJoined, starNotice].filter(Boolean).join("\n\n"));
    return sendDiscussionRoom(ctx, lang, created.discussion);
  }

  if (data.startsWith(callBacks.discussionCreatePaidCapacityConfirm)) {
    await ctx.answerCb?.();
    const quoted = parsePaidCapacityConfirmPayload(data);
    const paidCapacity = getPaidDiscussionCapacity(quoted.capacity);
    if (!paidCapacity?.available) {
      return showPaidCapacityError(messages[lang].discussionPaidCapacityUnavailable);
    }
    if (Number(paidCapacity.cost) !== Number(quoted.cost)) {
      return showPaidCapacityError(messages[lang].discussionPaidCapacityStale);
    }
    if (Number(ctx.user?.discussionDraftMaxMembers) !== Number(quoted.capacity)) {
      return showPaidCapacityError(messages[lang].discussionPaidCapacityStale);
    }

    const spend = quoted.cost > 0
      ? await spendStars({
        userId: ctx.userId,
        amount: quoted.cost,
        reason: "discussion_paid_capacity",
        idempotencyKey: `discussion-paid-capacity:${ctx.userId}:${ctx.callbackMessageId || "message"}:${quoted.capacity}:${quoted.cost}`,
        settingsSnapshot: {
          paidCapacity: quoted.capacity,
          paidCapacityCost: quoted.cost,
        },
        metadata: {
          capacity: quoted.capacity,
          kind: paidCapacity.kind,
        },
      })
      : { ok: true, balance: ctx.user?.starBalance || 0 };
    if (!spend.ok) {
      if (spend.reason === "insufficient_balance") {
        return showPaidCapacityError(fillPaidCapacityText(messages[lang].discussionPaidCapacityInsufficient, lang, {
          capacity: quoted.capacity,
          cost: quoted.cost,
          balance: spend.balance || ctx.user?.starBalance || 0,
        }));
      }
      return showPaidCapacityError(messages[lang].discussionPaidCapacityUnavailable);
    }

    if (ctx.user) ctx.user.starBalance = spend.balance;
    const created = await createCurrentDraft(true);
    if (!created.ok) {
      let refunded = false;
      if (spend.transaction?._id) {
        const refund = await refundStars({
          transactionId: spend.transaction._id,
          idempotencyKey: `discussion-paid-capacity-refund:${spend.transaction._id}`,
          reason: "discussion_paid_capacity_failed",
          metadata: { capacity: quoted.capacity, createReason: created.reason },
        });
        refunded = Boolean(refund.ok);
        if (ctx.user && refund.ok) ctx.user.starBalance = refund.balance;
      }
      await refundExtraSlotAuthorization("discussion_extra_slot_create_failed");
      return showPaidCapacityError(refunded
        ? messages[lang].discussionPaidCapacityFailedRefunded
        : messages[lang].discussionPaidCapacityFailed);
    }

    if (!created.paidOwnedSlotUsed) {
      await refundExtraSlotAuthorization("discussion_extra_slot_not_needed");
    }

    await clearDiscussionMenuNotice(ctx);
    await clearDiscussionDraft(ctx.userId);
    await updateUserState(ctx.userId, "idle");
    applyStarRewardsToContext(ctx, created.starRewards);
    const starNotice = buildStarRewardNotice(messages, lang, created.starRewards);
    await ctx.reply([messages[lang].discussionJoined, starNotice].filter(Boolean).join("\n\n"));
    return sendDiscussionRoom(ctx, lang, created.discussion);
  }

  return null;
}

module.exports = {
  isDiscussionCreateCallback,
  handleDiscussionCreateCallback,
  resumeDiscussionCreatePreview,
  startDiscussionCreateFlow,
};
