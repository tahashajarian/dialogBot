const crypto = require("node:crypto");
const Discussion = require("../models/discussion");
const DiscussionOwnerJoinNotice = require("../models/discussion-owner-join-notice");
const User = require("../models/user");
const { callBacks } = require("../constants");
const { getDiscussionOwnerJoinNoticeConfig } = require("../config");
const { getDiscussionDisplayTitle } = require("./discussion-ui");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");

const NOTICE_WINDOW_MS = 10 * 60 * 1000;
const CLAIM_STALE_MS = 60 * 1000;
const SUMMARY_SCAN_LIMIT = 50;

function ownerJoinNoticeKeyboard(messages, lang, publicDiscussionCode) {
  return {
    reply_markup: {
      inline_keyboard: [[{
        text: messages[lang].discussionOwnerJoinNoticeOpen,
        callback_data: `${callBacks.discussionOwnerJoinNoticeOpen}${publicDiscussionCode}`,
      }]],
    },
  };
}

function buildOwnerJoinNoticeText(messages, lang, {
  joinerName,
  joinedCount,
  discussion,
  memberCount,
  forceSummary = false,
}) {
  const count = Math.max(1, Number(joinedCount) || 1);
  const template = count === 1
    ? forceSummary
      ? messages[lang].discussionOwnerJoinNoticeSummarySingle
      : messages[lang].discussionOwnerJoinNoticeSingle
    : messages[lang].discussionOwnerJoinNoticeSummary;
  return template
    .replace("{name}", String(joinerName || ""))
    .replace("{joinedCount}", String(count))
    .replace("{title}", getDiscussionDisplayTitle(messages, lang, discussion))
    .replace("{memberCount}", String(Math.max(0, Number(memberCount) || 0)));
}

function activeClaimFilter(staleClaimCutoff) {
  return { claimToken: { $ne: "" }, claimedAt: { $gt: staleClaimCutoff } };
}

function availableClaimFilter(staleClaimCutoff) {
  return { $or: [{ claimToken: "" }, { claimedAt: null }, { claimedAt: { $lte: staleClaimCutoff } }] };
}

function addPendingUserPipeline(joinerUserId) {
  const pending = { $setUnion: [{ $ifNull: ["$pendingUserIds", []] }, [joinerUserId]] };
  return [{
    $set: {
      pendingUserIds: pending,
      pendingCount: { $size: pending },
    },
  }];
}

async function addUniquePendingUser(filter, joinerUserId) {
  return DiscussionOwnerJoinNotice.findOneAndUpdate(
    {
      ...filter,
      windowUserIds: { $ne: joinerUserId },
      pendingUserIds: { $ne: joinerUserId },
      claimedUserIds: { $ne: joinerUserId },
    },
    addPendingUserPipeline(joinerUserId),
    { returnDocument: "after", updatePipeline: true },
  ).lean();
}

function claimUsersPipeline({ claimToken, claimKind, now, joinerUserId = null }) {
  const unionParts = [
    { $ifNull: ["$pendingUserIds", []] },
    { $ifNull: ["$claimedUserIds", []] },
  ];
  if (Number.isInteger(joinerUserId)) unionParts.push([joinerUserId]);
  const claimedUsers = { $setUnion: unionParts };
  return [{
    $set: {
      claimToken,
      claimKind,
      claimedAt: now,
      claimedUserIds: claimedUsers,
      claimedCount: { $size: claimedUsers },
      pendingUserIds: [],
      pendingCount: 0,
    },
  }];
}

