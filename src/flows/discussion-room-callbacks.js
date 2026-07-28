const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  discussionsMenuKeyboard,
  discussionCloseConfirmKeyboard,
  discussionMembersCloseKeyboard,
  discussionLeaveCurrentNoticeKeyboard,
  discussionUnavailableAckKeyboard,
} = require("../keyboards");
const { applyStarRewardsToContext, buildStarRewardNotice } = require("../services/stars-ui");
const { getMessageId } = require("../services/bot-navigation");
const { buildDiscussionLeaveText, markDiscussionLeaveTipShown } = require("../services/discussion-leave-tip");
const { sendNavigationFootprint } = require("../services/navigation-footprints");
const { restoreStableReplyKeyboard } = require("./reply-keyboard-recovery");
const { MODES, setNavigationMode } = require("../services/reply-keyboard-navigation");
const { getDiscussionErrorMessage, getDiscussionDisplayTitle } = require("../services/discussion-ui");
const {
  formatDiscussionRoom,
  formatDiscussionRoomFollowup,
  buildDiscussionRoomKeyboard,
  paginateDiscussionMembers,
  formatDiscussionMemberLines,
  buildDiscussionMembersText,
} = require("../services/discussion-room-ui");
const { updateUserFields, updateUserState } = require("../services/users");
const {
  ensurePublicProfileCodes,
  ensurePublicDiscussionCode,
  findDiscussionByPublicCode,
  findDiscussionById,
  findDiscussionByIdLean,
  normalizePublicProfileCode,
} = require("../services/discussions");
const {
  findDiscussionMemberProfiles,
  findUserIdByPublicProfileCode,
} = require("../services/discussion-member-profiles");
const {
  closeDiscussionAndNotify,
  joinDiscussionAndNotify,
  leaveDiscussionAndNotify,
  removeDiscussionMemberAndNotify,
} = require("../services/discussion-actions");
const {
  rememberDiscussionMembersMessage,
  clearDiscussionMembersMessage,
  clearDiscussionListMessage,
  forgetDiscussionListMessage,
  clearDiscussionMenuNotice,
  sendDiscussionJoinErrorAck,
} = require("./discussions-callbacks");
const {
  joinDiscussionFromInvite,
  showDiscussionInvitePreviewCommand,
} = require("./discussions-text");
const { buildDiscussionOpenNameGate, requireDiscussionProfileName } = require("./discussion-name-gate");
const { sendTasteSetupNudge } = require("./onboarding");
const { restorePublicProfileReturnNavigationMode } = require("../services/public-profile-navigation");
const { EVENT_NAMES, trackEvent } = require("../services/analytics-events");
const { parseDiscussionClosePayload } = require("../services/callback-contracts");

function isDiscussionRoomCallback(data = "") {
  const value = String(data || "");
  return value.startsWith(callBacks.discussionOwnerJoinNoticeOpen)
    || value.startsWith(callBacks.discussionOpen)
    || value.startsWith(callBacks.discussionInviteJoin)
    || value.startsWith(callBacks.discussionInviteSwitchJoin)
    || value.startsWith(callBacks.discussionInviteCancel)
    || value.startsWith(callBacks.discussionLeave)
    || value.startsWith(callBacks.discussionClose)
    || value.startsWith(callBacks.discussionMembersPage)
    || (value !== callBacks.discussionMembersClose && value.startsWith(callBacks.discussionMembers))
    || value === callBacks.discussionRemoveMemberCancel
    || value.startsWith(callBacks.discussionRemoveMemberConfirm);
}

function getActiveRoomCallbackDiscussionId(data = "") {
  if (
    data.startsWith(callBacks.discussionCloseConfirm)
    || data.startsWith(callBacks.discussionCloseCancel)
  ) return "";
  const prefixes = [
    callBacks.discussionMembersPage,
    callBacks.discussionMembers,
    callBacks.discussionRemoveMemberConfirm,
    callBacks.discussionClose,
  ];
  for (const prefix of prefixes) {
    if (data.startsWith(prefix)) {
      return String(data.slice(prefix.length).split(":")[0] || "");
    }
  }
  return "";
}

