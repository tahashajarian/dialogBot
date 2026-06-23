const { operationalLimits } = require("./operational-limits");

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
    ...overrides,
  };
  const formatted = Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    String(template || ""),
  );
  return formatted
    .replace(
      /• Top 10: 10 items; regular list: 100 items; saved profiles: 50\n• Suggestions: 10 per hour in each section\n• Active discussions created: 3; 30 messages per 10 minutes in discussions\n• Direct invitations: 3 per 24 hours/,
      `• Top 10: ${values.topTenLimit} items; regular list: ${values.watchlistLimit} items; saved profiles: ${values.savedProfilesLimit}\n• Suggestions: ${values.suggestionLimit} per ${values.suggestionWindowMinutes} minutes in each section\n• Active discussions created: ${values.activeDiscussionsLimit}; ${values.discussionMessageLimit} messages per ${values.discussionMessageWindowMinutes} minutes in discussions\n• In-bot saved-profile invitations: ${values.invitationLimit} per ${values.invitationWindowHours} hours`,
    )
    .replace(
      /• هر تاپ ۱۰: ۱۰ مورد؛ هر لیست معمولی: ۱۰۰ مورد؛ ذخیره‌شده‌ها: ۵۰ پروفایل\n• پیشنهادها: ۱۰ پیشنهاد در ساعت برای هر بخش\n• ساخت بحث فعال: ۳ بحث؛ پیام بحث: ۳۰ پیام در ۱۰ دقیقه\n• دعوت مستقیم: ۳ دعوت در هر ۲۴ ساعت/,
      `• هر تاپ ۱۰: ${values.topTenLimit} مورد؛ هر لیست معمولی: ${values.watchlistLimit} مورد؛ ذخیره‌شده‌ها: ${values.savedProfilesLimit} پروفایل\n• پیشنهادها: ${values.suggestionLimit} پیشنهاد در هر ${values.suggestionWindowMinutes} دقیقه برای هر بخش\n• ساخت بحث فعال: ${values.activeDiscussionsLimit} بحث؛ پیام بحث: ${values.discussionMessageLimit} پیام در ${values.discussionMessageWindowMinutes} دقیقه\n• دعوت داخل بات از ذخیره‌شده‌ها: ${values.invitationLimit} دعوت در هر ${values.invitationWindowHours} ساعت`,
    );
}

module.exports = { formatOperationalLimitsText };
