const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  mainMenuKeyboard,
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionRoomKeyboard,
  discussionInvitePreviewKeyboard,
  discussionCreateCancelKeyboard,
  discussionJoinErrorAckKeyboard,
} = require("../keyboards");
const User = require("../models/user");
const {
  ensurePublicProfileCode,
  findDiscussionByPublicCode,
  getActiveDiscussionInviteForUser,
  getDiscussionInvitePreviewByCode,
  joinOrSwitchActiveDiscussion,
  listActiveDiscussions,
  listMyDiscussions,
  normalizePublicProfileCode,
  reportDiscussionMember,
} = require("../services/discussions");
const {
  closeDiscussionAndNotify,
  joinDiscussionAndNotify,
  leaveDiscussionAndNotify,
  removeDiscussionMemberAndNotify,
} = require("../services/discussion-actions");
const {
  getDiscussionErrorMessage,
  buildDiscussionInviteLockedText,
  buildDiscussionInvitePreviewText,
  buildDiscussionInviteShareText,
  decorateDiscussionsForList,
  paginateDiscussions,
  buildDiscussionListText,
} = require("../services/discussion-ui");
const {
  formatDiscussionMemberLines,
  formatDiscussionRoom,
  formatRecentDiscussionMessages,
} = require("../services/discussion-room-ui");
const { buildBotStartLink } = require("../services/invite-links");
const { updateProfileField, updateUserState } = require("../services/users");
const {
  clearDiscussionMembersMessage,
  rememberDiscussionMembersMessage,
} = require("./discussions-callbacks");

function normalizeKeyboardText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\uFE0F/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

function matchesMessageText(text, keys) {
  const normalizedText = normalizeKeyboardText(text);
  return keys
    .flatMap((key) => [messages.fa[key], messages.en[key]])
    .map(normalizeKeyboardText)
    .includes(normalizedText);
}

function getPlainKeyboardText(text) {
  return normalizeKeyboardText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function isDiscussionMembersText(text) {
  const plainText = getPlainKeyboardText(text);
  return matchesMessageText(text, ["discussionMembersTitle"]) || plainText.includes("اعضا") || plainText.includes("members");
}

function isDiscussionMyListText(text) {
  return matchesMessageText(text, ["discussionMyList"]);
}

function isDiscussionLeaveText(text) {
  const plainText = getPlainKeyboardText(text);
  return matchesMessageText(text, ["discussionLeave"]) || (plainText.includes("خروج") && plainText.includes("بحث")) || plainText.includes("leave discussion");
}

function isDiscussionCloseText(text) {
  const plainText = getPlainKeyboardText(text);
  return matchesMessageText(text, ["discussionCloseButton"]) || (plainText.includes("بستن") && plainText.includes("بحث")) || plainText.includes("close discussion");
}

function isDiscussionInviteText(text) {
  const plainText = getPlainKeyboardText(text);
  return matchesMessageText(text, ["discussionInvite"]) || plainText.includes("دعوت") || plainText.includes("invite");
}

function isDiscussionCloseConfirmText(text) {
  return matchesMessageText(text, ["discussionCloseConfirmCommand"]);
}

function isDiscussionCloseCancelText(text) {
  return matchesMessageText(text, ["discussionCloseCancelCommand"]);
}

function isDiscussionReturnToMenuText(text) {
  const normalizedText = normalizeKeyboardText(text);
  const legacyLabels = [
    "💬 منوی بحث‌ها",
    "💬 Discussions menu",
  ].map(normalizeKeyboardText);
  const plainText = getPlainKeyboardText(text);
  return (
    matchesMessageText(text, ["discussionReturnToMenu"]) ||
    legacyLabels.includes(normalizedText) ||
    (plainText.includes("منوی") && plainText.includes("بحث")) ||
    (plainText.includes("discussion") && plainText.includes("menu"))
  );
}

function isDiscussionBottomControlText(text) {
  return (
    isDiscussionReturnToMenuText(text) ||
    isDiscussionMembersText(text) ||
    isDiscussionInviteText(text) ||
    isDiscussionLeaveText(text) ||
    isDiscussionCloseText(text)
  );
}

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function formatDiscussionLeftMessage(lang, discussionTitle = "") {
  return messages[lang].discussionLeft.replace("{title}", discussionTitle || "-");
}

function formatDiscussionClosedMessage(lang, discussionTitle = "") {
  return messages[lang].discussionClosed.replace("{title}", discussionTitle || "-");
}

async function replyWithDiscussionMenu(ctx, lang, text, { removeKeyboard = false } = {}) {
  await ctx.reply(text, removeKeyboard ? { reply_markup: { remove_keyboard: true } } : undefined);
  return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
}

function normalizeProfileCodeFromActionCommand(value) {
  const raw = String(value || "").trim().replace(/^\/?(remove|report|save|unsave)_/i, "");
  return normalizePublicProfileCode(raw.startsWith("u_") ? raw : `u_${raw}`);
}

async function rememberDiscussionListMessage(ctx, listType, message) {
  const messageId = getMessageId(message);
  if (!messageId) return;
  await updateProfileField(ctx.userId, "discussionLastListMessageId", messageId);
  await updateProfileField(ctx.userId, "discussionLastListType", listType);
}

async function clearRememberedDiscussionListMessage(ctx) {
  const messageId = Number(ctx.user?.discussionLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "discussionLastListMessageId", null);
    await updateProfileField(ctx.userId, "discussionLastListType", "");
  }
  return deleted;
}

