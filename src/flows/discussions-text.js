const messages = require("../messages");
const {
  mainMenuKeyboard,
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionInviteModeKeyboard,
  discussionRoomKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
} = require("../keyboards");
const User = require("../models/user");
const {
  ensurePublicProfileCodes,
  findDiscussionByPublicCode,
  getActiveDiscussionInviteForUser,
  getDiscussionInvitePreviewByCode,
  joinOrOpenDiscussion,
  listActiveDiscussions,
  listMyDiscussions,
  normalizeMaxMembers,
  normalizePublicProfileCode,
  validateJoinRules,
} = require("../services/discussions");
const {
  closeDiscussionAndNotify,
  joinDiscussionAndNotify,
  leaveDiscussionAndNotify,
  removeDiscussionMemberAndNotify,
  reportDiscussionMemberAndNotify,
} = require("../services/discussion-actions");
const {
  getDiscussionErrorMessage,
  buildDiscussionInviteLockedText,
  buildDiscussionJoinLockedText,
  buildDiscussionInvitePreviewText,
  buildDiscussionInviteShareText,
  decorateDiscussionsForList,
  rankDiscussionsForDiscovery,
  paginateDiscussions,
  buildDiscussionListText,
  getDiscussionDisplayTitle,
} = require("../services/discussion-ui");
const {
  formatDiscussionRoomFollowup,
  formatDiscussionMemberLines,
  formatDiscussionRoom,
} = require("../services/discussion-room-ui");
const { buildBotStartLink } = require("../services/invite-links");
const { createReferralLink } = require("../services/star-referrals");
const { awardSavedInvitePair } = require("../services/star-invitations");
const {
  applyStarRewardsToContext,
  buildStarRewardNotice,
} = require("../services/stars-ui");
const { updateProfileField, updateUserFields, updateUserState } = require("../services/users");
const {
  buildDiscussionOpenNameGate,
  requireDiscussionProfileName,
} = require("./discussion-name-gate");
const { isDiscussionBoostText, showBoostQuote } = require("./discussion-boosts");
const { sendTasteSetupNudge } = require("./onboarding");
const {
  clearRememberedDiscussionRoomCards,
  clearDiscussionMembersMessage,
  rememberDiscussionMembersMessage,
} = require("./discussions-callbacks");
const { replyWithKeyboardRemovalNoticeThenInline } = require("../services/bot-navigation");
const { sendNavigationFootprint } = require("../services/navigation-footprints");

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
    isDiscussionBoostText(text) ||
    isDiscussionLeaveText(text) ||
    isDiscussionCloseText(text)
  );
}

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function formatDiscussionLeftMessage(lang, discussion = {}) {
  return messages[lang].discussionLeft.replace(
    "{title}",
    getDiscussionDisplayTitle(messages, lang, discussion) || "-",
  );
}

function formatDiscussionClosedMessage(lang, discussion = {}) {
  return messages[lang].discussionClosed.replace(
    "{title}",
    getDiscussionDisplayTitle(messages, lang, discussion) || "-",
  );
}

async function replyWithDiscussionMenu(ctx, lang, text, { removeKeyboard = false } = {}) {
  await ctx.reply(text, removeKeyboard ? { reply_markup: { remove_keyboard: true } } : undefined);
  return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
}

async function enterDiscussionsAfterRoomExit(ctx, lang, left = null) {
  await clearRememberedDiscussionRoomCards(ctx);
  await clearDiscussionMembersMessage(ctx);
  if (left?.ok && left.discussion) {
    await ctx.reply(formatDiscussionLeftMessage(lang, left.discussion));
  }
  await sendNavigationFootprint(ctx, {
    lang,
    destination: "discussions",
    removeKeyboard: true,
  });
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
  let messageId = Number(ctx.user?.discussionLastListMessageId);
  if ((!Number.isInteger(messageId) || messageId <= 0) && ctx.userId) {
    const freshUser = await User.findOne({ userId: ctx.userId })
      .select("discussionLastListMessageId discussionLastListType")
      .lean();
    messageId = Number(freshUser?.discussionLastListMessageId);
    if (ctx.user && freshUser?.discussionLastListType) {
      ctx.user.discussionLastListType = freshUser.discussionLastListType;
    }
  }
  if (!Number.isInteger(messageId) || messageId <= 0 || !ctx.deleteMessage) {
    return false;
  }
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted === false) return false;
  if (ctx.user) {
    ctx.user.discussionLastListMessageId = null;
    ctx.user.discussionLastListType = "";
  }
  await updateProfileField(ctx.userId, "discussionLastListMessageId", null);
  await updateProfileField(ctx.userId, "discussionLastListType", "");
  return true;
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
  await sendNavigationFootprint(ctx, { lang, destination: "discussion", discussion });
  await ctx.reply(formatDiscussionRoom(messages, lang, discussion));
  return ctx.reply(
    formatDiscussionRoomFollowup(messages, lang, discussion),
    discussionRoomKeyboard(lang, discussion.creatorUserId === ctx.userId),
  );
}

