function getDiscussionErrorMessage(messages, lang, reason) {
  if (reason === "missing_discussion") return messages[lang].discussionErrMissingDiscussion;
  if (reason === "discussion_closed") return messages[lang].discussionErrClosed;
  if (reason === "discussion_full") return messages[lang].discussionErrFull;
  if (reason === "membership_limit") return messages[lang].discussionErrMembershipLimit;
  if (reason === "requires_top_ten_completed") return messages[lang].discussionErrNeedTopTen;
  if (reason === "requires_taste_label") return messages[lang].discussionErrNeedTaste;
  if (reason === "requires_top_ten_item") return messages[lang].discussionErrNeedItem;
  if (reason === "not_owner") return messages[lang].discussionErrNotOwner;
  if (reason === "already_closed") return messages[lang].discussionErrAlreadyClosed;
  if (reason === "not_member") return messages[lang].discussionErrNotMember;
  if (reason === "invalid_title") return messages[lang].discussionErrInvalidTitle;
  if (reason === "invalid_title_link") return messages[lang].discussionInvalidTitleLink;
  if (reason === "open_requires_description") return messages[lang].discussionErrOpenNeedsDescription;
  if (reason === "create_rate_limit") return messages[lang].discussionCreateRateLimit;
  if (reason === "message_rate_limit") return messages[lang].discussionMessageRateLimit;
  return messages[lang].unknownAction;
}

function getJoinRulePreviewText(messages, lang, joinRule = {}) {
  if (joinRule.type === "top_ten_completed") {
    return messages[lang].discussionRuleTextTopTen.replace("{section}", joinRule.section || "-");
  }
  if (joinRule.type === "taste_label") {
    return messages[lang].discussionRuleTextTaste.replace("{section}", joinRule.section || "-");
  }
  if (joinRule.type === "top_ten_item") {
    return messages[lang].discussionRuleTextItem
      .replace("{section}", joinRule.section || "-")
      .replace("{item}", joinRule.itemTitle || "-");
  }
  return messages[lang].discussionRuleTextOpen;
}

function getDiscussionListPrefix(joinCheck) {
  return joinCheck?.ok ? "✅" : "🔒";
}

function buildDiscussionListText(messages, lang, title, discussions = []) {
  if (!discussions.length) {
    return title;
  }

  const lines = discussions.map((entry, index) => {
    const prefix = entry.listPrefix || "💬";
    const count = Array.isArray(entry.memberUserIds) ? entry.memberUserIds.length : 0;
    const rule = getJoinRulePreviewText(messages, lang, entry.joinRule || { type: "open" });
    return `${index + 1}. ${prefix} ${entry.title}\n👥 ${count}/${entry.maxMembers || 20}\n${rule}`;
  });
  return `${title}\n\n${lines.join("\n\n")}`;
}

function buildDiscussionPreviewText(messages, lang, user) {
  const title = String(user?.discussionDraftTitle || "").trim();
  const description = String(user?.discussionDraftDescription || "").trim();
  const joinRule = user?.discussionDraftJoinRule || { type: "open" };
  return messages[lang].discussionPreview
    .replace("{title}", title || "-")
    .replace("{description}", description || "-")
    .replace("{rule}", getJoinRulePreviewText(messages, lang, joinRule));
}

module.exports = {
  getDiscussionErrorMessage,
  getJoinRulePreviewText,
  getDiscussionListPrefix,
  buildDiscussionListText,
  buildDiscussionPreviewText,
};
