const DISCUSSION_LANGUAGES = ["fa", "en"];
const DISCUSSION_LANGUAGE_FILTERS = ["fa", "en", "all"];

function normalizeDiscussionLanguage(value, fallback = "fa") {
  const normalizedFallback = DISCUSSION_LANGUAGES.includes(String(fallback || "").toLowerCase()) ? String(fallback).toLowerCase() : "fa";
  const normalized = String(value || "").trim().toLowerCase();
  return DISCUSSION_LANGUAGES.includes(normalized) ? normalized : normalizedFallback;
}

function normalizeDiscussionLanguageFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return DISCUSSION_LANGUAGE_FILTERS.includes(normalized) ? normalized : "";
}

function getEffectiveDiscussionLanguageFilter(user = {}) {
  return normalizeDiscussionLanguageFilter(user.discussionLanguageFilter)
    || normalizeDiscussionLanguage(user.lang);
}

function getDiscussionLanguageLabel(messages, uiLang, language) {
  const normalized = normalizeDiscussionLanguage(language);
  return normalized === "en" ? messages[uiLang].discussionLanguageEnglish : messages[uiLang].discussionLanguagePersian;
}

module.exports = {
  DISCUSSION_LANGUAGES,
  normalizeDiscussionLanguage,
  normalizeDiscussionLanguageFilter,
  getEffectiveDiscussionLanguageFilter,
  getDiscussionLanguageLabel,
};
