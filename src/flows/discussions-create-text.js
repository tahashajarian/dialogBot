const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  discussionsMenuKeyboard,
  discussionCreateDescriptionKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinRuleKeyboard,
  discussionCreateConfirmKeyboard,
} = require("../keyboards");
const { updateProfileField, resetDiscussionDraft, updateUserState } = require("../services/users");
const { toPlainUser } = require("../services/profile");
const { hasLink, validateDiscussionTitle, validateDiscussionDescription } = require("../services/discussions");
const { buildDiscussionPreviewText } = require("../services/discussion-ui");
const { refundPaidExtraDiscussionAuthorization } = require("../services/discussion-paid-creation");
const {
  clearDiscussionMenuNotice,
  rememberDiscussionMenuNotice,
  sendDiscussionCreatePrompt,
} = require("./discussions-text");

function normalizeKeyboardText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\uFE0F/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

function isDiscussionCreateTextState(state = "") {
  return (
    state === "discussion_create_title" ||
    state === "discussion_create_title_edit" ||
    state === "discussion_create_description" ||
    state === "discussion_create_description_edit" ||
    state === "discussion_create_join_rule" ||
    state === "discussion_create_join_rule_edit"
  );
}

function buildDiscussionPreviewForCurrentDraft(ctx, lang, description) {
  return buildDiscussionPreviewText(messages, lang, {
    ...toPlainUser(ctx.user),
    discussionDraftDescription: description,
  });
}

function buildDiscussionPreviewForCurrentUser(ctx, lang, overrides = {}) {
  return buildDiscussionPreviewText(messages, lang, {
    ...toPlainUser(ctx.user),
    ...overrides,
  });
}

async function clearDiscussionDraft(ctx) {
  await resetDiscussionDraft(ctx.userId);
}

async function cancelDiscussionCreate(ctx, lang) {
  await clearDiscussionMenuNotice(ctx);
  const refund = await refundPaidExtraDiscussionAuthorization(ctx.userId);
  if (ctx.user && refund.refunded) ctx.user.starBalance = refund.balance;
  await clearDiscussionDraft(ctx);
  await updateUserState(ctx.userId, "idle");
  await ctx.reply(messages[lang].discussionCreateCanceled, {
    reply_markup: { remove_keyboard: true },
  });
  return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
}

async function handleDiscussionCreateTitleText(ctx, lang, text, state) {
  const isEditingFromPreview = state === "discussion_create_title_edit";
  if (normalizeKeyboardText(text) === normalizeKeyboardText(messages[lang].discussionCreateCancel)) {
    return cancelDiscussionCreate(ctx, lang);
  }

  const cancelKeyboard = () => discussionCreateCancelKeyboard(
    lang,
    isEditingFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
    isEditingFromPreview ? messages[lang].discussionCancelEdit : null,
  );

  if (!text || text.startsWith("/")) {
    return sendDiscussionCreatePrompt(
      ctx,
      isEditingFromPreview ? messages[lang].discussionInvalidTitle : messages[lang].discussionCreateAskTitle,
      cancelKeyboard(),
    );
  }

  const normalized = String(text).trim().replace(/\s+/g, " ").slice(0, 80);
  if (!normalized) {
    return sendDiscussionCreatePrompt(ctx, messages[lang].discussionInvalidTitle, cancelKeyboard());
  }

  if (hasLink(normalized)) {
    return sendDiscussionCreatePrompt(ctx, messages[lang].discussionInvalidTitleLink, cancelKeyboard());
  }

  const titleValidation = validateDiscussionTitle(normalized);
  if (!titleValidation.valid) {
    const validationMessage = titleValidation.reason === "sensitive_content"
      ? messages[lang].discussionSensitiveTitle
      : messages[lang].discussionInvalidTitle;
    return sendDiscussionCreatePrompt(ctx, validationMessage, cancelKeyboard());
  }

  await clearDiscussionMenuNotice(ctx);
  await updateProfileField(ctx.userId, "discussionDraftTitle", normalized);
  if (isEditingFromPreview) {
    await updateUserState(ctx.userId, "discussion_create_preview");
    return ctx.reply(
      buildDiscussionPreviewForCurrentUser(ctx, lang, { discussionDraftTitle: normalized }),
      discussionCreateConfirmKeyboard(lang, ctx.user?.discussionDraftLanguage || ctx.user?.lang),
    );
  }

  await updateUserState(ctx.userId, "discussion_create_join_rule");
  return ctx.reply(
    messages[lang].discussionJoinRulePrompt,
    discussionJoinRuleKeyboard(lang, {
      cancelCallback: callBacks.discussionCreateCancel,
      backButton: {
        text: messages[lang].discussionBack,
        callback_data: callBacks.discussionCreateBackToTitle,
      },
    }),
  );
}

