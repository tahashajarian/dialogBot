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
const { getProfileGenderEmoji } = require("./profile");
const { operationalLimits } = require("./operational-limits");

const PEOPLE_DISCOVERY_PAGE_SIZE = PAGINATION.peopleDiscoveryPageSize;
const PEOPLE_DISCOVERY_MIN_SHARED_ITEMS = 2;
const PEOPLE_DISCOVERY_SCAN_LIMIT = 200;
const PEOPLE_DISCOVERY_TASTE_LABEL_SECTIONS = Object.freeze(["movies", "music", "books"]);

function getPeopleDiscoveryMinSharedItems() {
  return Math.max(1, Number(operationalLimits.peopleDiscoveryMinSharedItems) || PEOPLE_DISCOVERY_MIN_SHARED_ITEMS);
}

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

function hasEligibleDiscoverySection(index = {}, minSharedItems = getPeopleDiscoveryMinSharedItems()) {
  return Object.values(index).some((items) => Array.isArray(items) && items.length >= minSharedItems);
}

function buildUserTasteLabelIndex(user) {
  return Object.fromEntries(PEOPLE_DISCOVERY_TASTE_LABEL_SECTIONS
    .map((section) => [section, String(user?.aiTaste?.[section]?.labelKey || "").trim()])
    .filter(([, labelKey]) => labelKey));
}

function getSharedTasteLabels(viewerTasteLabels = {}, candidateTasteLabels = {}) {
  return PEOPLE_DISCOVERY_TASTE_LABEL_SECTIONS
    .filter((section) => (
      viewerTasteLabels[section]
      && viewerTasteLabels[section] === candidateTasteLabels[section]
    ))
    .map((section) => ({
      section,
      labelKey: viewerTasteLabels[section],
    }));
}

