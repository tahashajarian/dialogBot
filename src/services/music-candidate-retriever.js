const { URL, URLSearchParams } = require('url');
const { logger } = require('./logger');
const { normalizeCatalogueTitle } = require('./catalogue-normalization');
const {
  creatorIsExplicitlyRequested,
  getCreatorDiversityIssue,
  normalizeCreator,
} = require('./ai-suggestion-diversity');

const TIMEOUT_MS = 2600;

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function keyOf(title, artist) {
  return `${normalizeCatalogueTitle(title)}::${normalizeCatalogueTitle(artist)}`;
}

function chooseSeedIdentity(seed, candidates = []) {
  const seedKey = normalizeCatalogueTitle(seed.split(/\s+[—–|]\s+/u)[0]);
  const exact = candidates.filter((candidate) => normalizeCatalogueTitle(candidate.title) === seedKey);
  const pool = exact.length ? exact : candidates.slice(0, 2);
  const counts = new Map();
  for (const candidate of pool) {
    const artistKey = normalizeCreator(candidate.artist);
    if (artistKey) counts.set(artistKey, (counts.get(artistKey) || 0) + 1);
  }
  return [...pool].sort((left, right) => (
    (counts.get(normalizeCreator(right.artist)) || 0)
    - (counts.get(normalizeCreator(left.artist)) || 0)
  ))[0] || null;
}

async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    logger.warn('Music candidate retrieval request failed', { name: error?.name || 'Error' });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function searchItunes(term, options) {
  const params = new URLSearchParams({ term, entity: 'song', limit: '20' });
  const data = await fetchJson(new URL(`https://itunes.apple.com/search?${params}`), options);
  return (data?.results || []).filter((entry) => entry?.kind === 'song').map((entry) => ({
    title: clean(entry.trackName),
    artist: clean(entry.artistName),
    source: 'itunes',
  }));
}

async function searchDeezer(term, options) {
  const params = new URLSearchParams({ q: term, limit: '20' });
  const data = await fetchJson(new URL(`https://api.deezer.com/search/track?${params}`), options);
  return (data?.data || []).map((entry) => ({
    title: clean(entry.title_short || entry.title),
    artist: clean(entry.artist?.name),
    artistId: Number(entry.artist?.id) || 0,
    source: 'deezer',
  }));
}

async function getRelatedDeezerArtists(artistId, options) {
  if (!Number.isInteger(Number(artistId)) || Number(artistId) <= 0) return [];
  const data = await fetchJson(new URL(`https://api.deezer.com/artist/${Number(artistId)}/related?limit=8`), options);
  return (data?.data || []).map((entry) => clean(entry?.name)).filter(Boolean);
}

function uniqueCandidates(items, limit = 30) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item.title || !item.artist) continue;
    const key = keyOf(item.title, item.artist);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function filterDiverseCandidates(candidates, {
  requestText = '',
  recentCreators = [],
  savedCreators = [],
  seedArtists = [],
} = {}) {
  const seedArtistKeys = new Set(seedArtists.map(normalizeCreator).filter(Boolean));
  const strictlyDiverse = candidates.filter((candidate) => {
    if (getCreatorDiversityIssue({
      creator: candidate.artist,
      requestText,
      recentCreators,
      savedCreators,
    })) return false;
    return !seedArtistKeys.has(normalizeCreator(candidate.artist))
      || creatorIsExplicitlyRequested(candidate.artist, requestText);
  });
  if (strictlyDiverse.length) return strictlyDiverse;

  const withoutRecentOrSaturated = candidates.filter((candidate) => !getCreatorDiversityIssue({
    creator: candidate.artist,
    requestText,
    recentCreators,
    savedCreators,
  }));
  return withoutRecentOrSaturated.length ? withoutRecentOrSaturated : candidates;
}

async function retrieveMusicCandidates({
  favorites = [],
  requestText = '',
  recentCreators = [],
  savedCreators = [],
  discoveryArtists = [],
}, options = {}) {
  const seeds = favorites.map(clean).filter(Boolean).slice(0, 5);
  if (!seeds.length) return [];

  const seedGroups = await Promise.all(seeds.map(async (seed) => {
    const results = (await Promise.all([
      searchItunes(seed, options),
      searchDeezer(seed, options),
    ])).flat();
    return { seed, results, identity: chooseSeedIdentity(seed, results) };
  }));
  const seedResults = seedGroups.flatMap((group) => group.results);

  const seedIdentities = seedGroups.map((group) => group.identity).filter(Boolean);
  const artists = [...new Set(seedIdentities.map((item) => item.artist).filter(Boolean))].slice(0, 6);
  if (!artists.length && !discoveryArtists.length) return uniqueCandidates(seedResults);

  const artistIds = [...new Set(seedIdentities.map((item) => item.artistId).filter(Boolean))].slice(0, 4);
  const relatedArtists = [...new Set((await Promise.all(
    artistIds.map((artistId) => getRelatedDeezerArtists(artistId, options)),
  )).flat())]
    .filter((artist) => !artists.some((seedArtist) => normalizeCreator(seedArtist) === normalizeCreator(artist)))
    .slice(0, 8);
  const artistQueries = [...new Set([...discoveryArtists, ...relatedArtists])].slice(0, 10);
  const effectiveArtistQueries = artistQueries.length ? artistQueries : artists;
  const artistResults = (await Promise.all(effectiveArtistQueries.flatMap((artist) => [
    searchItunes(artist, options),
    searchDeezer(`artist:"${artist}"`, options),
  ]))).flat();

  return uniqueCandidates(filterDiverseCandidates(
    [...artistResults, ...seedResults],
    { requestText, recentCreators, savedCreators, seedArtists: artists },
  ), 36);
}

module.exports = {
  filterDiverseCandidates,
  getRelatedDeezerArtists,
  chooseSeedIdentity,
  retrieveMusicCandidates,
  uniqueCandidates,
};
