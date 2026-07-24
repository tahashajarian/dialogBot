const User = require("../models/user");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");

const SECTION_TIP_KEYS = Object.freeze([
  "discussions",
  "activeDiscussions",
  "discussionLeaveRecent",
  "favorites",
  "forLaterInline",
  "people",
]);

function hasSectionTipBeenShown(user, key) {
  if (!SECTION_TIP_KEYS.includes(key)) return false;
  return Boolean(user?.sectionTipsShownAt?.[key]);
}

async function markSectionTipShown(userId, key, shownAt = new Date()) {
  const normalizedUserId = Number(userId);
  const normalizedDate = shownAt instanceof Date ? shownAt : new Date(shownAt);
  if (
    !Number.isInteger(normalizedUserId)
    || normalizedUserId <= 0
    || !SECTION_TIP_KEYS.includes(key)
    || !Number.isFinite(normalizedDate.getTime())
  ) {
    return null;
  }
  return User.findOneAndUpdate(
    {
      userId: normalizedUserId,
      [`sectionTipsShownAt.${key}`]: null,
    },
    { $set: { [`sectionTipsShownAt.${key}`]: normalizedDate } },
    { returnDocument: "after" },
  );
}

async function markSectionTipShownForContext(ctx, key, shownAt = new Date()) {
  const normalizedDate = shownAt instanceof Date ? shownAt : new Date(shownAt);
  if (!SECTION_TIP_KEYS.includes(key) || !Number.isFinite(normalizedDate.getTime())) return null;
  if (!ctx?.user?._id && !ctx?.persistSectionTips) {
    if (!ctx?.user) return null;
    ctx.user.sectionTipsShownAt = ctx.user.sectionTipsShownAt || {};
    ctx.user.sectionTipsShownAt[key] = normalizedDate;
    return ctx.user;
  }
  const marked = await markSectionTipShown(ctx?.userId, key, normalizedDate);
  if (marked && ctx?.user) {
    ctx.user.sectionTipsShownAt = ctx.user.sectionTipsShownAt || {};
    ctx.user.sectionTipsShownAt[key] = normalizedDate;
  }
  if (marked) {
    void trackEvent({
      name: EVENT_NAMES.sectionTipExposed,
      userId: ctx?.userId,
      source: "first_visit",
      section: key,
      metadata: { tipKey: key },
    });
  }
  return marked;
}

module.exports = {
  SECTION_TIP_KEYS,
  hasSectionTipBeenShown,
  markSectionTipShown,
  markSectionTipShownForContext,
};
