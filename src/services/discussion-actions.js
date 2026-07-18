const {
  closeDiscussionAsOwner,
  joinOrOpenDiscussion,
  leaveDiscussionAsMember,
  removeMemberAsOwner,
  getActiveMembersInDiscussion,
  reportDiscussionMember,
} = require("./discussions");
const {
  notifyDiscussionMembers,
  createActiveDiscussionNotifier,
} = require("./discussion-notifications");
const { getDiscussionDisplayTitle } = require("./discussion-ui");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");

const notifyActiveMembersInDiscussion = createActiveDiscussionNotifier(getActiveMembersInDiscussion);
const REMOVE_KEYBOARD = { reply_markup: { remove_keyboard: true, selective: false } };

async function joinDiscussionAndNotify({ ctx, messages, discussionId, allowActiveSwitch = false }) {
  const joined = await joinOrOpenDiscussion(ctx.userId, discussionId, { allowActiveSwitch });
  if (!joined.ok) return joined;

  if (joined.previousActiveDiscussionId) {
    const left = await leaveDiscussionAsMember(ctx.userId, joined.previousActiveDiscussionId);
    if (left.ok && left.leaverName && left.discussionId) {
      await notifyActiveMembersInDiscussion(
        ctx,
        messages,
        left.discussionId,
        [ctx.userId],
        (msgs, lang) => msgs[lang].discussionLeftNotice.replace("{name}", left.leaverName),
      );
    }
  }

  if (joined.joined) {
    void trackEvent({
      name: EVENT_NAMES.discussionJoined,
      userId: ctx.userId,
      metadata: {
        joinRuleType: joined.discussion?.joinRule?.type || "unknown",
      },
    });
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
    // Leaving should not wait on recipient lookups or Telegram delivery.
    // The membership mutation above is authoritative; this notice is best effort.
    void notifyActiveMembersInDiscussion(
      ctx,
      messages,
      left.discussionId,
      [ctx.userId],
      (msgs, lang) => msgs[lang].discussionLeftNotice.replace("{name}", left.leaverName),
    ).catch(() => {});
  }

  return left;
}

async function closeDiscussionAndNotify({ ctx, messages, discussionId, discussionsMenuKeyboard }) {
  const activeMembers = await getActiveMembersInDiscussion(discussionId, [ctx.userId]);
  const closed = await closeDiscussionAsOwner(ctx.userId, discussionId);
  if (!closed.ok) return closed;

  await notifyDiscussionMembers(ctx, messages, activeMembers, (msgs, lang) => [
    {
      text: msgs[lang].discussionClosedNoticeToMembers.replace(
        "{title}",
        getDiscussionDisplayTitle(msgs, lang, closed.discussion),
      ),
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
    const discussionTitle = getDiscussionDisplayTitle(messages, targetLang, removed.discussion);
    try {
      await ctx.sendToUser?.(
        removed.memberUserId,
        messages[targetLang].discussionRemovedNotice.replace("{title}", discussionTitle),
        REMOVE_KEYBOARD,
        targetLang,
      );
      await ctx.sendToUser?.(
        removed.memberUserId,
        messages[targetLang].discussionsMenu,
        discussionsMenuKeyboard(targetLang),
        targetLang,
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

function fillReportTemplate(template, reported) {
  return String(template || "")
    .replace("{count}", String(reported.reportCount || 0))
    .replace("{threshold}", String(reported.reportBanThreshold || 0))
    .replace("{left}", String(reported.reportsLeft || 0));
}

async function reportDiscussionMemberAndNotify({ ctx, messages, discussionId, memberUserId }) {
  const reported = await reportDiscussionMember(ctx.userId, discussionId, memberUserId);
  if (!reported.ok) return reported;

  const targetLang = messages[reported.targetLang] ? reported.targetLang : "fa";
  const targetMessage = reported.banned
    ? fillReportTemplate(messages[targetLang].userBannedByReports, reported)
    : fillReportTemplate(messages[targetLang].discussionReportWarning, reported);
  const targetExtra = reported.banned ? REMOVE_KEYBOARD : {};

  try {
    await ctx.sendToUser?.(reported.targetUserId, targetMessage, targetExtra, targetLang);
  } catch {
    // Private warning delivery should not block the reporter action.
  }

  if (reported.banned) {
    for (const affectedDiscussionId of reported.affectedDiscussionIds || []) {
      await notifyActiveMembersInDiscussion(
        ctx,
        messages,
        affectedDiscussionId,
        [reported.targetUserId],
        (msgs, lang) => msgs[lang].discussionUserAutoRemovedNoticeToMembers.replace("{name}", reported.targetName),
      );
    }
  }

  return reported;
}

module.exports = {
  joinDiscussionAndNotify,
  leaveDiscussionAndNotify,
  closeDiscussionAndNotify,
  removeDiscussionMemberAndNotify,
  reportDiscussionMemberAndNotify,
};