async function sendShareableInviteForActiveDiscussion(ctx, lang) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
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
  const legacyDeepLink = buildBotStartLink(`join_${cleanCode}`);
  let deepLink = legacyDeepLink;
  if (legacyDeepLink) {
    const referral = await createReferralLink({
      inviterUserId: ctx.userId,
      discussionId: invite.discussion._id,
      discussionPublicCode: invite.code,
      source: "discussion_share",
    });
    if (referral.ok) deepLink = buildBotStartLink(`ref_${referral.link.publicCode}`) || legacyDeepLink;
  }
  await ctx.reply(messages[lang].discussionInviteReady);
  return ctx.reply(buildDiscussionInviteShareText(messages, lang, invite.discussion, invite.code, { deepLink }));
}

async function sendRememberedDiscussionList(ctx, lang, preferredType = "active") {
  const listType = preferredType === "mine" ? "mine" : "active";
  if (listType === "mine") {
    const result = await listMyDiscussions(ctx.userId, { limit: 20 });
    if (!result.ok || !result.discussions.length) {
      const sentEmpty = await ctx.reply(
        messages[lang].discussionListMineEmpty,
        discussionJoinErrorAckKeyboard(lang, "discussions"),
      );
      return rememberDiscussionMenuNotice(ctx, sentEmpty);
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

  const languageFilter = require("../services/discussion-language").getEffectiveDiscussionLanguageFilter(ctx.user);
  const result = await listActiveDiscussions({ userId: ctx.userId, limit: 100, languageFilter });
  if (!result.discussions.length) {
    const sentEmpty = await ctx.reply(messages[lang].discussionListEmpty);
    return rememberDiscussionListMessage(ctx, "active", sentEmpty);
  }
  const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, false);
  const ranked = await rankDiscussionsForDiscovery(ctx.user, decorated);
  const paged = paginateDiscussions(ranked, 0);
  const sent = await ctx.reply(
    buildDiscussionListText(messages, lang, messages[lang].discussionActiveList, paged.items, {
      startIndex: paged.startIndex,
    }),
    discussionListNavigationKeyboard(lang, {
      listType: "active",
      page: paged.page,
      totalPages: paged.totalPages,
      joinableOnly: false,
      languageFilter,
    }),
  );
  return rememberDiscussionListMessage(ctx, "active", sent);
}

async function refreshDiscussionListAfterFailedJoin(ctx, lang, reason, discussion = null) {
  const listType = ctx.user?.discussionLastListType || "active";
  await clearRememberedDiscussionListMessage(ctx);
  const errorNotice = await ctx.reply(
    buildDiscussionJoinLockedText(messages, lang, reason, discussion),
    discussionJoinErrorAckKeyboard(lang, listType)
  );
  await rememberDiscussionMenuNotice(ctx, errorNotice);
}

async function handleDiscussionBottomButton(ctx, lang, text) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");

  if (isDiscussionMembersText(text)) {
    if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);
    await clearDiscussionMembersMessage(ctx);

    const opened = await joinOrOpenDiscussion(ctx.userId, activeDiscussionId);
    if (!opened.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, opened.reason));
    const memberUsers = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName profileEmoji publicProfileCode")
      .lean();
    const preparedMembers = await ensurePublicProfileCodes(memberUsers);
    const rows = formatDiscussionMemberLines(messages, lang, preparedMembers, opened.discussion.creatorUserId, ctx.userId, opened.discussion._id);
    const sent = await ctx.reply(`${messages[lang].discussionMembersTitle}\n\n${rows.join("\n")}`);
    await rememberDiscussionMembersMessage(ctx, sent);
    return sent;
  }

  if (isDiscussionBoostText(text)) {
    return showBoostQuote(ctx, lang);
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

    return ctx.reply(
      messages[lang].discussionInviteModeText.replace(
        "{title}",
        getDiscussionDisplayTitle(messages, lang, invite.discussion),
      ),
      discussionInviteModeKeyboard(lang),
    );
  }

  if (isDiscussionMyListText(text)) {
    const result = await listMyDiscussions(ctx.userId, { limit: 20 });
    if (!result.ok) return ctx.reply(messages[lang].unknownAction);
    if (!result.discussions.length) {
      const emptyNotice = await ctx.reply(
        messages[lang].discussionListMineEmpty,
        discussionJoinErrorAckKeyboard(lang, "discussions"),
      );
      await rememberDiscussionMenuNotice(ctx, emptyNotice);
      return emptyNotice;
    }
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
    return enterDiscussionsAfterRoomExit(ctx, lang, left);
  }

  if (isDiscussionLeaveText(text)) {
    if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

    const left = await leaveDiscussionAndNotify({ ctx, messages, discussionId: activeDiscussionId });
    if (!left.ok) {
      return ctx.reply(messages[lang].discussionNotMember);
    }
    return enterDiscussionsAfterRoomExit(ctx, lang, left);
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
  const publicCode = discussion.publicDiscussionCode || code;
  const nameGate = buildDiscussionOpenNameGate(ctx, publicCode);

  if (!await requireDiscussionProfileName(ctx, lang, {
    source: nameGate.source,
    token: nameGate.token,
    beforePrompt: () => clearRememberedDiscussionListMessage(ctx),
  })) {
    return { ok: false, reason: "requires_profile_name" };
  }

  const joined = await joinDiscussionAndNotify({ ctx, messages, discussionId: discussion._id });
  if (!joined.ok) return refreshDiscussionListAfterFailedJoin(ctx, lang, joined.reason, discussion);

  await clearRememberedDiscussionListMessage(ctx);
  await clearDiscussionMenuNotice(ctx);
  applyStarRewardsToContext(ctx, joined.starRewards);
  const starNotice = buildStarRewardNotice(messages, lang, joined.starRewards);
  await ctx.reply([
    joined.joined ? messages[lang].discussionJoined : messages[lang].discussionOpened,
    starNotice,
  ].filter(Boolean).join("\n\n"));
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
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
  const activeElsewhere = Boolean(activeDiscussionId && activeDiscussionId !== String(preview.discussion._id));
  if (
    openExistingMember &&
    !activeElsewhere &&
    (preview.discussion.memberUserIds || []).includes(Number(ctx.userId))
  ) {
    return joinDiscussionFromInvite(ctx, lang, publicCode);
  }

  let blockedReason = "";
  if (activeElsewhere && !(preview.discussion.memberUserIds || []).includes(Number(ctx.userId))) {
    const isOwner = Number(preview.discussion.creatorUserId) === Number(ctx.userId);
    if (
      !isOwner &&
      Array.isArray(preview.discussion.removedUserIds) &&
      preview.discussion.removedUserIds.includes(Number(ctx.userId))
    ) {
      blockedReason = "removed_by_owner";
    } else if (!isOwner && (preview.discussion.memberUserIds || []).length >= normalizeMaxMembers(preview.discussion.maxMembers)) {
      blockedReason = "discussion_full";
    } else if (!isOwner) {
      const eligibility = await validateJoinRules({ user: ctx.user, joinRule: preview.discussion.joinRule });
      if (!eligibility.ok) blockedReason = eligibility.reason;
    }
  }

  const text = blockedReason === "discussion_full"
    ? messages[lang].discussionInviteFull
    : blockedReason === "removed_by_owner"
      ? messages[lang].discussionErrRemovedByOwner
      : blockedReason
        ? buildDiscussionInviteLockedText(messages, lang, blockedReason, preview.discussion)
        : buildDiscussionInvitePreviewText(messages, lang, preview.discussion);
  const inviteKeyboard = keyboard || discussionInvitePreviewKeyboard(lang, publicCode, {
    activeElsewhere,
    cancelOnly: Boolean(blockedReason),
  });
  if (editMessage) {
    return editMessage(text, inviteKeyboard);
  }
  return ctx.reply(text, inviteKeyboard);
}

