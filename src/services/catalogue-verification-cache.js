const { normalizeCatalogueTitle } = require("./catalogue-normalization");

const MAX_ENTRIES = 300;
const VERIFIED_TTL_MS = 6 * 60 * 60 * 1000;
const UNVERIFIED_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

function getKey(section, suggestion) {
  return [
    section,
    normalizeCatalogueTitle(suggestion?.title),
    normalizeCatalogueTitle(suggestion?.metadata),
  ].join(":");
}

function readCatalogueVerification(section, suggestion) {
  const key = getKey(section, suggestion);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  if (!entry.ok) return { ...entry.result };
  return {
    ok: true,
    suggestion: {
      ...suggestion,
      ...entry.catalogueFields,
    },
  };
}

function writeCatalogueVerification(section, suggestion, result) {
  if (!result?.ok && result?.reason !== "catalog_unverified") return;
  const key = getKey(section, suggestion);
  const entry = result.ok
    ? {
        ok: true,
        catalogueFields: {
          title: result.suggestion.title,
          metadata: result.suggestion.metadata,
          mediaType: result.suggestion.mediaType,
          catalogueId: result.suggestion.catalogueId,
          wikidataId: result.suggestion.wikidataId,
          musicBrainzId: result.suggestion.musicBrainzId,
          openLibraryKey: result.suggestion.openLibraryKey,
        },
        expiresAt: Date.now() + VERIFIED_TTL_MS,
      }
    : {
        ok: false,
        result: {
          ok: false,
          reason: result.reason,
          qualityIssue: result.qualityIssue,
        },
        expiresAt: Date.now() + UNVERIFIED_TTL_MS,
      };
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

function clearCatalogueVerificationCache() {
  cache.clear();
}

module.exports = {
  clearCatalogueVerificationCache,
  readCatalogueVerification,
  writeCatalogueVerification,
};