async function rememberDiscussionMenuNotice(ctx, message) {
  const messageId = getMessageId(message);
  if (!messageId) return;
  await updateProfileField(ctx.userId, "discussionMenuNoticeMessageId", messageId);
}

async function clearDiscussionMenuNotice(ctx) {
  const messageId = Number(ctx.user?.discussionMenuNoticeMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    await updateProfileField(ctx.userId, "discussionMenuNoticeMessageId", null);
  }
  return deleted;
}

async function sendDiscussionCreatePrompt(ctx, text, keyboard) {
  await clearDiscussionMenuNotice(ctx);
  const sent = await ctx.reply(text, keyboard);
  await rememberDiscussionMenuNotice(ctx, sent);
  return sent;
}

async function sendDiscussionRoomFromText(ctx, lang, discussion) {
  await ctx.reply(formatDiscussionRoom(messages, lang, discussion));
  return ctx.reply(
    `${formatRecentDiscussionMessages(messages, lang, discussion)}\n\n${messages[lang].discussionRoomSendHint}`,
    discussionRoomKeyboard(lang, discussion.creatorUserId === ctx.userId),
  );
}

async function sendRememberedDiscussionList(ctx, lang, preferredType = "active") {
  const listType = preferredType === "mine" ? "mine" : "active";
  if (listType === "mine") {
    const result = await listMyDiscussions(ctx.userId, { limit: 20 });
    if (!result.ok || !result.discussions.length) {
      const sentEmpty = await ctx.reply(messages[lang].discussionListMineEmpty);
      return rememberDiscussionListMessage(ctx, "mine", sentEmpty);
    }
    const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, true);
    const paged = paginateDiscussions(decorated, 0);
    const sent = await ctx.reply(
      buildDiscussionListText(messages, lang, messages[lang].discussionMyList, paged.items, {
        startIndex: paged.startIndex,
      }),
      discussionListNavigationKeyboard(lang, {
        listType: "mine",
        page: paged.page,
        totalPages: paged.totalPages,
      }),
    );
    return rememberDiscussionListMessage(ctx, "mine", sent);
  }

  const result = await listActiveDiscussions({ limit: 100 });
  if (!result.discussions.length) {
    const sentEmpty = await ctx.reply(messages[lang].discussionListEmpty);
    return rememberDiscussionListMessage(ctx, "active", sentEmpty);
  }
  const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, false);
  const paged = paginateDiscussions(decorated, 0);
  const sent = await ctx.reply(
    buildDiscussionListText(messages, lang, messages[lang].discussionActiveList, paged.items, {
      startIndex: paged.startIndex,
    }),
    discussionListNavigationKeyboard(lang, {
      listType: "active",
      page: paged.page,
      totalPages: paged.totalPages,
      joinableOnly: false,
    }),
  );
  return rememberDiscussionListMessage(ctx, "active", sent);
}

async function refreshDiscussionListAfterFailedJoin(ctx, lang, reason) {
  await clearRememberedDiscussionListMessage(ctx);
  const listType = ctx.user?.discussionLastListType || "active";
  const errorNotice = await ctx.reply(
    getDiscussionErrorMessage(messages, lang, reason),
    discussionJoinErrorAckKeyboard(lang, listType)
  );
  await rememberDiscussionMenuNotice(ctx, errorNotice);
}

