const {
  ensurePublicDiscussionCodes,
  validateJoinRules,
} = require("./discussions");
const { getSectionLabel, getTasteLabelEmoji, getTasteLabelTitle } = require("./ai-section");
const { paginateItems } = require("./pagination");
const { PAGINATION } = require("../constants/pagination");

const DISCUSSION_LIST_PAGE_SIZE = PAGINATION.discussionListPageSize;
const DISCUSSION_LIST_DIVIDER = PAGINATION.discussionListDivider;
const DEFAULT_DISCUSSION_CAPACITY = 20;

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
  if (reason === "invalid_report_target") return messages[lang].discussionErrInvalidReportTarget;
  if (reason === "create_rate_limit") return messages[lang].discussionCreateRateLimit;
  if (reason === "message_rate_limit") return messages[lang].discussionMessageRateLimit;
  return messages[lang].unknownAction;
}

function getJoinRulePreviewText(messages, lang, joinRule = {}) {
  const sectionLabel = joinRule?.section
    ? getSectionLabel(messages, lang, joinRule.section)
    : "-";
  if (joinRule.type === "top_ten_completed") {
    return messages[lang].discussionRuleTextTopTen.replace("{section}", sectionLabel);
  }
  if (joinRule.type === "taste_label") {
    const base = messages[lang].discussionRuleTextTaste.replace("{section}", sectionLabel);
    const labelKey = String(joinRule.tasteLabelKey || "").trim();
    if (!labelKey) return base;
    const badgeEmoji = getTasteLabelEmoji(joinRule.section, labelKey);
    const badgeTitle = getTasteLabelTitle(messages, lang, joinRule.section, labelKey);
    return `${base} - ${badgeEmoji} ${badgeTitle}`;
  }
  if (joinRule.type === "top_ten_item") {
    return messages[lang].discussionRuleTextItem
      .replace("{section}", sectionLabel)
      .replace("{item}", joinRule.itemTitle || "-");
  }
  return messages[lang].discussionRuleTextOpen;
}

async function decorateDiscussionsForList(user, discussions = [], includeMemberActions = false) {
  await ensurePublicDiscussionCodes(discussions);
  return Promise.all((discussions || []).map(async (discussion) => {
    const joinCheck = await validateJoinRules({ user, joinRule: discussion.joinRule });
    discussion.isJoinable = Boolean(joinCheck?.ok);
    discussion.listAction = includeMemberActions
      ? (Number(discussion.creatorUserId) === Number(user?.userId) ? "close" : "leave")
      : "";
    return discussion;
  }));
}

function paginateDiscussions(discussions = [], page = 0) {
  return paginateItems(discussions, page, DISCUSSION_LIST_PAGE_SIZE);
}

function buildDiscussionActionLine(lang, label, command) {
  return lang === "fa" ? `${label} 👈 ${command}` : `${label} 👉 ${command}`;
}

function buildDiscussionListText(messages, lang, title, discussions = [], { startIndex = 0 } = {}) {
  if (!discussions.length) {
    return title;
  }

  const baseIndex = Math.max(0, Number(startIndex) || 0);
  const lines = discussions.map((entry, index) => {
    const joinStatus = entry.isJoinable ? "✅" : "🔒";
    const count = Array.isArray(entry.memberUserIds) ? entry.memberUserIds.length : 0;
    const description = String(entry.description || "").trim() || "-";
    const rule = getJoinRulePreviewText(messages, lang, entry.joinRule || { type: "open" });
    const code = entry.publicDiscussionCode || "";
    const joinLabel = lang === "fa" ? "ورود" : "Join";
    const leaveLabel = lang === "fa" ? "خروج" : "Leave";
    const closeLabel = lang === "fa" ? "بستن" : "Close";
    const openLink = code ? `\n${buildDiscussionActionLine(lang, joinLabel, `/${code}`)}` : "";
    const ownerAction =
      entry.listAction === "close" && code
        ? `\n${buildDiscussionActionLine(lang, closeLabel, `/close_${code.slice(2)}`)}`
        : "";
    const leaveAction =
      entry.listAction === "leave" && code
        ? `\n${buildDiscussionActionLine(lang, leaveLabel, `/leave_${code.slice(2)}`)}`
        : "";
    return `${baseIndex + index + 1}.\n💬 ${entry.title}\n📄 ${description}\n👥 ${count}/${entry.maxMembers || 20}\n${joinStatus} ${messages[lang].discussionJoinConditionTitle}\n${rule}${openLink}${ownerAction}${leaveAction}`;
  });
  return `${title}\n\n${lines.join(`\n\n${DISCUSSION_LIST_DIVIDER}\n\n`)}`;
}

function buildDiscussionPreviewText(messages, lang, user) {
  const title = String(user?.discussionDraftTitle || "").trim();
  const description = String(user?.discussionDraftDescription || "").trim();
  const joinRule = user?.discussionDraftJoinRule || { type: "open" };
  const capacity = Number(user?.discussionDraftMaxMembers) || DEFAULT_DISCUSSION_CAPACITY;
  return messages[lang].discussionPreview
    .replace("{title}", title || "-")
    .replace("{description}", description || "-")
    .replace("{rule}", getJoinRulePreviewText(messages, lang, joinRule))
    .replace("{capacity}", String(capacity));
}

module.exports = {
  getDiscussionErrorMessage,
  getJoinRulePreviewText,
  decorateDiscussionsForList,
  paginateDiscussions,
  buildDiscussionListText,
  buildDiscussionPreviewText,
};
