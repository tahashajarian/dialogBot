const User = require("../models/user");

async function getOrCreateUser(from) {
  if (!from) return null;

  let user = await User.findOne({ userId: from.id });

  if (!user) {
    user = await User.create({
      userId: from.id,
      username: from.username,
      firstName: from.first_name,
      profileName: from.first_name,
      age: null,
      lang: "fa",
    });
  }

  return user;
}

async function updateLanguage(userId, newLang) {
  return await User.findOneAndUpdate(
    { userId },
    { lang: newLang },
    { returnDocument: "after" },
  );
}

async function updateProfileField(userId, field, value) {
  return await User.findOneAndUpdate(
    { userId },
    { [field]: value },
    { returnDocument: "after" },
  );
}

async function updateUserState(userId, state) {
  return await User.findOneAndUpdate(
    { userId },
    { state },
    { returnDocument: "after" },
  );
}

function normalizeAiListItem(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeAiListComment(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeAiListItems(items = []) {
  const unique = new Set();
  const normalized = [];

  for (const item of items) {
    const titleSource = typeof item === "string" ? item : item?.title;
    const commentSource = typeof item === "string" ? "" : item?.comment;
    const title = normalizeAiListItem(titleSource);
    const comment = normalizeAiListComment(commentSource);
    if (!title) continue;
    const key = title.toLowerCase();
    if (unique.has(key)) continue;
    unique.add(key);
    normalized.push({ title, comment });
  }

  return normalized;
}

const AI_SECTIONS = ["movies", "music", "books", "random"];
const LEGACY_FIELDS = {
  movies: { watchlist: "aiWatchlistMovies", topTen: "aiTopTenMovies" },
  music: { watchlist: "aiWatchlistMusic", topTen: "aiTopTenMusic" },
  books: { watchlist: "aiWatchlistBooks", topTen: "aiTopTenBooks" },
  random: { watchlist: "aiWatchlistRandom", topTen: "aiTopTenRandom" },
};

function getLegacyAiListItems(user, section, listType) {
  const field = LEGACY_FIELDS[section]?.[listType];
  if (!field) return [];
  return normalizeAiListItems(user?.[field] || []);
}

function hasStructuredAiList(user, section, listType) {
  return Array.isArray(user?.aiLists?.[section]?.[listType]);
}

function getAiListItemsFromUser(user, section, listType) {
  const legacyItems = getLegacyAiListItems(user, section, listType);

  if (hasStructuredAiList(user, section, listType)) {
    const structuredItems = normalizeAiListItems(user?.aiLists?.[section]?.[listType] || []);
    if (structuredItems.length > 0 || legacyItems.length === 0) {
      return structuredItems;
    }
  }

  return legacyItems;
}

function getAiListTitlesFromUser(user, section, listType) {
  return getAiListItemsFromUser(user, section, listType).map((entry) => entry.title);
}

async function addAiListItem(userId, section, listType, item, maxItems) {
  const title = normalizeAiListItem(item?.title || item);
  const comment = normalizeAiListComment(item?.comment);
  if (!title) {
    return { ok: false, reason: "empty" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = getAiListItemsFromUser(user, section, listType);
  const exists = current.some((entry) => entry.title.toLowerCase() === title.toLowerCase());
  if (exists) {
    return { ok: false, reason: "exists", items: current };
  }

  if (current.length >= maxItems) {
    return { ok: false, reason: "limit", items: current };
  }

  const updated = [...current, { title, comment }];
  await updateProfileField(userId, `aiLists.${section}.${listType}`, updated);
  return { ok: true, items: updated };
}

async function removeAiListItem(userId, section, listType, item) {
  const cleanItem = normalizeAiListItem(item);
  if (!cleanItem) {
    return { ok: false, reason: "empty" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = getAiListItemsFromUser(user, section, listType);
  const updated = current.filter((entry) => entry.title.toLowerCase() !== cleanItem.toLowerCase());
  if (updated.length === current.length) {
    return { ok: false, reason: "not_found", items: current };
  }

  await updateProfileField(userId, `aiLists.${section}.${listType}`, updated);
  return { ok: true, items: updated };
}

module.exports = {
  AI_SECTIONS,
  getOrCreateUser,
  updateLanguage,
  updateProfileField,
  updateUserState,
  addAiListItem,
  removeAiListItem,
  normalizeAiListItem,
  normalizeAiListComment,
  normalizeAiListItems,
  getAiListItemsFromUser,
  getAiListTitlesFromUser,
};