async function handleDiscussionBottomButton(ctx, lang, text) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");

  if (isDiscussionMembersText(text)) {
    if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);
    await clearDiscussionMembersMessage(ctx);

    const opened = await joinOrSwitchActiveDiscussion(ctx.userId, activeDiscussionId);
    if (!opened.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, opened.reason));
    const memberUsers = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName publicProfileCode")
      .lean();
    await Promise.all(memberUsers.map((entry) => ensurePublicProfileCode(entry.userId)));
    const refreshed = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName publicProfileCode")
      .lean();
    const rows = formatDiscussionMemberLines(messages, lang, refreshed, opened.discussion.creatorUserId, ctx.userId, opened.discussion._id);
    const sent = await ctx.reply(`${messages[lang].discussionMembersTitle}\n\n${rows.join("\n")}`);
    await rememberDiscussionMembersMessage(ctx, sent);
    return sent;
  }

  if (isDiscussionInviteText(text)) {
    if (!activeDiscussionId) {
      await ctx.reply(messages[lang].discussionInviteNoActive, {
        reply_markup: { remove_keyboard: true },
      });
      return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    }

    const invite = await getActiveDiscussionInviteForUser(ctx.userId, activeDiscussionId);
    if (!invite.ok) {
      const textByReason = invite.reason === "not_member"
        ? messages[lang].discussionInviteNotMember
        : getDiscussionErrorMessage(messages, lang, invite.reason);
      await ctx.reply(textByReason, { reply_markup: { remove_keyboard: true } });
      return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    }

    const cleanCode = String(invite.code || "").replace(/^d_/i, "");
    const deepLink = buildBotStartLink(`join_${cleanCode}`);
    await ctx.reply(messages[lang].discussionInviteReady);
    return ctx.reply(buildDiscussionInviteShareText(messages, lang, invite.discussion, invite.code, { deepLink }));
  }

  if (isDiscussionMyListText(text)) {
    const result = await listMyDiscussions(ctx.userId, { limit: 20 });
    if (!result.ok) return ctx.reply(messages[lang].unknownAction);
    if (!result.discussions.length) return ctx.reply(messages[lang].discussionListMineEmpty);
    const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, true);
    const sent = await ctx.reply(buildDiscussionListText(messages, lang, messages[lang].discussionMyList, decorated));
    await rememberDiscussionListMessage(ctx, "mine", sent);
    return sent;
  }

  if (isDiscussionReturnToMenuText(text)) {
    if (!activeDiscussionId) {
      const notice = await ctx.reply(messages[lang].discussionReturnedToMenu, {
        reply_markup: { remove_keyboard: true, selective: false },
      });
      await rememberDiscussionMenuNotice(ctx, notice);
      return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
    }

    const left = await leaveDiscussionAndNotify({ ctx, messages, discussionId: activeDiscussionId });
    await clearDiscussionMembersMessage(ctx);
    const textToShow = left.ok
      ? formatDiscussionLeftMessage(lang, left?.discussionTitle || "")
      : messages[lang].discussionReturnedToMenu;
    return replyWithDiscussionMenu(ctx, lang, textToShow, { removeKeyboard: true });
  }

  if (isDiscussionLeaveText(text)) {
    if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

    const left = await leaveDiscussionAndNotify({ ctx, messages, discussionId: activeDiscussionId });
    if (!left.ok) {
      return ctx.reply(messages[lang].discussionNotMember);
    }
    await clearDiscussionMembersMessage(ctx);
    return replyWithDiscussionMenu(
      ctx,
      lang,
      formatDiscussionLeftMessage(lang, left?.discussionTitle || ""),
      { removeKeyboard: true },
    );
  }

  if (isDiscussionCloseText(text)) {
    if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);
    const sent = await ctx.reply(messages[lang].discussionCloseConfirmPrompt, {
      reply_markup: {
        keyboard: [
          [{ text: messages[lang].discussionCloseConfirmCommand }],
          [{ text: messages[lang].discussionCloseCancelCommand }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
        selective: true,
      },
    });
    await updateUserState(ctx.userId, `discussion_close_confirm:${activeDiscussionId}:${getMessageId(sent) || ""}:room`);
    return sent;
  }

  return null;
}

async function openDiscussionCommand(ctx, lang, code) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion) return ctx.reply(messages[lang].discussionErrMissingDiscussion);

  const joined = await joinDiscussionAndNotify({ ctx, messages, discussionId: discussion._id });
  if (!joined.ok) return refreshDiscussionListAfterFailedJoin(ctx, lang, joined.reason);

  await clearRememberedDiscussionListMessage(ctx);
  await clearDiscussionMenuNotice(ctx);
  await ctx.reply(joined.joined ? messages[lang].discussionJoined : messages[lang].discussionSwitched);
  return sendDiscussionRoomFromText(ctx, lang, joined.discussion);
}

