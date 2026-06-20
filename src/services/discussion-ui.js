const {
  ensurePublicDiscussionCodes,
  validateJoinRules,
} = require("./discussions");
const { getSectionLabel, getTasteLabelEmoji, getTasteLabelTitle } = require("./ai-section");
const { paginateItems } = require("./pagination");
const { PAGINATION } = require("../constants/pagination");

const DISCUSSION_LIST_PAGE_SIZE = PAGINATION.discussionListPageSize;
const DISCUSSION_LIST_DIVIDER = PAGINATION.listDivider;
const DEFAULT_DISCUSSION_CAPACITY = 20;
const RTL_MARK = "\u200F";
const LTR_MARK = "\u200E";
const FSI = "\u2068";
const PDI = "\u2069";

function getDiscussionErrorMessage(messages, lang, reason) {
  if (reason === "missing_discussion") return messages[lang].discussionErrMissingDiscussion;
  if (reason === "discussion_unavailable") return messages[lang].discussionInviteUnavailable;
  if (reason === "discussion_closed") return messages[lang].discussionErrClosed;
  if (reason === "discussion_full") return messages[lang].discussionErrFull;
  if (reason === "leave_current_first") return messages[lang].discussionErrLeaveCurrentFirst;
  if (reason === "removed_by_owner") return messages[lang].discussionErrRemovedByOwner;
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
  if (reason === "duplicate_report") return messages[lang].discussionErrDuplicateReport;
  if (reason === "active_owned_limit") return messages[lang].discussionActiveOwnedLimit;
  if (reason === "message_rate_limit") return messages[lang].discussionMessageRateLimit;
  return messages[lang].unknownAction;
}

function getLocalizedJoinRuleItemTitle(lang, joinRule = {}) {
  const aliases = Array.isArray(joinRule.itemAliases) ? joinRule.itemAliases : [];
  if (lang === "fa") {
    const persianAlias = aliases.find((alias) => /[\u0600-\u06FF]/.test(String(alias || "")));
    return persianAlias || joinRule.itemTitle || "-";
  }
  const latinAlias = aliases.find((alias) => /[A-Za-z]/.test(String(alias || "")));
  return latinAlias || joinRule.itemTitle || "-";
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
      .replace("{item}", getLocalizedJoinRuleItemTitle(lang, joinRule));
  }
  return messages[lang].discussionRuleTextOpen;
}

async function decorateDiscussionsForList(user, discussions = [], includeMemberActions = false) {
  await ensurePublicDiscussionCodes(discussions);
  return Promise.all((discussions || []).map(async (discussion) => {
    const isOwner = Number(discussion.creatorUserId) === Number(user?.userId);
    const joinCheck = isOwner
      ? { ok: true }
      : await validateJoinRules({ user, joinRule: discussion.joinRule });
    const isRemovedByOwner = Array.isArray(discussion.removedUserIds) 
      && discussion.removedUserIds.includes(Number(user?.userId));
    
    // Owners can always rejoin their own open rooms; other users must satisfy rules and removal checks.
    discussion.isJoinable = isOwner || (Boolean(joinCheck?.ok) && !isRemovedByOwner);
    discussion.listAction = includeMemberActions
      ? (isOwner ? "close" : "leave")
      : "";
    return discussion;
  }));
}

function paginateDiscussions(discussions = [], page = 0) {
  return paginateItems(discussions, page, DISCUSSION_LIST_PAGE_SIZE);
}

function buildDiscussionActionLine(lang, label, command) {
  return `${label} 👈 ${command}`;
}

function lineForLang(lang, text) {
  return lang === "fa" ? `${RTL_MARK}${text}` : text;
}

function isolateText(lang, text) {
  const value = String(text || "");
  return lang === "fa" ? `${FSI}${value}${PDI}` : value;
}

function firstStrongDirection(text) {
  const value = String(text || "");
  for (const ch of value) {
    if (/[A-Za-z]/.test(ch)) return "ltr";
    if (/[\u0590-\u08FF]/.test(ch)) return "rtl";
  }
  return "rtl";
}

function mixedValueLine(lang, emoji, text) {
  const value = String(text || "");
  if (lang !== "fa") return `${emoji} ${value}`;
  const dirMark = firstStrongDirection(value) === "ltr" ? LTR_MARK : RTL_MARK;
  return `${dirMark}${emoji} ${FSI}${value}${PDI}`;
}

