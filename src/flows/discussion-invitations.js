const messages = require("../messages");
const User = require("../models/user");
const { formatOperationalLimitsText } = require("../services/operational-limits-ui");
const { callBacks } = require("../constants");
const {
  discussionsMenuKeyboard,
  discussionInviteSavedProfilesKeyboard,
  discussionInviteNoSavedProfilesKeyboard,
  discussionInviteDiscussionPickerKeyboard,
  discussionInviteProfilePickerKeyboard,
  discussionInviteProfileReturnKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationNoticeKeyboard,
  discussionInvitationPreviewKeyboard,
  discussionInvitationsBackKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionJoinLockedKeyboard,
  discussionUnavailableAckKeyboard,
  discussionLeaveCurrentNoticeKeyboard,
} = require("../keyboards");
const {
  buildInvitationSentText,
  filterSavedInviteTargets,
  buildInviteSavedProfilesText,
  buildInviteDiscussionPickerText,
  buildInviteDiscussionPickerList,
  buildInvitationPreviewText,
  buildReceivedInvitationsText,
  shouldShowDiscussionInvitationFirstTimeTip,
} = require("../services/discussion-invitations-ui");
const {
  createDiscussionInvitation,
  countAllVisibleReceivedInvitations,
  countUnseenPendingReceivedInvitations,
  getInvitationDisplayState,
  getInvitationForUser,
  isOwnerReentryInvitation,
  listEligibleDiscussionsForInvite,
  listOwnedDiscussionsForProfileInvite,
  listReceivedInvitations,
  markInvitationsSeen,
  markInvitationAccepted,
  removeInvitationForUser,
  trimReceivedInvitationInbox,
} = require("../services/discussion-invitations");
const {
  canRestrictInviterForUser,
  muteInviterForUser,
} = require("../services/discussion-invitation-mutes");
const { EVENT_NAMES, trackEvent } = require("../services/analytics-events");
const {
  ensurePublicDiscussionCode,
  findDiscussionByPublicCode,
  getActiveDiscussionInviteForUser,
  normalizePublicDiscussionCode,
  normalizePublicProfileCode,
} = require("../services/discussions");
const { buildSavedProfileListItems } = require("../services/saved-profiles-ui");
const { buildDiscussionRoomKeyboard } = require("../services/discussion-room-ui");
const {
  getDiscussionDisplayTitle,
  getDiscussionErrorMessage,
  buildDiscussionInviteLockedText,
} = require("../services/discussion-ui");
const { joinDiscussionAndNotify } = require("../services/discussion-actions");
const { markSectionTipShownForContext, updateProfileField, updateUserState } = require("../services/users");
const { rememberDiscussionListReturnMode } = require("../services/discussion-list-return");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
} = require("../services/stars-ui");
const {
  awardSavedInvitePair,
} = require("../services/star-invitations");
const { requireDiscussionProfileName } = require("./discussion-name-gate");
const { PAGINATION } = require("../constants/pagination");
const { paginateItems } = require("../services/pagination");
const { parsePublicProfileNavigationMode } = require("../services/public-profile-navigation");

const INVITATIONS_PAGE_SIZE = 5;
const PROFILE_INVITE_MODE_PATTERN = /^profile_invite_picker:(people|saved):(\d+):(u_[A-Z0-9]+)$/;

function parseProfileInviteMode(mode = "") {
  const match = String(mode).match(PROFILE_INVITE_MODE_PATTERN);
  return match ? { source: match[1], page: Number(match[2]) || 0, code: match[3] } : null;
}

async function setProfileInviteMode(ctx, { source, page, code }) {
  const mode = `profile_invite_picker:${source}:${Number(page) || 0}:${code}`;
  if (ctx.user) ctx.user.navigationMode = mode;
  await updateProfileField(ctx.userId, "navigationMode", mode);
  return mode;
}

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function normalizeProfileCodeFromInviteCommand(value) {
  const raw = String(value || "").trim().replace(/^\/?(invite|iv)_/i, "");
  return normalizePublicProfileCode(raw.startsWith("u_") ? raw : `u_${raw}`);
}

function normalizeInvitationCodeFromCommand(value, prefix) {
  return String(value || "").trim().replace(new RegExp(`^/?${prefix}_`, "i"), "");
}

function buildInvitationAcceptStatusText(lang, {
  joined = false,
  starNotice = "",
  opensRoom = false,
} = {}) {
  return [
    joined
      ? messages[lang].discussionJoined
      : opensRoom
        ? ""
        : messages[lang].discussionOpened,
    starNotice,
  ].filter(Boolean).join("\n\n");
}