async function claimOwnerJoinNotice({ discussionId, ownerUserId, joinerUserId, now = new Date() }) {
  const normalizedJoinerId = Number(joinerUserId);
  if (!Number.isInteger(normalizedJoinerId) || normalizedJoinerId <= 0) {
    throw new TypeError("joinerUserId must be a positive integer");
  }
  const windowCutoff = new Date(now.getTime() - NOTICE_WINDOW_MS);
  const staleClaimCutoff = new Date(now.getTime() - CLAIM_STALE_MS);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const duringClaim = await addUniquePendingUser({
      discussionId,
      ownerUserId,
      ...activeClaimFilter(staleClaimCutoff),
    }, normalizedJoinerId);
    if (duringClaim) return { action: "throttled", pendingCount: duringClaim.pendingCount };

    const insideWindow = await addUniquePendingUser({
      discussionId,
      ownerUserId,
      lastSuccessfulSendAt: { $gt: windowCutoff },
    }, normalizedJoinerId);
    if (insideWindow) return { action: "throttled", pendingCount: insideWindow.pendingCount };

    const state = await DiscussionOwnerJoinNotice.findOne({ discussionId, ownerUserId }).lean();
    const lastSentAt = state?.lastSuccessfulSendAt?.getTime?.() || 0;
    const claimIsActive = Boolean(
      state?.claimToken && state?.claimedAt?.getTime?.() > staleClaimCutoff.getTime(),
    );
    const alreadyCounted = claimIsActive
      ? (state.claimedUserIds || []).includes(normalizedJoinerId)
      : lastSentAt > windowCutoff.getTime() && [
        ...(state?.windowUserIds || []),
        ...(state?.pendingUserIds || []),
      ].includes(normalizedJoinerId);
    if (alreadyCounted) return { action: "duplicate" };

    const claimToken = crypto.randomUUID();
    const hasPending = Boolean(
      (state?.pendingUserIds || []).length ||
      (state?.claimedUserIds || []).length,
    );
    const claimKind = hasPending ? "summary" : "immediate";
    const claimed = await DiscussionOwnerJoinNotice.findOneAndUpdate(
      {
        discussionId,
        ownerUserId,
        $and: [
          { $or: [{ lastSuccessfulSendAt: null }, { lastSuccessfulSendAt: { $lte: windowCutoff } }] },
          availableClaimFilter(staleClaimCutoff),
        ],
      },
      claimUsersPipeline({ claimToken, claimKind, now, joinerUserId: normalizedJoinerId }),
      { returnDocument: "after", updatePipeline: true },
    ).lean();
    if (claimed) {
      return {
        action: "send",
        claimToken,
        claimKind,
        count: claimed.claimedCount,
      };
    }

    try {
      await DiscussionOwnerJoinNotice.create({
        discussionId,
        ownerUserId,
        claimToken,
        claimKind: "immediate",
        claimedAt: now,
        claimedUserIds: [normalizedJoinerId],
        claimedCount: 1,
      });
      return { action: "send", claimToken, claimKind: "immediate", count: 1 };
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
    }
  }

  throw new Error("owner_join_notice_claim_contention");
}

async function claimDueOwnerJoinNoticeSummary(discussionId, now = new Date()) {
  const windowCutoff = new Date(now.getTime() - NOTICE_WINDOW_MS);
  const staleClaimCutoff = new Date(now.getTime() - CLAIM_STALE_MS);
  const claimToken = crypto.randomUUID();
  const claimed = await DiscussionOwnerJoinNotice.findOneAndUpdate(
    {
      discussionId,
      $and: [
        { $or: [
          {
            $and: [
              { "pendingUserIds.0": { $exists: true } },
              { $or: [
                { lastSuccessfulSendAt: null },
                { lastSuccessfulSendAt: { $lte: windowCutoff } },
              ] },
            ],
          },
          { claimedAt: { $lte: staleClaimCutoff }, "claimedUserIds.0": { $exists: true } },
        ] },
        availableClaimFilter(staleClaimCutoff),
      ],
    },
    claimUsersPipeline({ claimToken, claimKind: "summary", now }),
    { returnDocument: "after", updatePipeline: true },
  ).lean();
  if (!claimed) return null;
  return {
    action: "send",
    claimToken,
    claimKind: "summary",
    count: claimed.claimedCount,
    ownerUserId: claimed.ownerUserId,
    discussionId: claimed.discussionId,
  };
}

async function completeOwnerJoinNoticeClaim(discussionId, claimToken, sentAt = new Date()) {
  return DiscussionOwnerJoinNotice.findOneAndUpdate(
    { discussionId, claimToken },
    [{
      $set: {
        lastSuccessfulSendAt: sentAt,
        windowUserIds: { $ifNull: ["$claimedUserIds", []] },
        claimToken: "",
        claimKind: "",
        claimedUserIds: [],
        claimedCount: 0,
        claimedAt: null,
      },
    }],
    { returnDocument: "after", updatePipeline: true },
  ).lean();
}

