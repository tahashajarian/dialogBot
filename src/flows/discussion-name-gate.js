const messages = require("../messages");
const {
  cancelEditKeyboard,
  discussionsMenuKeyboard,
  mainMenuKeyboard,
  onboardingCompleteKeyboard,
  peopleHubKeyboard,
} = require("../keyboards");
const { clearProfileEditPrompt, sendProfileEditPrompt } = require("./profile-edit");
const { validateProfileName } = require("../services/profile");
const { updateProfileField, updateUserState } = require("../services/users");

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

function isDiscussionNameCancelText(text = "") {
  const normalized = String(text).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().replace(/\s+/g, " ");
  return normalized === "/cancel" || ["fa", "en"].some((lang) => normalized === messages[lang].cancelEdit);
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

async function restoreDiscussionNameSourceKeyboard(ctx, lang, pendingEntry) {
  const source = pendingEntry?.source || "";
  if (["accept", "open", "open_active", "open_mine"].includes(source)) {
    return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
  }
  if (source === "open_saved") {
    return ctx.reply(messages[lang].people, peopleHubKeyboard(lang));
  }
  if (source !== "join") return null;

  const mode = String(ctx.user?.navigationMode || "");
  const onboardingMode = mode.match(/^onboarding_complete:(0|1):(0|1)$/);
  if (onboardingMode) {
    return ctx.reply(messages[lang].mainMenu, onboardingCompleteKeyboard(lang, {
      hasInvitation: onboardingMode[1] === "1",
      discussionContinuation: onboardingMode[2] === "1",
    }));
  }
  if (/^(?:people|saved_profiles|public_profile|profile_discussions)/.test(mode)) {
    return ctx.reply(messages[lang].people, peopleHubKeyboard(lang));
  }
  if (/^discussions?$|^discussion_/.test(mode)) {
    return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
  }
  return ctx.reply(messages[lang].mainMenu, mainMenuKeyboard(lang));
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

  await restoreDiscussionNameSourceKeyboard(ctx, lang, pendingEntry);

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
    await updateProfileField(ctx.userId, "navigationMode", "discussions");
    if (ctx.user) ctx.user.navigationMode = "discussions";
    return ctx.reply(messages[lang].discussionsMenu, discussionsMenuKeyboard(lang));
  }

  return true;
}

function getProfileNameErrorMessage(lang, reason) {
  if (reason === "emoji") return messages[lang].profileNameNoEmoji;
  if (reason === "link") return messages[lang].profileNameNoLink;
  if (reason === "sensitive_content") return messages[lang].profileNameNotAcceptable;
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
  isDiscussionNameCancelText,
  parseDiscussionNameState,
  requireDiscussionProfileName,
  restoreDiscussionNameSourceKeyboard,
};
