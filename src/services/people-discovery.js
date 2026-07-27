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
const {
  normalizeDiscussionLanguageFilter,
  normalizeDiscussionLanguage,
} = require("./discussion-language");

const PEOPLE_DISCOVERY_PAGE_SIZE = PAGINATION.peopleDiscoveryPageSize;
const PEOPLE_DISCOVERY_MIN_SHARED_ITEMS = 2;
const PEOPLE_DISCOVERY_SCAN_LIMIT = 200;
const PEOPLE_DISCOVERY_TASTE_LABEL_SECTIONS = Object.freeze(["movies", "music", "books"]);
const PEOPLE_DISCOVERY_SCORE_BAND_SIZE = 5;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function getPeopleDiscoveryMinSharedItems() {
  return Math.max(1, Number(operationalLimits.peopleDiscoveryMinSharedItems) || PEOPLE_DISCOVERY_MIN_SHARED_ITEMS);
}

function getEffectivePeopleLanguageFilter(user = {}) {
  return normalizeDiscussionLanguageFilter(user.peopleLanguageFilter)
    || normalizeDiscussionLanguage(user.lang);
}

function buildPeopleLanguageQuery(languageFilter) {
  const normalized = normalizeDiscussionLanguageFilter(languageFilter);
  return normalized && normalized !== "all" ? { lang: normalized } : {};
}

function applyPeopleLanguageFilter(items = [], languageFilter = "all") {
  const availableLanguages = [...new Set((items || [])
    .map((entry) => normalizeDiscussionLanguage(entry.language))
    .filter(Boolean))];
  const normalizedFilter = normalizeDiscussionLanguageFilter(languageFilter);
  const filteredItems = availableLanguages.length > 1 && normalizedFilter !== "all"
    ? items.filter((entry) => normalizeDiscussionLanguage(entry.language) === normalizedFilter)
    : items;
  return {
    items: filteredItems,
    availableLanguages,
  };
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

function getStableProfileIdentity(entry = {}) {
  const userId = Number(entry.userId);
  if (Number.isInteger(userId)) return `id:${userId}`;
  return `profile:${String(entry.code || entry.name || "")}`;
}

function hashDiscoveryRotationSeed(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sortPeopleDiscoveryItems(items = [], viewer = {}, now = new Date()) {
  const dayNumber = Math.floor(new Date(now).getTime() / MILLISECONDS_PER_DAY);
  const viewerId = Number(viewer?.userId) || 0;
  const prepared = [...(items || [])].sort((a, b) => {
    const savedOrder = Number(Boolean(a.isSaved)) - Number(Boolean(b.isSaved));
    if (savedOrder !== 0) return savedOrder;
    const bandA = Math.floor((Number(a.score) || 0) / PEOPLE_DISCOVERY_SCORE_BAND_SIZE);
    const bandB = Math.floor((Number(b.score) || 0) / PEOPLE_DISCOVERY_SCORE_BAND_SIZE);
    if (bandA !== bandB) return bandB - bandA;
    const scoreOrder = (Number(b.score) || 0) - (Number(a.score) || 0);
    if (scoreOrder !== 0) return scoreOrder;
    return getStableProfileIdentity(a).localeCompare(getStableProfileIdentity(b));
  });

  const groups = [];
  for (const entry of prepared) {
    const band = Math.floor((Number(entry.score) || 0) / PEOPLE_DISCOVERY_SCORE_BAND_SIZE);
    const groupKey = `${Number(Boolean(entry.isSaved))}:${band}`;
    const current = groups.at(-1);
    if (current?.key === groupKey) current.items.push(entry);
    else groups.push({ key: groupKey, items: [entry] });
  }

  return groups.flatMap((group) => {
    if (group.items.length < 2) return group.items;
    const baseOffset = hashDiscoveryRotationSeed(`${viewerId}:${group.key}`) % group.items.length;
    const offset = (baseOffset + dayNumber) % group.items.length;
    return [...group.items.slice(offset), ...group.items.slice(0, offset)];
  });
}

async function findTasteLabelCandidates(viewer, viewerTasteLabels, { limit, languageFilter }) {
  const labelQueries = Object.entries(viewerTasteLabels)
    .map(([section, labelKey]) => ({ [`aiTaste.${section}.labelKey`]: labelKey }));
  if (!labelQueries.length) return [];

  return User.find({
    userId: { $ne: Number(viewer?.userId) },
    bannedAt: null,
    showProfileInPeopleDiscovery: { $ne: false },
    ...buildPeopleLanguageQuery(languageFilter),
    $or: labelQueries,
  })
    .select("userId publicProfileCode firstName profileName profileEmoji gender age lang aiTaste createdAt")
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
  languageFilter = getEffectivePeopleLanguageFilter(viewer),
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
      languageFilter: "all",
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
        .select("userId publicProfileCode firstName profileName profileEmoji gender age lang aiTaste createdAt")
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
        language: normalizeDiscussionLanguage(candidate.lang),
        sharedSections,
        sharedTasteLabels,
        isSaved: savedCodes.has(String(code || "").toLowerCase()),
        hasProfileName: Boolean(candidate.profileName),
        createdAt: candidate.createdAt || null,
      };
      entry.score = getPeopleDiscoveryScore(entry);
      items.push(entry);
    }
    const languageResult = applyPeopleLanguageFilter(items, languageFilter);
    const limitedItems = sortPeopleDiscoveryItems(languageResult.items, viewer).slice(0, resultLimit);
    trackPeopleDiscovery(viewer, { mode: "taste", resultCount: limitedItems.length });
    return {
      ok: true,
      items: limitedItems,
      availableLanguages: languageResult.availableLanguages,
    };
  }

  const candidates = await User.find({
    userId: { $ne: Number(viewer?.userId) },
    bannedAt: null,
    showProfileInPeopleDiscovery: { $ne: false },
  })
    .select("userId publicProfileCode firstName profileName profileEmoji gender age lang createdAt aiLists aiTaste aiWatchlistMovies aiTopTenMovies aiWatchlistMusic aiTopTenMusic aiWatchlistBooks aiTopTenBooks aiWatchlistRandom aiTopTenRandom")
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
      language: normalizeDiscussionLanguage(candidate.lang),
      sharedSections,
      sharedTasteLabels,
      isSaved: savedCodes.has(String(code || "").toLowerCase()),
      hasProfileName: Boolean(candidate.profileName),
      createdAt: candidate.createdAt || null,
    };
    entry.score = getPeopleDiscoveryScore(entry);
    items.push(entry);
  }

  const languageResult = applyPeopleLanguageFilter(items, languageFilter);
  const sortedItems = sortPeopleDiscoveryItems(languageResult.items, viewer);
  trackPeopleDiscovery(viewer, { mode: "taste", resultCount: sortedItems.length });
  return {
    ok: true,
    items: sortedItems,
    availableLanguages: languageResult.availableLanguages,
  };
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
  PEOPLE_DISCOVERY_SCORE_BAND_SIZE,
  PEOPLE_DISCOVERY_TASTE_LABEL_SECTIONS,
  applyPeopleLanguageFilter,
  buildUserDiscoveryIndex,
  buildUserTasteLabelIndex,
  ensurePeopleDiscoveryCodes,
  findPeopleBySharedTaste,
  getEffectivePeopleLanguageFilter,
  getPeopleDiscoveryMinSharedItems,
  getSharedSections,
  getSharedTasteLabels,
  paginatePeopleDiscovery,
  sortPeopleDiscoveryItems,
};
