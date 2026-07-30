const messages = require("../messages");
const {
  getSectionEmoji,
  getSectionLabel,
  getTasteLabelEmoji,
  getTasteLabelTitle,
} = require("./ai-section");
const { getAiListItemsFromUser } = require("./users");
const { getAiListDisplayParts } = require("./ai-list-ui");
const { formatUserDisplayName } = require("./profile");
const { MEDIA_SECTIONS } = require("./profile-sharing");

const MEDIA_CAPTION_LIMIT = 1024;
const COPYABLE_TITLE_START = "\uE000";
const COPYABLE_TITLE_END = "\uE001";

function formatPublicFavoritesTelegramText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(COPYABLE_TITLE_START, "<code>")
    .replaceAll(COPYABLE_TITLE_END, "</code>");
}

function compactPublicValue(value, maxLength) {
  const chars = Array.from(String(value || "").trim().replace(/\s+/g, " "));
  return chars.length <= maxLength ? chars.join("") : `${chars.slice(0, maxLength - 1).join("")}…`;
}

function normalizePublicFavorite(item) {
  const title = compactPublicValue(typeof item === "string" ? item : item?.title, 72);
  const metadata = compactPublicValue(typeof item === "string" ? "" : item?.metadata, 120);
  const comment = compactPublicValue(typeof item === "string" ? "" : item?.comment, 96);
  return title ? { title, metadata, comment } : null;
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
    "",
    messages[lang].aiListCopyTitleTip,
    "",
    entry.items.map((item, index) => {
      const { copyableTitle, displayMetadata } = getAiListDisplayParts(item, section, lang);
      return `${index + 1}. ${COPYABLE_TITLE_START}${copyableTitle}${COPYABLE_TITLE_END}`
        + `${displayMetadata ? ` — ${displayMetadata}` : ""}`
        + `${item.comment ? ` — ${item.comment}` : ""}`;
    }).join("\n\n"),
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
    "",
    messages[lang].aiListCopyTitleTip,
    "",
    entry.items.map((item, index) => {
      const { copyableTitle, displayMetadata } = getAiListDisplayParts(item, section, lang);
      return `${index + 1}. ${COPYABLE_TITLE_START}${compactPublicValue(copyableTitle, 60)}${COPYABLE_TITLE_END}`
        + `${displayMetadata ? ` — ${compactPublicValue(displayMetadata, 60)}` : ""}`;
    }).join("\n\n"),
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
  formatPublicFavoritesTelegramText,
  getPublicFavoriteSections,
  normalizePublicFavorite,
};
