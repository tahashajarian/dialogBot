const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  profilePrivacySafetyKeyboard,
  profileInvitationRestrictionsKeyboard,
} = require("../keyboards");
const {
  listInvitationRestrictions,
  countInvitationRestrictions,
  unmuteInvitationRestrictionById,
  unmuteInvitationRestrictionByProfileCode,
} = require("../services/discussion-invitation-mutes");
const { buildInvitationRestrictionsView } = require("../services/profile-privacy-ui");
const { updateProfileField } = require("../services/users");
const { MODES, setNavigationMode } = require("../services/reply-keyboard-navigation");

const RESTRICTIONS_PAGE_SIZE = 5;

function isProfilePrivacyCallback(data = "") {
  return data === callBacks.profilePrivacy
    || data === callBacks.profilePrivacyBack
    || data.startsWith(callBacks.profileSetPeopleDiscovery)
    || data.startsWith(callBacks.profileSetFavoritesVisible)
    || data === callBacks.profileInvitationRestrictions
    || data.startsWith(callBacks.profileInvitationRestrictionsPage)
    || data === callBacks.profileInvitationRestrictionsClose
    || data.startsWith(callBacks.profileInvitationAllow);
}

function canPersistMessageState(ctx) {
  return Boolean(ctx?.user?._id || ctx?.persistInvitationRestrictions);
}

async function rememberInvitationRestrictionsMessage(ctx, messageOrId) {
  const candidate = typeof messageOrId === "boolean" ? ctx.callbackMessageId : messageOrId;
  const messageId = Number(candidate?.message_id || candidate);
  if (!Number.isInteger(messageId) || messageId <= 0) return;
  if (ctx.user) ctx.user.profileInvitationRestrictionsLastMessageId = messageId;
  if (canPersistMessageState(ctx)) {
    await updateProfileField(ctx.userId, "profileInvitationRestrictionsLastMessageId", messageId);
  }
}

async function forgetInvitationRestrictionsMessage(ctx) {
  if (ctx.user) ctx.user.profileInvitationRestrictionsLastMessageId = null;
  if (canPersistMessageState(ctx)) {
    await updateProfileField(ctx.userId, "profileInvitationRestrictionsLastMessageId", null);
  }
}

async function clearInvitationRestrictionsMessage(ctx, fallbackMessageId = null) {
  const rememberedMessageId = Number(ctx.user?.profileInvitationRestrictionsLastMessageId);
  const messageId = Number(fallbackMessageId || rememberedMessageId);
  const clearsRememberedMessage = !fallbackMessageId || messageId === rememberedMessageId;
  if (clearsRememberedMessage) {
    await forgetInvitationRestrictionsMessage(ctx);
  }
  if (!Number.isInteger(messageId) || messageId <= 0) return false;
  try {
    await ctx.deleteMessage?.(messageId);
    return true;
  } catch {
    return false;
  }
}

function invitationRestrictionProfileKeyboardAfterAllow(ctx, profileCode) {
  const rows = ctx.callbackMessage?.reply_markup?.inline_keyboard;
  if (!Array.isArray(rows)) return null;
  const allowCallback = `${callBacks.profileInvitationAllow}${profileCode}`;
  return {
    inline_keyboard: rows
      .map((row) => row.filter((button) => button?.callback_data !== allowCallback))
      .filter((row) => row.length > 0),
  };
}

async function sendProfilePrivacySafety(ctx, lang, user = ctx.user, {
  footerText = "",
  editCallbackMessageOrReply,
} = {}) {
  const text = [messages[lang].profilePrivacySafetyTitle, messages[lang].profilePrivacySafetyText, footerText]
    .filter(Boolean)
    .join("\n\n");
  const keyboard = profilePrivacySafetyKeyboard(lang, {
    showsActiveDiscussion: user?.showActiveDiscussionOnProfile !== false,
    showsInPeopleDiscovery: user?.showProfileInPeopleDiscovery !== false,
    showsFavorites: user?.showFavoritesOnProfile !== false,
  });
  const sent = editCallbackMessageOrReply
    ? await editCallbackMessageOrReply(ctx, text, keyboard)
    : await ctx.reply(text, keyboard);
  await setNavigationMode(ctx, MODES.PROFILE);
  return sent;
}

