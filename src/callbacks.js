const messages = require("./messages");
const path = require("node:path");
const { detectLanguage } = require("./lang");
const {
  discussionUnavailableAckKeyboard,
} = require("./keyboards");
const { callBacks } = require("./constants");
const {
  removeBottomKeyboard,
  replyWithRemovedKeyboardThenInline,
  leaveDiscussionAndClearKeyboardForNavigation,
} = require("./services/bot-navigation");
const { sendNavigationFootprint } = require("./services/navigation-footprints");
const { sendBannerPhoto } = require("./services/banner-media");
const { setStableNavigationState } = require("./services/reply-keyboard-navigation");
const {
  hasSectionTipBeenShown,
  markSectionTipShownForContext,
} = require("./services/users");
const {
  clearDiscussionMenuNotice,
  rememberDiscussionMenuNotice,
  handleDiscussionListCallback,
  isDiscussionCreateFlowCallback,
  isDiscussionCreateEntryPaymentCallback,
  isDiscussionCreateState,
  isDiscussionListCallback,
  renderActiveDiscussionList,
  renderMyDiscussionList,
} = require("./flows/discussions-callbacks");
const {
  isDiscussionCreateCallback,
  handleDiscussionCreateCallback,
} = require("./flows/discussions-create-callbacks");
const {
  showDiscussionInvitePreviewCommand,
  sendShareableInviteForActiveDiscussion,
} = require("./flows/discussions-text");
const {
  handleDiscussionInvitationCallback,
  isDiscussionInvitationCallback,
  renderInvitationsList,
} = require("./flows/discussion-invitations");
const {
  handleAiCallback,
  isAiCallback,
} = require("./flows/ai-callbacks");
const {
  clearRememberedAiListMessage,
} = require("./flows/ai-cards");
const {
  handleProfileSettingsOrEditCallback,
  isProfileSettingsOrEditCallback,
} = require("./flows/profile-callbacks");
const {
  handleDiscussionBoostCallback,
  isDiscussionBoostCallback,
} = require("./flows/discussion-boosts");
const {
  handleSavedProfilesCallback,
  isSavedProfilesCallback,
  renderSavedProfileDiscussions,
  sendPublicProfileByCode,
  sendSavedProfilesList,
} = require("./flows/saved-profiles");
const {
  handleOnboardingCallback,
  isOnboardingCallback,
} = require("./flows/onboarding");
const {
  handleProfileFavoritesCallback,
  isProfileFavoritesCallback,
} = require("./flows/profile-favorites");
const { handleHubCallback, isHubCallback } = require("./flows/hub-callbacks");
const { handleLanguageCallback, isLanguageCallback } = require("./flows/language-callbacks");
const {
  handleDiscussionRoomCallback,
  isDiscussionRoomCallback,
  sendDiscussionRoom,
} = require("./flows/discussion-room-callbacks");
const {
  handlePublicProfileCallback,
  isPublicProfileCallback,
} = require("./flows/public-profile-callbacks");
const {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
  hasTemporaryReplyKeyboard,
  isProfileCallbackMessage,
  prepareCallbackDispatch,
  retireCallbackMessageIfPossible,
  retireObsoleteCallbackIfNeeded,
} = require("./flows/callback-lifecycle");


async function showBottomHub(ctx, lang, destination, mode, text, keyboard, shouldClearKeyboard) {
  await setStableNavigationState(ctx, mode);
  await sendNavigationFootprint(ctx, { lang, destination, removeKeyboard: shouldClearKeyboard });
  let sent;
  if (destination === "discussions" && !hasSectionTipBeenShown(ctx.user, "discussionsBanner")) {
    try {
      sent = await sendBannerPhoto(ctx, {
        bannerKey: "discussions_section_v2",
        localSource: path.join(__dirname, "..", "assets", "discussions-section-banner.jpg"),
        configuredFileId: process.env.DISCUSSIONS_SECTION_BANNER_FILE_ID,
        extra: { ...keyboard, caption: text },
      });
      await markSectionTipShownForContext(ctx, "discussionsBanner", new Date()).catch(() => null);
    } catch {
      sent = await ctx.reply(text, keyboard);
    }
  } else {
    sent = await ctx.reply(text, keyboard);
  }
  return sent;
}