async function restoreOwnerJoinNoticeClaim(discussionId, claimToken) {
  return DiscussionOwnerJoinNotice.findOneAndUpdate(
    { discussionId, claimToken },
    [{
      $set: {
        pendingUserIds: {
          $setUnion: [
            { $ifNull: ["$pendingUserIds", []] },
            { $ifNull: ["$claimedUserIds", []] },
          ],
        },
        pendingCount: {
          $size: {
            $setUnion: [
              { $ifNull: ["$pendingUserIds", []] },
              { $ifNull: ["$claimedUserIds", []] },
            ],
          },
        },
        claimToken: "",
        claimKind: "",
        claimedUserIds: [],
        claimedCount: 0,
        claimedAt: null,
      },
    }],
    { returnDocument: "after", updatePipeline: true },
  ).lean();
}

async function removeOwnerJoinNoticeState(discussionId) {
  return DiscussionOwnerJoinNotice.deleteOne({ discussionId });
}

function recordOwnerNoticeEvent(name, ownerUserId, discussionId, count) {
  void trackEvent({
    name,
    userId: ownerUserId,
    source: "discussion_owner_join_notice",
    metadata: { discussionId: String(discussionId), count: Math.max(1, Number(count) || 1) },
  });
}

async function deliverOwnerJoinNoticeClaim({
  sendToUser,
  messages,
  discussionId,
  ownerUserId,
  claim,
  joinerName = "",
}) {
  try {
    const [owner, currentDiscussion] = await Promise.all([
      User.findOne({ userId: ownerUserId }).select("userId lang activeDiscussionId").lean(),
      Discussion.findOne({ _id: discussionId, creatorUserId: ownerUserId, status: "open" }).lean(),
    ]);
    if (!owner || !currentDiscussion?.publicDiscussionCode) {
      await removeOwnerJoinNoticeState(discussionId).catch(() => null);
      return { action: "retired" };
    }
    if (String(owner.activeDiscussionId || "") === String(discussionId)) {
      await completeOwnerJoinNoticeClaim(discussionId, claim.claimToken);
      return { action: "live" };
    }

    const lang = messages[owner.lang] ? owner.lang : "fa";
    const text = buildOwnerJoinNoticeText(messages, lang, {
      joinerName,
      joinedCount: claim.count,
      discussion: currentDiscussion,
      memberCount: currentDiscussion.memberUserIds?.length || 0,
      forceSummary: claim.claimKind === "summary",
    });
    const delivered = await sendToUser?.(
      ownerUserId,
      text,
      ownerJoinNoticeKeyboard(messages, lang, currentDiscussion.publicDiscussionCode),
      lang,
    );
    if (!delivered) throw new Error("owner_join_notice_delivery_failed");

    await completeOwnerJoinNoticeClaim(discussionId, claim.claimToken);
    recordOwnerNoticeEvent(
      claim.claimKind === "summary"
        ? EVENT_NAMES.discussionOwnerJoinNoticeSummarized
        : EVENT_NAMES.discussionOwnerJoinNoticeSent,
      ownerUserId,
      discussionId,
      claim.count,
    );
    return { action: claim.claimKind === "summary" ? "summarized" : "sent", count: claim.count };
  } catch (error) {
    await restoreOwnerJoinNoticeClaim(discussionId, claim.claimToken).catch(() => null);
    recordOwnerNoticeEvent(EVENT_NAMES.discussionOwnerJoinNoticeDeliveryFailed, ownerUserId, discussionId, claim.count);
    return { action: "failed", reason: error?.message || "delivery_failed" };
  }
}