async function joinDiscussionFromInvite(ctx, lang, code, {
  editMessage = null,
  clearListMessage = null,
  clearMenuNotice = null,
  clearInvitePreview = null,
  sendRoom = null,
  allowActiveSwitch = false,
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

  const publicCode = discussion.publicDiscussionCode || code;
  if (!await requireDiscussionProfileName(ctx, lang, { source: "join", token: publicCode })) {
    return { ok: false, reason: "requires_profile_name" };
  }

  const joined = await joinDiscussionAndNotify({
    ctx,
    messages,
    discussionId: discussion._id,
    allowActiveSwitch,
  });
  if (!joined.ok) {
    let text = getDiscussionErrorMessage(messages, lang, joined.reason);
    let keyboardToShow = discussionsMenuKeyboard(lang);
    let returnToMainMenu = false;

    if (joined.reason === "discussion_full") {
      text = messages[lang].discussionInviteFull;
    } else if (joined.reason === "leave_current_first") {
      keyboardToShow = discussionInvitePreviewKeyboard(lang, publicCode, { activeElsewhere: true });
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
      keyboardToShow = allowActiveSwitch
        ? discussionInvitePreviewKeyboard(lang, publicCode, { cancelOnly: true })
        : mainMenuKeyboard(lang);
      returnToMainMenu = !allowActiveSwitch;
    }

    if (editMessage) {
      await editMessage(text, keyboardToShow);
    } else {
      const destination = returnToMainMenu ? "main" : "discussions";
      const footprint = returnToMainMenu
        ? messages[lang].navigationFootprintMainMenu
        : messages[lang].navigationFootprintDiscussions;
      await replyWithKeyboardRemovalNoticeThenInline(
        ctx,
        footprint,
        text,
        discussionJoinErrorAckKeyboard(lang, destination),
      );
    }
    return joined;
  }

  await clearListMessage?.();
  await clearMenuNotice?.();
  try {
    await clearInvitePreview?.();
  } catch {
    // Preview cleanup is best-effort; joining feedback and room rendering should continue.
  }
  if (ctx.user) ctx.user.activeDiscussionId = joined.discussion._id;
  const pendingShareCode = String(ctx.user?.pendingDiscussionShareCode || "");
  const pendingShareInviterUserId = Number(ctx.user?.pendingDiscussionShareInviterUserId);
  const pendingShareMatches = pendingShareCode.toLowerCase() === String(publicCode || "").toLowerCase();
  if (
    joined.joined &&
    pendingShareCode &&
    pendingShareMatches &&
    Number.isInteger(pendingShareInviterUserId) &&
    pendingShareInviterUserId > 0 &&
    pendingShareInviterUserId !== Number(ctx.userId)
  ) {
    const inviterReward = await awardSavedInvitePair({
      inviterUserId: pendingShareInviterUserId,
      inviteeUserId: ctx.userId,
      invitationId: null,
      source: "discussion_share",
    });
    if (inviterReward.ok && inviterReward.applied) {
      const inviter = await User.findOne({ userId: pendingShareInviterUserId }).select("lang").lean();
      const inviterLang = messages[inviter?.lang] ? inviter.lang : "fa";
      const inviterNotice = buildStarRewardNotice(messages, inviterLang, [{
        milestone: "invite_pair_reward",
        amount: inviterReward.transaction.amount,
        balance: inviterReward.balance,
      }]);
      if (inviterNotice) await ctx.sendToUser?.(pendingShareInviterUserId, inviterNotice);
    }
  }
  if (pendingShareCode && pendingShareMatches) {
    const clearedShare = {
      pendingDiscussionShareInviterUserId: null,
      pendingDiscussionShareCode: "",
      pendingDiscussionShareAt: null,
    };
    Object.assign(ctx.user || {}, clearedShare);
    await updateUserFields(ctx.userId, clearedShare);
  }
  applyStarRewardsToContext(ctx, joined.starRewards);
  const starNotice = buildStarRewardNotice(messages, lang, joined.starRewards);
  if (starNotice) await ctx.reply(starNotice);
  const roomMessage = sendRoom
    ? await sendRoom(ctx, lang, joined.discussion)
    : await sendDiscussionRoomFromText(ctx, lang, joined.discussion);
  await sendTasteSetupNudge(ctx, lang).catch(() => null);
  return roomMessage;
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
  return replyWithDiscussionMenu(ctx, lang, formatDiscussionLeftMessage(lang, left.discussion), { removeKeyboard: true });
}

async function closeDiscussionCommand(ctx, lang, code) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion) return ctx.reply(messages[lang].discussionErrMissingDiscussion);
  const listSource = ctx.user?.discussionLastListType === "mine" ? "mine" : "active";
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
  await updateUserState(ctx.userId, `discussion_close_confirm:${discussion._id}:${getMessageId(sent) || ""}:${listSource}`);
  return sent;
}