function formatListIndex(lang, value) {
  const index = Number(value) || 0;
  if (lang !== "fa") return String(index);
  return new Intl.NumberFormat("fa-IR").format(index);
}

const BOT_DISCUSSION_MESSAGE_KEYS = {
  "free-discussion": {
    title: "botDiscussionFreeTitle",
    description: "botDiscussionFreeDescription",
  },
  "whats-up": {
    title: "botDiscussionWhatsUpTitle",
    description: "botDiscussionWhatsUpDescription",
  },
  "lets-talk": {
    title: "botDiscussionLetsTalkTitle",
    description: "botDiscussionLetsTalkDescription",
  },
};

function getBotDiscussionMessageKey(discussion = {}, field) {
  if (!discussion.isBotCreated) return "";
  return BOT_DISCUSSION_MESSAGE_KEYS[String(discussion.botSeedKey || "")]?.[field] || "";
}

function getDiscussionDisplayTitle(messages, lang, discussion = {}) {
  const title = String(discussion.title || "").trim() || "-";
  const messageKey = getBotDiscussionMessageKey(discussion, "title");
  const localizedTitle = messageKey ? messages?.[lang]?.[messageKey] : title;
  return discussion.isBotCreated ? `🤖 ${localizedTitle || title}` : title;
}

function getDiscussionDisplayDescription(messages, lang, discussion = {}) {
  const description = String(discussion.description || "").trim();
  const messageKey = getBotDiscussionMessageKey(discussion, "description");
  return messageKey ? (messages?.[lang]?.[messageKey] || description) : description;
}

function getStarterDiscussionHint(messages, lang, discussion = {}) {
  if (!discussion.isBotCreated) return "";
  if (discussion.botSeedKey === "free-discussion") {
    return messages[lang].discussionStarterHintOpen;
  }
  const joinRule = discussion.joinRule || {};
  if (joinRule.type !== "top_ten_item") return "";
  const item = getLocalizedJoinRuleItemTitle(lang, joinRule);
  const key = discussion.isJoinable
    ? "discussionStarterHintUnlocked"
    : "discussionStarterHintLocked";
  return messages[lang][key].replace("{item}", item);
}

function buildDiscussionListText(messages, lang, title, discussions = [], { startIndex = 0 } = {}) {
  if (!discussions.length) {
    return title;
  }

  const baseIndex = Math.max(0, Number(startIndex) || 0);
  const lines = discussions.map((entry, index) => {
    const count = Array.isArray(entry.memberUserIds) ? entry.memberUserIds.length : 0;
    const description = getDiscussionDisplayDescription(messages, lang, entry) || "-";
    const rule = getJoinRulePreviewText(messages, lang, entry.joinRule || { type: "open" });
    const ruleWithStatus = `${rule} ${entry.isJoinable ? "✅" : "🔒"}`.trim();
    const starterHint = getStarterDiscussionHint(messages, lang, entry);
    const code = entry.publicDiscussionCode || "";
    const joinLabel = lang === "fa" ? "ورود" : "Join";
    const leaveLabel = lang === "fa" ? "خروج" : "Leave";
    const closeLabel = lang === "fa" ? "بستن" : "Close";
    const openLink =
      code ? buildDiscussionActionLine(lang, joinLabel, `/${code}`) : "";
    const ownerAction =
      entry.listAction === "close" && code
        ? buildDiscussionActionLine(lang, closeLabel, `/close_${code.slice(2)}`)
        : "";
    const leaveAction =
      entry.listAction === "leave" && code
        ? buildDiscussionActionLine(lang, leaveLabel, `/leave_${code.slice(2)}`)
        : "";
    const actions = [openLink, ownerAction, leaveAction].filter(Boolean).join("\n");
    const actionsBlock = actions ? `\n\n${actions}` : "";
    return [
      lineForLang(lang, `${formatListIndex(lang, baseIndex + index + 1)}.`),
      mixedValueLine(lang, "💬", getDiscussionDisplayTitle(messages, lang, entry)),
      mixedValueLine(lang, "📄", description),
      lineForLang(lang, `👥 ${count}/${entry.maxMembers || 20}`),
      lineForLang(lang, `${messages[lang].discussionJoinConditionTitle}`),
      lineForLang(lang, `${isolateText(lang, ruleWithStatus)}`),
      starterHint ? lineForLang(lang, starterHint) : "",
    ].filter(Boolean).join("\n") + actionsBlock;
  });
  return `${title}\n\n${lines.join(`\n\n${DISCUSSION_LIST_DIVIDER}\n\n`)}`;
}

