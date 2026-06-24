const mongoose = require("mongoose");
const UserTasteIndex = require("../models/user-taste-index");
const User = require("../models/user");
const { normalizeAiInput } = require("./input-normalization");
const { canonicalizeInterestChipTitle } = require("./interest-chips");

const AI_TASTE_INDEX_SECTIONS = ["movies", "music", "books", "random"];
const AI_TASTE_INDEX_LIST_TYPES = ["topTen", "watchlist"];
const AI_TASTE_INDEX_MIN_SHARED_ITEMS = 3;
const LEGACY_FIELDS = {
  movies: { watchlist: "aiWatchlistMovies", topTen: "aiTopTenMovies" },
  music: { watchlist: "aiWatchlistMusic", topTen: "aiTopTenMusic" },
  books: { watchlist: "aiWatchlistBooks", topTen: "aiTopTenBooks" },
  random: { watchlist: "aiWatchlistRandom", topTen: "aiTopTenRandom" },
};

function normalizeTasteIndexTitle(value, section, listType) {
  const raw = typeof value === "string" ? value : value?.title;
  const canonical = section === "random" && listType === "topTen"
    ? canonicalizeInterestChipTitle(raw)
    : raw;
  return normalizeAiInput(String(canonical || "").trim().replace(/\s+/g, " ").slice(0, 80));
}

function getStructuredItems(user, section, listType) {
  const items = user?.aiLists?.[section]?.[listType];
  return Array.isArray(items) ? items : null;
}

function getLegacyItems(user, section, listType) {
  const field = LEGACY_FIELDS[section]?.[listType];
  const items = field ? user?.[field] : [];
  return Array.isArray(items) ? items : [];
}

function getTasteIndexListItems(user, section, listType) {
  const structured = getStructuredItems(user, section, listType);
  const legacy = getLegacyItems(user, section, listType);
  if (structured && (structured.length > 0 || legacy.length === 0)) return structured;
  return legacy;
}

function buildUserTasteIndexSections(user = {}) {
  const sections = {};
  for (const section of AI_TASTE_INDEX_SECTIONS) {
    const items = [];
    for (const listType of AI_TASTE_INDEX_LIST_TYPES) {
      for (const item of getTasteIndexListItems(user, section, listType)) {
        const normalized = normalizeTasteIndexTitle(item, section, listType);
        if (normalized) items.push(normalized);
      }
    }
    const unique = [...new Set(items)];
    if (unique.length) sections[section] = unique;
  }
  return sections;
}

async function syncUserTasteIndex(userOrId, { sections = AI_TASTE_INDEX_SECTIONS, now = new Date() } = {}) {
  if (mongoose.connection.readyState !== 1) return { ok: true, skipped: true, reason: "db_unavailable" };
  const user = typeof userOrId === "object" && userOrId !== null
    ? userOrId
    : await User.findOne({ userId: Number(userOrId) }).lean();
  if (!user) return { ok: false, reason: "missing_user" };

  const userId = Number(user.userId);
  const sectionSet = new Set((sections || AI_TASTE_INDEX_SECTIONS).filter((section) => AI_TASTE_INDEX_SECTIONS.includes(section)));
  const index = buildUserTasteIndexSections(user);

  await Promise.all([...sectionSet].map(async (section) => {
    const items = index[section] || [];
    if (!items.length) {
      await UserTasteIndex.deleteOne({ userId, section });
      return;
    }
    await UserTasteIndex.findOneAndUpdate(
      { userId, section },
      {
        $set: {
          userId,
          section,
          items,
          itemCount: items.length,
          updatedAt: now,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }));

  return { ok: true, sections: [...sectionSet] };
}

async function rebuildAllUserTasteIndexes({ batchSize = 200, now = new Date() } = {}) {
  let lastId = 0;
  let users = 0;
  let sections = 0;

  while (true) {
    const batch = await User.find({ userId: { $gt: lastId } })
      .sort({ userId: 1 })
      .limit(Math.max(1, Number(batchSize) || 200))
      .lean();
    if (!batch.length) break;

    for (const user of batch) {
      lastId = Number(user.userId);
      const result = await syncUserTasteIndex(user, { now });
      if (result.ok) {
        users += 1;
        sections += result.sections.length;
      }
    }
  }

  return { ok: true, users, sections };
}

async function hasTasteIndexData() {
  if (mongoose.connection.readyState !== 1) return false;
  return Boolean(await UserTasteIndex.exists({}));
}

async function findIndexedSharedTasteCandidates(viewer, {
  limit = 200,
  excludeUserIds = [],
} = {}) {
  if (!(await hasTasteIndexData())) return null;
  const viewerIndex = buildUserTasteIndexSections(viewer);
  const eligibleSections = Object.entries(viewerIndex)
    .filter(([, items]) => items.length >= AI_TASTE_INDEX_MIN_SHARED_ITEMS);
  if (!eligibleSections.length) return [];

  const excluded = [...new Set([
    Number(viewer?.userId),
    ...(excludeUserIds || []).map((id) => Number(id)),
  ].filter((id) => Number.isInteger(id)))];

  const reduced = await UserTasteIndex.find({
    userId: { $nin: excluded },
    itemCount: { $gte: AI_TASTE_INDEX_MIN_SHARED_ITEMS },
    $or: eligibleSections.map(([section, items]) => ({ section, items: { $in: items } })),
  })
    .select("userId section items")
    .limit(Math.max(1, Number(limit) || 200) * 4)
    .lean()
    .catch(() => null);
  if (!reduced) return null;

  const byUser = new Map();
  for (const entry of reduced || []) {
    const viewerItems = viewerIndex[entry.section] || [];
    const candidateSet = new Set(entry.items || []);
    const count = viewerItems.filter((item) => candidateSet.has(item)).length;
    if (count < AI_TASTE_INDEX_MIN_SHARED_ITEMS) continue;
    const current = byUser.get(Number(entry.userId)) || [];
    current.push({ section: entry.section, count });
    byUser.set(Number(entry.userId), current);
  }

  return [...byUser.entries()]
    .map(([userId, sharedSections]) => ({
      userId,
      sharedSections: sharedSections.sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => (
      b.sharedSections.reduce((sum, section) => sum + section.count, 0) -
      a.sharedSections.reduce((sum, section) => sum + section.count, 0)
    ))
    .slice(0, Math.max(1, Number(limit) || 200));
}

module.exports = {
  AI_TASTE_INDEX_MIN_SHARED_ITEMS,
  buildUserTasteIndexSections,
  findIndexedSharedTasteCandidates,
  rebuildAllUserTasteIndexes,
  syncUserTasteIndex,
};
