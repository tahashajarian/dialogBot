const { normalizeCatalogueTitle } = require("./catalogue-normalization");
const { verifyOpenLibraryBookCandidate } = require("./open-library-book-verifier");
const { verifyWikidataBookCandidate } = require("./wikidata-suggestion-verifier");

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const MISMATCH_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const verificationCache = new Map();

function cacheKey(candidate) {
  return [candidate?.originalTitle, candidate?.originalAuthor]
    .map(normalizeCatalogueTitle)
    .join("::");
}

function getCached(key) {
  const cached = verificationCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    verificationCache.delete(key);
    return null;
  }
  return cached.result;
}

function setCached(key, result, ttlMs) {
  if (!key || !ttlMs) return;
  verificationCache.set(key, { result, expiresAt: Date.now() + ttlMs });
  while (verificationCache.size > MAX_CACHE_ENTRIES) {
    verificationCache.delete(verificationCache.keys().next().value);
  }
}

async function verifyBookSuggestionCandidate(candidate, options = {}, dependencies = {}) {
  const key = cacheKey(candidate);
  const cached = getCached(key);
  if (cached) return { ...cached, candidate, cached: true };

  const verifyOpenLibrary = dependencies.verifyOpenLibrary || verifyOpenLibraryBookCandidate;
  const verifyWikidata = dependencies.verifyWikidata || verifyWikidataBookCandidate;
  const openLibrary = await verifyOpenLibrary(candidate, options);
  if (openLibrary?.ok) {
    setCached(key, openLibrary, SUCCESS_TTL_MS);
    return openLibrary;
  }

  const wikidata = await verifyWikidata(candidate, options);
  if (wikidata?.ok) {
    setCached(key, wikidata, SUCCESS_TTL_MS);
    return wikidata;
  }

  const bothUnavailable = openLibrary?.reason === "catalog_unavailable"
    && wikidata?.reason === "catalog_unavailable";
  const result = {
    ok: false,
    reason: bothUnavailable ? "catalog_unavailable" : "catalog_unverified",
    qualityIssue: wikidata?.qualityIssue || openLibrary?.qualityIssue || "catalog_unverified",
  };
  if (!bothUnavailable) setCached(key, result, MISMATCH_TTL_MS);
  return result;
}

module.exports = {
  verifyBookSuggestionCandidate,
};