async function notifyInviteeOfInvitation(ctx, invitationResult) {
  const invitee = invitationResult?.invitee;
  const inviteeUserId = Number(invitee?.userId);
  if (!Number.isInteger(inviteeUserId) || inviteeUserId <= 0 || !ctx.sendToUser) {
    return false;
  }
  const targetLang = messages[invitee?.lang] ? invitee.lang : "fa";
  try {
    await ctx.sendToUser(
      inviteeUserId,
      messages[targetLang].discussionInvitationReceivedNotice,
      discussionInvitationNoticeKeyboard(
        targetLang,
        invitationResult?.invitation?.publicInvitationCode,
      ),
      targetLang,
    );
    return true;
  } catch {
    return false;
  }
}

async function getInvitationCount(userId) {
  return countUnseenPendingReceivedInvitations(userId).catch(() => 0);
}

function buildDiscussionsMenuText(lang, invitationCount = 0, text = messages[lang].discussionsMenu) {
  const count = Math.max(0, Number(invitationCount) || 0);
  if (!count || text !== messages[lang].discussionsMenu) return text;
  return `${text}\n\n${messages[lang].discussionInvitationsWithCount.replace("{count}", String(count))}`;
}

async function sendDiscussionsMenuWithInvitationCount(ctx, lang, text = messages[lang].discussionsMenu, {
  editCallbackMessageOrReply = null,
} = {}) {
  const invitationCount = await getInvitationCount(ctx.userId);
  const keyboard = discussionsMenuKeyboard(lang, { invitationCount });
  const menuText = buildDiscussionsMenuText(lang, invitationCount, text);
  if (editCallbackMessageOrReply) return editCallbackMessageOrReply(ctx, menuText, keyboard);
  return ctx.reply(menuText, keyboard);
}

async function buildSavedInviteTargets(ctx) {
  const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
  return buildSavedProfileListItems({
    codes,
    normalizePublicProfileCode,
    findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
      .select("userId publicProfileCode profileName firstName")
      .lean(),
  });
}

function getInviteCreationFailureText(lang, reason, details = {}) {
  if (reason === "duplicate") return messages[lang].discussionInvitationAlreadySent;
  if (reason === "daily_limit") {
    return formatOperationalLimitsText(messages[lang].discussionInvitationDailyLimit, {
      count: details.cap,
      invitationWindowHours: details.windowHours,
    });
  }
  if (reason === "already_member") return messages[lang].discussionInvitationAlreadyMember;
  if (reason === "not_saved") return messages[lang].discussionInvitationNotSaved;
  if (reason === "self_invite") return messages[lang].discussionInvitationSelfInvite;
  if (reason === "inviter_muted") return messages[lang].discussionInvitationCannotReceiveFromYou;
  if (reason === "removed_by_owner") return messages[lang].discussionInvitationUnavailable;
  if (reason === "not_member") return messages[lang].discussionInviteNotMember;
  if (reason === "discussion_closed") return messages[lang].discussionInviteUnavailable;
  return messages[lang].discussionInvitationUnavailable;
}

async function showInviteSavedProfilePicker(ctx, lang, {
  editCallbackMessageOrReply,
  page = 0,
  expectedDiscussionId = "",
} = {}) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
  if (expectedDiscussionId && expectedDiscussionId !== activeDiscussionId) {
    return ctx.reply(messages[lang].discussionInviteUnavailable, discussionUnavailableAckKeyboard(lang));
  }
  const invite = await getActiveDiscussionInviteForUser(ctx.userId, activeDiscussionId);
  if (!invite.ok) {
    const text = invite.reason === "not_member"
      ? messages[lang].discussionInviteNotMember
      : getDiscussionErrorMessage(messages, lang, invite.reason);
    return ctx.reply(text, discussionInvitationAckKeyboard(lang, "room"));
  }

  const targets = await buildSavedInviteTargets(ctx);
  if (!targets.length) {
    return (editCallbackMessageOrReply || ((roomCtx, text, keyboard) => roomCtx.reply(text, keyboard)))(
      ctx,
      messages[lang].discussionInvitationNoSavedProfiles,
      discussionInviteNoSavedProfilesKeyboard(lang),
    );
  }

  const eligibleTargets = filterSavedInviteTargets(targets, invite.discussion?.memberUserIds);
  if (!eligibleTargets.length) {
    return (editCallbackMessageOrReply || ((roomCtx, text, keyboard) => roomCtx.reply(text, keyboard)))(
      ctx,
      messages[lang].discussionInvitationAllSavedAlreadyMembers,
      discussionInviteSavedProfilesKeyboard(lang),
    );
  }

  const paginated = paginateItems(eligibleTargets, page, PAGINATION.savedProfilesPageSize);

  return (editCallbackMessageOrReply || ((roomCtx, text, keyboard) => roomCtx.reply(text, keyboard)))(
    ctx,
    buildInviteSavedProfilesText(messages, lang, invite.discussion),
    discussionInviteSavedProfilesKeyboard(lang, paginated.items, {
      page: paginated.page,
      totalPages: paginated.totalPages,
      discussionId: activeDiscussionId,
      discussionCode: invite.code,
    }),
  );
}

