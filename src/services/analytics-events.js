const mongoose = require("mongoose");
const AnalyticsEvent = require("../models/analytics-event");
const { logger } = require("./logger");

const EVENT_NAMES = Object.freeze({
  userStarted: "user_started",
  onboardingStarted: "onboarding_started",
  onboardingCompleted: "onboarding_completed",
  onboardingDestinationChosen: "onboarding_destination_chosen",
  onboardingSkipped: "onboarding_skipped",
  sectionTipExposed: "section_tip_exposed",
  starterInvitationPrepared: "starter_invitation_prepared",
  starterInvitationOpened: "starter_invitation_opened",
  topTenItemAdded: "topten_item_added",
  watchlistItemAdded: "watchlist_item_added",
  tasteLabelUnlocked: "taste_label_unlocked",
  suggestionRequested: "suggestion_requested",
  suggestionSaved: "suggestion_saved",
  peopleDiscoveryQueried: "people_discovery_queried",
  discussionListOpened: "discussion_list_opened",
  discussionJoined: "discussion_joined",
  discussionCreated: "discussion_created",
  discussionOwnerJoinNoticeSent: "discussion_owner_join_notice_sent",
  discussionOwnerJoinNoticeThrottled: "discussion_owner_join_notice_throttled",
  discussionOwnerJoinNoticeSummarized: "discussion_owner_join_notice_summarized",
  discussionOwnerJoinNoticeDeliveryFailed: "discussion_owner_join_notice_delivery_failed",
  discussionOwnerJoinNoticeOpened: "discussion_owner_join_notice_opened",
  inviteSent: "invite_sent",
  profileSaved: "profile_saved",
  starsEarned: "stars_earned",
  starsSpent: "stars_spent",
  starsRefunded: "stars_refunded",
  externalReferralClaimed: "external_referral_claimed",
  externalReferralQualified: "external_referral_qualified",
  discussionBoostViewed: "discussion_boost_viewed",
  discussionBoostActivated: "discussion_boost_activated",
  boostRecipientSelection: "boost_recipient_selection",
  boostRecommendationSent: "boost_recommendation_sent",
  boostRecommendationNotInterested: "boost_recommendation_not_interested",
  advancedSearchPreviewViewed: "advanced_search_preview_viewed",
  advancedSearchNotifyRequested: "advanced_search_notify_requested",
});

const SAFE_METADATA_KEYS = new Set([
  "count",
  "goal",
  "listType",
  "joinRuleType",
  "maxMembers",
  "labelKey",
  "source",
  "status",
  "reason",
  "page",
  "joinableOnly",
  "resultCount",
  "amount",
  "balance",
  "milestone",
  "durationHours",
  "cost",
  "mode",
  "matchType",
  "cached",
  "candidateCount",
  "selectedCount",
  "skippedReasons",
  "destination",
  "tipKey",
  "discussionId",
]);
const THROTTLE_CACHE_LIMIT = 1000;
const throttleCache = new Map();

function sanitizeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const safeEntries = Object.entries(metadata)
    .filter(([key]) => SAFE_METADATA_KEYS.has(key))
    .map(([key, value]) => {
      if (typeof value === "boolean") return [key, value];
      if (typeof value === "number") return [key, Number.isFinite(value) ? value : 0];
      return [key, String(value || "").slice(0, 80)];
    });
  return safeEntries.length ? Object.fromEntries(safeEntries) : undefined;
}

async function trackEvent({ name, userId = null, source = "", section = "", metadata } = {}) {
  try {
    if (!name || mongoose.connection.readyState !== 1) return null;
    return await AnalyticsEvent.create({
      name: String(name).slice(0, 80),
      userId: Number.isInteger(Number(userId)) ? Number(userId) : null,
      source: String(source || "").slice(0, 80),
      section: String(section || "").slice(0, 40),
      metadata: sanitizeMetadata(metadata),
    });
  } catch (error) {
    logger.debug("Failed to record analytics event", error);
    return null;
  }
}

function rememberThrottle(key, nowMs) {
  throttleCache.set(key, nowMs);
  if (throttleCache.size <= THROTTLE_CACHE_LIMIT) return;
  const overflow = throttleCache.size - THROTTLE_CACHE_LIMIT;
  for (const cacheKey of throttleCache.keys()) {
    throttleCache.delete(cacheKey);
    if (throttleCache.size <= THROTTLE_CACHE_LIMIT - overflow) break;
  }
}

function trackThrottledEvent({ throttleKey, throttleMs = 5 * 60 * 1000, now = new Date(), ...event } = {}) {
  const key = String(throttleKey || `${event.name}:${event.userId || ""}:${event.source || ""}:${event.section || ""}`);
  const nowMs = now.getTime();
  const lastMs = throttleCache.get(key) || 0;
  if (nowMs - lastMs < throttleMs) return null;
  rememberThrottle(key, nowMs);
  return trackEvent(event);
}

async function countEventsByName({ since } = {}) {
  const match = since ? { createdAt: { $gte: since } } : {};
  const rows = await AnalyticsEvent.aggregate([
    { $match: match },
    { $group: { _id: "$name", count: { $sum: 1 }, users: { $addToSet: "$userId" } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({
    key: row._id || "unknown",
    count: row.count,
    users: (row.users || []).filter((id) => id !== null).length,
  }));
}

async function countEventsBySection({ name, since } = {}) {
  const match = {
    ...(name ? { name } : {}),
    ...(since ? { createdAt: { $gte: since } } : {}),
  };
  const rows = await AnalyticsEvent.aggregate([
    { $match: match },
    { $group: { _id: "$section", count: { $sum: 1 }, users: { $addToSet: "$userId" } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({
    key: row._id || "unknown",
    count: row.count,
    users: (row.users || []).filter((id) => id !== null).length,
  }));
}

async function countUniqueUsersForEvents({ names = [], since } = {}) {
  const rows = await AnalyticsEvent.aggregate([
    {
      $match: {
        name: { $in: names },
        ...(since ? { createdAt: { $gte: since } } : {}),
      },
    },
    { $group: { _id: "$name", users: { $addToSet: "$userId" }, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((row) => [
    row._id,
    {
      count: row.count,
      users: (row.users || []).filter((id) => id !== null).length,
    },
  ]));
}

module.exports = {
  EVENT_NAMES,
  countEventsByName,
  countEventsBySection,
  countUniqueUsersForEvents,
  sanitizeMetadata,
  trackEvent,
  trackThrottledEvent,
};
