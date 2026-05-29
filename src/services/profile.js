const { getSectionLabel, getTasteLabelEmoji, getTasteLabelTitle } = require("./ai-section");

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

function buildTasteLabelsText(user, lang, messages) {
  const labels = getFinalTasteLabels(user, lang, messages);
  const lines = [
    "",
    "",
    messages[lang].profileTasteLabelsTitle,
  ];

  if (!labels.length) {
    lines.push(messages[lang].profileTasteLabelsEmptyHint);
    return lines.join("\n");
  }

  lines.push(...labels.map((entry) => `${entry.icon} ${entry.section}: ${entry.label}`));
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

function buildProfileText(user, lang, messages) {
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
  const discoveryStatus = user?.profileDiscoverable
    ? messages[lang].profileDiscoverabilityPublic
    : messages[lang].profileDiscoverabilityPrivate;
  const activeDiscussionStatus = user?.showActiveDiscussionOnProfile
    ? messages[lang].profileActiveDiscussionShown
    : messages[lang].profileActiveDiscussionHidden;

  const titleIcon = user?.gender === "female" ? "🌸" : user?.gender === "male" ? "💙" : "🪞";
  const genderIcon = "⚧️";
  const tasteLabelsText = buildTasteLabelsText(user, lang, messages);

  const baseText = [
    `${titleIcon} ${messages[lang].profileTitle}`,
    `━━━━━━━━━━━━━━`,
    lang === "fa" ? `👤 نام: ${displayName}` : `👤 ${messages[lang].profileName}: ${displayName}`,
    lang === "fa" ? `🏙 شهر: ${city}` : `🏙 ${messages[lang].profileCity}: ${city}`,
    lang === "fa" ? `🎂 سن: ${age}` : `🎂 ${messages[lang].profileAge}: ${age}`,
    `${genderIcon} ${messages[lang].profileGender}: ${gender}`,
    `🐾 ${messages[lang].profilePetPreference}: ${petPreference}`,
    `📍 ${messages[lang].profileLocation}: ${locationText}`,
    `📝 ${messages[lang].profileBio}: ${bio}`,
    messages[lang].profileDiscoverability.replace("{status}", discoveryStatus),
    messages[lang].profileActiveDiscussionVisibility.replace("{status}", activeDiscussionStatus),
  ].join("\n");

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
}) {
  const hasCustomPhoto = user?.photoFileId;
  const profileText = buildProfileText(user, lang, messages);
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
  buildProfileText,
  buildTasteLabelsText,
  buildLocationPayload,
  hasValidLocation,
  sendProfileMessage,
  saveLocationProfile,
  isValidTextInput,
  toPlainUser,
};
