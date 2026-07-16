const {
  getDiscussionDisplayTitle,
  getDiscussionDisplayDescription,
  getJoinRulePreviewText,
} = require("./discussion-ui");
const { normalizeMaxMembers } = require("./discussions");

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

function buildInvitationSentText(messages, lang, invitee = {}) {
  return messages[lang].discussionInvitationSent.replace(
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

function buildInvitationEntryText(messages, lang, entry, index, { accepted = false } = {}) {
  const { invitation, discussion, inviter, state } = entry;
  const code = commandCode(invitation.publicInvitationCode);
  const isBotInvite = invitation?.source === "bot_onboarding" && discussion?.isBotCreated;
  const inviterCode = !isBotInvite && inviter?.publicProfileCode ? commandCode(inviter.publicProfileCode, /^u_/i) : "";
  const statusEmoji = accepted ? "✅" : invitation.seenAt ? "📨" : "🆕";
  const title = discussion
    ? getDiscussionDisplayTitle(messages, lang, discussion)
    : messages[lang].discussionInvitationMissingTitle;
  const inviterName = isBotInvite
    ? messages[lang].discussionInvitationBotInviter
    : displayName(inviter, lang === "fa" ? "کاربر" : "User");
  const maxMembers = discussion ? normalizeMaxMembers(discussion.maxMembers) : 0;
  const memberCount = discussion?.memberUserIds?.length || 0;
  const rule = discussion ? getJoinRulePreviewText(messages, lang, discussion.joinRule) : "";
  const lines = [
    `${index + 1}. ${statusEmoji} ${title}`,
    messages[lang].discussionInvitationFrom.replace("{name}", inviterName),
  ];

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

  if (state.state === "joinable" || state.state === "already_member") {
    lines.push(pointerLine(lang, messages[lang].discussionInvitationAccept, `/accept_inv_${code}`));
  }
  if (inviterCode && !accepted) {
    lines.push(pointerLine(lang, messages[lang].discussionInvitationInviterProfile, `/u_${inviterCode}`));
  }
  lines.push(pointerLine(lang, messages[lang].discussionInvitationRemove, `/remove_inv_${code}`));
  return lines.join("\n");
}

async function buildReceivedInvitationsText(messages, lang, user, entries = [], acceptedEntries = []) {
  const hasPending = entries.length > 0;
  const hasAccepted = acceptedEntries.length > 0;
  const parts = [messages[lang].discussionInvitationsTitle, ""];
  if (!hasPending && !hasAccepted) {
    parts.push(messages[lang].discussionInvitationsEmpty);
    if (messages[lang].discussionInvitationsEmptyTip) {
      parts.push("");
      parts.push(messages[lang].discussionInvitationsEmptyTip);
    }
    return parts.join("\n");
  }

  const membershipCount = Array.isArray(user?.discussionMembershipIds) ? user.discussionMembershipIds.length : 0;
  if (membershipCount === 0 && hasPending) {
    parts.push(messages[lang].discussionInvitationFirstTimeTip);
    parts.push("");
  }

  if (hasPending) {
    for (let index = 0; index < entries.length; index += 1) {
      parts.push(buildInvitationEntryText(messages, lang, entries[index], index));
      if (index < entries.length - 1) {
        parts.push("");
        parts.push(DIVIDER);
        parts.push("");
      }
    }
  } else {
    parts.push(messages[lang].discussionInvitationsEmpty);
  }

  if (hasAccepted) {
    if (hasPending) {
      parts.push("");
      parts.push(DIVIDER);
    }
    parts.push("");
    parts.push(messages[lang].discussionInvitationsRecentTitle);
    parts.push("");
    for (let index = 0; index < acceptedEntries.length; index += 1) {
      parts.push(buildInvitationEntryText(messages, lang, acceptedEntries[index], index, { accepted: true }));
      if (index < acceptedEntries.length - 1) {
        parts.push("");
        parts.push(DIVIDER);
        parts.push("");
      }
    }
  } else if (!hasPending && messages[lang].discussionInvitationsEmptyTip) {
    parts.push("");
    parts.push(messages[lang].discussionInvitationsEmptyTip);
  }

  return parts.join("\n");
}

module.exports = {
  buildInvitationSentText,
  filterSavedInviteTargets,
  buildInviteSavedProfilesText,
  buildInviteDiscussionPickerText,
  buildInviteDiscussionPickerList,
  buildReceivedInvitationsText,
};
