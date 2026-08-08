const mongoose = require("mongoose");
const UserTasteIndex = require("../models/user-taste-index");
const User = require("../models/user");
const { normalizeAiInput } = require("./input-normalization");
const { canonicalizeInterestChipTitle } = require("./interest-chips");
const { mapWithConcurrency } = require("./bounded-concurrency");
const { buildTasteMatchKeys, countSharedTasteItems } = require("./taste-item-matching");

const AI_TASTE_INDEX_SECTIONS = ["movies", "music", "books", "random"];
const AI_TASTE_INDEX_LIST_TYPES = ["topTen", "watchlist"];
const AI_TASTE_INDEX_MIN_SHARED_ITEMS = 3;
const TASTE_INDEX_READINESS_CACHE_TTL_MS = 60 * 1000;
const TASTE_INDEX_REBUILD_CONCURRENCY = 5;
let tasteIndexReadiness = null;
let tasteIndexReadinessExpiresAt = 0;
let tasteIndexReadinessPromise = null;

function cacheTasteIndexReadiness(value, now = Date.now()) {
  tasteIndexReadiness = Boolean(value);
  tasteIndexReadinessExpiresAt = now + TASTE_INDEX_READINESS_CACHE_TTL_MS;
  return tasteIndexReadiness;
}

function invalidateTasteIndexReadinessCache() {
  tasteIndexReadiness = null;
  tasteIndexReadinessExpiresAt = 0;
  tasteIndexReadinessPromise = null;
}
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
          matchKeys: [...new Set(items.flatMap((item) => buildTasteMatchKeys(item)))],
          itemCount: items.length,
          updatedAt: now,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }));

  if (Object.values(index).some((items) => items.length)) {
    cacheTasteIndexReadiness(true);
  }

  return { ok: true, sections: [...sectionSet] };
}

async function rebuildAllUserTasteIndexes({
  batchSize = 200,
  concurrency = TASTE_INDEX_REBUILD_CONCURRENCY,
  maxUsers = Infinity,
  now = new Date(),
} = {}) {
  let lastId = 0;
  let users = 0;
  let sections = 0;

  while (true) {
    const remaining = Math.max(0, Number(maxUsers) - users);
    if (remaining === 0) break;
    const batch = await User.find({ userId: { $gt: lastId } })
      .sort({ userId: 1 })
      .limit(Math.min(Math.max(1, Number(batchSize) || 200), remaining))
      .lean();
    if (!batch.length) break;

    lastId = Number(batch.at(-1).userId);
    const results = await mapWithConcurrency(batch, concurrency, async (user) => {
      const result = await syncUserTasteIndex(user, { now });
      return result;
    });
    for (const result of results) {
      if (!result.ok) continue;
      users += 1;
      sections += result.sections.length;
    }
  }

  return { ok: true, users, sections };
}

