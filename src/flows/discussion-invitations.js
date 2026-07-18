const messages = require("../messages");
const User = require("../models/user");
const { formatOperationalLimitsText } = require("../services/operational-limits-ui");
const { callBacks } = require("../constants");
const {
  discussionsMenuKeyboard,
  discussionRoomKeyboard,
  discussionInviteSavedProfilesKeyboard,
  discussionInviteNoSavedProfilesKeyboard,
  discussionInviteDiscussionPickerKeyboard,
  discussionInvitationAckKeyboard,
  discussionInvitationRestrictionConfirmKeyboard,
  discussionInvitationsBackKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionJoinLockedKeyboard,
  discussionLeaveCurrentNoticeKeyboard,
} = require("../keyboards");
const {
  buildInvitationSentText,
  filterSavedInviteTargets,
  buildInviteSavedProfilesText,
  buildInviteDiscussionPickerText,
  buildInviteDiscussionPickerList,
  buildReceivedInvitationsText,
  shouldShowDiscussionInvitationFirstTimeTip,
} = require("../services/discussion-invitations-ui");
const {
  createDiscussionInvitation,
  countAllPendingReceivedInvitations,
  countUnseenPendingReceivedInvitations,
  getInvitationDisplayState,
  getInvitationForUser,
  listEligibleDiscussionsForInvite,
  listReceivedInvitations,
  markInvitationsSeen,
  markInvitationAccepted,
  removeInvitationForUser,
  expireInvitation,
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
const {
  getDiscussionDisplayTitle,
  getDiscussionErrorMessage,
  buildDiscussionInviteLockedText,
} = require("../services/discussion-ui");
const { joinDiscussionAndNotify } = require("../services/discussion-actions");
const { markSectionTipShownForContext, updateProfileField } = require("../services/users");
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

const INVITATIONS_PAGE_SIZE = 5;
const ACCEPTED_INVITATIONS_LIMIT = 5;

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

function discussionInvitationInboxKeyboard(lang) {
  return {
    reply_markup: {
      inline_keyboard: [[{
        text: messages[lang].discussionInvitationOpenInbox,
        callback_data: callBacks.discussionInvitations,
      }]],
    },
  };
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
      discussionInvitationInboxKeyboard(targetLang),
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
    return ctx.reply(messages[lang].discussionInviteUnavailable);
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
}) {
  const created = await createDiscussionInvitation({
    inviterUserId: ctx.userId,
    inviteePublicProfileCode: profileCode,
    discussionId,
    source,
  });

  const keyboard = discussionInvitationAckKeyboard(lang, destination);
  const send = editCallbackMessageOrReply || ((roomCtx, text, extra) => roomCtx.reply(text, extra));
  if (!created.ok) {
    return send(ctx, getInviteCreationFailureText(lang, created.reason, created), keyboard);
  }

  await notifyInviteeOfInvitation(ctx, created);
  return send(
    ctx,
    buildInvitationSentText(messages, lang, created.invitee),
    { reply_markup: { inline_keyboard: [] } },
  );
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
  const totalInvitations = await countAllPendingReceivedInvitations(ctx.userId);
  const totalPages = Math.max(1, Math.ceil(totalInvitations / INVITATIONS_PAGE_SIZE));
  const normalizedPage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const navigationMode = `discussion_invitations:${normalizedPage}:${totalPages}`;
  await updateProfileField(ctx.userId, "navigationMode", navigationMode);
  if (ctx.user) ctx.user.navigationMode = navigationMode;
  const start = normalizedPage * INVITATIONS_PAGE_SIZE;
  const listed = await listReceivedInvitations(ctx.userId, {
    skip: start,
    limit: INVITATIONS_PAGE_SIZE,
  });
  const acceptedListed = normalizedPage === 0
    ? await listReceivedInvitations(ctx.userId, {
      limit: ACCEPTED_INVITATIONS_LIMIT,
      statuses: ["accepted"],
    })
    : { invitations: [] };
  const pageEntries = listed.invitations || [];
  const acceptedPageEntries = acceptedListed.invitations || [];
  const entries = [];
  for (const entry of pageEntries) {
    entries.push({
      ...entry,
      state: await getInvitationDisplayState(ctx.user, entry.discussion),
    });
  }
  const acceptedEntries = [];
  for (const entry of acceptedPageEntries) {
    acceptedEntries.push({
      ...entry,
      state: await getInvitationDisplayState(ctx.user, entry.discussion),
    });
  }
  const text = await buildReceivedInvitationsText(messages, lang, ctx.user, entries, acceptedEntries);
  const showsFirstDiscussionTip = shouldShowDiscussionInvitationFirstTimeTip(ctx.user, entries);
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
} = {}) {
  const code = normalizeInvitationCodeFromCommand(text, "accept_inv");
  const found = await getInvitationForUser(code, ctx.userId, { statuses: ["pending", "accepted"] });
  if (!found.ok) {
    return ctx.reply(messages[lang].discussionInvitationUnavailable, discussionJoinErrorAckKeyboard(lang, "invitations"));
  }
  if (!await requireDiscussionProfileName(ctx, lang, { source: "accept", token: code })) {
    return { ok: false, reason: "requires_profile_name" };
  }
  if (!found.discussion || found.discussion.status !== "open") {
    await expireInvitation(found.invitation);
    return ctx.reply(messages[lang].discussionInviteUnavailable, discussionJoinErrorAckKeyboard(lang, "invitations"));
  }

  const joined = await joinDiscussionAndNotify({ ctx, messages, discussionId: found.discussion._id });
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
    if (joined.reason === "discussion_closed" || joined.reason === "missing_discussion" || joined.reason === "removed_by_owner") {
      await expireInvitation(found.invitation);
    }
    return ctx.reply(
      failureText,
      joined.reason === "leave_current_first"
        ? discussionLeaveCurrentNoticeKeyboard(lang)
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
  const statusText = [
    joined.joined ? messages[lang].discussionJoined : messages[lang].discussionOpened,
    starNotice,
  ].filter(Boolean).join("\n\n");
  if (sendRoom) {
    await ctx.reply(statusText);
    return sendRoom(ctx, lang, joined.discussion);
  }
  return ctx.reply(statusText, discussionRoomKeyboard(lang, joined.discussion.creatorUserId === ctx.userId));
}

async function removeInvitationCommand(ctx, lang, text) {
  const code = normalizeInvitationCodeFromCommand(text, "remove_inv");
  const removed = await removeInvitationForUser(code, ctx.userId);
  if (!removed.ok) {
    return ctx.reply(messages[lang].discussionInvitationUnavailable, discussionInvitationAckKeyboard(lang, "invitations"));
  }
  await ctx.reply(messages[lang].discussionInvitationRemoved);
  return renderInvitationsList(ctx, lang);
}

function isDiscussionInvitationCallback(data = "") {
  return data === callBacks.discussionInvitations ||
    data.startsWith(callBacks.discussionInvitationsPage) ||
    data === callBacks.discussionInviteModeSaved ||
    data === callBacks.discussionInviteModeShare ||
    data === callBacks.discussionInvitePickerClose ||
    data.startsWith(callBacks.discussionInviteSavedPage) ||
    data.startsWith(callBacks.discussionInviteSavedTarget) ||
    data.startsWith(callBacks.discussionInviteDiscussionTarget) ||
    data.startsWith(callBacks.discussionInvitationMute) ||
    data.startsWith(callBacks.discussionInvitationMuteConfirm) ||
    data === callBacks.discussionInvitationMuteCancel ||
    data.startsWith(callBacks.discussionInvitationAck);
}

async function handleDiscussionInvitationCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
  sendShareableInviteForActiveDiscussion,
  sendSavedProfilesList,
} = {}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.discussionInvitations) {
    await ctx.answerCb?.();
    if (ctx.callbackMessage?.caption || ctx.callbackMessage?.photo || ctx.callbackMessage?.document) {
      await deleteCallbackMessageIfPossible?.(ctx);
    }
    return renderInvitationsList(ctx, lang, 0, { editCallbackMessageOrReply });
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
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.discussionInviteDiscussionTarget, "");
    const [profileCodeRaw = "", discussionCodeRaw = ""] = payload.split(":");
    const discussionCode = normalizePublicDiscussionCode(discussionCodeRaw);
    const discussion = discussionCode ? await findDiscussionByPublicCode(discussionCode) : null;
    return createInvitationAndAck(ctx, lang, {
      profileCode: normalizePublicProfileCode(profileCodeRaw),
      discussionId: discussion?._id || "",
      source: "saved_profile",
      destination: "saved",
      editCallbackMessageOrReply,
    });
  }

  if (data.startsWith(callBacks.discussionInvitationMute)) {
    await ctx.answerCb?.();
    const mutedUserId = Number(data.replace(callBacks.discussionInvitationMute, ""));
    const allowed = await canRestrictInviterForUser({
      muterUserId: ctx.userId,
      mutedUserId,
    });
    if (!allowed) {
      await deleteCallbackMessageIfPossible?.(ctx);
      return ctx.reply(messages[lang].discussionInvitationUnavailable);
    }
    return (editCallbackMessageOrReply || ((flowCtx, text, keyboard) => flowCtx.reply(text, keyboard)))(
      ctx,
      messages[lang].discussionInvitationRestrictConfirmText,
      discussionInvitationRestrictionConfirmKeyboard(lang, mutedUserId),
    );
  }

  if (data.startsWith(callBacks.discussionInvitationMuteConfirm)) {
    await ctx.answerCb?.();
    const mutedUserId = Number(data.replace(callBacks.discussionInvitationMuteConfirm, ""));
    const allowed = await canRestrictInviterForUser({
      muterUserId: ctx.userId,
      mutedUserId,
    });
    if (!allowed) {
      await deleteCallbackMessageIfPossible?.(ctx);
      return ctx.reply(messages[lang].discussionInvitationUnavailable);
    }
    const muted = await muteInviterForUser({
      muterUserId: ctx.userId,
      mutedUserId,
    });
    const text = muted.ok
      ? messages[lang].discussionInvitationMuted
      : messages[lang].discussionInvitationUnavailable;
    await deleteCallbackMessageIfPossible?.(ctx);
    return ctx.reply(text, discussionInvitationAckKeyboard(lang, "invitations"));
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
