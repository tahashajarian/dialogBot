const { getSectionLabel, getTasteLabelEmoji, getTasteLabelTitle } = require("./ai-section");
const RTL_MARK = "\u200F";
const FSI = "\u2068";
const PDI = "\u2069";
const ACTIVE_DISCUSSION_HELP_COMMAND = "/profile_active_discussion_help";

function lineForLang(lang, text) {
  return lang === "fa" ? `${RTL_MARK}${text}` : text;
}

function isolateText(lang, text) {
  const value = String(text || "");
  return lang === "fa" ? `${FSI}${value}${PDI}` : value;
}

function toPlainUser(user) {
  if (!user) return {};
  if (typeof user.toObject === "function") {
    return user.toObject();
  }
  return { ...user };
}

function isValidTextInput(text, maxLength) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (normalized.length > maxLength) return false;
  if (/[<>]/.test(normalized)) return false;
  return true;
}

function getFinalTasteLabels(user, lang, messages) {
  const sections = [
    { key: "movies", icon: "🎬" },
    { key: "music", icon: "🎵" },
    { key: "books", icon: "📚" },
    { key: "random", icon: "🧩" },
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

function buildTasteLabelsText(user, lang, messages, { isOwnProfile = false } = {}) {
  const labels = getFinalTasteLabels(user, lang, messages);
  const lines = [
    "",
    "",
    messages[lang].profileTasteLabelsTitle,
  ];

  if (!labels.length) {
    lines.push(
      isOwnProfile
        ? messages[lang].profileTasteLabelsEmptyHint
        : messages[lang].profileTasteLabelsEmptyPublic,
    );
    return lines.join("\n");
  }

  lines.push(...labels.map((entry) => lineForLang(
    lang,
    `${entry.icon} ${entry.section}: ${isolateText(lang, entry.label)}`,
  )));
  return lines.join("\n");
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
  const displayName = user?.profileName || user?.firstName || "—";
  const city = user?.city || "—";
  const age = Number.isFinite(user?.age) ? `\u2066${String(user.age)}\u2069` : "—";
  const genderMap = {
    female: messages[lang].genderOptionFemaleDisplay,
    male: messages[lang].genderOptionMaleDisplay,
    other: messages[lang].genderOptionOtherDisplay,
  };
  const gender = genderMap[user?.gender] || messages[lang].genderMissing;
  const petPreferenceMap = {
    any: messages[lang].petOptionAnyDisplay,
    none: messages[lang].petOptionNoneDisplay,
    cat: messages[lang].petOptionCatDisplay,
    dog: messages[lang].petOptionDogDisplay,
    bird: messages[lang].petOptionBirdDisplay,
    small_pets: messages[lang].petOptionSmallPetsDisplay,
  };
  const petPreference = petPreferenceMap[user?.petPreference] || "—";
  const bio = user?.bio || messages[lang].bioMissing;
  const locationText = hasValidLocation(user?.location)
    ? (user.location.city || messages[lang].locationSet)
    : messages[lang].locationMissing;
  const activeDiscussionStatus = user?.showActiveDiscussionOnProfile
    ? messages[lang].profileActiveDiscussionShown
    : messages[lang].profileActiveDiscussionHidden;

  const titleIcon = user?.gender === "female" ? "🌸" : user?.gender === "male" ? "💙" : "🪞";
  const genderIcon = "⚧️";
  const tasteLabelsText = buildTasteLabelsText(user, lang, messages, { isOwnProfile });

  const lines = [
    lineForLang(lang, `${titleIcon} ${messages[lang].profileTitle}`),
    lineForLang(lang, `━━━━━━━━━━━━━━`),
    lineForLang(lang, lang === "fa" ? `👤 نام: ${isolateText(lang, displayName)}` : `👤 ${messages[lang].profileName}: ${displayName}`),
    lineForLang(lang, lang === "fa" ? `🏙 شهر: ${isolateText(lang, city)}` : `🏙 ${messages[lang].profileCity}: ${city}`),
    lineForLang(lang, lang === "fa" ? `🎂 سن: ${age}` : `🎂 ${messages[lang].profileAge}: ${age}`),
    lineForLang(lang, `${genderIcon} ${messages[lang].profileGender}: ${isolateText(lang, gender)}`),
    lineForLang(lang, `🐾 ${messages[lang].profilePetPreference}: ${isolateText(lang, petPreference)}`),
    lineForLang(lang, `📍 ${messages[lang].profileLocation}: ${isolateText(lang, locationText)}`),
    lineForLang(lang, `📝 ${messages[lang].profileBio}: ${isolateText(lang, bio)}`),
  ];

  if (isOwnProfile) {
    const activeDiscussionLine = messages[lang].profileActiveDiscussionVisibility
      .replace("{status}", activeDiscussionStatus);
    lines.push(
      `${activeDiscussionLine} (${messages[lang].profileActiveDiscussionHelpButton} ${ACTIVE_DISCUSSION_HELP_COMMAND})`,
    );
  }

  const baseText = lines.join("\n");

  return `${baseText}${tasteLabelsText}`;
}

function buildLocationPayload(locationMessage) {
  if (!hasValidLocation(locationMessage)) {
    return null;
  }

  return {
    latitude: Number(locationMessage.latitude),
    longitude: Number(locationMessage.longitude),
    accuracy: locationMessage.horizontal_accuracy || null,
    city: null,
    sharedAt: new Date(),
  };
}

async function saveLocationProfile({
  userId,
  locationMessage,
  updateProfileField,
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
    .then(async (resolvedCity) => {
      if (!resolvedCity) return;

      await updateProfileField(userId, "location", {
        ...location,
        city: resolvedCity,
      });
    })
    .catch(() => {});

  return location;
}

async function sendProfileMessage({
  ctx,
  user,
  lang,
  keyboard,
  messages,
  defaultProfilePhoto,
  loadingText = "",
  isOwnProfile = false,
  footerText = "",
}) {
  const hasCustomPhoto = user?.photoFileId;
  const profileText = [
    buildProfileText(user, lang, messages, { isOwnProfile }),
    String(footerText || "").trim(),
  ].filter(Boolean).join("\n\n");
  const loadingMessage = loadingText ? await ctx.reply(loadingText) : null;
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

  try {
    sentProfile = await ctx.replyWithPhoto(
      { source: defaultProfilePhoto },
      {
        caption: profileText,
        ...keyboard,
      }
    );
    await deleteMessageIfPossible(ctx, loadingMessage);
    return sentProfile;
  } catch {
    sentProfile = await ctx.reply(profileText, keyboard);
    await deleteMessageIfPossible(ctx, loadingMessage);
    return sentProfile;
  }
}

module.exports = {
  ACTIVE_DISCUSSION_HELP_COMMAND,
  buildProfileText,
  buildTasteLabelsText,
  buildLocationPayload,
  hasValidLocation,
  sendProfileMessage,
  saveLocationProfile,
  isValidTextInput,
  toPlainUser,
};
