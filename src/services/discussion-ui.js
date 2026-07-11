const {
  ensurePublicDiscussionCodes,
  validateJoinRules,
} = require("./discussions");
const { getSectionEmoji, getSectionLabel, getTasteLabelEmoji, getTasteLabelTitle } = require("./ai-section");
const { localizeInterestChipTitleWithEmoji } = require("./interest-chips");
const { paginateItems } = require("./pagination");
const { PAGINATION } = require("../constants/pagination");
const User = require("../models/user");
const { isDiscussionBoostAvailable, starEconomy } = require("./star-settings");
const { formatOperationalLimitsText } = require("./operational-limits-ui");

const DISCUSSION_LIST_PAGE_SIZE = PAGINATION.discussionListPageSize;
const DISCUSSION_LIST_DIVIDER = PAGINATION.listDivider;
const DEFAULT_DISCUSSION_CAPACITY = 20;
const DISCUSSION_NEW_BOOST_MS = 24 * 60 * 60 * 1000;
const DISCUSSION_RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
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
  if (reason === "paid_capacity_required") return messages[lang].discussionPaidCapacityUnavailable;
  if (reason === "invalid_report_target") return messages[lang].discussionErrInvalidReportTarget;
  if (reason === "duplicate_report") return messages[lang].discussionErrDuplicateReport;
  if (reason === "active_owned_limit") return formatOperationalLimitsText(messages[lang].discussionActiveOwnedLimit);
  if (reason === "message_rate_limit") return messages[lang].discussionMessageRateLimit;
  return messages[lang].unknownAction;
}

