const {
  countAllPendingReceivedInvitations,
  countUnseenPendingReceivedInvitations,
} = require("./discussion-invitations");
const { findDiscussionByIdLean, listMyDiscussions } = require("./discussions");
const { getRecentOwnerJoinSummary } = require("./discussion-owner-join-notifications");
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
  const listOwnedDiscussions = deps.listOwnedDiscussions || listMyDiscussions;
  const getRecentJoinSummary = deps.getRecentJoinSummary || getRecentOwnerJoinSummary;
  const requested = plan || {};
  const snapshot = { language: lang };
  const sources = {};

  if (requested.identity !== false) {
    snapshot.displayName = String(ctx.user?.profileName || ctx.user?.firstName || "").slice(0, 80);
  }
  if (requested.favorites) snapshot.favorites = compactFavorites(ctx.user);
  if (requested.profileAge) {
    const age = Number(ctx.user?.age);
    snapshot.profileAge = Number.isFinite(age) && age > 0 ? age : null;
  }
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
          memberCount: Array.isArray(discussion.memberUserIds) ? discussion.memberUserIds.length : null,
          isOwner: Number(discussion.creatorUserId) === Number(ctx.userId),
          id: String(discussion._id || ctx.user.activeDiscussionId),
        } : { present: false };
      }).catch(() => {
        sources.activeDiscussion = "unavailable";
        snapshot.activeDiscussion = null;
      }));
    }
  }


  if (requested.ownedDiscussions) {
    sources.ownedDiscussions = "ok";
    tasks.push(Promise.resolve().then(() => listOwnedDiscussions(ctx.userId, { limit: 5 })).then(async (result) => {
      const discussions = result?.ok && Array.isArray(result.discussions) ? result.discussions : [];
      const memberCounts = discussions.map((discussion) => Array.isArray(discussion.memberUserIds) ? discussion.memberUserIds.length : 0);
      const otherMemberCounts = discussions.map((discussion, index) => Math.max(0, memberCounts[index] - 1));
      snapshot.ownedDiscussions = {
        count: discussions.length,
        totalMemberCount: memberCounts.reduce((sum, count) => sum + count, 0),
        otherMemberCount: otherMemberCounts.reduce((sum, count) => sum + count, 0),
        latest: discussions[0] ? {
          id: String(discussions[0]._id || ""),
          title: getDiscussionDisplayTitle(messages, lang, discussions[0]) || "",
          memberCount: Array.isArray(discussions[0].memberUserIds) ? discussions[0].memberUserIds.length : null,
        } : null,
      };
      if (requested.recentDiscussionJoin && discussions[0]) {
        snapshot.recentDiscussionJoin = await getRecentJoinSummary(ctx.userId, discussions[0]._id);
      }
    }).catch(() => {
      sources.ownedDiscussions = "unavailable";
      snapshot.ownedDiscussions = null;
      if (requested.recentDiscussionJoin) snapshot.recentDiscussionJoin = null;
    }));
  }

  await Promise.all(tasks);
  if (Object.keys(sources).length) snapshot.sources = sources;
  return Object.freeze(snapshot);
}

module.exports = { buildVerifiedHomeSnapshot, compactFavorites };