function getSharedSections(viewerIndex = {}, candidateIndex = {}, minSharedItems = getPeopleDiscoveryMinSharedItems()) {
  const sharedSections = [];

  for (const section of AI_SECTIONS) {
    const viewerItems = viewerIndex[section] || [];
    const candidateItems = candidateIndex[section] || [];
    if (viewerItems.length < minSharedItems || candidateItems.length < minSharedItems) continue;

    const sharedCount = countSharedTasteItems(viewerItems, candidateItems);
    if (sharedCount >= minSharedItems) {
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
  const sectionScore = (entry.sharedSections || []).length * 10;
  const tasteLabelScore = (entry.sharedTasteLabels || []).length * 15;
  const profileScore = entry.hasProfileName ? 3 : 0;
  return sharedScore + sectionScore + tasteLabelScore + profileScore;
}

async function findTasteLabelCandidates(viewer, viewerTasteLabels, { limit }) {
  const labelQueries = Object.entries(viewerTasteLabels)
    .map(([section, labelKey]) => ({ [`aiTaste.${section}.labelKey`]: labelKey }));
  if (!labelQueries.length) return [];

  return User.find({
    userId: { $ne: Number(viewer?.userId) },
    bannedAt: null,
    showProfileInPeopleDiscovery: { $ne: false },
    $or: labelQueries,
  })
    .select("userId publicProfileCode firstName profileName profileEmoji gender age aiTaste")
    .limit(Math.max(1, Number(limit) || PEOPLE_DISCOVERY_SCAN_LIMIT))
    .lean();
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
  const resultLimit = Math.max(1, Number(limit) || PEOPLE_DISCOVERY_SCAN_LIMIT);
  const minSharedItems = getPeopleDiscoveryMinSharedItems();
  const viewerIndex = buildUserDiscoveryIndex(viewer);
  const viewerTasteLabels = buildUserTasteLabelIndex(viewer);
  if (
    !hasEligibleDiscoverySection(viewerIndex, minSharedItems)
    && !Object.keys(viewerTasteLabels).length
  ) {
    trackPeopleDiscovery(viewer, { mode: "taste", resultCount: 0, reason: "not_enough_data" });
    return { ok: false, reason: "not_enough_data", items: [] };
  }

  const savedCodes = new Set((viewer?.savedProfileCodes || []).map((code) => String(code || "").toLowerCase()).filter(Boolean));
  const indexedCandidates = await findIndexedSharedTasteCandidates(viewer, {
    limit: resultLimit,
    minSharedItems,
  });
  if (indexedCandidates) {
    const sharedByUserId = new Map(indexedCandidates.map((entry) => [Number(entry.userId), entry.sharedSections || []]));
    const indexedCandidateIds = indexedCandidates.map((entry) => Number(entry.userId)).filter((id) => Number.isInteger(id));
    const tasteLabelCandidates = await findTasteLabelCandidates(viewer, viewerTasteLabels, {
      limit: resultLimit,
    });
    const tasteLabelCandidateIds = (tasteLabelCandidates || [])
      .map((entry) => Number(entry.userId))
      .filter((id) => Number.isInteger(id));
    const candidateIds = [...new Set([...indexedCandidateIds, ...tasteLabelCandidateIds])];
    const tasteLabelCandidatesById = new Map(
      (tasteLabelCandidates || []).map((candidate) => [Number(candidate.userId), candidate]),
    );
    const indexedOnlyIds = indexedCandidateIds.filter((userId) => !tasteLabelCandidatesById.has(userId));
    const indexedHydrated = indexedOnlyIds.length
      ? await User.find({
        userId: { $in: indexedOnlyIds },
        bannedAt: null,
        showProfileInPeopleDiscovery: { $ne: false },
      })
        .select("userId publicProfileCode firstName profileName profileEmoji gender age aiTaste")
        .lean()
      : [];
    const byUserId = new Map(
      [...(tasteLabelCandidates || []), ...(indexedHydrated || [])]
        .map((candidate) => [Number(candidate.userId), candidate]),
    );
    const items = [];
    for (const userId of candidateIds) {
      const candidate = byUserId.get(userId);
      if (!candidate) continue;
      const baseName = candidate.profileName || candidate.firstName || "";
      if (!baseName) continue;
      const name = [baseName, candidate.profileEmoji].filter(Boolean).join(" ");
      const code = candidate.publicProfileCode;
      const sharedSections = sharedByUserId.get(userId) || [];
      const sharedTasteLabels = getSharedTasteLabels(
        viewerTasteLabels,
        buildUserTasteLabelIndex(candidate),
      );
      if (!sharedSections.length && !sharedTasteLabels.length) continue;
      const entry = {
        userId: candidate.userId,
        code,
        name,
        genderEmoji: getProfileGenderEmoji(candidate.gender),
        age: candidate.age,
        sharedSections,
        sharedTasteLabels,
        isSaved: savedCodes.has(String(code || "").toLowerCase()),
        hasProfileName: Boolean(candidate.profileName),
      };
      entry.score = getPeopleDiscoveryScore(entry);
      items.push(entry);
    }
    items.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
    const limitedItems = items.slice(0, resultLimit);
    trackPeopleDiscovery(viewer, { mode: "taste", resultCount: limitedItems.length });
    return { ok: true, items: limitedItems };
  }

  const candidates = await User.find({
    userId: { $ne: Number(viewer?.userId) },
    bannedAt: null,
    showProfileInPeopleDiscovery: { $ne: false },
  })
    .select("userId publicProfileCode firstName profileName profileEmoji gender age aiLists aiTaste aiWatchlistMovies aiTopTenMovies aiWatchlistMusic aiTopTenMusic aiWatchlistBooks aiTopTenBooks aiWatchlistRandom aiTopTenRandom")
    .limit(resultLimit)
    .lean();

  const items = [];
  for (const candidate of candidates || []) {
    const baseName = candidate.profileName || candidate.firstName || "";
    if (!baseName) continue;
    const name = [baseName, candidate.profileEmoji].filter(Boolean).join(" ");

    const candidateIndex = buildUserDiscoveryIndex(candidate);
    const sharedSections = getSharedSections(viewerIndex, candidateIndex, minSharedItems);
    const sharedTasteLabels = getSharedTasteLabels(
      viewerTasteLabels,
      buildUserTasteLabelIndex(candidate),
    );
    if (!sharedSections.length && !sharedTasteLabels.length) continue;

    const code = candidate.publicProfileCode;
    const entry = {
      userId: candidate.userId,
      code,
      name,
      genderEmoji: getProfileGenderEmoji(candidate.gender),
      age: candidate.age,
      sharedSections,
      sharedTasteLabels,
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
  PEOPLE_DISCOVERY_TASTE_LABEL_SECTIONS,
  buildUserDiscoveryIndex,
  buildUserTasteLabelIndex,
  ensurePeopleDiscoveryCodes,
  findPeopleBySharedTaste,
  getPeopleDiscoveryMinSharedItems,
  getSharedSections,
  getSharedTasteLabels,
  paginatePeopleDiscovery,
};