async function notifyDiscussionOwnerOfJoin({ ctx, messages, joined }) {
  if (!getDiscussionOwnerJoinNoticeConfig().enabled || !joined?.joined || !joined.discussion) {
    return { action: "disabled" };
  }

  const discussionId = joined.discussion._id;
  const ownerUserId = Number(joined.discussion.creatorUserId);
  const joinerUserId = Number(ctx.userId);
  if (
    !Number.isInteger(ownerUserId) ||
    ownerUserId <= 0 ||
    ownerUserId === joinerUserId ||
    joined.discussion.isBotCreated
  ) {
    return { action: "suppressed" };
  }

  const owner = await User.findOne({ userId: ownerUserId }).select("activeDiscussionId").lean();
  if (!owner) return { action: "suppressed" };
  if (String(owner.activeDiscussionId || "") === String(discussionId)) return { action: "live" };

  const claim = await claimOwnerJoinNotice({ discussionId, ownerUserId, joinerUserId });
  if (claim.action === "duplicate") return claim;
  if (claim.action === "throttled") {
    recordOwnerNoticeEvent(EVENT_NAMES.discussionOwnerJoinNoticeThrottled, ownerUserId, discussionId, 1);
    return claim;
  }

  return deliverOwnerJoinNoticeClaim({
    sendToUser: ctx.sendToUser,
    messages,
    discussionId,
    ownerUserId,
    claim,
    joinerName: joined.joinerName,
  });
}

async function flushDueOwnerJoinNoticeSummaries({ sendToUser, messages, now = new Date() } = {}) {
  if (!getDiscussionOwnerJoinNoticeConfig().enabled) return { checked: 0, delivered: 0 };
  const windowCutoff = new Date(now.getTime() - NOTICE_WINDOW_MS);
  const staleClaimCutoff = new Date(now.getTime() - CLAIM_STALE_MS);
  const states = await DiscussionOwnerJoinNotice.find({
    $or: [
      {
        $and: [
          { "pendingUserIds.0": { $exists: true } },
          { $or: [
            { lastSuccessfulSendAt: null },
            { lastSuccessfulSendAt: { $lte: windowCutoff } },
          ] },
        ],
      },
      { claimedAt: { $lte: staleClaimCutoff }, "claimedUserIds.0": { $exists: true } },
    ],
  }).select("discussionId").limit(SUMMARY_SCAN_LIMIT).lean();

  let delivered = 0;
  for (const state of states) {
    const claim = await claimDueOwnerJoinNoticeSummary(state.discussionId, now);
    if (!claim) continue;
    const result = await deliverOwnerJoinNoticeClaim({
      sendToUser,
      messages,
      discussionId: claim.discussionId,
      ownerUserId: claim.ownerUserId,
      claim,
    });
    if (result.action === "summarized") delivered += 1;
  }
  return { checked: states.length, delivered };
}

async function getRecentOwnerJoinSummary(ownerUserId, discussionId, now = new Date()) {
  if (!ownerUserId || !discussionId) return { available: false, count: 0 };
  const cutoff = new Date(now.getTime() - NOTICE_WINDOW_MS);
  const state = await DiscussionOwnerJoinNotice.findOne({ discussionId, ownerUserId }).lean();
  if (!state) return { available: true, count: 0 };
  const ids = new Set();
  if (state.lastSuccessfulSendAt && state.lastSuccessfulSendAt > cutoff) {
    for (const id of state.windowUserIds || []) ids.add(Number(id));
  }
  for (const id of state.pendingUserIds || []) ids.add(Number(id));
  if (state.claimedAt && state.claimedAt > cutoff) {
    for (const id of state.claimedUserIds || []) ids.add(Number(id));
  }
  return { available: true, count: [...ids].filter(Number.isInteger).length, windowMinutes: Math.round(NOTICE_WINDOW_MS / 60000) };
}

module.exports = {
  CLAIM_STALE_MS,
  NOTICE_WINDOW_MS,
  buildOwnerJoinNoticeText,
  claimDueOwnerJoinNoticeSummary,
  claimOwnerJoinNotice,
  completeOwnerJoinNoticeClaim,
  deliverOwnerJoinNoticeClaim,
  flushDueOwnerJoinNoticeSummaries,
  getRecentOwnerJoinSummary,
  notifyDiscussionOwnerOfJoin,
  ownerJoinNoticeKeyboard,
  removeOwnerJoinNoticeState,
  restoreOwnerJoinNoticeClaim,
};
