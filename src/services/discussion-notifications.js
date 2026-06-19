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
  for (const member of members || []) {
    const memberLang = messages[member.lang] ? member.lang : "fa";
    try {
      const payloads = normalizeNotificationPayloads(getPayloads(messages, memberLang));
      for (const payload of payloads) {
        await ctx.sendToUser?.(member.userId, payload.text, payload.extra);
      }
    } catch {
      // Individual notification failures should not block the acting user.
    }
  }
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
    const activeMembers = await getActiveMembersInDiscussion(discussionId, excludeUserIds);
    await notifyDiscussionMembers(ctx, messages, activeMembers, getPayloads);
  };
}

module.exports = {
  normalizeNotificationPayloads,
  notifyDiscussionMembers,
  createActiveDiscussionNotifier,
};