async function createInvitationAndAck(ctx, lang, {
  profileCode,
  discussionId,
  source,
  destination,
  editCallbackMessageOrReply,
  returnKeyboard = null,
}) {
  const created = await createDiscussionInvitation({
    inviterUserId: ctx.userId,
    inviteePublicProfileCode: profileCode,
    discussionId,
    source,
  });

  const keyboard = returnKeyboard || discussionInvitationAckKeyboard(lang, destination);
  const send = editCallbackMessageOrReply || ((roomCtx, text, extra) => roomCtx.reply(text, extra));
  if (!created.ok) {
    const failureText = getInviteCreationFailureText(lang, created.reason, created);
    const isUnavailable = failureText === messages[lang].discussionInviteUnavailable
      || failureText === messages[lang].discussionInvitationUnavailable;
    return send(
      ctx,
      failureText,
      returnKeyboard || (isUnavailable ? discussionUnavailableAckKeyboard(lang) : keyboard),
    );
  }

  await notifyInviteeOfInvitation(ctx, created);
  return send(
    ctx,
    buildInvitationSentText(messages, lang, created.invitee, {
      restoresOwnerRemoval: created.restoresOwnerRemoval,
    }),
    returnKeyboard || { reply_markup: { inline_keyboard: [] } },
  );
}

async function showCreatorDiscussionPickerForProfile(ctx, lang, profileContext, {
  editCallbackMessageOrReply,
} = {}) {
  const target = await User.findOne({ publicProfileCode: profileContext.code })
    .select("userId profileName firstName publicProfileCode bannedAt showProfileInPeopleDiscovery")
    .lean();
  if (!target) return false;
  if (profileContext.source === "people" && (target.bannedAt || target.showProfileInPeopleDiscovery === false)) {
    return false;
  }
  if (profileContext.source === "saved") {
    const savedCodes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    if (!savedCodes.some((entry) => normalizePublicProfileCode(entry) === profileContext.code)) return false;
  }

  const discussions = await listOwnedDiscussionsForProfileInvite(ctx.userId, target.userId);
  if (!discussions.length) return false;
  await Promise.all(discussions.map((discussion) => ensurePublicDiscussionCode(discussion)));
  const keyboardDiscussions = discussions.map((discussion) => ({
    ...(discussion.toObject?.() || discussion),
    title: getDiscussionDisplayTitle(messages, lang, discussion),
  }));
  await setProfileInviteMode(ctx, profileContext);
  const text = `${buildInviteDiscussionPickerText(messages, lang, target)}\n\n${
    buildInviteDiscussionPickerList(messages, lang, discussions)
  }`;
  const keyboard = discussionInviteProfilePickerKeyboard(lang, profileContext.code, keyboardDiscussions);
  return editCallbackMessageOrReply
    ? editCallbackMessageOrReply(ctx, text, keyboard)
    : ctx.reply(text, keyboard);
}

async function showDiscussionPickerForSavedProfile(ctx, lang, profileCode, {
  editCallbackMessageOrReply,
} = {}) {
  const normalizedCode = normalizePublicProfileCode(profileCode);
  const target = normalizedCode
    ? await User.findOne({ publicProfileCode: normalizedCode }).select("userId profileName firstName publicProfileCode").lean()
    : null;
  if (!target) return ctx.reply(messages[lang].profileCodeNotFound);

  const savedCodes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
  const isSaved = savedCodes.some((entry) => normalizePublicProfileCode(entry) === normalizedCode);
  if (!isSaved) {
    return ctx.reply(messages[lang].discussionInvitationNotSaved);
  }

  const discussions = await listEligibleDiscussionsForInvite(ctx.userId, target.userId);
  await Promise.all(discussions.map((discussion) => ensurePublicDiscussionCode(discussion)));
  if (!discussions.length) {
    return ctx.reply(
      messages[lang].discussionInvitationNoEligibleDiscussions,
      discussionInvitationAckKeyboard(lang, "saved"),
    );
  }

  const text = `${buildInviteDiscussionPickerText(messages, lang, target)}\n\n${
    buildInviteDiscussionPickerList(messages, lang, discussions)
  }`;
  const keyboardDiscussions = discussions.map((discussion) => ({
    ...discussion,
    title: getDiscussionDisplayTitle(messages, lang, discussion),
  }));
  const keyboard = discussionInviteDiscussionPickerKeyboard(lang, normalizedCode, keyboardDiscussions);
  if (editCallbackMessageOrReply) return editCallbackMessageOrReply(ctx, text, keyboard);
  return ctx.reply(text, keyboard);
}