async function showDiscussionInvitePreviewCommand(ctx, lang, code, {
  editMessage = null,
  keyboard = null,
  openExistingMember = true,
} = {}) {
  const preview = await getDiscussionInvitePreviewByCode(code);
  if (!preview.ok) {
    const unavailableText = messages[lang].discussionInviteUnavailable;
    await ctx.reply(unavailableText, { reply_markup: { remove_keyboard: true } });
    return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
  }

  const publicCode = preview.code || preview.discussion.publicDiscussionCode;
  if (openExistingMember && (preview.discussion.memberUserIds || []).includes(Number(ctx.userId))) {
    return joinDiscussionFromInvite(ctx, lang, publicCode);
  }

  const text = buildDiscussionInvitePreviewText(messages, lang, preview.discussion);
  const inviteKeyboard = keyboard || discussionInvitePreviewKeyboard(lang, publicCode);
  if (editMessage) {
    return editMessage(text, inviteKeyboard);
  }
  return ctx.reply(text, inviteKeyboard);
}

async function joinDiscussionFromInvite(ctx, lang, code, {
  editMessage = null,
  clearListMessage = null,
  clearMenuNotice = null,
  sendRoom = null,
} = {}) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion || discussion.status !== "open") {
    const text = messages[lang].discussionInviteUnavailable;
    if (editMessage) {
      await editMessage(text, mainMenuKeyboard(lang));
    } else {
      await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
      await ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
    }
    return { ok: false, reason: "missing_discussion" };
  }

  const wasActiveInDiscussion = String(ctx.user?.activeDiscussionId || "") === String(discussion._id);
  const joined = await joinDiscussionAndNotify({ ctx, messages, discussionId: discussion._id });
  if (!joined.ok) {
    let text = getDiscussionErrorMessage(messages, lang, joined.reason);
    let keyboardToShow = discussionsMenuKeyboard(lang);
    let returnToMainMenu = false;

    if (joined.reason === "discussion_full") {
      text = messages[lang].discussionInviteFull;
    } else if (joined.reason === "removed_by_owner") {
      text = messages[lang].discussionErrRemovedByOwner;
      keyboardToShow = mainMenuKeyboard(lang);
      returnToMainMenu = true;
    } else if (
      joined.reason === "requires_taste_label" ||
      joined.reason === "requires_top_ten_item" ||
      joined.reason === "requires_top_ten_completed"
    ) {
      text = buildDiscussionInviteLockedText(messages, lang, joined.reason, discussion);
      keyboardToShow = mainMenuKeyboard(lang);
      returnToMainMenu = true;
    }

    if (editMessage) {
      await editMessage(text, keyboardToShow);
    } else {
      const destination = returnToMainMenu ? "main" : "discussions";
      await ctx.reply(text, {
        reply_markup: { remove_keyboard: true },
      });
      await ctx.reply(text, discussionJoinErrorAckKeyboard(lang, destination));
    }
    return joined;
  }

  await clearListMessage?.();
  await clearMenuNotice?.();
  const statusText = joined.joined
    ? messages[lang].discussionJoined
    : (wasActiveInDiscussion ? messages[lang].discussionInviteAlreadyMember : messages[lang].discussionSwitched);
  await ctx.reply(statusText);
  if (sendRoom) return sendRoom(ctx, lang, joined.discussion);
  return sendDiscussionRoomFromText(ctx, lang, joined.discussion);
}

async function leaveDiscussionCommand(ctx, lang, code) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion) return ctx.reply(messages[lang].discussionErrMissingDiscussion);

  const left = await leaveDiscussionAndNotify({ ctx, messages, discussionId: discussion._id });
  if (!left.ok) {
    return ctx.reply(getDiscussionErrorMessage(messages, lang, left.reason));
  }
  await clearDiscussionMembersMessage(ctx);
  await clearRememberedDiscussionListMessage(ctx);
  return replyWithDiscussionMenu(ctx, lang, formatDiscussionLeftMessage(lang, left.discussionTitle), { removeKeyboard: true });
}

