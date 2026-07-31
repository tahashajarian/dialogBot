const { URL, URLSearchParams } = require('url');
const { logger } = require('./logger');
const { normalizeCatalogueTitle } = require('./catalogue-normalization');

const TIMEOUT_MS = 2600;

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function keyOf(title, artist) {
  return `${normalizeCatalogueTitle(title)}::${normalizeCatalogueTitle(artist)}`;
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
    source: 'deezer',
  }));
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

async function retrieveMusicCandidates({ favorites = [] }, options = {}) {
  const seeds = favorites.map(clean).filter(Boolean).slice(0, 5);
  if (!seeds.length) return [];

  const seedResults = (await Promise.all(seeds.flatMap((seed) => [
    searchItunes(seed, options),
    searchDeezer(seed, options),
  ]))).flat();

  const artists = [...new Set(seedResults.map((item) => item.artist).filter(Boolean))].slice(0, 6);
  if (!artists.length) return uniqueCandidates(seedResults);

  const artistResults = (await Promise.all(artists.flatMap((artist) => [
    searchItunes(artist, options),
    searchDeezer(`artist:"${artist}"`, options),
  ]))).flat();

  return uniqueCandidates([...artistResults, ...seedResults], 36);
}

module.exports = { retrieveMusicCandidates, uniqueCandidates };
