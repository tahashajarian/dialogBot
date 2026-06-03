const RTL_MARK = "\u200F";
const FSI = "\u2068";
const PDI = "\u2069";

function lineForLang(lang, text) {
  return lang === "fa" ? `${RTL_MARK}${text}` : text;
}

function isolateText(lang, text) {
  const value = String(text || "");
  return lang === "fa" ? `${FSI}${value}${PDI}` : value;
}

function formatListIndex(lang, value) {
  const index = Number(value) || 0;
  if (lang !== "fa") return String(index);
  return new Intl.NumberFormat("fa-IR").format(index);
}

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
  const lines = recent.map((entry) => lineForLang(
    lang,
    `- ${isolateText(lang, entry.senderDisplayName)}: ${isolateText(lang, entry.text)}`,
  ));
  return `${messages[lang].discussionRecentMessagesTitle}\n${lines.join("\n")}`;
}

const DISCUSSION_MEMBER_DIVIDER = "────────";

function formatDiscussionMemberLines(messages, lang, members = [], creatorUserId, currentUserId = null, discussionId = null) {
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
      const viewLabel = messages[lang].discussionMemberViewProfile;
      const reportLabel = messages[lang].discussionMemberReport;
      actions.push(`${viewLabel} 👈 /${code}`);
      actions.push(`${reportLabel} 👈 /report_${codeSuffix}`);
      if (currentUserIsOwner) {
        const removeLabel = messages[lang].discussionMemberRemoveAction;
        actions.push(`${removeLabel} 👈 /remove_${codeSuffix}`);
      }
    }

    const actionText = actions.length ? `\n${actions.join("\n")}` : "";
    const divider = `\n${DISCUSSION_MEMBER_DIVIDER}`;
    return `${lineForLang(lang, `${formatListIndex(lang, index + 1)}.`)}\n${lineForLang(lang, `👤 ${isolateText(lang, name)}${owner}`)}${actionText}${divider}`;
  });
}

module.exports = {
  formatDiscussionRoom,
  formatRecentDiscussionMessages,
  formatDiscussionMemberLines,
};