async function closeDiscussionCommand(ctx, lang, code) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion) return ctx.reply(messages[lang].discussionErrMissingDiscussion);
  const sent = await ctx.reply(messages[lang].discussionCloseConfirmPrompt, {
    reply_markup: {
      keyboard: [
        [{ text: messages[lang].discussionCloseConfirmCommand }],
        [{ text: messages[lang].discussionCloseCancelCommand }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  });
  await updateUserState(ctx.userId, `discussion_close_confirm:${discussion._id}:${getMessageId(sent) || ""}:list`);
  return sent;
}

async function removeDiscussionMemberCommand(ctx, lang, text) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
  if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

  const code = normalizeProfileCodeFromActionCommand(text);
  const member = code ? await User.findOne({ publicProfileCode: code }).select("userId").lean() : null;
  const memberUserId = Number(member?.userId);
  if (!Number.isInteger(memberUserId)) return ctx.reply(getDiscussionErrorMessage(messages, lang, "not_member"));

  const removed = await removeDiscussionMemberAndNotify({
    ctx,
    messages,
    discussionId: activeDiscussionId,
    memberUserId,
    discussionsMenuKeyboard,
  });
  if (!removed.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, removed.reason));
  return ctx.reply(messages[lang].discussionMemberRemoved.replace("{name}", removed.removedMemberName || "Member"));
}

async function reportDiscussionMemberCommand(ctx, lang, text) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
  if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

  const code = normalizeProfileCodeFromActionCommand(text);
  const member = code ? await User.findOne({ publicProfileCode: code }).select("userId").lean() : null;
  const memberUserId = Number(member?.userId);
  if (!Number.isInteger(memberUserId)) return ctx.reply(getDiscussionErrorMessage(messages, lang, "not_member"));

  const reported = await reportDiscussionMember(ctx.userId, activeDiscussionId, memberUserId);
  if (!reported.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, reported.reason));
  return ctx.reply(messages[lang].discussionReportSent);
}

async function closeDiscussionFromTextConfirmation({ ctx, lang, parsed }) {
  if (isDiscussionCloseCancelText(ctx.text)) {
    await updateUserState(ctx.userId, "idle");
    if (parsed.messageId && ctx.deleteMessage) {
      await ctx.deleteMessage(parsed.messageId);
    }
    if (parsed.source === "list") {
      const previousListType = ctx.user?.discussionLastListType || "active";
      await ctx.reply(messages[lang].discussionCloseCanceled, {
        reply_markup: { remove_keyboard: true },
      });
      return sendRememberedDiscussionList(ctx, lang, previousListType);
    }
    const opened = await joinOrSwitchActiveDiscussion(ctx.userId, parsed.discussionId || String(ctx.user?.activeDiscussionId || ""));
    if (!opened.ok) {
      return replyWithDiscussionMenu(ctx, lang, messages[lang].discussionReturnedToMenu, { removeKeyboard: true });
    }
    return ctx.reply(messages[lang].discussionCloseCanceled, discussionRoomKeyboard(lang, opened.discussion.creatorUserId === ctx.userId));
  }

  if (!isDiscussionCloseConfirmText(ctx.text)) {
    return ctx.reply(messages[lang].discussionSelectOptionPrompt);
  }

  const discussionId = parsed.discussionId || String(ctx.user?.activeDiscussionId || "");
  if (!discussionId) {
    await updateUserState(ctx.userId, "idle");
    return replyWithDiscussionMenu(ctx, lang, messages[lang].discussionNotMember, { removeKeyboard: true });
  }

  const closed = await closeDiscussionAndNotify({ ctx, messages, discussionId, discussionsMenuKeyboard });
  if (!closed.ok) {
    await updateUserState(ctx.userId, "idle");
    return replyWithDiscussionMenu(ctx, lang, getDiscussionErrorMessage(messages, lang, closed.reason), { removeKeyboard: true });
  }
  if (parsed.messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(parsed.messageId);
  }
  const previousListType = ctx.user?.discussionLastListType || "active";
  await clearDiscussionMembersMessage(ctx);
  await clearRememberedDiscussionListMessage(ctx);
  await updateUserState(ctx.userId, "idle");
  if (parsed.source === "list") {
    await ctx.reply(formatDiscussionClosedMessage(lang, closed.discussionTitle), {
      reply_markup: { remove_keyboard: true },
    });
    return sendRememberedDiscussionList(ctx, lang, previousListType);
  }
  return replyWithDiscussionMenu(ctx, lang, formatDiscussionClosedMessage(lang, closed.discussionTitle), { removeKeyboard: true });
}

module.exports = {
  matchesMessageText,
  isDiscussionBottomControlText,
  handleDiscussionBottomButton,
  clearDiscussionMenuNotice,
  rememberDiscussionMenuNotice,
  sendDiscussionCreatePrompt,
  closeDiscussionFromTextConfirmation,
  openDiscussionCommand,
  showDiscussionInvitePreviewCommand,
  joinDiscussionFromInvite,
  leaveDiscussionCommand,
  closeDiscussionCommand,
  removeDiscussionMemberCommand,
  reportDiscussionMemberCommand,
};
