function formatDiscussionRoom(messages, lang, discussion) {
  const count = Array.isArray(discussion.memberUserIds) ? discussion.memberUserIds.length : 0;
  const cap = discussion.maxMembers || 20;
  const text = discussion.description
    ? messages[lang].discussionRoomHeader
    : messages[lang].discussionRoomHeaderNoDescription;
  return text
    .replace("{title}", discussion.title)
    .replace("{description}", discussion.description || "")
    .replace("{count}", String(count))
    .replace("{cap}", String(cap));
}

function formatRecentDiscussionMessages(messages, lang, discussion) {
  const recent = Array.isArray(discussion.recentMessages) ? discussion.recentMessages : [];
  if (!recent.length) {
    return `${messages[lang].discussionRecentMessagesTitle}\n${messages[lang].discussionNoRecentMessages}`;
  }
  const lines = recent.map((entry) => `- ${entry.senderDisplayName}: ${entry.text}`);
  return `${messages[lang].discussionRecentMessagesTitle}\n${lines.join("\n")}`;
}

function formatMemberActionLine(lang, label, command) {
  return lang === "fa" ? `${label} 👈 ${command}` : `${label} 👉 ${command}`;
}

const DISCUSSION_MEMBER_DIVIDER = "────────";

function formatDiscussionMemberLines(messages, lang, members = [], creatorUserId, currentUserId = null) {
  return members.map((entry, index) => {
    const isCurrentUser = Number(entry.userId) === Number(currentUserId);
    const isOwner = Number(entry.userId) === Number(creatorUserId);
    const currentUserIsOwner = Number(currentUserId) === Number(creatorUserId);
    const name = isCurrentUser ? (lang === "fa" ? "تو" : "You") : (entry.profileName || entry.firstName || "کاربر");
    const owner = isOwner ? ` — ${messages[lang].discussionOwnerMark}` : "";
    const code = entry.publicProfileCode || "";
    const codeSuffix = code.replace(/^u_/i, "");
    const actions = [];

    if (!isCurrentUser && code) {
      actions.push(formatMemberActionLine(lang, messages[lang].discussionMemberViewProfile, `/${code}`));
      actions.push(formatMemberActionLine(lang, messages[lang].discussionMemberReport, `/report_${codeSuffix}`));
      if (currentUserIsOwner) {
        actions.push(formatMemberActionLine(lang, messages[lang].discussionMemberRemoveAction, `/remove_${codeSuffix}`));
      }
    }

    const actionText = actions.length ? `\n${actions.join("\n")}` : "";
    const divider = index < members.length - 1 ? `\n\n${DISCUSSION_MEMBER_DIVIDER}` : "";
    return `${index + 1}. 👤 ${name}${owner}${actionText}${divider}`;
  });
}

module.exports = {
  formatDiscussionRoom,
  formatRecentDiscussionMessages,
  formatDiscussionMemberLines,
};
