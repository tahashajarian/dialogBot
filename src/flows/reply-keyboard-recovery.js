const messages = require("../messages");
const {
  aiAssistantKeyboard,
  discussionsMenuKeyboard,
  mainMenuKeyboard,
  peopleHubKeyboard,
  profileKeyboard,
} = require("../keyboards");
const { buildAiAssistantMenuMessage } = require("../services/ai-list-ui");
const { findDiscussionByIdLean } = require("../services/discussions");
const {
  buildDiscussionRoomKeyboard,
} = require("../services/discussion-room-ui");
const { getDiscussionDisplayTitle } = require("../services/discussion-ui");

function getStableReplyKeyboardRecovery(ctx, lang) {
  if (ctx.user?.activeDiscussionId || String(ctx.user?.state || "idle") !== "idle") return null;
  const mode = String(ctx.user?.navigationMode || "");

  if (!mode || mode === "global") {
    return {
      text: messages[lang].mainMenu,
      keyboard: mainMenuKeyboard(lang),
    };
  }
  if (
    mode === "discussions"
    || /^discussion_(?:list|invitations|language|join_error):/.test(mode)
  ) {
    return {
      text: messages[lang].discussionsMenu,
      keyboard: discussionsMenuKeyboard(lang),
    };
  }
  if (
    mode === "people"
    || mode.startsWith("people_")
    || mode.startsWith("saved_profiles:")
  ) {
    return {
      text: messages[lang].peopleMenu,
      keyboard: peopleHubKeyboard(lang, {
        hasSavedProfiles: Array.isArray(ctx.user?.savedProfileCodes)
          && ctx.user.savedProfileCodes.length > 0,
      }),
    };
  }
  if (mode === "favorites" || mode.startsWith("ai_")) {
    return {
      text: buildAiAssistantMenuMessage(lang, { user: ctx.user }),
      keyboard: aiAssistantKeyboard(lang),
    };
  }
  if (["profile", "profile_settings", "profile_privacy"].includes(mode)) {
    return {
      text: messages[lang].profileEditMenuText,
      keyboard: profileKeyboard(lang, Boolean(ctx.user?.photoFileId)),
    };
  }
  return null;
}

async function restoreStableReplyKeyboard(ctx, lang) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
  if (activeDiscussionId) {
    const discussion = await findDiscussionByIdLean(activeDiscussionId);
    if (!discussion || discussion.status !== "open") return null;
    const title = getDiscussionDisplayTitle(messages, lang, discussion);
    return ctx.reply(
      messages[lang].discussionInviteStillInRoom.replace("{title}", title),
      await buildDiscussionRoomKeyboard(lang, discussion, ctx.userId),
    );
  }

  const recovery = getStableReplyKeyboardRecovery(ctx, lang);
  if (!recovery) return null;
  return ctx.reply(recovery.text, recovery.keyboard);
}

module.exports = {
  getStableReplyKeyboardRecovery,
  restoreStableReplyKeyboard,
};
