const { PAGINATION } = require("../constants/pagination");
const {
  getDiscussionDisplayDescription,
  getDiscussionDisplayTitle,
} = require("./discussion-ui");
const { formatUserDisplayName, getProfileGenderEmoji } = require("./profile");
const { formatProfileListNameLine } = require("./people-discovery-ui");
const { paginateItems } = require("./pagination");
const { discussionRoomKeyboard } = require("../keyboards");
const { hasActiveBoostForDiscussion } = require("./discussion-boosts");

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
  const description = getDiscussionDisplayDescription(messages, lang, discussion);
  const text = description
    ? messages[lang].discussionRoomHeader
    : messages[lang].discussionRoomHeaderNoDescription;
  return text
    .replace("{title}", getDiscussionDisplayTitle(messages, lang, discussion))
    .replace("{description}", description)
    .replace("{count}", String(count))
    .replace("{cap}", String(cap))
    + `\n${discussion.language === "en" ? "🇬🇧" : "🇮🇷"} ${discussion.language === "en" ? messages[lang].discussionLanguageEnglish : messages[lang].discussionLanguagePersian}`;
}

function formatRecentDiscussionMessages(messages, lang, discussion) {
  const recent = Array.isArray(discussion.recentMessages) ? discussion.recentMessages : [];
  if (!recent.length) {
    return `${messages[lang].discussionRecentMessagesTitle}\n${messages[lang].discussionNoRecentMessages}`;
  }
  const lines = recent.map((entry) => {
    const isVoice = Boolean(entry.voiceFileId);
    const content = isVoice 
      ? (lang === "fa" ? "🎤 پیام صوتی" : "🎤 Voice message")
      : isolateText(lang, entry.text);
    return lineForLang(
      lang,
      `- ${isolateText(lang, entry.senderDisplayName)}: ${content}`,
    );
  });
  return `${messages[lang].discussionRecentMessagesTitle}\n${lines.join("\n")}`;
}

function getStarterDiscussionJoinNudge(messages, lang, discussion = {}) {
  if (!discussion.isBotCreated) return "";
  const seedKey = String(discussion.botSeedKey || "").replace(/:(fa|en)$/, "");
  if (seedKey === "free-discussion") {
    return messages[lang].discussionStarterJoinNudgeFree;
  }
  if (seedKey === "whats-up") {
    return messages[lang].discussionStarterJoinNudgeGaming;
  }
  if (seedKey === "lets-talk") {
    return messages[lang].discussionStarterJoinNudgeMovies;
  }
  return "";
}

function formatDiscussionRoomFollowup(messages, lang, discussion) {
  const parts = [
    formatRecentDiscussionMessages(messages, lang, discussion),
    messages[lang].discussionRoomSendHint,
    getStarterDiscussionJoinNudge(messages, lang, discussion),
  ].filter(Boolean);
  return parts.join("\n\n");
}

async function buildDiscussionRoomKeyboard(lang, discussion, currentUserId) {
  const isOwner = Number(discussion?.creatorUserId) === Number(currentUserId);
  const canBoost = !isOwner || !await hasActiveBoostForDiscussion(discussion?._id);
  return discussionRoomKeyboard(lang, isOwner, { canBoost });
}

const DISCUSSION_MEMBER_DIVIDER = PAGINATION.listDivider;

function paginateDiscussionMembers(members = [], memberUserIds = [], page = 0) {
  const positions = new Map(
    (memberUserIds || []).map((userId, index) => [Number(userId), index]),
  );
  const orderedMembers = [...(members || [])].sort(
    (left, right) => (positions.get(Number(left.userId)) ?? Number.MAX_SAFE_INTEGER)
      - (positions.get(Number(right.userId)) ?? Number.MAX_SAFE_INTEGER),
  );
  return {
    ...paginateItems(orderedMembers, page, PAGINATION.discussionMembersPageSize),
    totalCount: orderedMembers.length,
  };
}

function formatDiscussionMemberLines(messages, lang, members = [], creatorUserId, currentUserId = null, {
  startIndex = 0,
} = {}) {
  return members.map((entry, index) => {
    const isCurrentUser = Number(entry.userId) === Number(currentUserId);
    const isOwner = Number(entry.userId) === Number(creatorUserId);
    const currentUserIsOwner = Number(currentUserId) === Number(creatorUserId);
    const name = isCurrentUser ? (lang === "fa" ? "تو" : "You") : formatUserDisplayName(entry);
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

    const actionText = actions.length ? `\n\n${actions.join("\n\n")}` : "";
    const divider = `\n${DISCUSSION_MEMBER_DIVIDER}`;
    const nameLine = formatProfileListNameLine(lang, {
      name,
      genderEmoji: getProfileGenderEmoji(entry.gender),
      age: entry.age,
    });
    return `${lineForLang(lang, `${formatListIndex(lang, startIndex + index + 1)}.`)}\n${nameLine}${owner}${actionText}${divider}`;
  });
}

function buildDiscussionMembersText(messages, lang, rows = [], totalCount = rows.length) {
  const count = formatListIndex(lang, totalCount);
  const title = `👩‍🦳 ${messages[lang].discussionMembersTitle} (${count})`;
  const hasViewableMember = rows.some((row) => /\/u_[a-z0-9]+/i.test(String(row || "")));
  const header = [
    title,
    hasViewableMember ? messages[lang].discussionMembersTip : "",
  ].filter(Boolean).join("\n");
  return `${header}\n\n${rows.join("\n")}`;
}

module.exports = {
  formatDiscussionRoom,
  formatDiscussionRoomFollowup,
  buildDiscussionRoomKeyboard,
  formatRecentDiscussionMessages,
  getStarterDiscussionJoinNudge,
  paginateDiscussionMembers,
  formatDiscussionMemberLines,
  buildDiscussionMembersText,
};
