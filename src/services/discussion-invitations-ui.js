const {
  getDiscussionDisplayTitle,
  getDiscussionDisplayDescription,
  getJoinRulePreviewText,
} = require("./discussion-ui");
const { resolveDiscussionMaxMembers } = require("./discussions");

const DIVIDER = "-----";

function commandCode(code = "", prefix = /^i_/i) {
  return String(code || "").replace(prefix, "");
}

function pointerLine(lang, label, command) {
  return lang === "fa" ? `${label} 👈 ${command}` : `${label} 👉 ${command}`;
}

function displayName(user = {}, fallback = "") {
  return String(user?.profileName || user?.firstName || fallback || "").trim();
}

function buildInvitationSentText(messages, lang, invitee = {}, { restoresOwnerRemoval = false } = {}) {
  const template = restoresOwnerRemoval
    ? messages[lang].discussionReentryInvitationSent
    : messages[lang].discussionInvitationSent;
  return template.replace(
    "{name}",
    displayName(invitee, lang === "fa" ? "کاربر" : "User"),
  );
}

function filterSavedInviteTargets(items = [], memberUserIds = []) {
  const members = new Set((memberUserIds || []).map((userId) => Number(userId)));
  return (items || []).filter((item) => !members.has(Number(item?.userId)));
}

function buildInviteSavedProfilesText(messages, lang, discussion) {
  const title = getDiscussionDisplayTitle(messages, lang, discussion);
  return messages[lang].discussionInviteChooseSavedProfile.replace("{title}", title);
}

function buildInviteDiscussionPickerText(messages, lang, invitee = {}) {
  return messages[lang].discussionInviteChooseDiscussion.replace(
    "{name}",
    displayName(invitee, lang === "fa" ? "کاربر" : "User"),
  );
}

function buildInviteDiscussionPickerList(messages, lang, discussions = []) {
  if (!discussions.length) return messages[lang].discussionInviteDiscussionPickerTitle;
  const lines = discussions.map((discussion, index) => {
    const title = getDiscussionDisplayTitle(messages, lang, discussion);
    const description = getDiscussionDisplayDescription(messages, lang, discussion) || "-";
    const count = Array.isArray(discussion.memberUserIds) ? discussion.memberUserIds.length : 0;
    const cap = discussion.maxMembers || 20;
    const rule = getJoinRulePreviewText(messages, lang, discussion.joinRule || { type: "open" });
    return `${index + 1}. ${title}\n📄 ${description}\n👥 ${count}/${cap}\n${messages[lang].discussionJoinConditionTitle}\n${rule}`;
  });
  return `${messages[lang].discussionInviteDiscussionPickerTitle}\n\n${lines.join(`\n\n${DIVIDER}\n\n`)}`;
}

function buildInvitationStateText(messages, lang, state = {}) {
  if (state.state === "joinable") return messages[lang].discussionInvitationStateJoinable;
  if (state.state === "already_member") return messages[lang].discussionInvitationStateAlreadyMember;
  if (state.state === "full") return messages[lang].discussionInvitationStateFull;
  if (state.state === "locked") return messages[lang].discussionInvitationStateLocked;
  if (state.state === "blocked") return messages[lang].discussionInvitationStateUnavailable;
  return messages[lang].discussionInvitationStateUnavailable;
}

function buildInvitationJoinRuleText(rule, state = {}) {
  return state.state === "joinable" ? `${rule} ✅` : rule;
}