async function boostDiscussionCommand(ctx, lang, code) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion) return ctx.reply(messages[lang].discussionErrMissingDiscussion);
  await clearRememberedDiscussionListMessage(ctx);
  return showBoostQuote(ctx, lang, discussion._id, "mine");
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

  const reported = await reportDiscussionMemberAndNotify({
    ctx,
    messages,
    discussionId: activeDiscussionId,
    memberUserId,
  });
  if (!reported.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, reported.reason));
  return ctx.reply(messages[lang].discussionReportSent);
}

async function closeDiscussionFromTextConfirmation({ ctx, lang, parsed }) {
  if (isDiscussionCloseCancelText(ctx.text)) {
    await updateUserState(ctx.userId, "idle");
    if (parsed.messageId && ctx.deleteMessage) {
      await ctx.deleteMessage(parsed.messageId);
    }
    if (["list", "active", "mine"].includes(parsed.source)) {
      const previousListType = parsed.source === "list"
        ? (ctx.user?.discussionLastListType || "active")
        : parsed.source;
      await ctx.reply(messages[lang].discussionCloseCanceled, {
        reply_markup: { remove_keyboard: true },
      });
      return sendRememberedDiscussionList(ctx, lang, previousListType);
    }
    const opened = await joinOrOpenDiscussion(ctx.userId, parsed.discussionId || String(ctx.user?.activeDiscussionId || ""));
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
  if (["list", "active", "mine"].includes(parsed.source)) {
    const sourceListType = parsed.source === "list" ? previousListType : parsed.source;
    const remainingList = sourceListType === "mine"
      ? await listMyDiscussions(ctx.userId, { limit: 1 })
      : null;
    const noRemainingMineDiscussions = sourceListType === "mine" && remainingList?.ok && !remainingList.discussions.length;
    if (noRemainingMineDiscussions) {
      const closedEmptyText = messages[lang].discussionListMineEmptyAfterClose.replace(
        "{title}",
        closed.discussion?.title || "-",
      );
      const emptyNotice = await replyWithKeyboardRemovalNoticeThenInline(
        ctx,
        messages[lang].navigationFootprintDiscussions,
        closedEmptyText,
        discussionJoinErrorAckKeyboard(lang, "discussions"),
      );
      await rememberDiscussionMenuNotice(ctx, emptyNotice);
      return emptyNotice;
    }
    await ctx.reply(formatDiscussionClosedMessage(lang, closed.discussion), {
      reply_markup: { remove_keyboard: true },
    });
    return sendRememberedDiscussionList(ctx, lang, sourceListType);
  }

  return replyWithDiscussionMenu(ctx, lang, formatDiscussionClosedMessage(lang, closed.discussion), { removeKeyboard: true });
}

module.exports = {
  matchesMessageText,
  isDiscussionBottomControlText,
  handleDiscussionBottomButton,
  clearDiscussionMenuNotice,
  rememberDiscussionMenuNotice,
  sendDiscussionCreatePrompt,
  sendDiscussionRoomFromText,
  closeDiscussionFromTextConfirmation,
  openDiscussionCommand,
  showDiscussionInvitePreviewCommand,
  joinDiscussionFromInvite,
  sendShareableInviteForActiveDiscussion,
  leaveDiscussionCommand,
  closeDiscussionCommand,
  boostDiscussionCommand,
  removeDiscussionMemberCommand,
  reportDiscussionMemberCommand,
};
