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
const {
  notifyDiscussionOwnerOfJoin,
  removeOwnerJoinNoticeState,
} = require("./discussion-owner-join-notifications");
const { deleteInvitationsForDiscussion } = require("./discussion-invitations");
const { updateProfileField } = require("./users");
const { logger } = require("./logger");

const notifyActiveMembersInDiscussion = createActiveDiscussionNotifier(getActiveMembersInDiscussion);
const REMOVE_KEYBOARD = { reply_markup: { remove_keyboard: true, selective: false } };

async function joinDiscussionAndNotify({
  ctx,
  messages,
  discussionId,
  allowActiveSwitch = false,
  allowOwnerReentry = false,
}) {
  const joined = await joinOrOpenDiscussion(ctx.userId, discussionId, {
    allowActiveSwitch,
    allowOwnerReentry,
  });
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

  if (joined.joined) {
    // Membership and room entry are authoritative; private owner delivery is bounded and best effort.
    void notifyDiscussionOwnerOfJoin({ ctx, messages, joined }).catch(() => {});
  }

  return joined;
}

async function leaveDiscussionAndNotify({ ctx, messages, discussionId }) {
  const left = await leaveDiscussionAsMember(ctx.userId, discussionId);
  if (!left.ok) {
    const staleActiveRoom = ["missing_discussion", "not_member"].includes(left.reason)
      && String(ctx.user?.activeDiscussionId || "") === String(discussionId);
    if (staleActiveRoom) {
      await updateProfileField(ctx.userId, "activeDiscussionId", null);
      if (ctx.user) ctx.user.activeDiscussionId = null;
    }
    return left;
  }

  if (left.leaverName && left.discussionId) {
    // Await bounded fan-out so a completed leave update does not abandon live
    // notification work. Per-recipient failures remain isolated and best effort.
    const delivery = await notifyActiveMembersInDiscussion(
      ctx,
      messages,
      left.discussionId,
      [ctx.userId],
      (msgs, lang) => msgs[lang].discussionLeftNotice.replace("{name}", left.leaverName),
    ).catch(() => ({ attempted: 0, delivered: 0, failed: 0, lookupFailed: true }));
    if (delivery.failed || delivery.lookupFailed) {
      logger.warn("Discussion leave notice delivery incomplete", {
        discussionId: String(left.discussionId),
        attempted: delivery.attempted,
        delivered: delivery.delivered,
        failed: delivery.failed,
        lookupFailed: Boolean(delivery.lookupFailed),
      });
    }
  }

  return left;
}

async function closeDiscussionAndNotify({ ctx, messages, discussionId, discussionsMenuKeyboard }) {
  const activeMembers = await getActiveMembersInDiscussion(discussionId, [ctx.userId]);
  const closed = await closeDiscussionAsOwner(ctx.userId, discussionId);
  if (!closed.ok) return closed;

  await removeOwnerJoinNoticeState(discussionId).catch(() => null);
  await deleteInvitationsForDiscussion(discussionId).catch(() => null);

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
