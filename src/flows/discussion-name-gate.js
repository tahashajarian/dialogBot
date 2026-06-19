const messages = require("../messages");
const { cancelEditKeyboard } = require("../keyboards");
const { sendProfileEditPrompt } = require("./profile-edit");
const { validateProfileName } = require("../services/profile");
const { updateUserState } = require("../services/users");

const DISCUSSION_NAME_STATE_PREFIX = "discussion_name_required:";
const DISCUSSION_PROFILE_NAME_MAX_LENGTH = 30;

function hasValidDiscussionProfileName(user = {}) {
  return validateProfileName(user.profileName, DISCUSSION_PROFILE_NAME_MAX_LENGTH).ok;
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

function isDiscussionNameState(state = "") {
  return Boolean(parseDiscussionNameState(state));
}

async function requireDiscussionProfileName(ctx, lang, { source, token } = {}) {
  if (hasValidDiscussionProfileName(ctx.user)) return true;

  const nextState = buildDiscussionNameState(source, token);
  if (!nextState) return true;
  await updateUserState(ctx.userId, nextState);
  await sendProfileEditPrompt(
    ctx,
    messages[lang].discussionNameRequired,
    cancelEditKeyboard(lang),
  );
  return false;
}

function getProfileNameErrorMessage(lang, reason) {
  if (reason === "emoji") return messages[lang].profileNameNoEmoji;
  return messages[lang].profileNameInvalid;
}

module.exports = {
  DISCUSSION_PROFILE_NAME_MAX_LENGTH,
  getProfileNameErrorMessage,
  hasValidDiscussionProfileName,
  isDiscussionNameState,
  parseDiscussionNameState,
  requireDiscussionProfileName,
};