async function renderInvitationsList(ctx, lang, page = 0, {
  editCallbackMessageOrReply,
} = {}) {
  await trimReceivedInvitationInbox(ctx.userId);
  const totalInvitations = await countAllVisibleReceivedInvitations(ctx.userId);
  const totalPages = Math.max(1, Math.ceil(totalInvitations / INVITATIONS_PAGE_SIZE));
  const normalizedPage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const navigationMode = `discussion_invitations:${normalizedPage}:${totalPages}`;
  await updateProfileField(ctx.userId, "navigationMode", navigationMode);
  if (ctx.user) ctx.user.navigationMode = navigationMode;
  const start = normalizedPage * INVITATIONS_PAGE_SIZE;
  const listed = await listReceivedInvitations(ctx.userId, {
    skip: start,
    limit: INVITATIONS_PAGE_SIZE,
    statuses: ["pending", "accepted"],
  });
  const pageEntries = listed.invitations || [];
  const entries = [];
  for (const entry of pageEntries) {
    entries.push({
      ...entry,
      state: await getInvitationDisplayState(ctx.user, entry.discussion, entry.invitation),
    });
  }
  const text = await buildReceivedInvitationsText(messages, lang, ctx.user, entries, {
    startIndex: start,
    totalCount: totalInvitations,
  });
  const pendingEntries = entries.filter((entry) => entry.invitation?.status === "pending");
  const showsFirstDiscussionTip = shouldShowDiscussionInvitationFirstTimeTip(ctx.user, pendingEntries);
  const unopenedStarter = entries.find((entry) => (
    ["bot_onboarding", "onboarding_match"].includes(entry.invitation?.source)
    && !entry.invitation?.seenAt
  ));
  const keyboard = discussionInvitationsBackKeyboard(lang, {
    page: normalizedPage,
    totalPages,
  });
  const sent = editCallbackMessageOrReply
    ? await editCallbackMessageOrReply(ctx, text, keyboard)
    : await ctx.reply(text, keyboard);
  if (showsFirstDiscussionTip) {
    await markSectionTipShownForContext(ctx, "discussions", new Date()).catch(() => null);
  }
  if (unopenedStarter) {
    const discussion = unopenedStarter.discussion;
    const matchType = discussion?.isBotCreated
      && String(discussion?.botSeedKey || "").replace(/:(fa|en)$/, "") === "free-discussion"
      ? "free"
      : "match";
    void trackEvent({
      name: EVENT_NAMES.starterInvitationOpened,
      userId: ctx.userId,
      source: "onboarding",
      metadata: { matchType },
    });
  }
  await updateProfileField(ctx.userId, "discussionLastListMessageId", getMessageId(sent) || ctx.callbackMessageId || null);
  await updateProfileField(ctx.userId, "discussionLastListType", "invitations");
  await markInvitationsSeen(entries.map((entry) => entry.invitation?._id));
  return sent;
}

