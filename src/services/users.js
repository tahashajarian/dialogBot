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

function normalizeAiListItems(items = []) {
  const unique = new Set();
  const normalized = [];

  for (const item of items) {
    const clean = normalizeAiListItem(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (unique.has(key)) continue;
    unique.add(key);
    normalized.push(clean);
  }

  return normalized;
}

async function addAiListItem(userId, field, item, maxItems) {
  const cleanItem = normalizeAiListItem(item);
  if (!cleanItem) {
    return { ok: false, reason: "empty" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = normalizeAiListItems(user[field] || []);
  const exists = current.some((entry) => entry.toLowerCase() === cleanItem.toLowerCase());
  if (exists) {
    return { ok: false, reason: "exists", items: current };
  }

  if (current.length >= maxItems) {
    return { ok: false, reason: "limit", items: current };
  }

  const updated = [...current, cleanItem];
  await updateProfileField(userId, field, updated);
  return { ok: true, items: updated };
}

async function removeAiListItem(userId, field, item) {
  const cleanItem = normalizeAiListItem(item);
  if (!cleanItem) {
    return { ok: false, reason: "empty" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = normalizeAiListItems(user[field] || []);
  const updated = current.filter((entry) => entry.toLowerCase() !== cleanItem.toLowerCase());
  if (updated.length === current.length) {
    return { ok: false, reason: "not_found", items: current };
  }

  await updateProfileField(userId, field, updated);
  return { ok: true, items: updated };
}

module.exports = {
  getOrCreateUser,
  updateLanguage,
  updateProfileField,
  updateUserState,
  addAiListItem,
  removeAiListItem,
  normalizeAiListItem,
  normalizeAiListItems,
};
