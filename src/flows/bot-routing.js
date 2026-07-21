const messages = require("../messages");

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

function parseDiscussionCloseConfirmState(state = "") {
  if (!state.startsWith("discussion_close_confirm")) return {};
  const [, discussionId = "", messageIdRaw = "", requestedSource = "room"] = state.split(":");
  const messageId = Number(messageIdRaw);
  return {
    discussionId,
    messageId: Number.isInteger(messageId) && messageId > 0 ? messageId : null,
    source: ["list", "active", "mine"].includes(requestedSource) ? requestedSource : "room",
  };
}

function getStartInviteCode(text = "") {
  const match = String(text || "").trim().match(/^\/start(?:@\w+)?(?:\s+|[?=])(?:join_|d_)([a-z0-9]+)$/i);
  return match ? `d_${match[1].toUpperCase()}` : "";
}

function getStartReferralCode(text = "") {
  const match = String(text || "").trim().match(/^\/start(?:@\w+)?(?:\s+|[?=])ref_([a-f0-9]{12})$/i);
  return match ? match[1].toUpperCase() : "";
}

function isAllowedDiscussionCommandLink(text = "") {
  const value = String(text || "").trim();
  return [
    /^\/start(?:@\w+)?(?:$|[\s?=])/i,
    /^\/join_[a-z0-9]+$/i,
    /^\/(?:invite|iv)_[a-z0-9]+$/i,
    /^\/accept_inv_[a-z0-9]+$/i,
    /^\/remove_inv_[a-z0-9]+$/i,
    /^\/d_[a-z0-9]+$/i,
    /^\/leave_[a-z0-9]+$/i,
    /^\/close_[a-z0-9]+$/i,
    /^\/boost_[a-z0-9]+$/i,
    /^\/remove_(u_)?[a-z0-9]+$/i,
    /^\/report_(u_)?[a-z0-9]+$/i,
    /^\/save_(u_)?[a-z0-9]+$/i,
    /^\/allow_ir_[a-f0-9]{24}$/i,
    /^\/allow_inv_[a-z0-9]+$/i,
    /^\/(?:unsave|rm)_(u_)?[a-z0-9]+$/i,
    /^\/(?:discussions|ds)_(u_)?[a-z0-9]+$/i,
    /^\/u_[a-z0-9]+$/i,
  ].some((pattern) => pattern.test(value));
}

function shouldRejectDiscussionSlashCommand(ctx, state = "", text = "") {
  return Boolean(
    state === "idle"
    && ctx.user?.activeDiscussionId
    && String(text || "").trim().startsWith("/")
    && !isAllowedDiscussionCommandLink(text)
  );
}

function getNavigationCommand(text = "") {
  const match = String(text || "").trim().match(/^\/(menu|profile|lang|taste|discussions|people|help)(?:@\w+)?$/i);
  return match ? match[1].toLowerCase() : "";
}

function normalizeIncomingText(value = "") {
  return String(value || "").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim();
}

module.exports = {
  getNavigationCommand,
  getStartInviteCode,
  getStartReferralCode,
  isAllowedDiscussionCommandLink,
  matchesMessageText,
  normalizeIncomingText,
  normalizeKeyboardText,
  parseDiscussionCloseConfirmState,
  shouldRejectDiscussionSlashCommand,
};