function getDiscussionCloseReturnSource(ctx) {
  return ctx.user?.discussionLastListType === "mine" ? "mine"
    : ctx.user?.discussionLastListType === "active" ? "active"
    : "room";
}

function formatDiscussionResult(key, lang, discussion = {}) {
  return messages[lang][key].replace(
    "{title}",
    getDiscussionDisplayTitle(messages, lang, discussion) || "-",
  );
}

async function clearDiscussionCardsAfterVisibleReply(ctx, exceptMessageIds = []) {
  try {
    await forgetDiscussionListMessage(ctx);
    await clearDiscussionMenuNotice(ctx, exceptMessageIds);
  } catch {
    // Cleanup is best-effort; visible user feedback must not depend on it.
  }
}

async function sendDiscussionRoom(ctx, lang, discussion) {
  await sendNavigationFootprint(ctx, { lang, destination: "discussion", discussion });
  await ctx.reply(formatDiscussionRoom(messages, lang, discussion));
  const recentMessage = await ctx.reply(
    formatDiscussionRoomFollowup(messages, lang, discussion),
    await buildDiscussionRoomKeyboard(lang, discussion, ctx.userId),
  );
  return recentMessage;
}

async function restoreActiveDiscussionKeyboardAfterInviteDismiss(ctx, lang, inviteCode = "") {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
  if (!activeDiscussionId) return null;

  let invitedDiscussion = null;
  try {
    invitedDiscussion = await findDiscussionByPublicCode(inviteCode);
  } catch {
    // If the lookup fails, still try to restore the active room controls below.
  }
  if (invitedDiscussion && String(invitedDiscussion._id) === activeDiscussionId) return null;

  const discussion = await findDiscussionByIdLean(activeDiscussionId);
  if (!discussion || discussion.status !== "open") return null;
  const title = getDiscussionDisplayTitle(messages, lang, discussion);
  return ctx.reply(
    messages[lang].discussionInviteStillInRoom.replace("{title}", title),
    await buildDiscussionRoomKeyboard(lang, discussion, ctx.userId),
  );
}