function fillDiscussionInviteTemplate(template, values = {}) {
  return String(template || "")
    .replace("{title}", values.title || "-")
    .replace("{descriptionBlock}", values.descriptionBlock || "")
    .replace("{ruleBlock}", values.ruleBlock || "")
    .replace("{joinBlock}", values.joinBlock || "")
    .replace("{joinConditionTitle}", values.joinConditionTitle || "")
    .replace("{rule}", values.rule || "")
    .replace("{count}", values.count || "0")
    .replace("{cap}", values.cap || "20")
    .replace("{code}", values.code || "");
}

function getInviteDescriptionBlock(messages, lang, discussion = {}, { compact = false } = {}) {
  const description = getDiscussionDisplayDescription(messages, lang, discussion);
  if (!description) return "";
  if (compact) return `📄 ${description}\n\n`;
  return `📄 ${description}\n`;
}

function getInviteRuleBlock(messages, lang, discussion = {}) {
  const rule = getJoinRulePreviewText(messages, lang, discussion.joinRule || { type: "open" });
  return `${messages[lang].discussionJoinConditionTitle}\n${rule}\n\n`;
}

function buildDiscussionInviteShareText(messages, lang, discussion, code, { deepLink = "" } = {}) {
  const cleanCode = String(code || discussion?.publicDiscussionCode || "").replace(/^d_/i, "");
  const joinBlock = deepLink
    ? messages[lang].discussionInviteLinkLine.replace("{link}", deepLink)
    : messages[lang].discussionInviteCommandLine.replace("{code}", cleanCode);
  return fillDiscussionInviteTemplate(messages[lang].discussionInviteShareText, {
    title: getDiscussionDisplayTitle(messages, lang, discussion),
    descriptionBlock: getInviteDescriptionBlock(messages, lang, discussion, { compact: true }),
    ruleBlock: getInviteRuleBlock(messages, lang, discussion),
    joinBlock,
    code: cleanCode,
  });
}

function buildDiscussionInvitePreviewText(messages, lang, discussion) {
  return fillDiscussionInviteTemplate(messages[lang].discussionInvitePreview, {
    title: getDiscussionDisplayTitle(messages, lang, discussion),
    descriptionBlock: getInviteDescriptionBlock(messages, lang, discussion),
    count: String((discussion?.memberUserIds || []).length),
    cap: String(discussion?.maxMembers || DEFAULT_DISCUSSION_CAPACITY),
    joinConditionTitle: messages[lang].discussionJoinConditionTitle,
    rule: getJoinRulePreviewText(messages, lang, discussion?.joinRule || { type: "open" }),
  });
}

function buildDiscussionInviteLockedText(messages, lang, reason, discussion = {}) {
  const joinRule = discussion?.joinRule || {};
  const sectionLabel = joinRule.section ? getSectionLabel(messages, lang, joinRule.section) : "";
  const rule = getJoinRulePreviewText(messages, lang, joinRule);
  if (reason === "requires_taste_label") {
    return messages[lang].discussionInviteLockedTaste
      .replace("{rule}", rule)
      .replaceAll("{section}", sectionLabel || "-");
  }
  if (reason === "requires_top_ten_item") {
    const item = getLocalizedJoinRuleItemTitle(lang, joinRule);
    return messages[lang].discussionInviteLockedItem
      .replace("{rule}", rule)
      .replaceAll("{item}", item)
      .replaceAll("{section}", sectionLabel || "-");
  }
  if (reason === "requires_top_ten_completed") {
    return messages[lang].discussionInviteLockedTopTen
      .replaceAll("{section}", sectionLabel || "-");
  }
  return getDiscussionErrorMessage(messages, lang, reason);
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
  getLocalizedJoinRuleItemTitle,
  decorateDiscussionsForList,
  paginateDiscussions,
  getDiscussionDisplayTitle,
  getDiscussionDisplayDescription,
  buildDiscussionListText,
  buildDiscussionPreviewText,
  buildDiscussionInviteShareText,
  buildDiscussionInvitePreviewText,
  buildDiscussionInviteLockedText,
};
