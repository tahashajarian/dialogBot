const { createHash } = require("node:crypto");
const {
  buildUserDiscoveryIndex,
  buildUserTasteLabelIndex,
} = require("./people-discovery");

const PEOPLE_DISCOVERY_CACHE_TTL_MS = 2 * 60 * 1000;
const PEOPLE_DISCOVERY_CACHE_MAX_ENTRIES = 500;
const cache = new Map();

function buildPeopleDiscoveryCacheKey(user = {}, languageFilter = "all") {
  const point = user?.location?.point;
  const fingerprint = JSON.stringify({
    userId: Number(user?.userId) || 0,
    languageFilter,
    discovery: buildUserDiscoveryIndex(user),
    tasteLabels: buildUserTasteLabelIndex(user),
    savedProfileCodes: Array.isArray(user?.savedProfileCodes) ? user.savedProfileCodes : [],
    showProfileInPeopleDiscovery: user?.showProfileInPeopleDiscovery !== false,
    location: Array.isArray(point?.coordinates) ? point.coordinates : null,
  });
  const digest = createHash("sha256").update(fingerprint).digest("base64url");
  return `${Number(user?.userId) || 0}:${digest}`;
}

function prunePeopleDiscoveryCache(now = Date.now()) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= PEOPLE_DISCOVERY_CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

async function getPeopleDiscoverySnapshot(user, languageFilter, load, {
  now = Date.now(),
  ttlMs = PEOPLE_DISCOVERY_CACHE_TTL_MS,
  forceRefresh = false,
  onStatus = null,
} = {}) {
  const key = buildPeopleDiscoveryCacheKey(user, languageFilter);
  const cached = cache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    onStatus?.(cached.settled ? "hit" : "inflight");
    return cached.promise;
  }

  prunePeopleDiscoveryCache(now);
  const promise = Promise.resolve().then(load);
  const entry = {
    expiresAt: now + Math.max(1, Number(ttlMs) || PEOPLE_DISCOVERY_CACHE_TTL_MS),
    promise,
    settled: false,
  };
  cache.set(key, entry);
  onStatus?.(forceRefresh ? "refresh" : "miss");
  try {
    const value = await promise;
    entry.settled = true;
    return value;
  } catch (error) {
    if (cache.get(key)?.promise === promise) cache.delete(key);
    throw error;
  }
}

function clearPeopleDiscoveryCache() {
  cache.clear();
}

module.exports = {
  PEOPLE_DISCOVERY_CACHE_TTL_MS,
  buildPeopleDiscoveryCacheKey,
  clearPeopleDiscoveryCache,
  getPeopleDiscoverySnapshot,
};
