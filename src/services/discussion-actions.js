const {
  closeDiscussionAsOwner,
  joinOrSwitchActiveDiscussion,
  leaveDiscussionAsMember,
  removeMemberAsOwner,
  getActiveMembersInDiscussion,
  notifyDiscussionMembers,
  notifyActiveMembersInDiscussion,
} = require("./discussions");

async function joinDiscussionAndNotify({ ctx, messages, discussionId }) {
  const joined = await joinOrSwitchActiveDiscussion(ctx.userId, discussionId);
  if (!joined.ok) return joined;

  if (joined.leftPrevious?.discussionId && joined.leftPrevious?.leaverName) {
    await notifyActiveMembersInDiscussion(
      ctx,
      messages,
      joined.leftPrevious.discussionId,
      [ctx.userId],
      (msgs, lang) => msgs[lang].discussionLeftNotice.replace("{name}", joined.leftPrevious.leaverName),
    );
  }

  if (joined.joined && joined.joinerName && joined.otherMemberIds) {
    await notifyActiveMembersInDiscussion(
      ctx,
      messages,
      joined.discussion._id,
      [ctx.userId],
      (msgs, lang) => msgs[lang].discussionJoinNotice.replace("{name}", joined.joinerName),
    );
  }

  return joined;
}

async function leaveDiscussionAndNotify({ ctx, messages, discussionId }) {
  const left = await leaveDiscussionAsMember(ctx.userId, discussionId);
  if (!left.ok) return left;

  if (left.leaverName && left.discussionId) {
    await notifyActiveMembersInDiscussion(
      ctx,
      messages,
      left.discussionId,
      [ctx.userId],
      (msgs, lang) => msgs[lang].discussionLeftNotice.replace("{name}", left.leaverName),
    );
  }

  return left;
}

async function closeDiscussionAndNotify({ ctx, messages, discussionId, discussionsMenuKeyboard }) {
  const activeMembers = await getActiveMembersInDiscussion(discussionId, [ctx.userId]);
  const closed = await closeDiscussionAsOwner(ctx.userId, discussionId);
  if (!closed.ok) return closed;

  await notifyDiscussionMembers(ctx, messages, activeMembers, (msgs, lang) => [
    {
      text: msgs[lang].discussionClosedNoticeToMembers.replace("{title}", closed.discussionTitle || ""),
      extra: { reply_markup: { remove_keyboard: true } },
    },
    {
      text: msgs[lang].discussionsMenu,
      extra: discussionsMenuKeyboard(lang),
    },
  ]);

  return closed;
}

async function removeDiscussionMemberAndNotify({
  ctx,
  messages,
  discussionId,
  memberUserId,
  discussionsMenuKeyboard,
}) {
  const removed = await removeMemberAsOwner(ctx.userId, discussionId, memberUserId);
  if (!removed.ok) return removed;

  if (removed.wasActive) {
    const targetLang = messages[removed.memberLang] ? removed.memberLang : "fa";
    try {
      await ctx.sendToUser?.(
        removed.memberUserId,
        messages[targetLang].discussionRemovedNotice.replace("{title}", removed.discussionTitle || ""),
        { reply_markup: { remove_keyboard: true } },
      );
      await ctx.sendToUser?.(
        removed.memberUserId,
        messages[targetLang].discussionsMenu,
        discussionsMenuKeyboard(targetLang),
      );
    } catch {
      // Notification failures should not block the owner action.
    }
  }

  if (removed.removedMemberName && removed.discussionId) {
    await notifyActiveMembersInDiscussion(
      ctx,
      messages,
      removed.discussionId,
      [ctx.userId, removed.memberUserId],
      (msgs, lang) => msgs[lang].discussionRemovedNoticeToMembers.replace("{name}", removed.removedMemberName),
    );
  }

  return removed;
}

module.exports = {
  joinDiscussionAndNotify,
  leaveDiscussionAndNotify,
  closeDiscussionAndNotify,
  removeDiscussionMemberAndNotify,
};
