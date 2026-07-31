const { URL, URLSearchParams } = require('url');
const { logger } = require('./logger');
const { extractSuggestionCreator } = require('./ai-suggestion-quality');
const { normalizeCatalogueTitle } = require('./catalogue-normalization');

const DEEZER_SEARCH_URL = 'https://api.deezer.com/search/track';
const DEEZER_TIMEOUT_MS = 5000;

function isStrongTextMatch(actual, expected) {
  const left = normalizeCatalogueTitle(actual);
  const right = normalizeCatalogueTitle(expected);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 5 && longer.includes(shorter) && shorter.length / longer.length >= 0.78;
}

function chooseDeezerTrack(results, title, artist) {
  return (results || []).find((entry) => (
    isStrongTextMatch(entry?.title_short || entry?.title, title)
    && isStrongTextMatch(entry?.artist?.name, artist)
  )) || null;
}

async function verifyDeezerSuggestion(suggestion, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEEZER_TIMEOUT_MS,
} = {}) {
  const title = String(suggestion?.title || '').trim();
  const artist = extractSuggestionCreator(suggestion?.metadata);
  if (!title || !artist || typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'catalog_unavailable' };
  }

  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const params = new URLSearchParams({ q: `track:"${title}" artist:"${artist}"` });
    const response = await fetchImpl(new URL(`${DEEZER_SEARCH_URL}?${params}`), {
      headers: { accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return { ok: false, reason: 'catalog_unavailable' };
    const data = await response.json();
    const match = chooseDeezerTrack(data?.data, title, artist);
    if (!match) {
      return {
        ok: false,
        reason: 'catalog_unverified',
        qualityIssue: 'catalog_title_creator_mismatch',
      };
    }
    return { ok: true, verified: true };
  } catch (error) {
    logger.warn('Deezer suggestion verification request failed', { name: error?.name || 'Error' });
    return { ok: false, reason: 'catalog_unavailable' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { chooseDeezerTrack, isStrongTextMatch, verifyDeezerSuggestion };
