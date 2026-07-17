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
    || data === callBacks.profileInvitationRestrictions
    || data.startsWith(callBacks.profileInvitationRestrictionsPage)
    || data === callBacks.profileInvitationRestrictionsClose;
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

async function clearInvitationRestrictionsMessage(ctx, fallbackMessageId = null) {
  const rememberedMessageId = Number(ctx.user?.profileInvitationRestrictionsLastMessageId);
  const messageId = Number(fallbackMessageId || rememberedMessageId);
  const clearsRememberedMessage = !fallbackMessageId || messageId === rememberedMessageId;
  if (clearsRememberedMessage) {
    if (ctx.user) ctx.user.profileInvitationRestrictionsLastMessageId = null;
    if (canPersistMessageState(ctx)) {
      await updateProfileField(ctx.userId, "profileInvitationRestrictionsLastMessageId", null);
    }
  }
  if (!Number.isInteger(messageId) || messageId <= 0) return false;
  try {
    await ctx.deleteMessage?.(messageId);
    return true;
  } catch {
    return false;
  }
}

async function sendProfilePrivacySafety(ctx, lang, user = ctx.user, { footerText = "" } = {}) {
  const text = [messages[lang].profilePrivacySafetyTitle, messages[lang].profilePrivacySafetyText, footerText]
    .filter(Boolean)
    .join("\n\n");
  const sent = await ctx.reply(text, profilePrivacySafetyKeyboard(lang, {
    showsActiveDiscussion: user?.showActiveDiscussionOnProfile !== false,
    showsInPeopleDiscovery: user?.showProfileInPeopleDiscovery !== false,
  }));
  await setNavigationMode(ctx, MODES.PROFILE_PRIVACY);
  return sent;
}

async function sendProfilePrivacyStatus(ctx, lang, user, text) {
  const sent = await ctx.reply(text, profilePrivacySafetyKeyboard(lang, {
    showsActiveDiscussion: user?.showActiveDiscussionOnProfile !== false,
    showsInPeopleDiscovery: user?.showProfileInPeopleDiscovery !== false,
  }));
  await setNavigationMode(ctx, MODES.PROFILE_PRIVACY);
  return sent;
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
  await clearInvitationRestrictionsMessage(ctx);
  return renderInvitationRestrictionsList(ctx, lang, page);
}

async function handleProfilePrivacyCallback(ctx, lang, {
  editCallbackMessageOrReply,
  retireCallbackMessageIfPossible,
  sendOwnProfileSettings,
} = {}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.profilePrivacy) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendProfilePrivacySafety(ctx, lang, ctx.user || {});
  }

  if (data === callBacks.profilePrivacyBack) {
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendOwnProfileSettings(ctx, lang, ctx.user || {});
  }

  if (data.startsWith(callBacks.profileSetPeopleDiscovery)) {
    const raw = data.replace(callBacks.profileSetPeopleDiscovery, "");
    if (!new Set(["0", "1"]).has(raw)) return false;
    const nextValue = raw === "1";
    const updatedUser = await updateProfileField(ctx.userId, "showProfileInPeopleDiscovery", nextValue);
    if (ctx.user) ctx.user.showProfileInPeopleDiscovery = nextValue;
    await ctx.answerCb?.();
    await retireCallbackMessageIfPossible?.(ctx);
    return sendProfilePrivacyStatus(
      ctx,
      lang,
      updatedUser || ctx.user || {},
      nextValue
        ? messages[lang].profilePeopleDiscoveryVisibleOn
        : messages[lang].profilePeopleDiscoveryVisibleOff,
    );
  }

  if (data === callBacks.profileInvitationRestrictions) {
    await ctx.answerCb?.();
    return renderInvitationRestrictionsList(ctx, lang, 0, { editCallbackMessageOrReply });
  }

  if (data.startsWith(callBacks.profileInvitationRestrictionsPage)) {
    await ctx.answerCb?.();
    const page = Number(data.replace(callBacks.profileInvitationRestrictionsPage, ""));
    return renderInvitationRestrictionsList(ctx, lang, page, { editCallbackMessageOrReply });
  }

  if (data === callBacks.profileInvitationRestrictionsClose) {
    await ctx.answerCb?.();
    const rememberedMessageId = Number(ctx.user?.profileInvitationRestrictionsLastMessageId);
    const closesCurrentList = !rememberedMessageId || rememberedMessageId === Number(ctx.callbackMessageId);
    await clearInvitationRestrictionsMessage(ctx, ctx.callbackMessageId);
    if (closesCurrentList) await setNavigationMode(ctx, MODES.PROFILE_PRIVACY);
    return true;
  }

  return false;
}

module.exports = {
  allowInvitationRestrictionCommand,
  clearInvitationRestrictionsMessage,
  handleProfilePrivacyCallback,
  isProfilePrivacyCallback,
  renderInvitationRestrictionsList,
  sendProfilePrivacySafety,
  sendProfilePrivacyStatus,
};
