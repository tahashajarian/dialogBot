const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  mainMenuKeyboard,
  discussionsMenuKeyboard,
  discussionListNavigationKeyboard,
  discussionInviteModeKeyboard,
  discussionInviteFullKeyboard,
  discussionCloseConfirmKeyboard,
  discussionMembersCloseKeyboard,
  discussionInvitePreviewKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionJoinLockedKeyboard,
  discussionLeaveCurrentNoticeKeyboard,
  discussionRemoveMemberConfirmKeyboard,
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
  listRecentJoinedDiscussions,
  normalizePublicProfileCode,
  resolveDiscussionMaxMembers,
  validateJoinRules,
} = require("../services/discussions");
const {
  closeDiscussionAndNotify,
  joinDiscussionAndNotify,
  leaveDiscussionAndNotify,
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
  buildDiscussionMembersText,
  formatDiscussionRoom,
  buildDiscussionRoomKeyboard,
} = require("../services/discussion-room-ui");
const { buildBotStartLink } = require("../services/invite-links");
const { createReferralLink } = require("../services/star-referrals");
const { markSharedLinkInvitationAccepted } = require("../services/discussion-invitations");
const { COPY_TEXT_LIMIT, buildNativeShareUrl, buildShareActionsKeyboard } = require("../services/share-actions");
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

function isDiscussionMembersText(text) {
  return matchesMessageText(text, ["discussionMembersTitle"]);
}

function isDiscussionMyListText(text) {
  return matchesMessageText(text, ["discussionMyList"]);
}

function isDiscussionLeaveText(text) {
  return matchesMessageText(text, ["discussionLeave"]);
}

function isDiscussionCloseText(text) {
  return matchesMessageText(text, ["discussionCloseButton"]);
}

function isDiscussionInviteText(text) {
  return matchesMessageText(text, ["discussionInvite"]);
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
    "💬 منوی گفت‌وگوها",
    "💬 Discussions menu",
  ].map(normalizeKeyboardText);
  return (
    matchesMessageText(text, ["discussionReturnToMenu"]) ||
    legacyLabels.includes(normalizedText)
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
  await updateProfileField(ctx.userId, "navigationMode", "discussions");
  if (ctx.user) ctx.user.navigationMode = "discussions";
  return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
}

async function enterDiscussionsAfterRoomExit(ctx, lang, left = null) {
  await Promise.all([
    clearRememberedDiscussionRoomCards(ctx),
    clearDiscussionMembersMessage(ctx),
    sendNavigationFootprint(ctx, {
      lang,
      destination: "discussions",
      removeKeyboard: true,
    }),
    updateProfileField(ctx.userId, "navigationMode", "discussions"),
  ]);
  if (ctx.user) ctx.user.navigationMode = "discussions";
  if (left?.ok && left.discussion) {
    await ctx.reply(formatDiscussionLeftMessage(lang, left.discussion), {
      reply_markup: { remove_keyboard: true },
    });
  }
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
  if (ctx.user) {
    ctx.user.discussionLastListMessageId = null;
    ctx.user.discussionLastListType = "";
  }
  await updateProfileField(ctx.userId, "discussionLastListMessageId", null);
  await updateProfileField(ctx.userId, "discussionLastListType", "");
  return true;
}

async function forgetRememberedDiscussionListMessage(ctx) {
  await updateProfileField(ctx.userId, "discussionLastListMessageId", null);
  if (ctx.user) ctx.user.discussionLastListMessageId = null;
}

async function rememberDiscussionMenuNotice(ctx, message) {
  const messageId = getMessageId(message);
  if (!messageId) return;
  await updateProfileField(ctx.userId, "discussionMenuNoticeMessageId", messageId);
}

async function clearDiscussionMenuNotice(ctx) {
  const messageId = Number(ctx.user?.discussionMenuNoticeMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return false;
  }
  // Creation uses mode-scoped reply keyboards. Once the server mode advances,
  // an old prompt is harmless history and does not need a Telegram delete.
  if (ctx.user) ctx.user.discussionMenuNoticeMessageId = null;
  await updateProfileField(ctx.userId, "discussionMenuNoticeMessageId", null);
  return true;
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
    await buildDiscussionRoomKeyboard(lang, discussion, ctx.userId),
  );
}