function getLocalizedJoinRuleItemTitle(lang, joinRule = {}) {
  const aliases = Array.isArray(joinRule.itemAliases) ? joinRule.itemAliases : [];
  let title = "";
  if (lang === "fa") {
    const persianAlias = aliases.find((alias) => /[\u0600-\u06FF]/.test(String(alias || "")));
    title = persianAlias || joinRule.itemTitle || "-";
  } else {
    const latinAlias = aliases.find((alias) => /[A-Za-z]/.test(String(alias || "")));
    title = latinAlias || joinRule.itemTitle || "-";
  }
  return joinRule.section === "random"
    ? localizeInterestChipTitleWithEmoji(title, lang)
    : title;
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
    const sectionWithEmoji = `${getSectionEmoji(joinRule.section)} ${sectionLabel}`.trim();
    return messages[lang].discussionRuleTextItem
      .replace("{section}", sectionWithEmoji)
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

function getTimeValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getRecencyScore(discussion, nowMs) {
  const activityMs = Math.max(
    getTimeValue(discussion.lastActivityAt),
    getTimeValue(discussion.updatedAt),
    getTimeValue(discussion.createdAt),
  );
  if (!activityMs) return 0;
  const ageMs = Math.max(0, nowMs - activityMs);
  if (ageMs >= DISCUSSION_RECENCY_WINDOW_MS) return 0;
  return Math.round((1 - (ageMs / DISCUSSION_RECENCY_WINDOW_MS)) * 20);
}

function getCapacityScore(discussion) {
  const maxMembers = Number(discussion.maxMembers) || DEFAULT_DISCUSSION_CAPACITY;
  const count = Array.isArray(discussion.memberUserIds) ? discussion.memberUserIds.length : 0;
  if (maxMembers <= 0 || count >= maxMembers) return 0;
  return Math.round(((maxMembers - count) / maxMembers) * 5);
}

function normalizeSavedProfileCodes(codes = []) {
  return [...new Set((codes || [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean))];
}

async function getSavedCreatorUserIds(user) {
  const codes = normalizeSavedProfileCodes(user?.savedProfileCodes);
  if (!codes.length) return new Set();
  const savedUsers = await User.find({ publicProfileCode: { $in: codes } })
    .select("userId")
    .lean();
  return new Set((savedUsers || []).map((entry) => Number(entry.userId)).filter(Boolean));
}

function getDiscussionDiscoveryScore(user, discussion, { now = new Date(), savedCreatorUserIds = new Set() } = {}) {
  const nowMs = getTimeValue(now) || Date.now();
  const joinRule = discussion.joinRule || { type: "open" };
  const membershipCount = Array.isArray(user?.discussionMembershipIds) ? user.discussionMembershipIds.length : 0;
  let score = 0;

  if (discussion.isJoinable) score += 15;
  if (discussion.isJoinable && joinRule.type === "top_ten_item") score += 90;
  if (discussion.isJoinable && joinRule.type === "taste_label") score += 80;
  if (discussion.isJoinable && joinRule.type === "top_ten_completed") score += 60;
  if (savedCreatorUserIds.has(Number(discussion.creatorUserId))) score += 50;
  if (nowMs - getTimeValue(discussion.createdAt) <= DISCUSSION_NEW_BOOST_MS) score += 40;
  if (discussion.isBotCreated && membershipCount < 2) score += 30;
  if ((joinRule.type || "open") === "open") score += 10;
  score += getRecencyScore(discussion, nowMs);
  score += getCapacityScore(discussion);

  return score;
}

async function rankDiscussionsForDiscovery(user, discussions = [], { now = new Date(), savedCreatorUserIds = null } = {}) {
  const savedCreatorIds = savedCreatorUserIds
    ? new Set([...savedCreatorUserIds].map(Number).filter(Boolean))
    : await getSavedCreatorUserIds(user);
  const ranked = [...(discussions || [])]
    .map((discussion, index) => ({
      discussion,
      index,
      score: getDiscussionDiscoveryScore(user, discussion, { now, savedCreatorUserIds: savedCreatorIds }),
      activity: Math.max(
        getTimeValue(discussion.lastActivityAt),
        getTimeValue(discussion.updatedAt),
        getTimeValue(discussion.createdAt),
      ),
    }))
    .sort((left, right) => (
      (right.score - left.score) ||
      (right.activity - left.activity) ||
      (left.index - right.index)
    ))
    .map((entry) => entry.discussion);
  const boostedSlots = Math.max(1, Math.min(2, Number(starEconomy.discussionBoostedSlotsPerPage) || 1));
  const boosted = ranked.filter((discussion) => discussion.isBoosted && discussion.isJoinable).slice(0, boostedSlots);
  if (!boosted.length) return ranked;
  const pinned = new Set(boosted.map((discussion) => String(discussion._id)));
  return [...boosted, ...ranked.filter((discussion) => !pinned.has(String(discussion._id)))];
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
  metalheads: {
    title: "botDiscussionMetalheadsTitle",
    description: "botDiscussionMetalheadsDescription",
  },
};

function getBotDiscussionMessageKey(discussion = {}, field) {
  if (!discussion.isBotCreated) return "";
  return BOT_DISCUSSION_MESSAGE_KEYS[String(discussion.botSeedKey || "").replace(/:(fa|en)$/, "")]?.[field] || "";
}

function getDiscussionDisplayTitle(messages, lang, discussion = {}) {
  const title = String(discussion.title || "").trim() || "-";
  const messageKey = getBotDiscussionMessageKey(discussion, "title");
  const localizedTitle = messageKey ? messages?.[discussion.language || lang]?.[messageKey] : title;
  return discussion.isBotCreated ? `👩‍🦳 ${localizedTitle || title}` : title;
}

function getDiscussionDisplayDescription(messages, lang, discussion = {}) {
  const description = String(discussion.description || "").trim();
  const messageKey = getBotDiscussionMessageKey(discussion, "description");
  return messageKey ? (messages?.[discussion.language || lang]?.[messageKey] || description) : description;
}

function getStarterDiscussionHint(messages, lang, discussion = {}) {
  if (!discussion.isBotCreated) return "";
  if (String(discussion.botSeedKey || "").replace(/:(fa|en)$/, "") === "free-discussion") {
    return messages[lang].discussionStarterHintOpen;
  }
  const joinRule = discussion.joinRule || {};
  if (joinRule.type !== "top_ten_item") return "";
  if (discussion.isJoinable) return "";
  const item = getLocalizedJoinRuleItemTitle(lang, joinRule);
  return messages[lang].discussionStarterHintLocked.replace("{item}", item);
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
    const boostLabel = messages[lang].discussionBoostActionLabel || messages[lang].discussionBoostButton;
    const openLink =
      code ? buildDiscussionActionLine(lang, joinLabel, `/${code}`) : "";
    const boostAction =
      entry.listAction === "close" && code && isDiscussionBoostAvailable()
        ? buildDiscussionActionLine(lang, boostLabel, `/boost_${code.slice(2)}`)
        : "";
    const ownerAction =
      entry.listAction === "close" && code
        ? buildDiscussionActionLine(lang, closeLabel, `/close_${code.slice(2)}`)
        : "";
    const leaveAction =
      entry.listAction === "leave" && code
        ? buildDiscussionActionLine(lang, leaveLabel, `/leave_${code.slice(2)}`)
        : "";
    const actions = [openLink, boostAction, ownerAction, leaveAction].filter(Boolean).join("\n");
    const actionsBlock = actions ? `\n\n${actions}` : "";
    const roomNumber = `${formatListIndex(lang, baseIndex + index + 1)}.`;
    const roomTitle = getDiscussionDisplayTitle(messages, lang, entry);
    const titleLine = lang === "fa"
      ? `${roomNumber} 💬 ${isolateText(lang, roomTitle)}`
      : `${roomNumber} 💬 ${roomTitle}`;
    const memberCountLine = `👥 ${count}/${entry.maxMembers || 20}`;
    const joinRuleLine = isolateText(lang, ruleWithStatus);
    const languageDiffers = entry.language && entry.language !== lang;
    return [
      lineForLang(lang, titleLine),
      entry.isBoosted ? lineForLang(lang, messages[lang].discussionBoostedLabel) : "",
      mixedValueLine(lang, "📄", description),
      lineForLang(lang, memberCountLine),
      lineForLang(lang, joinRuleLine),
      languageDiffers
        ? lineForLang(lang, `${entry.language === "en" ? "🇬🇧" : "🇮🇷"} ${entry.language === "en" ? messages[lang].discussionLanguageEnglish : messages[lang].discussionLanguagePersian}`)
        : "",
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
  const language = discussion.language === "en" ? messages[lang].discussionLanguageEnglish : messages[lang].discussionLanguagePersian;
  return `${discussion.language === "en" ? "🇬🇧" : "🇮🇷"} ${messages[lang].discussionLanguageFilter}: ${language}\n${messages[lang].discussionJoinConditionTitle}\n${rule}\n\n`;
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
    const messageKey = joinRule.section === "random"
      ? "discussionInviteLockedProfileInterest"
      : "discussionInviteLockedItem";
    return messages[lang][messageKey]
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

function buildDiscussionJoinLockedText(messages, lang, reason, discussion = {}) {
  const joinRule = discussion?.joinRule || {};
  const sectionLabel = joinRule.section ? getSectionLabel(messages, lang, joinRule.section) : "";
  const rule = getJoinRulePreviewText(messages, lang, joinRule);
  if (reason === "requires_taste_label") {
    return messages[lang].discussionJoinLockedTaste
      .replace("{rule}", rule)
      .replaceAll("{section}", sectionLabel || "-");
  }
  if (reason === "requires_top_ten_item") {
    const item = getLocalizedJoinRuleItemTitle(lang, joinRule);
    const messageKey = joinRule.section === "random"
      ? "discussionJoinLockedProfileInterest"
      : "discussionJoinLockedItem";
    return messages[lang][messageKey]
      .replace("{rule}", rule)
      .replaceAll("{item}", item)
      .replaceAll("{section}", sectionLabel || "-");
  }
  if (reason === "requires_top_ten_completed") {
    return messages[lang].discussionJoinLockedTopTen
      .replaceAll("{section}", sectionLabel || "-");
  }
  return getDiscussionErrorMessage(messages, lang, reason);
}

function buildDiscussionPreviewText(messages, lang, user) {
  const title = String(user?.discussionDraftTitle || "").trim();
  const description = String(user?.discussionDraftDescription || "").trim();
  const joinRule = user?.discussionDraftJoinRule || { type: "open" };
  const capacity = Number(user?.discussionDraftMaxMembers) || DEFAULT_DISCUSSION_CAPACITY;
  const language = require("./discussion-language").normalizeDiscussionLanguage(user?.discussionDraftLanguage, user?.lang);
  return messages[lang].discussionPreview
    .replace("{title}", title || "-")
    .replace("{description}", description || "-")
    .replace("{rule}", getJoinRulePreviewText(messages, lang, joinRule))
    .replace("{capacity}", String(capacity))
    .replace("{languageFlag}", language === "en" ? "🇬🇧" : "🇮🇷")
    .replace("{language}", language === "en" ? messages[lang].discussionLanguageEnglish : messages[lang].discussionLanguagePersian);
}

module.exports = {
  getDiscussionErrorMessage,
  getJoinRulePreviewText,
  getLocalizedJoinRuleItemTitle,
  decorateDiscussionsForList,
  getDiscussionDiscoveryScore,
  rankDiscussionsForDiscovery,
  paginateDiscussions,
  getDiscussionDisplayTitle,
  getDiscussionDisplayDescription,
  buildDiscussionListText,
  buildDiscussionPreviewText,
  buildDiscussionInviteShareText,
  buildDiscussionInvitePreviewText,
  buildDiscussionInviteLockedText,
  buildDiscussionJoinLockedText,
};
