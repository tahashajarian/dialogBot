const { mapWithConcurrency } = require("./bounded-concurrency");

const DISCUSSION_NOTIFICATION_CONCURRENCY = 8;

function normalizeNotificationPayloads(payload) {
  const payloads = Array.isArray(payload) ? payload : [payload];
  return payloads
    .map((entry) => {
      if (typeof entry === "string") return { text: entry, extra: {} };
      if (!entry || typeof entry !== "object") return null;
      return {
        text: String(entry.text || ""),
        extra: entry.extra && typeof entry.extra === "object" ? entry.extra : {},
      };
    })
    .filter((entry) => entry?.text);
}

async function notifyDiscussionMembers(ctx, messages, members = [], getPayloads) {
  const recipients = Array.from(members || []);
  const results = await mapWithConcurrency(
    recipients,
    DISCUSSION_NOTIFICATION_CONCURRENCY,
    async (member) => {
      const memberLang = messages[member.lang] ? member.lang : "fa";
      let delivered = true;
      try {
        const payloads = normalizeNotificationPayloads(getPayloads(messages, memberLang));
        for (const payload of payloads) {
          try {
            const sent = await ctx.sendToUser?.(member.userId, payload.text, payload.extra, memberLang);
            if (!sent) delivered = false;
          } catch {
            delivered = false;
          }
        }
      } catch {
        delivered = false;
      }
      return delivered;
    },
  );
  const delivered = results.filter(Boolean).length;
  return {
    attempted: recipients.length,
    delivered,
    failed: recipients.length - delivered,
  };
}

function createActiveDiscussionNotifier(getActiveMembersInDiscussion) {
  if (typeof getActiveMembersInDiscussion !== "function") {
    throw new TypeError("getActiveMembersInDiscussion must be a function");
  }

  return async function notifyActiveMembersInDiscussion(
    ctx,
    messages,
    discussionId,
    excludeUserIds,
    getPayloads,
  ) {
    let activeMembers;
    try {
      activeMembers = await getActiveMembersInDiscussion(discussionId, excludeUserIds);
    } catch {
      return { attempted: 0, delivered: 0, failed: 0, lookupFailed: true };
    }
    return notifyDiscussionMembers(ctx, messages, activeMembers, getPayloads);
  };
}

module.exports = {
  DISCUSSION_NOTIFICATION_CONCURRENCY,
  normalizeNotificationPayloads,
  notifyDiscussionMembers,
  createActiveDiscussionNotifier,
};
