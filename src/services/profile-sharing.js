const messages = require("../messages");
const { getSectionLabel, getTasteLabelEmoji, getTasteLabelTitle } = require("./ai-section");
const { getAiListItemsFromUser } = require("./users");
const { getProfileInterestTitles } = require("./profile");
const { starEconomy } = require("./star-settings");
const { formatStarNumber } = require("./stars-ui");

const SHARE_INTEREST_LIMIT = 5;
const SHARE_PROFILE_MIN_FAVORITES = 3;
const SHARE_VALUE_MAX_LENGTH = 52;
const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
const MEDIA_SECTIONS = Object.freeze(["movies", "music", "books"]);

function compactShareValue(value, maxLength = SHARE_VALUE_MAX_LENGTH) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (Array.from(normalized).length <= maxLength) return normalized;
  return `${Array.from(normalized).slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function getShareTasteLines(user, lang) {
  return MEDIA_SECTIONS.map((section) => {
    const taste = user?.aiTaste?.[section] || {};
    const labelKey = String(taste.labelKey || "").trim();
    if (!labelKey) return "";
    const sectionLabel = getSectionLabel(messages, lang, section);
    const label = getTasteLabelTitle(messages, lang, section, labelKey);
    const emoji = taste.emoji || getTasteLabelEmoji(section, labelKey);
    return `${sectionLabel}: ${emoji} ${compactShareValue(label)}`;
  }).filter(Boolean);
}

function getShareFavoriteLines(user, lang) {
  return MEDIA_SECTIONS.map((section) => {
    const favorite = getAiListItemsFromUser(user, section, "topTen")[0];
    const title = compactShareValue(typeof favorite === "string" ? favorite : favorite?.title);
    if (!title) return "";
    return `${getSectionLabel(messages, lang, section)}: ${title}`;
  }).filter(Boolean);
}

function buildShareableProfileCaption({ user, lang = "fa", link = "" } = {}) {
  const profileEmoji = String(user?.profileEmoji || "").trim();
  const interests = getProfileInterestTitles(user, SHARE_INTEREST_LIMIT, lang)
    .map((title) => compactShareValue(title, 36));
  const showsFavorites = user?.showFavoritesOnProfile !== false;
  const tasteLines = showsFavorites ? getShareTasteLines(user, lang) : [];
  const favoriteLines = showsFavorites ? getShareFavoriteLines(user, lang) : [];
  const detailBlocks = [];

  if (interests.length) {
    detailBlocks.push(messages[lang].profileShareInterests.replace("{items}", interests.join(lang === "fa" ? "، " : ", ")));
  }
  if (tasteLines.length) {
    detailBlocks.push([messages[lang].profileShareTasteTitle, ...tasteLines].join("\n"));
  }
  if (favoriteLines.length) {
    detailBlocks.push([messages[lang].profileShareFavoritesTitle, ...favoriteLines].join("\n"));
  }

  const title = messages[lang].profileShareTitle.replace("{emoji}", profileEmoji ? ` ${profileEmoji}` : "");
  const callToAction = showsFavorites
    ? messages[lang].profileShareCallToAction
    : messages[lang].profileShareCallToActionWithoutFavorites;
  const destination = [
    callToAction.replace("{emoji}", profileEmoji ? ` ${profileEmoji}` : ""),
    String(link || "").trim(),
  ].filter(Boolean).join("\n");
  const footer = messages[lang].profileShareFooter;
  const compose = () => [title, ...detailBlocks, destination, footer].filter(Boolean).join("\n\n");

  while (detailBlocks.length && compose().length > TELEGRAM_CAPTION_MAX_LENGTH) {
    detailBlocks.pop();
  }
  return compose().slice(0, TELEGRAM_CAPTION_MAX_LENGTH);
}

function buildProfileShareGuidance(lang = "fa", settings = starEconomy, { showsFavorites = true } = {}) {
  const reward = Math.max(0, Math.round(Number(settings?.rewardExternalReferral) || 0));
  if (!settings?.economyEnabled || !settings?.earningEnabled || reward === 0) {
    return showsFavorites
      ? messages[lang].profileShareGuidanceNoReward
      : messages[lang].profileShareGuidanceNoRewardWithoutFavorites;
  }
  return messages[lang].profileShareGuidance
    .replace("{reward}", formatStarNumber(reward, lang));
}

function hasPublicMediaFavorites(user) {
  return user?.showFavoritesOnProfile !== false
    && MEDIA_SECTIONS.some((section) => getAiListItemsFromUser(user, section, "topTen").length > 0);
}

function hasShareableMediaFavorites(user) {
  return MEDIA_SECTIONS.some(
    (section) => getAiListItemsFromUser(user, section, "topTen").length >= SHARE_PROFILE_MIN_FAVORITES,
  );
}

module.exports = {
  MEDIA_SECTIONS,
  SHARE_INTEREST_LIMIT,
  SHARE_PROFILE_MIN_FAVORITES,
  TELEGRAM_CAPTION_MAX_LENGTH,
  buildProfileShareGuidance,
  buildShareableProfileCaption,
  compactShareValue,
  getShareFavoriteLines,
  hasShareableMediaFavorites,
  hasPublicMediaFavorites,
};