function buildDiscussionInviteSharePayload(lang, discussion, code, deepLink) {
  const shareText = buildDiscussionInviteShareText(messages, lang, discussion, code, { deepLink });
  let nativeText = buildDiscussionInviteShareText(messages, lang, discussion, code, { includeJoin: false }).trim();
  if (Array.from(`${nativeText}\n\n${deepLink}`).length > COPY_TEXT_LIMIT) {
    nativeText = buildDiscussionInviteShareText(
      messages,
      lang,
      { ...discussion, description: "" },
      code,
      { includeJoin: false },
    ).trim();
  }
  const availableTextLength = Math.max(1, COPY_TEXT_LIMIT - Array.from(`\n\n${deepLink}`).length);
  if (Array.from(nativeText).length > availableTextLength) {
    nativeText = `${Array.from(nativeText).slice(0, Math.max(1, availableTextLength - 1)).join("")}…`;
  }
  return {
    shareText,
    copyText: `${nativeText}\n\n${deepLink}`,
    shareUrl: buildNativeShareUrl({ url: deepLink, text: nativeText }),
  };
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
  const { shareText, shareUrl, copyText } = buildDiscussionInviteSharePayload(
    lang,
    invite.discussion,
    invite.code,
    deepLink,
  );
  const keyboard = buildShareActionsKeyboard({
    shareLabel: messages[lang].discussionInviteShareAction,
    shareUrl,
    copyLabel: messages[lang].discussionInviteCopyAction,
    copyText,
    backLabel: messages[lang].discussionShareClose,
    backCallback: `${callBacks.discussionInvitationAck}room`,
  });
  return ctx.reply(`${messages[lang].discussionInviteReady}\n\n${shareText}`, keyboard);
}

