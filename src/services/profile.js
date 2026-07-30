const { getSectionLabel, getTasteLabelEmoji, getTasteLabelTitle } = require("./ai-section");
const { localizeInterestChipTitle } = require("./interest-chips");
const { hasLink } = require("./link-detection");
const { operationalLimits } = require("./operational-limits");
const { isCommandLikeText } = require("./command-like-text");
const { getProfileStarCompletionStatus } = require("./star-milestones");
const { starEconomy } = require("./star-settings");
const { isLowQualityProfileName } = require("./ai-input-quality");
const { hasSensitiveName } = require("./sensitive-name-moderation");
const { buildGeoPoint } = require("./nearby");
const RTL_MARK = "\u200F";
const FSI = "\u2068";
const PDI = "\u2069";
const ACTIVE_DISCUSSION_HELP_COMMAND = "/ad_help";

function lineForLang(lang, text) {
  return lang === "fa" ? `${RTL_MARK}${text}` : text;
}

function isolateText(lang, text) {
  const value = String(text || "");
  return lang === "fa" ? `${FSI}${value}${PDI}` : value;
}

function hasText(value) {
  return String(value || "").trim() !== "";
}

function formatUserDisplayName(user = {}, fallback = "کاربر") {
  const baseName = String(user?.profileName || user?.firstName || fallback || "").trim();
  const profileEmoji = String(user?.profileEmoji || "").trim();
  return [baseName, profileEmoji].filter(Boolean).join(" ");
}

function toPlainUser(user) {
  if (!user) return {};
  if (typeof user.toObject === "function") {
    return user.toObject();
  }
  return { ...user };
}

function isValidTextInput(text, maxLength) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (normalized.length > maxLength) return false;
  if (isCommandLikeText(normalized)) return false;
  if (/[<>]/.test(normalized)) return false;
  return true;
}

function hasEmoji(value = "") {
  return /\p{Extended_Pictographic}/u.test(String(value || ""));
}

function normalizeProfileName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function sanitizeProfileNameCandidate(name, maxLength) {
  const sanitized = normalizeProfileName(String(name || "").replace(/\p{Extended_Pictographic}/gu, ""));
  if (!isValidTextInput(sanitized, maxLength)) return "";
  if (hasLink(sanitized)) return "";
  if (isLowQualityProfileName(sanitized)) return "";
  if (hasSensitiveName(sanitized)) return "";
  return sanitized;
}

function validateProfileName(name, maxLength) {
  const normalized = normalizeProfileName(name);
  if (isCommandLikeText(normalized)) {
    return { ok: false, reason: "command_like" };
  }
  if (!isValidTextInput(name, maxLength)) {
    return { ok: false, reason: "invalid_text" };
  }
  if (hasLink(normalized)) {
    return { ok: false, reason: "link" };
  }
  if (hasEmoji(name)) {
    return { ok: false, reason: "emoji" };
  }
  if (hasSensitiveName(normalized)) {
    return { ok: false, reason: "sensitive_content" };
  }
  if (normalized.length < 3) {
    return { ok: false, reason: "too_short" };
  }
  if (isLowQualityProfileName(normalized)) {
    return { ok: false, reason: "low_quality" };
  }
  return { ok: true, value: normalized };
}

function getFinalTasteLabels(user, lang, messages) {
  const sections = [
    { key: "movies", icon: "🎬" },
    { key: "music", icon: "🎵" },
    { key: "books", icon: "📚" },
  ];

  return sections
    .map(({ key, icon }) => {
      const taste = user?.aiTaste?.[key] || {};
      const labelKey = String(taste?.labelKey || "").trim();

      if (!labelKey) {
        return null;
      }

      return {
        icon,
        section: getSectionLabel(messages, lang, key),
        label: `${taste?.emoji || getTasteLabelEmoji(key, labelKey)} ${getTasteLabelTitle(messages, lang, key, labelKey)}`,
      };
    })
    .filter(Boolean);
}

function buildTasteLabelsText(user, lang, messages) {
  const labels = getFinalTasteLabels(user, lang, messages);
  if (!labels.length) return "";

  const lines = [
    "",
    "",
    messages[lang].profileTasteLabelsTitle,
  ];

  lines.push(...labels.map((entry) => lineForLang(
    lang,
    `${entry.icon} ${entry.section}: ${isolateText(lang, entry.label)}`,
  )));
  return lines.join("\n");
}

