const { URL, URLSearchParams } = require('url');
const { logger } = require('./logger');
const { extractSuggestionCreator } = require('./ai-suggestion-quality');
const { normalizeCatalogueTitle } = require('./catalogue-normalization');

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const ITUNES_TIMEOUT_MS = 5000;

function isStrongTextMatch(actual, expected) {
  const left = normalizeCatalogueTitle(actual);
  const right = normalizeCatalogueTitle(expected);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 6 && longer.includes(shorter) && shorter.length / longer.length >= 0.72;
}

function chooseItunesSong(results, title, artist) {
  return (results || []).find((entry) => (
    String(entry?.wrapperType || '').toLowerCase() === 'track'
    && String(entry?.kind || '').toLowerCase() === 'song'
    && isStrongTextMatch(entry?.trackName, title)
    && isStrongTextMatch(entry?.artistName, artist)
  )) || null;
}

async function verifyItunesSuggestion(suggestion, {
  fetchImpl = globalThis.fetch,
  timeoutMs = ITUNES_TIMEOUT_MS,
} = {}) {
  const title = String(suggestion?.title || '').trim();
  const artist = extractSuggestionCreator(suggestion?.metadata);
  if (!title || !artist || typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'catalog_unavailable' };
  }
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const params = new URLSearchParams({
      term: `${title} ${artist}`,
      entity: 'song',
      limit: '25',
    });
    const response = await fetchImpl(new URL(`${ITUNES_SEARCH_URL}?${params}`), {
      headers: { accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return { ok: false, reason: 'catalog_unavailable' };
    const data = await response.json();
    const match = chooseItunesSong(data?.results, title, artist);
    if (!match) {
      return {
        ok: false,
        reason: 'catalog_unverified',
        qualityIssue: 'catalog_title_creator_mismatch',
      };
    }
    return { ok: true, verified: true };
  } catch (error) {
    logger.warn('iTunes suggestion verification request failed', { name: error?.name || 'Error' });
    return { ok: false, reason: 'catalog_unavailable' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { chooseItunesSong, isStrongTextMatch, verifyItunesSuggestion };