async function getTasteIndexHealth({ maxUsers = 1000, agedAfterMs = 24 * 60 * 60 * 1000 } = {}) {
  if (mongoose.connection.readyState !== 1) {
    return { ok: false, reason: "db_unavailable" };
  }
  const checkedUsers = await User.find({})
    .sort({ userId: 1 })
    .limit(Math.max(1, Number(maxUsers) || 1000))
    .lean();
  const checkedUserIds = checkedUsers.map((user) => Number(user.userId));
  const checkedRows = checkedUserIds.length
    ? await UserTasteIndex.find({ userId: { $in: checkedUserIds } }).lean()
    : [];
  const actual = new Map(checkedRows.map((row) => [`${row.userId}:${row.section}`, row.items || []]));
  let expectedRows = 0;
  let missingRows = 0;
  let mismatchedRows = 0;
  for (const user of checkedUsers) {
    const expected = buildUserTasteIndexSections(user);
    for (const section of AI_TASTE_INDEX_SECTIONS) {
      const key = `${user.userId}:${section}`;
      const expectedItems = expected[section] || [];
      const actualItems = actual.get(key);
      if (!expectedItems.length) {
        if (actualItems) mismatchedRows += 1;
      } else {
        expectedRows += 1;
        if (!actualItems) missingRows += 1;
        else if (JSON.stringify(actualItems) !== JSON.stringify(expectedItems)) mismatchedRows += 1;
      }
    }
  }
  const agedBefore = new Date(Date.now() - Math.max(0, Number(agedAfterMs) || 0));
  const [rows, indexedUsers, agedRows, newestRow, oldestRow] = await Promise.all([
    UserTasteIndex.countDocuments({}),
    UserTasteIndex.distinct("userId").then((ids) => ids.length),
    UserTasteIndex.countDocuments({ updatedAt: { $lt: agedBefore } }),
    UserTasteIndex.findOne({}).sort({ updatedAt: -1 }).select("updatedAt").lean(),
    UserTasteIndex.findOne({}).sort({ updatedAt: 1 }).select("updatedAt").lean(),
  ]);
  return {
    ok: true,
    rows,
    indexedUsers,
    checkedUsers: checkedUsers.length,
    expectedRows,
    missingRows,
    mismatchedRows,
    healthy: missingRows === 0 && mismatchedRows === 0,
    agedRows,
    agedAfterMs: Math.max(0, Number(agedAfterMs) || 0),
    newestUpdatedAt: newestRow?.updatedAt || null,
    oldestUpdatedAt: oldestRow?.updatedAt || null,
  };
}

async function hasTasteIndexData() {
  if (mongoose.connection.readyState !== 1) return false;
  if (tasteIndexReadiness !== null && Date.now() < tasteIndexReadinessExpiresAt) {
    return tasteIndexReadiness;
  }
  if (tasteIndexReadinessPromise) return tasteIndexReadinessPromise;

  tasteIndexReadinessPromise = UserTasteIndex.exists({})
    .then((result) => cacheTasteIndexReadiness(Boolean(result)))
    .finally(() => {
      tasteIndexReadinessPromise = null;
    });
  return tasteIndexReadinessPromise;
}

async function findIndexedSharedTasteCandidates(viewer, {
  limit = 200,
  excludeUserIds = [],
  minSharedItems = AI_TASTE_INDEX_MIN_SHARED_ITEMS,
  indexReady = false,
} = {}) {
  const minimum = Math.max(1, Number(minSharedItems) || AI_TASTE_INDEX_MIN_SHARED_ITEMS);
  if (!indexReady && !(await hasTasteIndexData())) return null;
  const viewerIndex = buildUserTasteIndexSections(viewer);
  const eligibleSections = Object.entries(viewerIndex)
    .filter(([, items]) => items.length >= minimum);
  if (!eligibleSections.length) return [];

  const excluded = [...new Set([
    Number(viewer?.userId),
    ...(excludeUserIds || []).map((id) => Number(id)),
  ].filter((id) => Number.isInteger(id)))];
  const viewerMatchKeys = Object.fromEntries(eligibleSections.map(([section, items]) => [
    section,
    [...new Set(items.flatMap((item) => buildTasteMatchKeys(item)))],
  ]));

  const reduced = await UserTasteIndex.find({
    userId: { $nin: excluded },
    itemCount: { $gte: minimum },
    $or: eligibleSections.flatMap(([section, items]) => [
      { section, items: { $in: items } },
      { section, matchKeys: { $in: viewerMatchKeys[section] } },
    ]),
  })
    .select("userId section items")
    .limit(Math.max(1, Number(limit) || 200) * 4)
    .lean()
    .catch(() => null);
  if (!reduced) return null;

  const byUser = new Map();
  for (const entry of reduced || []) {
    const viewerItems = viewerIndex[entry.section] || [];
    const count = countSharedTasteItems(viewerItems, entry.items || []);
    if (count < minimum) continue;
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
  TASTE_INDEX_REBUILD_CONCURRENCY,
  buildUserTasteIndexSections,
  findIndexedSharedTasteCandidates,
  getTasteIndexHealth,
  hasTasteIndexData,
  invalidateTasteIndexReadinessCache,
  rebuildAllUserTasteIndexes,
  syncUserTasteIndex,
};
