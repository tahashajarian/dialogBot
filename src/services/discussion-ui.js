const {
  ensurePublicDiscussionCodes,
  validateJoinRules,
} = require("./discussions");

const DISCUSSION_LIST_PAGE_SIZE = 5;
const DISCUSSION_LIST_DIVIDER = "────────";
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

async function decorateDiscussionsForList(user, discussions = [], includeMemberActions = false) {
  await ensurePublicDiscussionCodes(discussions);
  return Promise.all((discussions || []).map(async (discussion) => {
    const joinCheck = await validateJoinRules({ user, joinRule: discussion.joinRule });
    discussion.listPrefix = getDiscussionListPrefix(joinCheck);
    discussion.isJoinable = Boolean(joinCheck?.ok);
    discussion.listAction = includeMemberActions
      ? (Number(discussion.creatorUserId) === Number(user?.userId) ? "close" : "leave")
      : "";
    return discussion;
  }));
}

function paginateDiscussions(discussions = [], page = 0) {
  const totalPages = Math.max(1, Math.ceil(discussions.length / DISCUSSION_LIST_PAGE_SIZE));
  const normalizedPage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const start = normalizedPage * DISCUSSION_LIST_PAGE_SIZE;
  return {
    page: normalizedPage,
    totalPages,
    items: discussions.slice(start, start + DISCUSSION_LIST_PAGE_SIZE),
  };
}

function buildDiscussionActionLine(lang, label, command) {
  return lang === "fa" ? `${label} 👈 ${command}` : `${label} 👉 ${command}`;
}

function buildDiscussionListText(messages, lang, title, discussions = []) {
  if (!discussions.length) {
    return title;
  }

  const lines = discussions.map((entry, index) => {
    const prefix = entry.listPrefix || "💬";
    const count = Array.isArray(entry.memberUserIds) ? entry.memberUserIds.length : 0;
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
    return `${index + 1}. ${prefix} ${entry.title}\n👥 ${count}/${entry.maxMembers || 20}\n${rule}${openLink}${ownerAction}${leaveAction}`;
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