async function acceptInvitationCommand(ctx, lang, text, {
  sendRoom,
  allowActiveSwitch = false,
} = {}) {
  const code = normalizeInvitationCodeFromCommand(text, "accept_inv");
  const found = await getInvitationForUser(code, ctx.userId, { statuses: ["pending", "accepted"] });
  if (!found.ok) {
    return ctx.reply(messages[lang].discussionInvitationUnavailable, discussionUnavailableAckKeyboard(lang));
  }
  if (!await requireDiscussionProfileName(ctx, lang, { source: "accept", token: code })) {
    return { ok: false, reason: "requires_profile_name" };
  }
  if (!found.discussion || found.discussion.status !== "open") {
    return ctx.reply(messages[lang].discussionInviteUnavailable, discussionUnavailableAckKeyboard(lang));
  }
  await updateUserState(ctx.userId, "idle");

  const allowOwnerReentry = isOwnerReentryInvitation(found.invitation, found.discussion, ctx.userId);
  const joined = await joinDiscussionAndNotify({
    ctx,
    messages,
    discussionId: found.discussion._id,
    allowOwnerReentry,
    allowActiveSwitch,
  });
  if (!joined.ok) {
    let failureText = getDiscussionErrorMessage(messages, lang, joined.reason);
    const isJoinRuleFailure = (
      joined.reason === "requires_taste_label" ||
      joined.reason === "requires_top_ten_item" ||
      joined.reason === "requires_top_ten_completed"
    );
    if (isJoinRuleFailure) {
      failureText = buildDiscussionInviteLockedText(messages, lang, joined.reason, found.discussion);
    }
    return ctx.reply(
      failureText,
      joined.reason === "discussion_unavailable"
        ? discussionUnavailableAckKeyboard(lang)
        : joined.reason === "leave_current_first"
        ? discussionLeaveCurrentNoticeKeyboard(lang, code, { invitation: true })
        : isJoinRuleFailure
          ? discussionJoinLockedKeyboard(lang)
        : discussionJoinErrorAckKeyboard(lang, "invitations"),
    );
  }

  await markInvitationAccepted(found.invitation);
  const inviterReward = await awardSavedInvitePair({
    inviterUserId: found.invitation.inviterUserId,
    inviteeUserId: ctx.userId,
    invitationId: found.invitation._id,
    source: found.invitation.source,
  });
  if (inviterReward.ok && inviterReward.applied) {
    const inviter = await User.findOne({ userId: found.invitation.inviterUserId }).select("lang").lean();
    const inviterLang = messages[inviter?.lang] ? inviter.lang : "fa";
    const inviterNotice = buildStarRewardNotice(messages, inviterLang, [{
      milestone: "invite_pair_reward",
      amount: inviterReward.transaction.amount,
      balance: inviterReward.balance,
    }]);
    if (inviterNotice) await ctx.sendToUser?.(found.invitation.inviterUserId, inviterNotice, {}, inviterLang);
  }
  applyStarRewardsToContext(ctx, joined.starRewards);
  const starNotice = buildStarRewardNotice(messages, lang, joined.starRewards);
  const statusText = buildInvitationAcceptStatusText(lang, {
    joined: joined.joined,
    starNotice,
    opensRoom: Boolean(sendRoom),
  });
  if (sendRoom) {
    if (statusText) await ctx.reply(statusText);
    return sendRoom(ctx, lang, joined.discussion);
  }
  return ctx.reply(statusText, await buildDiscussionRoomKeyboard(lang, joined.discussion, ctx.userId));
}

async function removeInvitationCommand(ctx, lang, text) {
  const code = normalizeInvitationCodeFromCommand(text, "remove_inv");
  const removed = await removeInvitationForUser(code, ctx.userId);
  if (!removed.ok) {
    return ctx.reply(messages[lang].discussionInvitationUnavailable, discussionUnavailableAckKeyboard(lang));
  }
  await ctx.reply(messages[lang].discussionInvitationRemoved);
  return renderInvitationsList(ctx, lang);
}

function isDiscussionInvitationCallback(data = "") {
  return data === callBacks.discussionInvitations ||
    data.startsWith(callBacks.discussionInvitationsPage) ||
    data.startsWith(callBacks.discussionInvitationPreview) ||
    data.startsWith(callBacks.discussionInvitationPreviewAccept) ||
    data.startsWith(callBacks.discussionInvitationSwitchJoin) ||
    data.startsWith(callBacks.discussionInvitationPreviewProfile) ||
    data.startsWith(callBacks.discussionInvitationPreviewRemove) ||
    data === callBacks.discussionInviteModeSaved ||
    data === callBacks.discussionInviteModeShare ||
    data === callBacks.discussionInvitePickerClose ||
    data.startsWith(callBacks.discussionInviteSavedPage) ||
    data.startsWith(callBacks.discussionInviteSavedTarget) ||
    data.startsWith(callBacks.discussionInviteDiscussionTarget) ||
    data.startsWith(callBacks.discussionInviteProfileOpen) ||
    data === callBacks.discussionInviteProfileBack ||
    data === callBacks.discussionInvitationNoticeClose ||
    data.startsWith(callBacks.discussionInvitationMute) ||
    data.startsWith(callBacks.discussionInvitationMuteConfirm) ||
    data === callBacks.discussionInvitationMuteCancel ||
    data.startsWith(callBacks.discussionInvitationAck);
}