function buildInvitationEntryText(messages, lang, entry, index, {
  includeActions = true,
  includeIndex = true,
} = {}) {
  const { invitation, discussion, inviter, state } = entry;
  const accepted = invitation?.status === "accepted";
  const code = commandCode(invitation.publicInvitationCode);
  const isBotInvite = invitation?.source === "bot_onboarding" && discussion?.isBotCreated;
  const isSharedLinkInvite = invitation?.source === "shared_link";
  const inviterCode = !isBotInvite && !isSharedLinkInvite && inviter?.publicProfileCode
    ? commandCode(inviter.publicProfileCode, /^u_/i)
    : "";
  const statusEmoji = accepted ? "✅" : invitation.seenAt ? "📨" : "🆕";
  const title = discussion
    ? getDiscussionDisplayTitle(messages, lang, discussion)
    : messages[lang].discussionInvitationMissingTitle;
  let inviterName = displayName(inviter, lang === "fa" ? "کاربر" : "User");
  if (isBotInvite) inviterName = messages[lang].discussionInvitationBotInviter;
  if (isSharedLinkInvite) inviterName = messages[lang].discussionInvitationSharedLinkInviter;
  const maxMembers = discussion ? resolveDiscussionMaxMembers(discussion) : 0;
  const memberCount = discussion?.memberUserIds?.length || 0;
  const rule = discussion ? getJoinRulePreviewText(messages, lang, discussion.joinRule) : "";
  const lines = [
    `${includeIndex ? `${index + 1}. ` : ""}${statusEmoji} ${title}`,
  ];
  const commandLineIndexes = new Set();
  const inviterLine = messages[lang].discussionInvitationFrom.replace("{name}", inviterName);
  const inviterHasCommand = includeActions && inviterCode;
  lines.push(inviterHasCommand
    ? `${inviterLine} — ${pointerLine(
      lang,
      messages[lang].discussionInvitationInviterProfile,
      `/inviter_u_${inviterCode}`,
    )}`
    : inviterLine);
  if (inviterHasCommand) commandLineIndexes.add(lines.length - 1);

  const description = discussion ? getDiscussionDisplayDescription(messages, lang, discussion) : "";
  if (description) {
    lines.push(`📄 ${description}`);
  }
  if (discussion) {
    lines.push(`👥 ${memberCount}/${maxMembers}`);
    lines.push(`${messages[lang].discussionJoinConditionTitle}\n${buildInvitationJoinRuleText(rule, state)}`);
  }
  if (state.state !== "joinable") {
    lines.push(buildInvitationStateText(messages, lang, state));
  }

  if (includeActions && (state.state === "joinable" || state.state === "already_member")) {
    lines.push(pointerLine(lang, messages[lang].discussionInvitationAccept, `/accept_inv_${code}`));
    commandLineIndexes.add(lines.length - 1);
  }
  if (includeActions) {
    lines.push(pointerLine(lang, messages[lang].discussionInvitationRemove, `/remove_inv_${code}`));
    commandLineIndexes.add(lines.length - 1);
  }
  return lines.map((line, lineIndex) => {
    if (lineIndex === 0) return line;
    const besideCommand = commandLineIndexes.has(lineIndex) || commandLineIndexes.has(lineIndex - 1);
    return `${besideCommand ? "\n\n" : "\n"}${line}`;
  }).join("");
}

function buildInvitationPreviewText(messages, lang, entry) {
  return [
    messages[lang].discussionInvitationPreviewTitle,
    buildInvitationEntryText(messages, lang, entry, 0, {
      includeActions: false,
      includeIndex: false,
    }),
  ].join("\n\n");
}

function shouldShowDiscussionInvitationFirstTimeTip(user, entries = []) {
  const membershipCount = Array.isArray(user?.discussionMembershipIds) ? user.discussionMembershipIds.length : 0;
  return membershipCount === 0
    && entries.length > 0
    && !user?.sectionTipsShownAt?.discussions;
}

async function buildReceivedInvitationsText(messages, lang, user, entries = [], {
  startIndex = 0,
  totalCount = entries.length,
} = {}) {
  const title = messages[lang].discussionInvitationsTitle.replace(
    "{count}",
    String(Math.max(0, Number(totalCount) || 0)),
  );
  const parts = [title, ""];
  if (!entries.length) {
    parts.push(messages[lang].discussionInvitationsEmpty);
    if (messages[lang].discussionInvitationsEmptyTip) {
      parts.push("");
      parts.push(messages[lang].discussionInvitationsEmptyTip);
    }
    return parts.join("\n");
  }

  if (shouldShowDiscussionInvitationFirstTimeTip(user, entries)) {
    parts.push(messages[lang].discussionInvitationFirstTimeTip);
    parts.push("");
  }

  parts.push(messages[lang].discussionInvitationsListTip);
  parts.push("");

  for (let index = 0; index < entries.length; index += 1) {
    parts.push(buildInvitationEntryText(messages, lang, entries[index], startIndex + index));
    if (index < entries.length - 1) {
      parts.push("");
      parts.push(DIVIDER);
      parts.push("");
    }
  }

  return parts.join("\n");
}

module.exports = {
  buildInvitationSentText,
  filterSavedInviteTargets,
  buildInviteSavedProfilesText,
  buildInviteDiscussionPickerText,
  buildInviteDiscussionPickerList,
  buildInvitationPreviewText,
  buildReceivedInvitationsText,
  shouldShowDiscussionInvitationFirstTimeTip,
};
