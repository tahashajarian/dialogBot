const messages = require("../messages");
const {
  getSectionEmoji,
  getSectionLabel,
  getTasteLabelEmoji,
  getTasteLabelTitle,
} = require("./ai-section");
const { getAiListItemsFromUser } = require("./users");
const { formatUserDisplayName, PROFILE_CARD_DIVIDER } = require("./profile");
const { MEDIA_SECTIONS } = require("./profile-sharing");

const MEDIA_CAPTION_LIMIT = 1024;

function compactPublicValue(value, maxLength) {
  const chars = Array.from(String(value || "").trim().replace(/\s+/g, " "));
  return chars.length <= maxLength ? chars.join("") : `${chars.slice(0, maxLength - 1).join("")}…`;
}

function normalizePublicFavorite(item) {
  const title = compactPublicValue(typeof item === "string" ? item : item?.title, 72);
  const comment = compactPublicValue(typeof item === "string" ? "" : item?.comment, 96);
  return title ? { title, comment } : null;
}

function getPublicFavoriteSections(user) {
  if (user?.showFavoritesOnProfile === false) return [];
  return MEDIA_SECTIONS.map((section) => ({
    section,
    items: getAiListItemsFromUser(user, section, "topTen")
      .map(normalizePublicFavorite)
      .filter(Boolean),
  })).filter((entry) => entry.items.length > 0);
}

function buildPublicFavoritesHubText(user, lang) {
  const displayName = formatUserDisplayName(user, messages[lang].profileShareFallbackName);
  const sections = getPublicFavoriteSections(user);
  if (!sections.length) return messages[lang].profileFavoritesEmpty;
  const locale = lang === "fa" ? "fa-IR" : "en-US";
  const lines = [
    messages[lang].profileFavoritesHubTitle.replace("{name}", displayName),
    PROFILE_CARD_DIVIDER,
    "",
    ...sections.map(({ section, items }) => messages[lang].profileFavoritesSectionCount
      .replace("{emoji}", getSectionEmoji(section))
      .replace("{section}", getSectionLabel(messages, lang, section))
      .replace("{count}", items.length.toLocaleString(locale))),
    "",
    messages[lang].profileFavoritesHubPrompt,
  ];
  return lines.join("\n").slice(0, MEDIA_CAPTION_LIMIT);
}

function buildPublicFavoritesSectionText(user, lang, section) {
  const entry = getPublicFavoriteSections(user).find((candidate) => candidate.section === section);
  if (!entry) return messages[lang].profileFavoritesEmpty;
  const displayName = formatUserDisplayName(user, messages[lang].profileShareFallbackName);
  const lines = [
    messages[lang].profileFavoritesSectionTitle
      .replace("{name}", displayName)
      .replace("{emoji}", getSectionEmoji(section))
      .replace("{section}", getSectionLabel(messages, lang, section)),
    PROFILE_CARD_DIVIDER,
    "",
    ...entry.items.map((item, index) => `${index + 1}. ${item.title}${item.comment ? ` — ${item.comment}` : ""}`),
  ];
  const taste = user?.aiTaste?.[section] || {};
  const labelKey = String(taste.labelKey || "").trim();
  if (labelKey) {
    const label = `${taste.emoji || getTasteLabelEmoji(section, labelKey)} ${getTasteLabelTitle(messages, lang, section, labelKey)}`;
    lines.push("", messages[lang].profileFavoritesTasteLabel.replace("{label}", label));
  }
  let text = lines.join("\n");
  if (text.length <= MEDIA_CAPTION_LIMIT) return text;

  const compactLines = [
    lines[0],
    PROFILE_CARD_DIVIDER,
    "",
    ...entry.items.map((item, index) => `${index + 1}. ${compactPublicValue(item.title, 60)}`),
  ];
  if (labelKey) compactLines.push("", lines.at(-1));
  text = compactLines.join("\n");
  return text.length <= MEDIA_CAPTION_LIMIT
    ? text
    : `${text.slice(0, MEDIA_CAPTION_LIMIT - 1)}…`;
}

module.exports = {
  buildPublicFavoritesHubText,
  buildPublicFavoritesSectionText,
  compactPublicValue,
  getPublicFavoriteSections,
  normalizePublicFavorite,
};
