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

function formatDiscussionMemberLines(messages, lang, members = [], creatorUserId) {
  return members.map((entry, index) => messages[lang].discussionMembersLine
    .replace("{index}", String(index + 1))
    .replace("{name}", entry.profileName || entry.firstName || "کاربر")
    .replace("{code}", entry.publicProfileCode || messages[lang].discussionMembersPrivateCode)
    .replace("{owner}", entry.userId === creatorUserId ? ` ${messages[lang].discussionOwnerMark}` : ""));
}

module.exports = {
  formatDiscussionRoom,
  formatRecentDiscussionMessages,
  formatDiscussionMemberLines,
};