async function handleDiscussionCreateDescriptionText(ctx, lang, text, state) {
  const draftRule = ctx.user?.discussionDraftJoinRule || { type: "open" };
  const isOpenRule = draftRule.type === "open";
  const isEditingDescriptionFromPreview = state === "discussion_create_description_edit";
  const descriptionBackButton = isEditingDescriptionFromPreview
    ? {
      text: messages[lang].discussionBack,
      callback_data: callBacks.discussionCreatePreview,
    }
    : {
      text: messages[lang].discussionBack,
      callback_data: callBacks.discussionCreateBackToJoinRule,
    };

  if (normalizeKeyboardText(text) === normalizeKeyboardText(messages[lang].discussionCreateCancel)) {
    return cancelDiscussionCreate(ctx, lang);
  }

  const cancelKeyboard = () => discussionCreateCancelKeyboard(
    lang,
    isEditingDescriptionFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
    isEditingDescriptionFromPreview ? messages[lang].discussionCancelEdit : null,
    descriptionBackButton,
  );

  if (normalizeKeyboardText(text) === normalizeKeyboardText(messages[lang].discussionSkipDescription)) {
    if (isOpenRule) {
      return sendDiscussionCreatePrompt(ctx, messages[lang].discussionOpenNeedsDescription, cancelKeyboard());
    }

    await clearDiscussionMenuNotice(ctx);
    await updateProfileField(ctx.userId, "discussionDraftDescription", "");
    await updateUserState(ctx.userId, "discussion_create_preview");
    return ctx.reply(
      buildDiscussionPreviewForCurrentDraft(ctx, lang, ""),
      discussionCreateConfirmKeyboard(lang, ctx.user?.discussionDraftLanguage || ctx.user?.lang),
    );
  }

  if (!text || text.startsWith("/")) {
    return sendDiscussionCreatePrompt(
      ctx,
      messages[lang].discussionCreateAskDescription,
      isOpenRule
        ? cancelKeyboard()
        : discussionCreateDescriptionKeyboard(lang, {
          cancelCallback: isEditingDescriptionFromPreview ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
          cancelText: isEditingDescriptionFromPreview ? messages[lang].discussionCancelEdit : null,
          backButton: descriptionBackButton,
        }),
    );
  }

  const normalized = String(text).trim().replace(/\s+/g, " ").slice(0, 300);
  if (isOpenRule && !normalized) {
    return sendDiscussionCreatePrompt(ctx, messages[lang].discussionOpenNeedsDescription, cancelKeyboard());
  }

  const descValidation = validateDiscussionDescription(normalized);
  if (normalized && !descValidation.valid) {
    return sendDiscussionCreatePrompt(ctx, messages[lang].discussionInvalidDescription, cancelKeyboard());
  }

  await clearDiscussionMenuNotice(ctx);
  await updateProfileField(ctx.userId, "discussionDraftDescription", normalized);
  await updateUserState(ctx.userId, "discussion_create_preview");
  return ctx.reply(
    buildDiscussionPreviewForCurrentDraft(ctx, lang, normalized),
      discussionCreateConfirmKeyboard(lang, ctx.user?.discussionDraftLanguage || ctx.user?.lang),
  );
}

async function handleDiscussionCreateJoinRuleText(ctx, lang, state) {
  await ctx.reply(messages[lang].discussionSelectOptionPrompt);
  await clearDiscussionMenuNotice(ctx);
  const isEditingJoinRule = state === "discussion_create_join_rule_edit";
  const sent = await ctx.reply(
    messages[lang].discussionJoinRulePrompt,
    discussionJoinRuleKeyboard(lang, {
      cancelCallback: isEditingJoinRule ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel,
      cancelText: isEditingJoinRule ? messages[lang].discussionCancelEdit : null,
      backButton: isEditingJoinRule
        ? null
        : {
          text: messages[lang].discussionBack,
          callback_data: callBacks.discussionCreateBackToTitle,
        },
    }),
  );
  await rememberDiscussionMenuNotice(ctx, sent);
  return sent;
}

async function handleDiscussionCreateText(ctx, lang, text, state) {
  if (state === "discussion_create_title" || state === "discussion_create_title_edit") {
    return handleDiscussionCreateTitleText(ctx, lang, text, state);
  }

  if (state === "discussion_create_description" || state === "discussion_create_description_edit") {
    return handleDiscussionCreateDescriptionText(ctx, lang, text, state);
  }

  if (state === "discussion_create_join_rule" || state === "discussion_create_join_rule_edit") {
    return handleDiscussionCreateJoinRuleText(ctx, lang, state);
  }

  return null;
}

module.exports = {
  isDiscussionCreateTextState,
  handleDiscussionCreateText,
};