function getProfileInterestTitles(user, limit = operationalLimits.profileInterestItems, lang = "") {
  const modernItems = user?.aiLists?.random?.topTen;
  const legacyItems = user?.aiTopTenRandom;
  const items = Array.isArray(modernItems) && modernItems.length
    ? modernItems
    : Array.isArray(legacyItems) ? legacyItems : [];
  const seen = new Set();
  const titles = [];

  for (const item of items) {
    const rawTitle = String(typeof item === "string" ? item : item?.title || "").trim();
    const title = lang ? localizeInterestChipTitle(rawTitle, lang) : rawTitle;
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= limit) break;
  }

  return titles;
}

function hasProfileDisplayName(user) {
  return Boolean(String(user?.profileName || user?.firstName || "").trim());
}

function getProfileGenderEmoji(gender) {
  return {
    female: "👩",
    male: "👨",
    other: "🧬",
  }[String(gender || "").trim().toLowerCase()] || "";
}

function getBasicProfileMissingFields(user) {
  const missing = [];
  if (!hasProfileDisplayName(user)) missing.push("name");
  return missing;
}

function buildProfileInterestsText(user, lang, messages) {
  const interests = getProfileInterestTitles(user, operationalLimits.profileInterestItems, lang);
  if (!interests.length) return "";

  const lines = [
    "",
    messages[lang].profileInterestsTitle,
  ];

  const separator = lang === "fa" ? "، " : ", ";
  lines.push(lineForLang(lang, interests.map((title) => isolateText(lang, title)).join(separator)));
  return lines.join("\n");
}

function getAiTopTenCount(user, section) {
  const modernItems = user?.aiLists?.[section]?.topTen;
  const legacyKey = {
    movies: "aiTopTenMovies",
    music: "aiTopTenMusic",
    books: "aiTopTenBooks",
    random: "aiTopTenRandom",
  }[section];
  const legacyItems = legacyKey ? user?.[legacyKey] : [];
  const items = Array.isArray(modernItems) && modernItems.length
    ? modernItems
    : Array.isArray(legacyItems) ? legacyItems : [];
  return items.length;
}

function getNextProfileGrowthFieldKey(user) {
  if (!hasText(user?.city)) return "profileGrowthFieldCity";
  if (!(Number.isFinite(Number(user?.age)) && Number(user.age) > 0)) return "profileGrowthFieldAge";
  if (!["female", "male", "other"].includes(user?.gender)) return "profileGrowthFieldGender";
  if (!hasText(user?.photoFileId)) return "profileGrowthFieldPhoto";
  return "";
}

function buildOwnProfileGrowthHint(user, lang, messages) {
  const firstGoal = Math.max(1, Number(starEconomy.firstTopTenMilestoneItems) || 3);
  const interestsCount = getAiTopTenCount(user, "random");
  if (interestsCount < firstGoal) {
    return messages[lang].profileGrowthHintInterests
      .replace("{remaining}", Math.max(1, firstGoal - interestsCount).toLocaleString(lang === "fa" ? "fa-IR" : "en-US"));
  }

  const mediaSection = ["movies", "music", "books"].find((section) => getAiTopTenCount(user, section) < firstGoal);
  if (mediaSection) {
    const sectionLabel = getSectionLabel(messages, lang, mediaSection);
    return messages[lang].profileGrowthHintTopTen
      .replace("{section}", sectionLabel)
      .replace("{remaining}", Math.max(1, firstGoal - getAiTopTenCount(user, mediaSection)).toLocaleString(lang === "fa" ? "fa-IR" : "en-US"));
  }

  const profileStatus = getProfileStarCompletionStatus(user);
  if (!profileStatus.complete) {
    if (!profileStatus.hasBio) return messages[lang].profileGrowthHintBio;
    if (profileStatus.optionalNeeded > 0) {
      const missingFieldKey = getNextProfileGrowthFieldKey(user);
      if (!missingFieldKey) return "";
      return messages[lang].profileGrowthHintProfile
        .replace("{field}", messages[lang][missingFieldKey]);
    }
  }

  return "";
}

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function deleteMessageIfPossible(ctx, message) {
  const messageId = getMessageId(message);
  if (!messageId || !ctx.deleteMessage) {
    return;
  }

  try {
    await ctx.deleteMessage(messageId);
  } catch {}
}

