const Discussion = require("../models/discussion");
const User = require("../models/user");
const { hasLink, normalizeDiscussionText } = require("./discussion-text");
const { isCommandLikeText } = require("./command-like-text");
const { operationalLimits } = require("./operational-limits");

const DISCUSSION_RECENT_MESSAGES_CAP = 10;
const DISCUSSION_MESSAGE_LIMIT = 30;
const DISCUSSION_MESSAGE_WINDOW_MS = 10 * 60 * 1000;
const DISCUSSION_MESSAGE_BURST_WINDOW_MS = 1000;

function getRecentDiscussionMessageUsageFromUser(user, now = new Date(), windowMs = DISCUSSION_MESSAGE_WINDOW_MS) {
  const cutoff = now.getTime() - windowMs;
  return (user?.discussionMessageUsage || [])
    .map((entry) => new Date(entry))
    .filter((entry) => Number.isFinite(entry.getTime()) && entry.getTime() > cutoff);
}

async function consumeDiscussionMessageQuota(userId) {
  const now = new Date();
  const messageLimit = operationalLimits.discussionMessagesPerWindow;
  const windowMs = operationalLimits.discussionMessageWindowMinutes * 60 * 1000;
  const burstWindowMs = operationalLimits.discussionMessageBurstSeconds * 1000;
  const cutoff = new Date(now.getTime() - windowMs);
  const burstCutoff = new Date(now.getTime() - burstWindowMs);
  const updated = await User.findOneAndUpdate(
    {
      userId,
      $expr: {
        $and: [
          {
            $lt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$discussionMessageUsage", []] },
                    as: "usedAt",
                    cond: { $gt: ["$$usedAt", cutoff] },
                  },
                },
              },
              messageLimit,
            ],
          },
          {
            $eq: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$discussionMessageUsage", []] },
                    as: "usedAt",
                    cond: { $gt: ["$$usedAt", burstCutoff] },
                  },
                },
              },
              0,
            ],
          },
        ],
      },
    },
    [
      {
        $set: {
          discussionMessageUsage: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ["$discussionMessageUsage", []] },
                  as: "usedAt",
                  cond: { $gt: ["$$usedAt", cutoff] },
                },
              },
              [now],
            ],
          },
        },
      },
    ],
    { returnDocument: "after", updatePipeline: true },
  ).select("discussionMessageUsage");

  if (!updated) {
    const user = await User.findOne({ userId }).select("discussionMessageUsage").lean();
    if (!user) return { ok: false, reason: "missing_user" };
    const recentUsage = getRecentDiscussionMessageUsageFromUser(user, now, windowMs);
    const hasRecentBurst = recentUsage.some(
      (usedAt) => usedAt.getTime() > burstCutoff.getTime(),
    );
    if (hasRecentBurst) {
      return {
        ok: false,
        reason: "message_burst_limit",
        retryAfterMs: burstWindowMs,
      };
    }
    return { ok: false, reason: "message_rate_limit", cap: messageLimit };
  }

  return {
    ok: true,
    count: getRecentDiscussionMessageUsageFromUser(updated, now, windowMs).length,
  };
}

async function addRecentMessage({ discussionId, senderUserId, senderDisplayName, text, voiceFileId, voiceDuration }) {
  const discussion = await Discussion.findById(discussionId)
    .select("status memberUserIds creatorUserId")
    .lean();
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed" };
  if (!discussion.memberUserIds.includes(senderUserId)) return { ok: false, reason: "not_member" };

  const isVoiceMessage = Boolean(voiceFileId);
  const cleanText = text ? normalizeDiscussionText(text, 500) : "";
  const cleanName = normalizeDiscussionText(senderDisplayName, 80);

  if (!cleanText && !isVoiceMessage) return { ok: false, reason: "empty_message" };
  if (cleanText && isCommandLikeText(cleanText)) return { ok: false, reason: "message_command_like" };
  if (cleanText && hasLink(cleanText)) return { ok: false, reason: "message_contains_link" };

  const quota = await consumeDiscussionMessageQuota(senderUserId);
  if (!quota.ok) return { ...quota, discussion };

  const now = new Date();
  const message = {
    senderUserId,
    senderDisplayName: cleanName || "کاربر",
    text: cleanText,
    voiceFileId: voiceFileId || "",
    voiceDuration: voiceDuration || 0,
    sentAt: now,
  };
  const updatedDiscussion = await Discussion.findOneAndUpdate(
    {
      _id: discussionId,
      status: "open",
      memberUserIds: senderUserId,
    },
    {
      $push: {
        recentMessages: {
          $each: [message],
          $slice: -DISCUSSION_RECENT_MESSAGES_CAP,
        },
      },
      $inc: { replyCount: 1 },
      $set: {
        lastActivityAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );

  if (!updatedDiscussion) {
    const latest = await Discussion.findById(discussionId).lean();
    if (!latest) return { ok: false, reason: "missing_discussion" };
    if (latest.status !== "open") return { ok: false, reason: "discussion_closed" };
    return { ok: false, reason: "not_member" };
  }

  return {
    ok: true,
    discussion: updatedDiscussion,
    recentMessages: updatedDiscussion.recentMessages || [],
    recipients: updatedDiscussion.memberUserIds.filter((id) => id !== senderUserId),
  };
}

module.exports = {
  DISCUSSION_MESSAGE_BURST_WINDOW_MS,
  DISCUSSION_MESSAGE_LIMIT,
  DISCUSSION_MESSAGE_WINDOW_MS,
  DISCUSSION_RECENT_MESSAGES_CAP,
  addRecentMessage,
  consumeDiscussionMessageQuota,
  getRecentDiscussionMessageUsageFromUser,
};
