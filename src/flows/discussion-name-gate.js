const messages = require("../messages");
const { cancelEditKeyboard, discussionsMenuKeyboard } = require("../keyboards");
const { clearProfileEditPrompt, sendProfileEditPrompt } = require("./profile-edit");
const { validateProfileName } = require("../services/profile");
const { updateUserState } = require("../services/users");

const DISCUSSION_NAME_STATE_PREFIX = "discussion_name_required:";
const DISCUSSION_PROFILE_NAME_MAX_LENGTH = 30;

function hasValidDiscussionProfileName(user = {}) {
  return Boolean(user.profileNameConfirmedAt) &&
    validateProfileName(user.profileName, DISCUSSION_PROFILE_NAME_MAX_LENGTH).ok;
}

function buildDiscussionNameState(source, token) {
  const safeSource = String(source || "").replace(/:/g, "");
  const safeToken = String(token || "").replace(/:/g, "");
  if (!safeSource || !safeToken) return "";
  return `${DISCUSSION_NAME_STATE_PREFIX}${safeSource}:${safeToken}`;
}

function parseDiscussionNameState(state = "") {
  const raw = String(state || "");
  if (!raw.startsWith(DISCUSSION_NAME_STATE_PREFIX)) return null;
  const payload = raw.slice(DISCUSSION_NAME_STATE_PREFIX.length);
  const [source = "", token = ""] = payload.split(":");
  if (!source || !token) return null;
  return { source, token };
}

function splitDiscussionOpenNameToken(token = "") {
  const [returnToken = "", discussionCode = ""] = String(token || "").split("|");
  return {
    returnToken,
    discussionCode: discussionCode || returnToken,
  };
}

function getDiscussionOpenCodeFromNameState(entry = {}) {
  return splitDiscussionOpenNameToken(entry.token).discussionCode;
}

function buildDiscussionOpenNameGate(ctx, discussionCode) {
  const listType = String(ctx.user?.discussionLastListType || "");
  if (listType.startsWith("saved:")) {
    const savedProfileCode = listType.replace(/^saved:/, "");
    if (savedProfileCode) {
      return {
        source: "open_saved",
        token: `${savedProfileCode}|${discussionCode}`,
      };
    }
  }
  if (listType === "mine") {
    return { source: "open_mine", token: discussionCode };
  }
  return { source: "open", token: discussionCode };
}

function isDiscussionNameState(state = "") {
  return Boolean(parseDiscussionNameState(state));
}

async function requireDiscussionProfileName(ctx, lang, { source, token, beforePrompt } = {}) {
  if (hasValidDiscussionProfileName(ctx.user)) return true;

  const nextState = buildDiscussionNameState(source, token);
  if (!nextState) return true;
  await updateUserState(ctx.userId, nextState);
  await beforePrompt?.();
  await sendProfileEditPrompt(
    ctx,
    messages[lang].discussionNameRequired,
    cancelEditKeyboard(lang),
  );
  return false;
}

async function handleDiscussionNameCancel(ctx, lang, {
  renderActiveDiscussionList,
  renderMyDiscussionList,
  renderSavedProfileDiscussions,
  renderInvitationsList,
  showDiscussionInvitePreviewCommand,
} = {}) {
  const pendingEntry = parseDiscussionNameState(ctx.user?.state);
  await clearProfileEditPrompt(ctx);
  await updateUserState(ctx.userId, "idle");
  if (ctx.user) ctx.user.state = "idle";

  if (pendingEntry?.source === "accept" && renderInvitationsList) {
    return renderInvitationsList(ctx, lang, 0);
  }
  if (pendingEntry?.source === "open_saved" && renderSavedProfileDiscussions) {
    const { returnToken } = splitDiscussionOpenNameToken(pendingEntry.token);
    return renderSavedProfileDiscussions(ctx, lang, returnToken);
  }
  if (pendingEntry?.source === "open_mine" && renderMyDiscussionList) {
    return renderMyDiscussionList(ctx, lang, 0, {
      editCallbackMessageOrReply: (_ctx, text, keyboard) => _ctx.reply(text, keyboard),
    });
  }
  if ((pendingEntry?.source === "open" || pendingEntry?.source === "open_active") && renderActiveDiscussionList) {
    return renderActiveDiscussionList(ctx, lang, 0, false, {
      editCallbackMessageOrReply: (_ctx, text, keyboard) => _ctx.reply(text, keyboard),
    });
  }
  if (pendingEntry?.source === "join" && showDiscussionInvitePreviewCommand) {
    return showDiscussionInvitePreviewCommand(ctx, lang, pendingEntry.token);
  }
  if (pendingEntry?.source === "create") {
    return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
  }

  return true;
}

function getProfileNameErrorMessage(lang, reason) {
  if (reason === "emoji") return messages[lang].profileNameNoEmoji;
  return messages[lang].profileNameInvalid;
}

module.exports = {
  DISCUSSION_PROFILE_NAME_MAX_LENGTH,
  buildDiscussionOpenNameGate,
  getProfileNameErrorMessage,
  getDiscussionOpenCodeFromNameState,
  handleDiscussionNameCancel,
  hasValidDiscussionProfileName,
  isDiscussionNameState,
  parseDiscussionNameState,
  requireDiscussionProfileName,
};