function hasValidLocation(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function buildProfileText(user, lang, messages, { isOwnProfile = false } = {}) {
  const displayNameWithEmoji = formatUserDisplayName(user, "—");
  const genderMap = {
    female: messages[lang].genderOptionFemaleDisplay,
    male: messages[lang].genderOptionMaleDisplay,
    other: messages[lang].genderOptionOtherDisplay,
  };
  const petPreferenceMap = {
    any: messages[lang].petOptionAnyDisplay,
    none: messages[lang].petOptionNoneDisplay,
    cat: messages[lang].petOptionCatDisplay,
    dog: messages[lang].petOptionDogDisplay,
    bird: messages[lang].petOptionBirdDisplay,
    small_pets: messages[lang].petOptionSmallPetsDisplay,
  };
  const activeDiscussionStatus = user?.showActiveDiscussionOnProfile !== false
    ? messages[lang].profileActiveDiscussionShown
    : messages[lang].profileActiveDiscussionHidden;
  const peopleDiscoveryStatus = user?.showProfileInPeopleDiscovery !== false
    ? messages[lang].profileActiveDiscussionShown
    : messages[lang].profileActiveDiscussionHidden;
  const favoritesStatus = user?.showFavoritesOnProfile !== false
    ? messages[lang].profileActiveDiscussionShown
    : messages[lang].profileActiveDiscussionHidden;

  const titleIcon = "🪞";
  const title = isOwnProfile
    ? messages[lang].profileTitle
    : (messages[lang].profilePublicTitle || messages[lang].profileTitle);
  const genderIcon = "⚧️";
  const interestsText = buildProfileInterestsText(user, lang, messages, { isOwnProfile });
  const tasteLabelsText = buildTasteLabelsText(user, lang, messages, { isOwnProfile });
  const growthHint = isOwnProfile ? buildOwnProfileGrowthHint(user, lang, messages) : "";

  const lines = [
    ...(isOwnProfile ? [lineForLang(lang, messages[lang].profileOwnerTip), ""] : []),
    lineForLang(lang, `${titleIcon} ${title}`),
    lineForLang(lang, lang === "fa" ? `👤 نام: ${isolateText(lang, displayNameWithEmoji)}` : `👤 ${messages[lang].profileName}: ${displayNameWithEmoji}`),
  ];

  if (hasText(user?.city)) {
    lines.push(lineForLang(lang, lang === "fa" ? `🏙 شهر: ${isolateText(lang, user.city)}` : `🏙 ${messages[lang].profileCity}: ${user.city}`));
  }

  if (Number.isFinite(user?.age)) {
    const age = `\u2066${String(user.age)}\u2069`;
    lines.push(lineForLang(lang, lang === "fa" ? `🎂 سن: ${age}` : `🎂 ${messages[lang].profileAge}: ${age}`));
  }

  const gender = genderMap[user?.gender];
  if (gender) {
    lines.push(lineForLang(lang, `${genderIcon} ${messages[lang].profileGender}: ${isolateText(lang, gender)}`));
  }

  const petPreference = petPreferenceMap[user?.petPreference];
  if (starEconomy.profilePetPreferenceEnabled && petPreference) {
    lines.push(lineForLang(lang, `🐾 ${messages[lang].profilePetPreference}: ${isolateText(lang, petPreference)}`));
  }

  if (starEconomy.profileLocationEnabled && hasValidLocation(user?.location)) {
    const locationText = user.location.city || messages[lang].locationSet;
    lines.push(lineForLang(lang, `📍 ${messages[lang].profileLocation}: ${isolateText(lang, locationText)}`));
  }

  if (hasText(user?.bio)) {
    lines.push(lineForLang(lang, `📝 ${messages[lang].profileBio}: ${isolateText(lang, user.bio)}`));
  }

  if (isOwnProfile) {
    const starBalance = Math.max(0, Math.round(Number(user?.starBalance) || 0))
      .toLocaleString(lang === "fa" ? "fa-IR" : "en-US");
    lines.push(lineForLang(lang, `⭐ ${messages[lang].profileStarsLabel}: ${starBalance}`));
    lines.push(messages[lang].profilePeopleDiscoveryVisibility
      .replace("{status}", peopleDiscoveryStatus));
    lines.push(messages[lang].profileFavoritesVisibility
      .replace("{status}", favoritesStatus));
    const activeDiscussionLine = messages[lang].profileActiveDiscussionVisibility
      .replace("{status}", activeDiscussionStatus);
    lines.push(user?.activeDiscussionHelpAcknowledgedAt
      ? activeDiscussionLine
      : `${activeDiscussionLine} (${messages[lang].profileActiveDiscussionHelpButton} ${ACTIVE_DISCUSSION_HELP_COMMAND})`);
  }

  const baseText = lines.join("\n");
  const privateGrowthFooter = growthHint ? `\n\n${lineForLang(lang, growthHint)}` : "";

  const visibleTasteLabelsText = isOwnProfile || user?.showFavoritesOnProfile !== false
    ? tasteLabelsText
    : "";
  return `${baseText}${interestsText}${visibleTasteLabelsText}${privateGrowthFooter}`;
}

function buildLocationPayload(locationMessage) {
  if (!hasValidLocation(locationMessage)) {
    return null;
  }

  return {
    latitude: Number(locationMessage.latitude),
    longitude: Number(locationMessage.longitude),
    point: buildGeoPoint(locationMessage),
    accuracy: locationMessage.horizontal_accuracy || null,
    city: null,
    cityLookupAttemptedAt: null,
    sharedAt: new Date(),
  };
}

async function saveLocationProfile({
  userId,
  locationMessage,
  updateProfileField,
  updateLocationCityForSharedAt,
  updateUserState,
  resolveCityByCoordinates,
}) {
  const location = buildLocationPayload(locationMessage);
  if (!location) {
    return null;
  }

  await updateProfileField(userId, "location", location);
  await updateUserState(userId, "idle");

  resolveCityByCoordinates(location.latitude, location.longitude)
    .then((resolvedCity) => updateLocationCityForSharedAt?.(
        userId,
        location.sharedAt,
        resolvedCity || null,
        new Date(),
      ))
    .catch(() => updateLocationCityForSharedAt?.(
        userId,
        location.sharedAt,
        null,
        new Date(),
      ))
    .catch(() => {});

  return location;
}

async function sendProfileMessage({
  ctx,
  user,
  lang,
  keyboard,
  messages,
  loadingText = "",
  isOwnProfile = false,
  footerText = "",
}) {
  const hasCustomPhoto = user?.photoFileId;
  const profileText = [
    buildProfileText(user, lang, messages, { isOwnProfile }),
    String(footerText || "").trim(),
  ].filter(Boolean).join("\n\n");
  const loadingMessage = hasCustomPhoto && loadingText ? await ctx.reply(loadingText) : null;
  let sentProfile;

  if (hasCustomPhoto) {
    try {
      sentProfile = await ctx.replyWithPhoto(user.photoFileId, {
        caption: profileText,
        ...keyboard,
      });
      await deleteMessageIfPossible(ctx, loadingMessage);
      return sentProfile;
    } catch {
      sentProfile = await ctx.reply(profileText, keyboard);
      await deleteMessageIfPossible(ctx, loadingMessage);
      return sentProfile;
    }
  }

  sentProfile = await ctx.reply(profileText, keyboard);
  await deleteMessageIfPossible(ctx, loadingMessage);
  return sentProfile;
}

module.exports = {
  ACTIVE_DISCUSSION_HELP_COMMAND,
  buildProfileText,
  buildProfileInterestsText,
  buildOwnProfileGrowthHint,
  buildTasteLabelsText,
  getBasicProfileMissingFields,
  getProfileGenderEmoji,
  getProfileInterestTitles,
  buildLocationPayload,
  formatUserDisplayName,
  hasValidLocation,
  sendProfileMessage,
  saveLocationProfile,
  isValidTextInput,
  sanitizeProfileNameCandidate,
  validateProfileName,
  toPlainUser,
};