async function sendProfilePrivacyStatus(ctx, lang, user, text, { editCallbackMessageOrReply } = {}) {
  return sendProfilePrivacySafety(ctx, lang, user, {
    footerText: text,
    editCallbackMessageOrReply,
  });
}

async function renderInvitationRestrictionsList(ctx, lang, page = 0, { editCallbackMessageOrReply } = {}) {
  let total;
  let normalizedPage;
  let listed;
  try {
    total = await countInvitationRestrictions(ctx.userId);
    const totalPages = Math.max(1, Math.ceil(total / RESTRICTIONS_PAGE_SIZE));
    normalizedPage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
    listed = await listInvitationRestrictions(ctx.userId, {
      skip: normalizedPage * RESTRICTIONS_PAGE_SIZE,
      limit: RESTRICTIONS_PAGE_SIZE,
    });
  } catch {
    const keyboard = profileInvitationRestrictionsKeyboard(lang, [], { page: 0, totalPages: 1 });
    await setNavigationMode(ctx, "profile_invitation_restrictions:0:1");
    const sent = editCallbackMessageOrReply
      ? await editCallbackMessageOrReply(ctx, messages[lang].profileInvitationRestrictionFailed, keyboard)
      : await ctx.reply(messages[lang].profileInvitationRestrictionFailed, keyboard);
    await rememberInvitationRestrictionsMessage(ctx, sent);
    return sent;
  }
  const totalPages = Math.max(1, Math.ceil(total / RESTRICTIONS_PAGE_SIZE));
  const start = normalizedPage * RESTRICTIONS_PAGE_SIZE;
  const view = buildInvitationRestrictionsView(messages, lang, listed.restrictions || [], {
    start,
    totalCount: total,
  });
  const keyboard = profileInvitationRestrictionsKeyboard(lang, view.entries, {
    page: normalizedPage,
    totalPages,
  });
  await setNavigationMode(ctx, `profile_invitation_restrictions:${normalizedPage}:${totalPages}`);
  const sent = editCallbackMessageOrReply
    ? await editCallbackMessageOrReply(ctx, view.text, keyboard)
    : await ctx.reply(view.text, keyboard);
  await rememberInvitationRestrictionsMessage(ctx, sent);
  return sent;
}

async function refreshInvitationRestrictionsList(ctx, lang, page = 0) {
  const messageId = Number(ctx.user?.profileInvitationRestrictionsLastMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || !ctx.editMessageText) {
    return renderInvitationRestrictionsList(ctx, lang, page);
  }
  return renderInvitationRestrictionsList(ctx, lang, page, {
    editCallbackMessageOrReply: async (_callbackCtx, text, keyboard) => {
      const edited = await ctx.editMessageText(messageId, text, keyboard);
      if (edited) return { message_id: messageId };
      await ctx.editMessageReplyMarkup?.(messageId, { inline_keyboard: [] });
      return ctx.reply(text, keyboard);
    },
  });
}

async function allowInvitationRestrictionCommand(ctx, lang, text) {
  const value = String(text || "").trim();
  const idMatch = value.match(/^\/allow_ir_([a-f0-9]{24})$/i);
  const profileMatch = value.match(/^\/allow_inv_([a-z0-9]+)$/i);
  if (!idMatch && !profileMatch) return false;
  const page = Number(String(ctx.user?.navigationMode || "").match(/^profile_invitation_restrictions:(\d+):/)?.[1] || 0);
  const result = idMatch
    ? await unmuteInvitationRestrictionById({
      muterUserId: ctx.userId,
      restrictionId: idMatch[1],
    })
    : await unmuteInvitationRestrictionByProfileCode({
      muterUserId: ctx.userId,
      publicProfileCode: `u_${profileMatch[1]}`,
    });
  if (!result.ok) return ctx.reply(messages[lang].profileInvitationRestrictionFailed);
  return refreshInvitationRestrictionsList(ctx, lang, page);
}

