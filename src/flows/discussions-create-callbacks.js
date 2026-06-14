const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  inlineKeyboard,
  discussionsMenuKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionSectionKeyboard,
  discussionCreateConfirmKeyboard,
  discussionCreateCapacityKeyboard,
  discussionSelectTasteKeyboard,
  discussionSelectItemKeyboard,
} = require("../keyboards");
const {
  updateProfileField,
  updateUserState,
  getAiListItemsFromUser,
  getAiTasteFromUser,
} = require("../services/users");
const { toPlainUser } = require("../services/profile");
const {
  getSectionLabel,
  getTasteLabelEmoji,
  getTasteLabelTitle,
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

function isEditingDiscussionRuleFromPreview(ctx) {
  return ctx.user?.state === "discussion_create_join_rule_edit";
}

function createStepBackButton(_messages, lang, callbackData) {
  return {
    text: messages[lang].discussionBack,
    callback_data: callbackData,
  };
}

function discussionMenuBackKeyboard(lang) {
  return inlineKeyboard([
    [{ text: messages[lang].discussionBack, callback_data: callBacks.discussions }],
  ]);
}

async function clearDiscussionDraft(userId) {
  await Promise.all([
    updateProfileField(userId, "discussionDraftTitle", ""),
    updateProfileField(userId, "discussionDraftDescription", ""),
    updateProfileField(userId, "discussionDraftJoinRule", null),
    updateProfileField(userId, "discussionDraftMaxMembers", 20),
  ]);
}

async function askDiscussionDescription(ctx, lang, joinRule, {
  state = "discussion_create_description",
  cancelCallback = callBacks.discussionCreateCancel,
  cancelText = null,
  backButton = null,
  deleteCallbackMessageIfPossible,
  rememberDiscussionMenuNotice,
} = {}) {
  await updateProfileField(ctx.userId, "discussionDraftJoinRule", joinRule);
  await updateUserState(ctx.userId, state);
  await deleteCallbackMessageIfPossible(ctx);
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
  includeTitlePin = false,
  deleteCallbackMessageIfPossible,
  rememberDiscussionMenuNotice,
} = {}) {
  await updateUserState(ctx.userId, state);
  await deleteCallbackMessageIfPossible(ctx);
  if (includeTitlePin) {
    await ctx.reply(messages[lang].discussionCreateTitlePin);
  }
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

async function handleDiscussionCreateCallback(ctx, lang, helpers) {
  const data = ctx.callbackData || "";
  const {
    editCallbackMessageOrReply,
    deleteCallbackMessageIfPossible,
    clearDiscussionMenuNotice,
    rememberDiscussionMenuNotice,
    sendDiscussionRoom,
  } = helpers;

  const askDescription = (joinRule, options = {}) => askDiscussionDescription(ctx, lang, joinRule, {
    ...options,
    deleteCallbackMessageIfPossible,
    rememberDiscussionMenuNotice,
  });
  const sendTitlePrompt = (options = {}) => sendDiscussionCreateTitlePrompt(ctx, lang, {
    ...options,
    deleteCallbackMessageIfPossible,
    rememberDiscussionMenuNotice,
  });
  const sendJoinRulePrompt = (options = {}) => sendDiscussionJoinRulePrompt(ctx, lang, {
    ...options,
    editCallbackMessageOrReply,
  });

  if (data === callBacks.discussionCreateStart) {
    await ctx.answerCb?.();
    
    // Check active owned limit (applies to everyone, no bypass)
    const activeLimit = await checkActiveOwnedDiscussionsLimit(ctx.userId);
    if (!activeLimit.ok) {
      await clearDiscussionDraft(ctx.userId);
      await updateUserState(ctx.userId, "idle");
      return editCallbackMessageOrReply(
        ctx,
        getDiscussionErrorMessage(messages, lang, activeLimit.reason) || messages[lang].discussionActiveOwnedLimit,
        discussionJoinErrorAckKeyboard(lang, "discussions"),
      );
    }
    
    await clearDiscussionDraft(ctx.userId);
    return sendTitlePrompt({ includeTitlePin: true });
  }

  if (data === callBacks.discussionCreateCancelEdit) {
    await ctx.answerCb?.(messages[lang].discussionCreateCanceled.replace(/^🤖\s*/, ""));
    await updateUserState(ctx.userId, "discussion_create_preview");
    await clearDiscussionMenuNotice(ctx);
    await ctx.reply(messages[lang].discussionCreateCanceled, {
      reply_markup: { remove_keyboard: true },
    });
    return editCallbackMessageOrReply(
      ctx,
      buildDiscussionPreviewForCurrentUser(ctx, lang),
      discussionCreateConfirmKeyboard(lang),
    );
  }

  if (data === callBacks.discussionCreateBackToTitle) {
    await ctx.answerCb?.();
    return sendTitlePrompt();
  }

  if (data === callBacks.discussionCreateCancel) {
    await ctx.answerCb?.(messages[lang].discussionCreateCanceled.replace(/^🤖\s*/, ""));
    await clearDiscussionDraft(ctx.userId);
    await updateUserState(ctx.userId, "idle");
    await clearDiscussionMenuNotice(ctx);
    await deleteCallbackMessageIfPossible(ctx);
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
      discussionCreateConfirmKeyboard(lang),
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
        discussionCreateConfirmKeyboard(lang),
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
    
    // Check if user has ANY badges or items across all sections
    const sections = ["movies", "music", "books", "random"];
    if (type === "taste_label") {
      const hasBadge = sections.some((section) => {
        const taste = getAiTasteFromUser(ctx.user, section);
        return taste?.labelKey;
      });
      if (!hasBadge) {
        await deleteCallbackMessageIfPossible(ctx);
        await ctx.reply(messages[lang].discussionRuleNoBadgesAtAll);
        const editMode = isEditingDiscussionRuleFromPreview(ctx);
        return sendJoinRulePrompt({
          state: editMode ? "discussion_create_join_rule_edit" : "discussion_create_join_rule",
          cancelCallback: editMode ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          cancelText: editMode ? messages[lang].discussionCancelEdit : messages[lang].discussionCreateCancel,
          backButton: editMode
            ? null
            : createStepBackButton(messages, lang, callBacks.discussionCreateBackToTitle),
        });
      }
    } else if (type === "top_ten_item") {
      const hasItem = sections.some((section) => {
        const topTen = getAiListItemsFromUser(ctx.user, section, "topTen");
        return topTen.length > 0;
      });
      if (!hasItem) {
        await deleteCallbackMessageIfPossible(ctx);
        await ctx.reply(messages[lang].discussionRuleNoItemsAtAll);
        const editMode = isEditingDiscussionRuleFromPreview(ctx);
        return sendJoinRulePrompt({
          state: editMode ? "discussion_create_join_rule_edit" : "discussion_create_join_rule",
          cancelCallback: editMode ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          cancelText: editMode ? messages[lang].discussionCancelEdit : messages[lang].discussionCreateCancel,
          backButton: editMode
            ? null
            : createStepBackButton(messages, lang, callBacks.discussionCreateBackToTitle),
        });
      }
    }
    
    await updateProfileField(ctx.userId, "discussionDraftJoinRule", { type });
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
    if (baseRule.type === "taste_label") {
      const taste = getAiTasteFromUser(ctx.user, section);
      if (!taste?.labelKey) {
        await deleteCallbackMessageIfPossible(ctx);
        await ctx.reply(
          messages[lang].discussionRuleNoEligibleTaste
            .replace("{section}", getSectionLabel(messages, lang, section)),
        );
        const editMode = isEditingDiscussionRuleFromPreview(ctx);
        return sendJoinRulePrompt({
          state: editMode ? "discussion_create_join_rule_edit" : "discussion_create_join_rule",
          cancelCallback: editMode ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          cancelText: editMode ? messages[lang].discussionCancelEdit : messages[lang].discussionCreateCancel,
          backButton: editMode
            ? null
            : createStepBackButton(messages, lang, callBacks.discussionCreateBackToTitle),
        });
      }
      const finalizedRule = { ...nextRule, tasteLabelKey: taste.labelKey };
      await updateProfileField(ctx.userId, "discussionDraftJoinRule", finalizedRule);
      if (isEditingDiscussionRuleFromPreview(ctx)) {
        await updateUserState(ctx.userId, "discussion_create_preview");
        return editCallbackMessageOrReply(
          ctx,
          buildDiscussionPreviewForCurrentUser(ctx, lang, { discussionDraftJoinRule: finalizedRule }),
          discussionCreateConfirmKeyboard(lang),
        );
      }
      return editCallbackMessageOrReply(
        ctx,
        messages[lang].discussionChooseTasteLabel.replace("{section}", getSectionLabel(messages, lang, section)),
        discussionSelectTasteKeyboard(lang, section, taste.labelKey, {
          tasteLabelTitle: `${getTasteLabelEmoji(section, taste.labelKey)} ${getTasteLabelTitle(messages, lang, section, taste.labelKey)}`,
          cancelCallback: isEditingDiscussionRuleFromPreview(ctx) ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          cancelText: isEditingDiscussionRuleFromPreview(ctx) ? messages[lang].discussionCancelEdit : null,
          backButton: isEditingDiscussionRuleFromPreview(ctx)
            ? createStepBackButton(messages, lang, callBacks.discussionCreatePreview)
            : createStepBackButton(messages, lang, callBacks.discussionCreateBackToSection),
        }),
      );
    }

    if (baseRule.type === "top_ten_item") {
      const topTen = getAiListItemsFromUser(ctx.user, section, "topTen");
      if (!topTen.length) {
        await deleteCallbackMessageIfPossible(ctx);
        await ctx.reply(
          messages[lang].discussionRuleNoEligibleItem
            .replace("{section}", getSectionLabel(messages, lang, section)),
        );
        const editMode = isEditingDiscussionRuleFromPreview(ctx);
        return sendJoinRulePrompt({
          state: editMode ? "discussion_create_join_rule_edit" : "discussion_create_join_rule",
          cancelCallback: editMode ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          cancelText: editMode ? messages[lang].discussionCancelEdit : messages[lang].discussionCreateCancel,
          backButton: editMode
            ? null
            : createStepBackButton(messages, lang, callBacks.discussionCreateBackToTitle),
        });
      }
      await updateProfileField(ctx.userId, "discussionDraftJoinRule", nextRule);
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
      if (topTen.length < 10) return ctx.reply(getDiscussionErrorMessage(messages, lang, "requires_top_ten_completed"));
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
    const nextRule = {
      ...(ctx.user?.discussionDraftJoinRule || {}),
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
        discussionCreateConfirmKeyboard(lang),
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
        discussionCreateConfirmKeyboard(lang),
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
      discussionCreateConfirmKeyboard(lang),
    );
  }

  if (data === callBacks.discussionCreateEditCapacity) {
    await ctx.answerCb?.();
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
      discussionCreateConfirmKeyboard(lang),
    );
  }

  if (data === callBacks.discussionCreateConfirm) {
    await ctx.answerCb?.();
    const created = await createDiscussion({
      creatorUserId: ctx.userId,
      title: ctx.user?.discussionDraftTitle || "",
      description: ctx.user?.discussionDraftDescription || "",
      joinRule: ctx.user?.discussionDraftJoinRule || { type: "open" },
      maxMembers: ctx.user?.discussionDraftMaxMembers || 20,
    });
    if (!created.ok) {
      return ctx.reply(getDiscussionErrorMessage(messages, lang, created.reason) || messages[lang].discussionCreateFailed);
    }
    await clearDiscussionMenuNotice(ctx);
    await deleteCallbackMessageIfPossible(ctx);
    await clearDiscussionDraft(ctx.userId);
    await updateUserState(ctx.userId, "idle");
    await ctx.reply(messages[lang].discussionJoined);
    return sendDiscussionRoom(ctx, lang, created.discussion);
  }

  return null;
}

module.exports = {
  isDiscussionCreateCallback,
  handleDiscussionCreateCallback,
};