async function handleCallback(ctx) {
  const data = ctx.callbackData || "";
  const lang = detectLanguage(ctx);

  if (!data) {
    await ctx.answerCb?.();
    return ctx.reply(messages[lang].unknownAction);
  }

  if (await retireObsoleteCallbackIfNeeded(ctx, data)) return null;

  if (isOnboardingCallback(data)) {
    return handleOnboardingCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      showSharedDiscussionPreview: (code) => showDiscussionInvitePreviewCommand(ctx, lang, code),
      showSharedProfile: (code) => sendPublicProfileByCode(ctx, lang, code, { fromSharedLink: true }),
    });
  }

  await prepareCallbackDispatch(ctx, data);

  // menu routes
  if (isHubCallback(data)) {
    return handleHubCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      hasTemporaryReplyKeyboard,
      showBottomHub,
    });
  }

  if (isLanguageCallback(data)) {
    return handleLanguageCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
    });
  }

  if (data === callBacks.onboardingDiscussionContinue) {
    await ctx.answerCb?.();
    const code = String(ctx.user?.pendingDiscussionShareCode || "");
    if (!code) {
      return editCallbackMessageOrReply(
        ctx,
        messages[lang].discussionInviteUnavailable,
        discussionUnavailableAckKeyboard(lang),
      );
    }
    return showDiscussionInvitePreviewCommand(ctx, lang, code);
  }

  if (
    isDiscussionCreateFlowCallback(data)
    && !isDiscussionCreateEntryPaymentCallback(data)
    && !isDiscussionCreateState(ctx.user?.state || "")
  ) {
    await ctx.answerCb?.(messages[lang].unknownAction.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
    return deleteCallbackMessageIfPossible(ctx);
  }

  if (isSavedProfilesCallback(data)) {
    return handleSavedProfilesCallback(ctx, lang, {
      clearRememberedAiListMessage,
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      hasTemporaryReplyKeyboard,
      isProfileCallbackMessage,
      leaveDiscussionAndClearKeyboardForNavigation,
      removeBottomKeyboard,
      replyWithRemovedKeyboardThenInline,
    });
  }

  if (isProfileFavoritesCallback(data)) {
    return handleProfileFavoritesCallback(ctx, lang);
  }

  if (isDiscussionListCallback(data)) {
    return handleDiscussionListCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      renderSavedProfileDiscussions,
      renderInvitationsList,
    });
  }

  if (isDiscussionInvitationCallback(data)) {
    return handleDiscussionInvitationCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      sendShareableInviteForActiveDiscussion,
      sendRoom: sendDiscussionRoom,
      sendSavedProfilesList,
      sendPublicProfileByCode,
    });
  }

  if (isDiscussionBoostCallback(data)) {
    return handleDiscussionBoostCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      renderMyDiscussionList,
    });
  }

  if (isDiscussionCreateCallback(data)) {
    return handleDiscussionCreateCallback(ctx, lang, {
      editCallbackMessageOrReply,
      clearDiscussionMenuNotice,
      rememberDiscussionMenuNotice,
      sendDiscussionRoom,
      deleteCallbackMessageIfPossible,
    });
  }

  if (isDiscussionRoomCallback(data)) {
    return handleDiscussionRoomCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
    });
  }

  if (isPublicProfileCallback(data)) {
    return handlePublicProfileCallback(ctx, lang, { deleteCallbackMessageIfPossible });
  }

  if (isAiCallback(data)) {
    return handleAiCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      hasTemporaryReplyKeyboard,
      removeBottomKeyboard,
      replyWithRemovedKeyboardThenInline,
    });
  }

  if (isProfileSettingsOrEditCallback(data)) {
    return handleProfileSettingsOrEditCallback(ctx, lang, {
      deleteCallbackMessageIfPossible,
      editCallbackMessageOrReply,
      isProfileCallbackMessage,
      leaveDiscussionAndClearKeyboardForNavigation,
      removeBottomKeyboard,
      renderActiveDiscussionList,
      renderMyDiscussionList,
      renderSavedProfileDiscussions,
      renderInvitationsList,
      retireCallbackMessageIfPossible,
      showDiscussionInvitePreviewCommand,
    });
  }

  await ctx.answerCb?.();
  return ctx.reply(messages[lang].unknownAction);
}

module.exports = { handleCallback };
