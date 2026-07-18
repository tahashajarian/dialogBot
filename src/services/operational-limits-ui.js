const { operationalLimits } = require("./operational-limits");
const { starEconomy } = require("./star-settings");
const { DISCUSSION_OWNED_HARD_LIMIT } = require("../constants/limits");

function formatOperationalLimitsText(template, overrides = {}) {
  const values = {
    topTenLimit: operationalLimits.aiTopTenItems,
    watchlistLimit: operationalLimits.aiWatchlistItems,
    savedProfilesLimit: operationalLimits.savedProfiles,
    suggestionLimit: operationalLimits.aiSuggestionsPerWindow,
    suggestionWindowMinutes: operationalLimits.aiSuggestionWindowMinutes,
    activeDiscussionsLimit: operationalLimits.activeOwnedDiscussions,
    discussionMessageLimit: operationalLimits.discussionMessagesPerWindow,
    discussionMessageWindowMinutes: operationalLimits.discussionMessageWindowMinutes,
    invitationLimit: operationalLimits.directInvitationsPerWindow,
    invitationWindowHours: operationalLimits.directInvitationWindowHours,
    paidExtraDiscussionCost: starEconomy.paidExtraDiscussionCost,
    ownedDiscussionHardLimit: DISCUSSION_OWNED_HARD_LIMIT,
    ...overrides,
  };
  const formatted = Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    String(template || ""),
  );
  return formatted
    .replace(
      /• Top 10: 10 items; section list: 100 items; saved profiles: 50\n• Suggestions: 10 per hour in each section\n• Active discussions created: 3; 30 messages per 10 minutes in discussions\n• Direct invitations: 3 per 24 hours/,
      `• Top 10: ${values.topTenLimit} items; section list: ${values.watchlistLimit} items; saved profiles: ${values.savedProfilesLimit}\n• Suggestions: ${values.suggestionLimit} per ${values.suggestionWindowMinutes} minutes in each section\n• Active discussions created: ${values.activeDiscussionsLimit}; ${values.discussionMessageLimit} messages per ${values.discussionMessageWindowMinutes} minutes in discussions\n• In-bot saved-profile invitations: ${values.invitationLimit} per ${values.invitationWindowHours} hours`,
    )
    .replace(
      /• هر تاپ ۱۰: ۱۰ مورد؛ لیست هر بخش: ۱۰۰ مورد؛ ذخیره‌شده‌ها: ۵۰ پروفایل\n• پیشنهادها: ۱۰ پیشنهاد در ساعت برای هر بخش\n• ساخت گفت‌وگوی فعال: ۳ گفت‌وگو؛ پیام گفت‌وگو: ۳۰ پیام در ۱۰ دقیقه\n• دعوت مستقیم: ۳ دعوت در هر ۲۴ ساعت/,
      `• هر تاپ ۱۰: ${values.topTenLimit} مورد؛ لیست هر بخش: ${values.watchlistLimit} مورد؛ ذخیره‌شده‌ها: ${values.savedProfilesLimit} پروفایل\n• پیشنهادها: ${values.suggestionLimit} پیشنهاد در هر ${values.suggestionWindowMinutes} دقیقه برای هر بخش\n• ساخت گفت‌وگوی فعال: ${values.activeDiscussionsLimit} گفت‌وگو؛ پیام گفت‌وگو: ${values.discussionMessageLimit} پیام در ${values.discussionMessageWindowMinutes} دقیقه\n• دعوت داخل بات از ذخیره‌شده‌ها: ${values.invitationLimit} دعوت در هر ${values.invitationWindowHours} ساعت`,
    );
}

module.exports = { formatOperationalLimitsText };
