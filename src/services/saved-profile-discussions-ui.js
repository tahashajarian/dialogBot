const messages = require("../messages");
const { callBacks } = require("../constants");
const { inlineKeyboard } = require("../keyboards");
const { normalizePublicProfileCode } = require("./public-codes");
const { decorateDiscussionsForList } = require("./discussion-ui");

function hasPeopleSurfaceContext(ctx) {
  return Number(ctx.user?.peopleLastListMessageId) > 0
    || ["browse", "taste"].includes(String(ctx.user?.peopleLastListMode || ""));
}

function parseProfileDiscussionRequest(raw = "", ctx = {}) {
  const value = String(raw || "");
  const parts = value.split(":");
  const knownSources = new Set([
    "saved",
    "browse",
    "taste",
    "shared",
    "direct",
    "discussion_members",
    "invitations",
    "restrictions",
  ]);
  if (parts.length >= 2 && knownSources.has(parts[0])) {
    return {
      source: parts[0] === "browse" || parts[0] === "taste" ? "people" : parts[0],
      peopleMode: parts[0] === "taste" ? "taste" : "browse",
      code: normalizePublicProfileCode(parts.slice(1).join(":")),
    };
  }
  return {
    source: hasPeopleSurfaceContext(ctx) ? "people" : "saved",
    peopleMode: String(ctx.user?.peopleLastListMode || "") === "taste" ? "taste" : "browse",
    code: normalizePublicProfileCode(value),
  };
}

function buildProfileDiscussionReturnType(profileCode, { source = "saved", peopleMode = "browse" } = {}) {
  const code = normalizePublicProfileCode(profileCode);
  if (!code) return "";
  return source === "people"
    ? `people:${peopleMode === "taste" ? "taste" : "browse"}:${code}`
    : `${source}:${code}`;
}

function profileDiscussionsInlineKeyboard(lang, profileCode, { showBack = true } = {}) {
  const rows = [];
  if (showBack) {
    rows.push([{
      text: messages[lang].discussionBack,
      callback_data: `${callBacks.profileDiscussionsBack}${profileCode}`,
    }]);
  }
  rows.push([{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.profileDiscussionsClose,
  }]);
  return inlineKeyboard(rows);
}

function profileDiscussionBackKeyboard(lang, profileCode) {
  return profileDiscussionsInlineKeyboard(lang, profileCode);
}

function markCurrentProfileDiscussions(user, discussions = []) {
  return discussions.map((discussion) => {
    if (String(user?.activeDiscussionId || "") === String(discussion?._id || "")) {
      discussion.listAction = "current";
      discussion.isCurrentForViewer = true;
    }
    return discussion;
  });
}

async function decorateProfileDiscussions(user, discussions = []) {
  return markCurrentProfileDiscussions(user, await decorateDiscussionsForList(user, discussions));
}

module.exports = {
  buildProfileDiscussionReturnType,
  decorateProfileDiscussions,
  markCurrentProfileDiscussions,
  parseProfileDiscussionRequest,
  profileDiscussionBackKeyboard,
  profileDiscussionsInlineKeyboard,
};