async function handleDiscussionRoomCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
}) {
  const data = ctx.callbackData || "";
  const activeRoomId = getActiveRoomCallbackDiscussionId(data);
  if (activeRoomId && activeRoomId !== String(ctx.user?.activeDiscussionId || "")) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible(ctx);
    return null;
  }

  if (data.startsWith(callBacks.discussionOwnerJoinNoticeOpen)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.discussionOwnerJoinNoticeOpen, "");
    const discussion = await findDiscussionByPublicCode(code);
    if (!discussion) {
      return showDiscussionInvitePreviewCommand(ctx, lang, code, {
        editMessage: (text, keyboard) => editCallbackMessageOrReply(ctx, text, keyboard),
      });
    }
    if (Number(discussion.creatorUserId) !== Number(ctx.userId)) {
      return editCallbackMessageOrReply(
        ctx,
        messages[lang].discussionInviteUnavailable,
        discussionUnavailableAckKeyboard(lang),
      );
    }
    void trackEvent({
      name: EVENT_NAMES.discussionOwnerJoinNoticeOpened,
      userId: ctx.userId,
      source: "discussion_owner_join_notice",
      metadata: { discussionId: String(discussion._id) },
    });
    const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
    if (!activeDiscussionId || activeDiscussionId === String(discussion._id)) {
      return joinDiscussionFromInvite(ctx, lang, code, {
        editMessage: (text, keyboard) => editCallbackMessageOrReply(ctx, text, keyboard),
        sendRoom: sendDiscussionRoom,
      });
    }
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionErrLeaveCurrentFirst,
      discussionLeaveCurrentNoticeKeyboard(lang, code),
    );
  }

  if (data.startsWith(callBacks.discussionOpen)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionOpen, "");
    const profileDiscussionMatch = String(ctx.user?.navigationMode || "")
      .match(/^profile_discussions:(?:saved|people|shared|direct|discussion_members|invitations|restrictions):(u_[A-Z0-9]+):\d+$/);
    if (profileDiscussionMatch && String(ctx.user?.activeDiscussionId || "") === String(discussionId)) {
      if (!ctx.isReplyKeyboardAction) await deleteCallbackMessageIfPossible(ctx);
      if (ctx.user) {
        ctx.user.publicProfileLastMessageId = null;
        ctx.user.discussionLastListMessageId = null;
        ctx.user.discussionLastListType = "";
      }
      await updateUserFields(ctx.userId, {
        publicProfileLastMessageId: null,
        discussionLastListMessageId: null,
        discussionLastListType: "",
      });
      await restorePublicProfileReturnNavigationMode(ctx);
      return true;
    }
    const joinErrorDestination = profileDiscussionMatch ? `saved:${profileDiscussionMatch[1]}` : "active";
    const discussion = await findDiscussionById(discussionId);
    if (!discussion) return sendDiscussionJoinErrorAck(ctx, lang, "missing_discussion", joinErrorDestination);
    const codeResult = await ensurePublicDiscussionCode(discussion);
    if (!codeResult.ok) return ctx.reply(messages[lang].unknownAction);
    const nameGate = buildDiscussionOpenNameGate(ctx, codeResult.code);
    const hasName = await requireDiscussionProfileName(ctx, lang, {
      source: nameGate.source,
      token: nameGate.token,
      beforePrompt: () => clearDiscussionListMessage(ctx),
    });
    if (!hasName) return true;
    const joined = await joinDiscussionAndNotify({ ctx, messages, discussionId });
    if (!joined.ok) {
      await ctx.answerCb?.();
      return sendDiscussionJoinErrorAck(ctx, lang, joined.reason, joinErrorDestination, { discussion });
    }
    await clearDiscussionListMessage(ctx, [ctx.callbackMessageId]);
    await clearDiscussionMenuNotice(ctx, [ctx.callbackMessageId]);
    applyStarRewardsToContext(ctx, joined.starRewards);
    const starNotice = buildStarRewardNotice(messages, lang, joined.starRewards);
    await ctx.reply([
      joined.joined ? messages[lang].discussionJoined : messages[lang].discussionOpened,
      starNotice,
    ].filter(Boolean).join("\n\n"));
    const roomMessage = await sendDiscussionRoom(ctx, lang, joined.discussion);
    await clearDiscussionCardsAfterVisibleReply(ctx, [getMessageId(roomMessage)]);
    return roomMessage;
  }

  if (data.startsWith(callBacks.discussionInviteJoin)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.discussionInviteJoin, "");
    return joinDiscussionFromInvite(ctx, lang, code, {
      editMessage: (text, keyboard) => editCallbackMessageOrReply(ctx, text, keyboard),
      clearListMessage: () => clearDiscussionListMessage(ctx, [ctx.callbackMessageId]),
      clearMenuNotice: () => clearDiscussionMenuNotice(ctx, [ctx.callbackMessageId]),
      sendRoom: sendDiscussionRoom,
    });
  }

  if (data.startsWith(callBacks.discussionInviteSwitchJoin)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.discussionInviteSwitchJoin, "");
    return joinDiscussionFromInvite(ctx, lang, code, {
      editMessage: (text, keyboard) => editCallbackMessageOrReply(ctx, text, keyboard),
      clearListMessage: () => clearDiscussionListMessage(ctx, [ctx.callbackMessageId]),
      clearMenuNotice: () => clearDiscussionMenuNotice(ctx, [ctx.callbackMessageId]),
      sendRoom: sendDiscussionRoom,
      allowActiveSwitch: true,
    });
  }

  if (data.startsWith(callBacks.discussionInviteCancel)) {
    await ctx.answerCb?.();
    try {
      await deleteCallbackMessageIfPossible(ctx);
    } catch {
      // Dismissal cleanup is best-effort; do not leave the callback stuck on a stale preview.
    }
    const restored = await restoreActiveDiscussionKeyboardAfterInviteDismiss(
      ctx,
      lang,
      data.replace(callBacks.discussionInviteCancel, ""),
    );
    if (restored || ctx.user?.activeDiscussionId) return restored;
    const nudge = await sendTasteSetupNudge(ctx, lang).catch(() => null);
    if (nudge) return nudge;
    return restoreStableReplyKeyboard(ctx, lang);
  }

  if (data.startsWith(callBacks.discussionLeave)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionLeave, "")
      || String(ctx.user?.activeDiscussionId || "");
    if (!discussionId) return ctx.reply(messages[lang].discussionNotMember);
    const left = await leaveDiscussionAndNotify({ ctx, messages, discussionId });
    if (!left.ok) return ctx.reply(messages[lang].discussionNotMember);
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    await clearDiscussionListMessage(ctx, [ctx.callbackMessageId]);
    await setNavigationMode(ctx, MODES.DISCUSSIONS);
    const notice = buildDiscussionLeaveText(
      ctx,
      lang,
      formatDiscussionResult("discussionLeft", lang, left.discussion),
    );
    const sent = await ctx.reply(
      `${notice.text}\n\n${messages[lang].discussionsMenu}`,
      discussionsMenuKeyboard(lang),
    );
    await markDiscussionLeaveTipShown(ctx, notice.showTip).catch(() => null);
    return sent;
  }

  if (
    data.startsWith(callBacks.discussionClose)
    && !data.startsWith(callBacks.discussionCloseConfirm)
    && !data.startsWith(callBacks.discussionCloseCancel)
  ) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionClose, "");
    return editCallbackMessageOrReply(
      ctx,
      messages[lang].discussionCloseConfirmPrompt,
      discussionCloseConfirmKeyboard(lang, discussionId, getDiscussionCloseReturnSource(ctx)),
    );
  }

  if (data.startsWith(callBacks.discussionCloseConfirm)) {
    await ctx.answerCb?.();
    await clearDiscussionMenuNotice(ctx);
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    await clearDiscussionListMessage(ctx, [ctx.callbackMessageId]);
    const { discussionId, source } = parseDiscussionClosePayload(
      data.replace(callBacks.discussionCloseConfirm, ""),
    );
    const closed = await closeDiscussionAndNotify({
      ctx,
      messages,
      discussionId,
      discussionsMenuKeyboard,
    });
    if (!closed.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, closed.reason));
    await updateUserState(ctx.userId, "idle");
    await setNavigationMode(ctx, MODES.DISCUSSIONS);
    if (ctx.user && String(ctx.user.activeDiscussionId || "") === String(discussionId)) {
      ctx.user.activeDiscussionId = null;
    }
    const resultCard = await editCallbackMessageOrReply(
      ctx,
      formatDiscussionResult("discussionClosed", lang, closed.discussion),
      { reply_markup: { inline_keyboard: [] } },
    );
    if (source === "room") await ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    return resultCard;
  }

  if (data.startsWith(callBacks.discussionCloseCancel)) {
    await ctx.answerCb?.();
    return deleteCallbackMessageIfPossible(ctx);
  }

  if (data.startsWith(callBacks.discussionMembers)) {
    await ctx.answerCb?.();
    const discussionId = data.replace(callBacks.discussionMembers, "");
    await clearDiscussionMembersMessage(ctx, [ctx.callbackMessageId]);
    const opened = await joinDiscussionAndNotify({ ctx, messages, discussionId });
    if (!opened.ok) {
      const errorText = getDiscussionErrorMessage(messages, lang, opened.reason);
      await ctx.answerCb?.(errorText.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
      return ctx.reply(errorText);
    }
    const memberUsers = await findDiscussionMemberProfiles(opened.discussion.memberUserIds);
    const preparedMembers = await ensurePublicProfileCodes(memberUsers);
    const paginated = paginateDiscussionMembers(preparedMembers, opened.discussion.memberUserIds, 0);
    const rows = formatDiscussionMemberLines(
      messages,
      lang,
      paginated.items,
      opened.discussion.creatorUserId,
      ctx.userId,
      { startIndex: paginated.startIndex },
    );
    const membersMessage = await editCallbackMessageOrReply(
      ctx,
      buildDiscussionMembersText(messages, lang, rows, paginated.totalCount),
      discussionMembersCloseKeyboard(lang, {
        discussionId: opened.discussion._id,
        page: paginated.page,
        totalPages: paginated.totalPages,
      }),
    );
    await rememberDiscussionMembersMessage(ctx, ctx.callbackMessageId || membersMessage);
    return membersMessage;
  }

  if (data.startsWith(callBacks.discussionMembersPage)) {
    await ctx.answerCb?.();
    const payload = data.slice(callBacks.discussionMembersPage.length);
    const separatorIndex = payload.lastIndexOf(":");
    const discussionId = separatorIndex > 0 ? payload.slice(0, separatorIndex) : "";
    const pageRaw = separatorIndex > 0 ? payload.slice(separatorIndex + 1) : "0";
    const discussion = await findDiscussionByIdLean(discussionId);
    if (
      !discussion
      || discussion.status !== "open"
      || !(discussion.memberUserIds || []).some((userId) => Number(userId) === Number(ctx.userId))
    ) {
      await deleteCallbackMessageIfPossible(ctx);
      return null;
    }
    const memberUsers = await findDiscussionMemberProfiles(discussion.memberUserIds);
    const preparedMembers = await ensurePublicProfileCodes(memberUsers);
    const paginated = paginateDiscussionMembers(
      preparedMembers,
      discussion.memberUserIds,
      /^\d+$/.test(pageRaw) ? Number(pageRaw) : 0,
    );
    const rows = formatDiscussionMemberLines(
      messages,
      lang,
      paginated.items,
      discussion.creatorUserId,
      ctx.userId,
      { startIndex: paginated.startIndex },
    );
    return editCallbackMessageOrReply(
      ctx,
      buildDiscussionMembersText(messages, lang, rows, paginated.totalCount),
      discussionMembersCloseKeyboard(lang, {
        discussionId: discussion._id,
        page: paginated.page,
        totalPages: paginated.totalPages,
      }),
    );
  }

  if (data === callBacks.discussionRemoveMemberCancel) {
    await ctx.answerCb?.();
    return deleteCallbackMessageIfPossible(ctx);
  }

  if (data.startsWith(callBacks.discussionRemoveMemberConfirm)) {
    await ctx.answerCb?.();
    const payload = data.replace(callBacks.discussionRemoveMemberConfirm, "");
    const [discussionId = "", memberCodeRaw = ""] = payload.split(":");
    const memberUserId = await findUserIdByPublicProfileCode(normalizePublicProfileCode(memberCodeRaw));
    if (!discussionId || !Number.isInteger(memberUserId)) {
      return ctx.reply(getDiscussionErrorMessage(messages, lang, "not_member"));
    }
    const removed = await removeDiscussionMemberAndNotify({
      ctx,
      messages,
      discussionId,
      memberUserId,
      discussionsMenuKeyboard,
    });
    if (!removed.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, removed.reason));
    await deleteCallbackMessageIfPossible(ctx);
    return ctx.reply(messages[lang].discussionMemberRemoved.replace("{name}", removed.removedMemberName || "عضو"));
  }

  return null;
}

module.exports = {
  handleDiscussionRoomCallback,
  isDiscussionRoomCallback,
  sendDiscussionRoom,
};