async function sendRememberedDiscussionList(ctx, lang, preferredType = "active") {
  const listType = preferredType === "mine" ? "mine" : "active";
  if (listType === "mine") {
    const [result, recentResult] = await Promise.all([
      listMyDiscussions(ctx.userId, { limit: 20 }),
      listRecentJoinedDiscussions(ctx.userId),
    ]);
    const hasRecentDiscussions = Boolean(recentResult.ok && recentResult.discussions.length);
    if (!result.ok || !result.discussions.length) {
      const sentEmpty = await ctx.reply(
        messages[lang].discussionListMineEmpty,
        discussionListNavigationKeyboard(lang, {
          listType: "mine",
          hasRecentDiscussions,
        }),
      );
      return rememberDiscussionMenuNotice(ctx, sentEmpty);
    }
    const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, true);
    const paged = paginateDiscussions(decorated, 0);
    const sent = await ctx.reply(
      buildDiscussionListText(messages, lang, messages[lang].discussionMyList, paged.items, {
        startIndex: paged.startIndex,
        totalCount: decorated.length,
        headerTip: hasRecentDiscussions
          ? messages[lang].discussionMyListTipWithRecent
          : messages[lang].discussionMyListTip,
      }),
      discussionListNavigationKeyboard(lang, {
        listType: "mine",
        page: paged.page,
        totalPages: paged.totalPages,
        hasRecentDiscussions,
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
  await forgetRememberedDiscussionListMessage(ctx);
  const errorNotice = await ctx.reply(
    buildDiscussionJoinLockedText(messages, lang, reason, discussion),
    discussionJoinLockedKeyboard(lang),
  );
  await rememberDiscussionMenuNotice(ctx, errorNotice);
}

async function handleDiscussionBottomButton(ctx, lang, text) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");

  if (isDiscussionMembersText(text)) {
    if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

    const opened = await joinOrOpenDiscussion(ctx.userId, activeDiscussionId);
    if (!opened.ok) return ctx.reply(getDiscussionErrorMessage(messages, lang, opened.reason));
    const memberUsers = await User.find({ userId: { $in: opened.discussion.memberUserIds } })
      .select("userId profileName firstName profileEmoji publicProfileCode")
      .lean();
    const preparedMembers = await ensurePublicProfileCodes(memberUsers);
    const rows = formatDiscussionMemberLines(messages, lang, preparedMembers, opened.discussion.creatorUserId, ctx.userId, opened.discussion._id);
    const memberText = buildDiscussionMembersText(messages, lang, rows);
    const sent = await ctx.reply(memberText, discussionMembersCloseKeyboard(lang));
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

    const capacity = resolveDiscussionMaxMembers(invite.discussion);
    if ((invite.discussion.memberUserIds || []).length >= capacity) {
      return ctx.reply(messages[lang].discussionInviteFull, discussionInviteFullKeyboard(lang));
    }

    return ctx.reply(
      messages[lang].discussionInviteModeText.replace(
        "{title}",
        getDiscussionDisplayTitle(messages, lang, invite.discussion),
      ),
      discussionInviteModeKeyboard(lang, {
        hasSavedProfiles: (ctx.user?.savedProfileCodes || []).length > 0,
      }),
    );
  }

  if (isDiscussionMyListText(text)) {
    const [result, recentResult] = await Promise.all([
      listMyDiscussions(ctx.userId, { limit: 20 }),
      listRecentJoinedDiscussions(ctx.userId),
    ]);
    const hasRecentDiscussions = Boolean(recentResult.ok && recentResult.discussions.length);
    if (!result.ok) return ctx.reply(messages[lang].unknownAction);
    if (!result.discussions.length) {
      const emptyNotice = await ctx.reply(
        messages[lang].discussionListMineEmpty,
        discussionListNavigationKeyboard(lang, {
          listType: "mine",
          hasRecentDiscussions,
        }),
      );
      await rememberDiscussionMenuNotice(ctx, emptyNotice);
      return emptyNotice;
    }
    const decorated = await decorateDiscussionsForList(ctx.user, result.discussions, true);
    const paged = paginateDiscussions(decorated, 0);
    const sent = await ctx.reply(
      buildDiscussionListText(messages, lang, messages[lang].discussionMyList, paged.items, {
        totalCount: decorated.length,
        headerTip: hasRecentDiscussions
          ? messages[lang].discussionMyListTipWithRecent
          : messages[lang].discussionMyListTip,
      }),
      discussionListNavigationKeyboard(lang, {
        listType: "mine",
        page: paged.page,
        totalPages: paged.totalPages,
        hasRecentDiscussions,
      }),
    );
    await rememberDiscussionListMessage(ctx, "mine", sent);
    return sent;
  }

  if (isDiscussionReturnToMenuText(text)) {
    if (!activeDiscussionId) {
      const notice = await ctx.reply(messages[lang].discussionReturnedToMenu, {
        reply_markup: { remove_keyboard: true, selective: false },
      });
      await rememberDiscussionMenuNotice(ctx, notice);
      await updateProfileField(ctx.userId, "navigationMode", "discussions");
      if (ctx.user) ctx.user.navigationMode = "discussions";
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
    return ctx.reply(
      messages[lang].discussionCloseConfirmPrompt,
      discussionCloseConfirmKeyboard(lang, activeDiscussionId, "room"),
    );
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
    beforePrompt: () => forgetRememberedDiscussionListMessage(ctx),
  })) {
    return { ok: false, reason: "requires_profile_name" };
  }

  const joined = await joinDiscussionAndNotify({ ctx, messages, discussionId: discussion._id });
  if (!joined.ok) return refreshDiscussionListAfterFailedJoin(ctx, lang, joined.reason, discussion);

  await forgetRememberedDiscussionListMessage(ctx);
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
    await updateProfileField(ctx.userId, "navigationMode", "global");
    if (ctx.user) ctx.user.navigationMode = "global";
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
  if (!(preview.discussion.memberUserIds || []).includes(Number(ctx.userId))) {
    const isOwner = Number(preview.discussion.creatorUserId) === Number(ctx.userId);
    if (
      !isOwner &&
      Array.isArray(preview.discussion.removedUserIds) &&
      preview.discussion.removedUserIds.includes(Number(ctx.userId))
    ) {
      blockedReason = "removed_by_owner";
    } else if (!isOwner && (preview.discussion.memberUserIds || []).length >= resolveDiscussionMaxMembers(preview.discussion)) {
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
  sendRoom = null,
  allowActiveSwitch = false,
} = {}) {
  const discussion = await findDiscussionByPublicCode(code);
  if (!discussion || discussion.status !== "open") {
    const text = messages[lang].discussionInviteUnavailable;
    await updateProfileField(ctx.userId, "navigationMode", "global");
    if (ctx.user) ctx.user.navigationMode = "global";
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

    if (joined.reason === "leave_current_first") {
      const keyboard = discussionLeaveCurrentNoticeKeyboard(lang);
      if (editMessage) {
        await editMessage(text, keyboard);
        return joined;
      }
      const notice = await ctx.reply(text, keyboard);
      await rememberDiscussionMenuNotice(ctx, notice);
      return joined;
    }

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
      keyboardToShow = allowActiveSwitch
        ? discussionInvitePreviewKeyboard(lang, publicCode, { cancelOnly: true })
        : mainMenuKeyboard(lang);
      returnToMainMenu = !allowActiveSwitch;
    }

    if (editMessage) {
      await updateProfileField(ctx.userId, "navigationMode", returnToMainMenu ? "global" : "discussions");
      if (ctx.user) ctx.user.navigationMode = returnToMainMenu ? "global" : "discussions";
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
  if (ctx.user) ctx.user.activeDiscussionId = joined.discussion._id;
  await markSharedLinkInvitationAccepted(ctx.userId, joined.discussion._id).catch(() => null);
  const pendingShareCode = String(ctx.user?.pendingDiscussionShareCode || "");
  const pendingShareMatches = pendingShareCode.toLowerCase() === String(publicCode || "").toLowerCase();
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
  return ctx.reply(
    messages[lang].discussionCloseConfirmPrompt,
    discussionCloseConfirmKeyboard(lang, discussion._id, listSource),
  );
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
  const member = code
    ? await User.findOne({ publicProfileCode: code }).select("userId profileName firstName").lean()
    : null;
  const memberUserId = Number(member?.userId);
  if (!Number.isInteger(memberUserId)) return ctx.reply(getDiscussionErrorMessage(messages, lang, "not_member"));
  const memberName = member.profileName || member.firstName || (lang === "fa" ? "عضو" : "member");
  return ctx.reply(
    messages[lang].discussionRemoveMemberConfirmPrompt.replace("{name}", memberName),
    discussionRemoveMemberConfirmKeyboard(lang, activeDiscussionId, code),
  );
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
    return ctx.reply(
      messages[lang].discussionCloseCanceled,
      await buildDiscussionRoomKeyboard(lang, opened.discussion, ctx.userId),
    );
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
  buildDiscussionInviteSharePayload,
  matchesMessageText,
  isDiscussionBottomControlText,
  handleDiscussionBottomButton,
  enterDiscussionsAfterRoomExit,
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
