const User = require("../models/user");
const { PAGINATION } = require("../constants/pagination");
const { paginateItems } = require("./pagination");
const { ensurePublicProfileCode } = require("./public-codes");
const { normalizeAiInput } = require("./input-normalization");
const {
  AI_SECTIONS,
  getAiListItemsFromUser,
  normalizeAiListItem,
} = require("./users");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");
const { findIndexedSharedTasteCandidates } = require("./user-taste-index");
const { countSharedTasteItems } = require("./taste-item-matching");

const PEOPLE_DISCOVERY_PAGE_SIZE = PAGINATION.peopleDiscoveryPageSize;
const PEOPLE_DISCOVERY_MIN_SHARED_ITEMS = 3;
const PEOPLE_DISCOVERY_SCAN_LIMIT = 200;

function normalizeDiscoveryItem(value) {
  return normalizeAiInput(normalizeAiListItem(value));
}

function getSectionItems(user, section) {
  const items = [
    ...getAiListItemsFromUser(user, section, "topTen"),
    ...getAiListItemsFromUser(user, section, "watchlist"),
  ];
  return [...new Set(items
    .map((entry) => normalizeDiscoveryItem(entry?.title))
    .filter(Boolean))];
}

function buildUserDiscoveryIndex(user) {
  const sections = {};
  for (const section of AI_SECTIONS) {
    const items = getSectionItems(user, section);
    if (items.length) sections[section] = items;
  }
  return sections;
}

function hasEligibleDiscoverySection(index = {}) {
  return Object.values(index).some((items) => Array.isArray(items) && items.length >= PEOPLE_DISCOVERY_MIN_SHARED_ITEMS);
}

function getSharedSections(viewerIndex = {}, candidateIndex = {}) {
  const sharedSections = [];

  for (const section of AI_SECTIONS) {
    const viewerItems = viewerIndex[section] || [];
    const candidateItems = candidateIndex[section] || [];
    if (viewerItems.length < PEOPLE_DISCOVERY_MIN_SHARED_ITEMS || candidateItems.length < PEOPLE_DISCOVERY_MIN_SHARED_ITEMS) continue;

    const sharedCount = countSharedTasteItems(viewerItems, candidateItems);
    if (sharedCount >= PEOPLE_DISCOVERY_MIN_SHARED_ITEMS) {
      sharedSections.push({
        section,
        count: sharedCount,
      });
    }
  }

  return sharedSections.sort((a, b) => b.count - a.count);
}

function getPeopleDiscoveryScore(entry) {
  const sharedScore = (entry.sharedSections || []).reduce((sum, section) => sum + section.count, 0);
  const tasteScore = (entry.sharedSections || []).length * 10;
  const profileScore = entry.hasProfileName ? 3 : 0;
  return sharedScore + tasteScore + profileScore;
}

function trackPeopleDiscovery(viewer, { mode, resultCount, reason } = {}) {
  void trackEvent({
    name: EVENT_NAMES.peopleDiscoveryQueried,
    userId: viewer?.userId,
    source: "people_discovery",
    metadata: {
      mode,
      resultCount: Number(resultCount) || 0,
      ...(reason ? { reason } : {}),
    },
  });
}

async function findPeopleBySharedTaste(viewer, {
  limit = PEOPLE_DISCOVERY_SCAN_LIMIT,
} = {}) {
  const viewerIndex = buildUserDiscoveryIndex(viewer);
  if (!hasEligibleDiscoverySection(viewerIndex)) {
    trackPeopleDiscovery(viewer, { mode: "taste", resultCount: 0, reason: "not_enough_data" });
    return { ok: false, reason: "not_enough_data", items: [] };
  }

  const savedCodes = new Set((viewer?.savedProfileCodes || []).map((code) => String(code || "").toLowerCase()).filter(Boolean));
  const indexedCandidates = await findIndexedSharedTasteCandidates(viewer, { limit });
  if (indexedCandidates) {
    const sharedByUserId = new Map(indexedCandidates.map((entry) => [Number(entry.userId), entry.sharedSections || []]));
    const candidateIds = indexedCandidates.map((entry) => Number(entry.userId)).filter((id) => Number.isInteger(id));
    const hydrated = candidateIds.length
      ? await User.find({
        userId: { $in: candidateIds },
        bannedAt: null,
      })
        .select("userId publicProfileCode firstName profileName profileEmoji")
        .lean()
      : [];
    const byUserId = new Map((hydrated || []).map((candidate) => [Number(candidate.userId), candidate]));
    const items = [];
    for (const userId of candidateIds) {
      const candidate = byUserId.get(userId);
      if (!candidate) continue;
      const baseName = candidate.profileName || candidate.firstName || "";
      if (!baseName) continue;
      const name = [baseName, candidate.profileEmoji].filter(Boolean).join(" ");
      const code = candidate.publicProfileCode;
      const entry = {
        userId: candidate.userId,
        code,
        name,
        sharedSections: sharedByUserId.get(userId) || [],
        isSaved: savedCodes.has(String(code || "").toLowerCase()),
        hasProfileName: Boolean(candidate.profileName),
      };
      entry.score = getPeopleDiscoveryScore(entry);
      items.push(entry);
    }
    items.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
    trackPeopleDiscovery(viewer, { mode: "taste", resultCount: items.length });
    return { ok: true, items };
  }

  const candidates = await User.find({
    userId: { $ne: Number(viewer?.userId) },
    bannedAt: null,
  })
    .select("userId publicProfileCode firstName profileName profileEmoji aiLists aiWatchlistMovies aiTopTenMovies aiWatchlistMusic aiTopTenMusic aiWatchlistBooks aiTopTenBooks aiWatchlistRandom aiTopTenRandom")
    .limit(Math.max(1, Number(limit) || PEOPLE_DISCOVERY_SCAN_LIMIT))
    .lean();

  const items = [];
  for (const candidate of candidates || []) {
    const baseName = candidate.profileName || candidate.firstName || "";
    if (!baseName) continue;
    const name = [baseName, candidate.profileEmoji].filter(Boolean).join(" ");

    const candidateIndex = buildUserDiscoveryIndex(candidate);
    const sharedSections = getSharedSections(viewerIndex, candidateIndex);
    if (!sharedSections.length) continue;

    const code = candidate.publicProfileCode;
    const entry = {
      userId: candidate.userId,
      code,
      name,
      sharedSections,
      isSaved: savedCodes.has(String(code || "").toLowerCase()),
      hasProfileName: Boolean(candidate.profileName),
    };
    entry.score = getPeopleDiscoveryScore(entry);
    items.push(entry);
  }

  items.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  trackPeopleDiscovery(viewer, { mode: "taste", resultCount: items.length });
  return { ok: true, items };
}

async function ensurePeopleDiscoveryCodes(items = []) {
  const prepared = await Promise.all((items || []).map(async (entry) => {
    if (entry.code) return entry;
    const codeResult = await ensurePublicProfileCode(entry.userId);
    if (!codeResult.ok) return null;
    return { ...entry, code: codeResult.code };
  }));
  return prepared.filter(Boolean);
}

function paginatePeopleDiscovery(items = [], page = 0) {
  return paginateItems(items, page, PEOPLE_DISCOVERY_PAGE_SIZE);
}

module.exports = {
  PEOPLE_DISCOVERY_MIN_SHARED_ITEMS,
  buildUserDiscoveryIndex,
  ensurePeopleDiscoveryCodes,
  findPeopleBySharedTaste,
  getSharedSections,
  paginatePeopleDiscovery,
};