async function handleProfilePrivacyCallback(ctx, lang, {
  editCallbackMessageOrReply,
  editProfileSurfaceCard,
  restoreOwnProfileCard,
} = {}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.profilePrivacy) {
    await ctx.answerCb?.();
    return sendProfilePrivacySafety(ctx, lang, ctx.user || {}, {
      editCallbackMessageOrReply: editProfileSurfaceCard || editCallbackMessageOrReply,
    });
  }

  if (data === callBacks.profilePrivacyBack) {
    await ctx.answerCb?.();
    return restoreOwnProfileCard(ctx, lang, ctx.user || {});
  }

  if (data.startsWith(callBacks.profileSetPeopleDiscovery)) {
    const raw = data.replace(callBacks.profileSetPeopleDiscovery, "");
    if (!new Set(["0", "1"]).has(raw)) return false;
    const nextValue = raw === "1";
    const updatedUser = await updateProfileField(ctx.userId, "showProfileInPeopleDiscovery", nextValue);
    if (ctx.user) ctx.user.showProfileInPeopleDiscovery = nextValue;
    await ctx.answerCb?.();
    return sendProfilePrivacyStatus(
      ctx,
      lang,
      updatedUser || ctx.user || {},
      nextValue
        ? messages[lang].profilePeopleDiscoveryVisibleOn
        : messages[lang].profilePeopleDiscoveryVisibleOff,
      { editCallbackMessageOrReply: editProfileSurfaceCard || editCallbackMessageOrReply },
    );
  }

  if (data.startsWith(callBacks.profileSetFavoritesVisible)) {
    const raw = data.replace(callBacks.profileSetFavoritesVisible, "");
    if (!new Set(["0", "1"]).has(raw)) return false;
    const nextValue = raw === "1";
    const updatedUser = await updateProfileField(ctx.userId, "showFavoritesOnProfile", nextValue);
    if (ctx.user) ctx.user.showFavoritesOnProfile = nextValue;
    await ctx.answerCb?.();
    return sendProfilePrivacyStatus(
      ctx,
      lang,
      updatedUser || ctx.user || {},
      nextValue
        ? messages[lang].profileFavoritesVisibleOn
        : messages[lang].profileFavoritesVisibleOff,
      { editCallbackMessageOrReply: editProfileSurfaceCard || editCallbackMessageOrReply },
    );
  }

  if (data === callBacks.profileInvitationRestrictions) {
    await ctx.answerCb?.();
    return renderInvitationRestrictionsList(ctx, lang, 0, {
      editCallbackMessageOrReply: editProfileSurfaceCard || editCallbackMessageOrReply,
    });
  }

  if (data.startsWith(callBacks.profileInvitationAllow)) {
    const profileCode = data.replace(callBacks.profileInvitationAllow, "");
    const profileMode = String(ctx.user?.navigationMode || "")
      .match(/^public_profile:restrictions:(u_[A-Z0-9]+):(\d+):/);
    if (!profileMode || profileMode[1] !== profileCode) {
      await ctx.answerCb?.(messages[lang].profileInvitationRestrictionFailed);
      return false;
    }
    const page = Number(profileMode[2]) || 0;
    const result = await unmuteInvitationRestrictionByProfileCode({
      muterUserId: ctx.userId,
      publicProfileCode: profileCode,
    });
    if (!result.ok || !result.removed) {
      await ctx.answerCb?.(messages[lang].profileInvitationRestrictionFailed);
      return false;
    }
    await ctx.answerCb?.();
    const profileKeyboard = invitationRestrictionProfileKeyboardAfterAllow(ctx, profileCode);
    if (profileKeyboard) {
      await ctx.editMessageReplyMarkup?.(ctx.callbackMessageId, profileKeyboard);
    }
    return refreshInvitationRestrictionsList(ctx, lang, page);
  }

  if (data.startsWith(callBacks.profileInvitationRestrictionsPage)) {
    await ctx.answerCb?.();
    const page = Number(data.replace(callBacks.profileInvitationRestrictionsPage, ""));
    return renderInvitationRestrictionsList(ctx, lang, page, {
      editCallbackMessageOrReply: editProfileSurfaceCard || editCallbackMessageOrReply,
    });
  }

  if (data === callBacks.profileInvitationRestrictionsClose) {
    await ctx.answerCb?.();
    await forgetInvitationRestrictionsMessage(ctx);
    return sendProfilePrivacySafety(ctx, lang, ctx.user || {}, {
      editCallbackMessageOrReply: editProfileSurfaceCard || editCallbackMessageOrReply,
    });
  }

  return false;
}

module.exports = {
  allowInvitationRestrictionCommand,
  clearInvitationRestrictionsMessage,
  handleProfilePrivacyCallback,
  isProfilePrivacyCallback,
  refreshInvitationRestrictionsList,
  renderInvitationRestrictionsList,
  sendProfilePrivacySafety,
  sendProfilePrivacyStatus,
};
