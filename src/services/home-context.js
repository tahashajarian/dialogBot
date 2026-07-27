const {
  countAllPendingReceivedInvitations,
  countUnseenPendingReceivedInvitations,
} = require("./discussion-invitations");
const { findDiscussionByIdLean } = require("./discussions");
const { buildOwnProfileGrowthHint } = require("./profile");
const { getDiscussionDisplayTitle } = require("./discussion-ui");
const messages = require("../messages");

function compactFavorites(user = {}) {
  const result = {};
  for (const section of ["movies", "music", "books", "random"]) {
    const items = user?.aiLists?.[section]?.topTen;
    result[section] = Array.isArray(items) ? items.length : 0;
  }
  return result;
}

async function buildVerifiedHomeSnapshot(ctx, lang, plan = {}, deps = {}) {
  if (plan && (plan.countInvitations || plan.findDiscussion)) {
    deps = plan;
    plan = { identity: true, invitations: true, activeDiscussion: true, favorites: true };
  }
  const countAllInvitations = deps.countInvitations || deps.countAllInvitations || countAllPendingReceivedInvitations;
  const countUnseenInvitations = deps.countUnseenInvitations || countUnseenPendingReceivedInvitations;
  const findDiscussion = deps.findDiscussion || findDiscussionByIdLean;
  const requested = plan || {};
  const snapshot = { language: lang };
  const sources = {};

  if (requested.identity !== false) {
    snapshot.displayName = String(ctx.user?.profileName || ctx.user?.firstName || "").slice(0, 80);
  }
  if (requested.favorites) snapshot.favorites = compactFavorites(ctx.user);
  if (requested.profileGrowth) {
    snapshot.profileGrowthHint = buildOwnProfileGrowthHint(ctx.user, lang, messages) || "";
  }

  const tasks = [];
  if (requested.invitations) {
    sources.invitations = "ok";
    const countInvitations = requested.news ? countUnseenInvitations : countAllInvitations;
    tasks.push(Promise.resolve().then(() => countInvitations(ctx.userId)).then((count) => {
      snapshot.invitationCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : null;
      snapshot.invitationCountKind = requested.news ? "unseen" : "pending";
    }).catch(() => {
      sources.invitations = "unavailable";
      snapshot.invitationCount = null;
      snapshot.invitationCountKind = requested.news ? "unseen" : "pending";
    }));
  }

  if (requested.activeDiscussion) {
    sources.activeDiscussion = "ok";
    if (!ctx.user?.activeDiscussionId) {
      snapshot.activeDiscussion = { present: false };
    } else {
      tasks.push(Promise.resolve().then(() => findDiscussion(ctx.user.activeDiscussionId)).then((discussion) => {
        snapshot.activeDiscussion = discussion && discussion.status === "open" ? {
          present: true,
          title: getDiscussionDisplayTitle(messages, lang, discussion) || "",
          lastActivityAt: discussion.lastActivityAt || discussion.updatedAt || null,
        } : { present: false };
      }).catch(() => {
        sources.activeDiscussion = "unavailable";
        snapshot.activeDiscussion = null;
      }));
    }
  }

  await Promise.all(tasks);
  if (Object.keys(sources).length) snapshot.sources = sources;
  return Object.freeze(snapshot);
}

module.exports = { buildVerifiedHomeSnapshot, compactFavorites };