async function handleDiscussionInvitationCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
  sendRoom,
  sendShareableInviteForActiveDiscussion,
  sendSavedProfilesList,
  sendPublicProfileByCode,
} = {}) {
  const data = ctx.callbackData || "";

  if (data.startsWith(callBacks.discussionInviteProfileOpen)) {
    const code = normalizePublicProfileCode(data.replace(callBacks.discussionInviteProfileOpen, ""));
    const profileContext = parsePublicProfileNavigationMode(ctx.user?.navigationMode);
    if (
      !code
      || !profileContext
      || !["people", "saved"].includes(profileContext.source)
      || profileContext.code !== code
    ) {
      await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
      return false;
    }
    const shown = await showCreatorDiscussionPickerForProfile(ctx, lang, profileContext, {
      editCallbackMessageOrReply,
    });
    if (!shown) await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
    else await ctx.answerCb?.();
    return shown;
  }

  if (data === callBacks.discussionInviteProfileBack) {
    const inviteContext = parseProfileInviteMode(ctx.user?.navigationMode);
    if (!inviteContext || !sendPublicProfileByCode) {
      await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
      return false;
    }
    await ctx.answerCb?.();
    const isSaved = (ctx.user?.savedProfileCodes || [])
      .some((entry) => normalizePublicProfileCode(entry) === inviteContext.code);
    const profileMode = `public_profile:${inviteContext.source}:${inviteContext.code}:${inviteContext.page}:${isSaved ? "saved" : "unsaved"}:0`;
    if (ctx.user) ctx.user.navigationMode = profileMode;
    await updateProfileField(ctx.userId, "navigationMode", profileMode);
    return sendPublicProfileByCode(ctx, lang, inviteContext.code, {
      fromPeopleList: inviteContext.source === "people",
      fromSavedList: inviteContext.source === "saved",
      editCurrent: true,
    });
  }

  if (data === callBacks.discussionInvitations) {
    await ctx.answerCb?.();
    await rememberDiscussionListReturnMode(ctx);
    if (ctx.callbackMessage?.caption || ctx.callbackMessage?.photo || ctx.callbackMessage?.document) {
      await deleteCallbackMessageIfPossible?.(ctx);
    }
    return renderInvitationsList(ctx, lang, 0, { editCallbackMessageOrReply });
  }

  if (data === callBacks.discussionInvitationNoticeClose) {
    await ctx.answerCb?.();
    return deleteCallbackMessageIfPossible?.(ctx);
  }

  if (data.startsWith(callBacks.discussionInvitationPreview)) {
    const code = data.replace(callBacks.discussionInvitationPreview, "");
    const found = await getInvitationForUser(code, ctx.userId, {
      statuses: ["pending", "accepted"],
    });
    if (!found.ok || !found.discussion) {
      await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
      return (editCallbackMessageOrReply || ((_ctx, text, keyboard) => _ctx.reply(text, keyboard)))(
        ctx,
        messages[lang].discussionInvitationUnavailable,
        discussionInvitationPreviewKeyboard(lang),
      );
    }
    const isUserInvitation = !["bot_onboarding", "onboarding_match", "shared_link"]
      .includes(found.invitation?.source);
    const inviter = isUserInvitation
      ? await User.findOne({ userId: found.invitation.inviterUserId })
        .select("userId profileName firstName publicProfileCode")
        .lean()
      : null;
    const entry = {
      invitation: found.invitation,
      discussion: found.discussion,
      inviter,
      state: await getInvitationDisplayState(ctx.user, found.discussion, found.invitation),
    };
    await ctx.answerCb?.();
    const sent = await (editCallbackMessageOrReply || ((_ctx, text, keyboard) => _ctx.reply(text, keyboard)))(
      ctx,
      buildInvitationPreviewText(messages, lang, entry),
      discussionInvitationPreviewKeyboard(lang, entry),
    );
    await markInvitationsSeen([found.invitation._id]);
    return sent;
  }

  if (data.startsWith(callBacks.discussionInvitationPreviewAccept)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.discussionInvitationPreviewAccept, "");
    return acceptInvitationCommand(ctx, lang, `/accept_inv_${code}`, { sendRoom });
  }

  if (data.startsWith(callBacks.discussionInvitationSwitchJoin)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.discussionInvitationSwitchJoin, "");
    return acceptInvitationCommand(ctx, lang, `/accept_inv_${code}`, {
      sendRoom,
      allowActiveSwitch: true,
    });
  }

  if (data.startsWith(callBacks.discussionInvitationPreviewProfile)) {
    const payload = data.replace(callBacks.discussionInvitationPreviewProfile, "");
    const separatorIndex = payload.indexOf(":");
    const code = separatorIndex >= 0 ? payload.slice(0, separatorIndex) : "";
    const profileCode = normalizePublicProfileCode(
      separatorIndex >= 0 ? payload.slice(separatorIndex + 1) : "",
    );
    const found = await getInvitationForUser(code, ctx.userId, {
      statuses: ["pending", "accepted"],
    });
    const inviter = found.ok && found.invitation?.status === "pending"
      ? await User.findOne({ userId: found.invitation.inviterUserId })
        .select("publicProfileCode")
        .lean()
      : null;
    if (
      !profileCode
      || normalizePublicProfileCode(inviter?.publicProfileCode) !== profileCode
      || !sendPublicProfileByCode
    ) {
      await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
      return false;
    }
    await ctx.answerCb?.();
    return sendPublicProfileByCode(ctx, lang, profileCode, {
      fromInvitationPreview: true,
    });
  }

  if (data.startsWith(callBacks.discussionInvitationPreviewRemove)) {
    const code = data.replace(callBacks.discussionInvitationPreviewRemove, "");
    const removed = await removeInvitationForUser(code, ctx.userId);
    if (!removed.ok) {
      await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
      return false;
    }
    await ctx.answerCb?.(messages[lang].discussionInvitationRemoved);
    return (editCallbackMessageOrReply || ((_ctx, text, keyboard) => _ctx.reply(text, keyboard)))(
      ctx,
      messages[lang].discussionInvitationRemoved,
      discussionInvitationPreviewKeyboard(lang),
    );
  }

  if (data.startsWith(callBacks.discussionInvitationsPage)) {
    await ctx.answerCb?.();
    const page = Number(data.replace(callBacks.discussionInvitationsPage, ""));
    return renderInvitationsList(ctx, lang, page, { editCallbackMessageOrReply });
  }

  if (data === callBacks.discussionInviteModeSaved) {
    await ctx.answerCb?.();
    return showInviteSavedProfilePicker(ctx, lang);
  }

  if (data.startsWith(callBacks.discussionInviteSavedPage)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.discussionInviteSavedPage, "");
    const separatorIndex = payload.indexOf(":");
    const page = separatorIndex >= 0 ? Number(payload.slice(0, separatorIndex)) : 0;
    const expectedDiscussionId = separatorIndex >= 0 ? payload.slice(separatorIndex + 1) : "";
    return showInviteSavedProfilePicker(ctx, lang, {
      editCallbackMessageOrReply,
      page,
      expectedDiscussionId,
    });
  }

  if (data === callBacks.discussionInviteModeShare) {
    await ctx.answerCb?.();
    return sendShareableInviteForActiveDiscussion(ctx, lang);
  }

  if (data === callBacks.discussionInvitePickerClose) {
    await ctx.answerCb?.();
    return deleteCallbackMessageIfPossible?.(ctx);
  }

  if (data.startsWith(callBacks.discussionInviteSavedTarget)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.discussionInviteSavedTarget, "");
    const [profileCodeRaw = "", discussionCodeRaw = ""] = payload.split(":");
    const profileCode = normalizePublicProfileCode(profileCodeRaw);
    const discussionCode = normalizePublicDiscussionCode(discussionCodeRaw);
    const boundDiscussion = discussionCode ? await findDiscussionByPublicCode(discussionCode) : null;
    const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
    if (!boundDiscussion || String(boundDiscussion._id) !== activeDiscussionId) {
      await deleteCallbackMessageIfPossible?.(ctx);
      return true;
    }
    return createInvitationAndAck(ctx, lang, {
      profileCode,
      discussionId: boundDiscussion._id,
      source: "room",
      destination: "room",
      editCallbackMessageOrReply,
    });
  }

  if (data.startsWith(callBacks.discussionInviteDiscussionTarget)) {
    const payload = data.replace(callBacks.discussionInviteDiscussionTarget, "");
    const [profileCodeRaw = "", discussionCodeRaw = ""] = payload.split(":");
    const discussionCode = normalizePublicDiscussionCode(discussionCodeRaw);
    const discussion = discussionCode ? await findDiscussionByPublicCode(discussionCode) : null;
    const profileInviteContext = parseProfileInviteMode(ctx.user?.navigationMode);
    if (profileInviteContext) {
      const target = await User.findOne({ publicProfileCode: profileInviteContext.code })
        .select("userId isBanned showProfileInPeopleDiscovery")
        .lean();
      if (
        normalizePublicProfileCode(profileCodeRaw) !== profileInviteContext.code
        || !discussion
        || Number(discussion.creatorUserId) !== Number(ctx.userId)
        || !target
        || target.isBanned
        || (profileInviteContext.source === "people" && target.showProfileInPeopleDiscovery === false)
      ) {
        await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
        return false;
      }
      await ctx.answerCb?.();
      return createInvitationAndAck(ctx, lang, {
        profileCode: profileInviteContext.code,
        discussionId: discussion._id,
        source: profileInviteContext.source === "people" ? "people_profile" : "saved_profile",
        destination: profileInviteContext.source,
        editCallbackMessageOrReply,
        returnKeyboard: discussionInviteProfileReturnKeyboard(lang),
      });
    }
    await ctx.answerCb?.();
    return createInvitationAndAck(ctx, lang, {
      profileCode: normalizePublicProfileCode(profileCodeRaw),
      discussionId: discussion?._id || "",
      source: "saved_profile",
      destination: "saved",
      editCallbackMessageOrReply,
    });
  }

  if (
    data.startsWith(callBacks.discussionInvitationMute)
    || data.startsWith(callBacks.discussionInvitationMuteConfirm)
  ) {
    const prefix = data.startsWith(callBacks.discussionInvitationMuteConfirm)
      ? callBacks.discussionInvitationMuteConfirm
      : callBacks.discussionInvitationMute;
    const mutedUserId = Number(data.replace(prefix, ""));
    const profileContext = parsePublicProfileNavigationMode(ctx.user?.navigationMode);
    if (["invitations", "invitation_preview"].includes(profileContext?.source)) {
      const displayedProfile = await User.findOne({
        publicProfileCode: profileContext.code,
      }).select("userId").lean();
      if (Number(displayedProfile?.userId) !== mutedUserId) {
        await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
        return false;
      }
    }
    const allowed = await canRestrictInviterForUser({
      muterUserId: ctx.userId,
      mutedUserId,
    });
    if (!allowed) {
      await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
      return false;
    }
    const muted = await muteInviterForUser({
      muterUserId: ctx.userId,
      mutedUserId,
    });
    if (!muted.ok) {
      await ctx.answerCb?.(messages[lang].discussionInvitationUnavailable);
      return false;
    }
    await ctx.answerCb?.(messages[lang].discussionInvitationMuted);
    if (["invitations", "invitation_preview"].includes(profileContext?.source) && sendPublicProfileByCode) {
      const sourceOptions = profileContext.source === "invitations"
        ? { fromInvitationList: true }
        : { fromInvitationPreview: true };
      return sendPublicProfileByCode(ctx, lang, profileContext.code, {
        ...sourceOptions,
        editCurrent: true,
      });
    }
    await deleteCallbackMessageIfPossible?.(ctx);
    return renderInvitationsList(ctx, lang);
  }

  if (data === callBacks.discussionInvitationMuteCancel) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible?.(ctx);
    return renderInvitationsList(ctx, lang);
  }

  if (data.startsWith(callBacks.discussionInvitationAck)) {
    await ctx.answerCb?.();
    const destination = data.replace(callBacks.discussionInvitationAck, "") || "invitations";
    await deleteCallbackMessageIfPossible?.(ctx);
    if (destination === "room") {
      const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
      const invite = activeDiscussionId ? await getActiveDiscussionInviteForUser(ctx.userId, activeDiscussionId) : null;
      if (invite?.ok) {
        await updateProfileField(ctx.userId, "navigationMode", `discussion_room:${activeDiscussionId}`);
        if (ctx.user) ctx.user.navigationMode = `discussion_room:${activeDiscussionId}`;
        return true;
      }
      return sendDiscussionsMenuWithInvitationCount(ctx, lang);
    }
    if (destination === "saved") {
      const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
      return sendSavedProfilesList(ctx, lang, codes, 0);
    }
    if (destination === "discussions") {
      return sendDiscussionsMenuWithInvitationCount(ctx, lang, messages[lang].discussionsMenu, { editCallbackMessageOrReply });
    }
    return renderInvitationsList(ctx, lang, 0, { editCallbackMessageOrReply });
  }

  return false;
}

module.exports = {
  acceptInvitationCommand,
  buildInvitationAcceptStatusText,
  buildSavedInviteTargets,
  buildDiscussionsMenuText,
  getInvitationCount,
  handleDiscussionInvitationCallback,
  isDiscussionInvitationCallback,
  normalizeProfileCodeFromInviteCommand,
  notifyInviteeOfInvitation,
  removeInvitationCommand,
  renderInvitationsList,
  sendDiscussionsMenuWithInvitationCount,
  showDiscussionPickerForSavedProfile,
};
