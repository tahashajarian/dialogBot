const { getSectionLabel, getTasteLabelTitle } = require("./ai-section");

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
      const sampleCount = Number(taste?.sampleCount) || 0;
      const confidence = Number(taste?.confidence) || 0;

      if (!labelKey || sampleCount < 10 || confidence < 0.55) {
        return null;
      }

      return {
        icon,
        section: getSectionLabel(messages, lang, key),
        label: getTasteLabelTitle(messages, lang, key, labelKey),
      };
    })
    .filter(Boolean);
}

function buildTasteLabelsText(user, lang, messages) {
  const labels = getFinalTasteLabels(user, lang, messages);
  if (!labels.length) {
    return "";
  }

  return [
    "",
    messages[lang].profileTasteLabelsTitle,
    ...labels.map((entry) => `${entry.icon} ${entry.section}: ${entry.label}`),
  ].join("\n");
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
  const locationText = user?.location
    ? (user.location.city || messages[lang].locationSet)
    : messages[lang].locationMissing;

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
  ].join("\n");

  return `${baseText}${tasteLabelsText}`;
}

function buildLocationPayload(locationMessage) {
  return {
    latitude: locationMessage.latitude,
    longitude: locationMessage.longitude,
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
}) {
  const hasCustomPhoto = user?.photoFileId;
  const profileText = buildProfileText(user, lang, messages);

  if (hasCustomPhoto) {
    try {
      return await ctx.replyWithPhoto(user.photoFileId, {
        caption: profileText,
        ...keyboard,
      });
    } catch {
      return ctx.reply(profileText, keyboard);
    }
  }

  try {
    return await ctx.replyWithPhoto(
      { source: defaultProfilePhoto },
      {
        caption: profileText,
        ...keyboard,
      }
    );
  } catch {
    return ctx.reply(profileText, keyboard);
  }
}

module.exports = {
  buildProfileText,
  buildTasteLabelsText,
  buildLocationPayload,
  sendProfileMessage,
  saveLocationProfile,
  isValidTextInput,
  toPlainUser,
};
