const { URL, URLSearchParams } = require("url");
const { logger } = require("./logger");
const { extractSuggestionCreator } = require("./ai-suggestion-quality");
const {
  extractYear,
  normalizeCatalogueTitle,
} = require("./catalogue-normalization");

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_TIMEOUT_MS = 5000;
const OPEN_LIBRARY_USER_AGENT = "MuzeBot/1.0 (https://t.me/HeyMuzeBot)";

function normalizeCreator(value) {
  return normalizeCatalogueTitle(value);
}

function editDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function similarity(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return 1 - (editDistance(a, b) / longest);
}

function titleMatchStrength(requestedTitle, catalogTitle) {
  const requested = normalizeCatalogueTitle(requestedTitle);
  const catalog = normalizeCatalogueTitle(catalogTitle);
  if (!requested || !catalog) return 0;
  if (requested === catalog) return 1;
  if (requested.length >= 8 && catalog.includes(requested)) return 0.92;
  if (catalog.length >= 8 && requested.includes(catalog)) return 0.9;
  return similarity(requested, catalog);
}

function creatorMatchStrength(expectedAuthor, catalogAuthor) {
  const expected = normalizeCreator(expectedAuthor);
  const catalog = normalizeCreator(catalogAuthor);
  if (!expected || !catalog) return 0;
  if (expected === catalog) return 1;
  return similarity(expected, catalog);
}

function chooseOpenLibraryResult(docs, title, expectedAuthor) {
  const hasExpectedAuthor = Boolean(normalizeCreator(expectedAuthor));
  const ranked = (docs || []).map((doc, index) => {
    const titleStrength = titleMatchStrength(title, doc?.title);
    const authorStrength = hasExpectedAuthor
      ? Math.max(0, ...(doc?.author_name || []).map((author) => (
        creatorMatchStrength(expectedAuthor, author)
      )))
      : 1;
    return { doc, index, titleStrength, authorStrength };
  }).filter(({ titleStrength, authorStrength }) => (
    titleStrength >= 0.9 && authorStrength >= 0.78
  )).sort((left, right) => (
    (right.titleStrength + right.authorStrength)
    - (left.titleStrength + left.authorStrength)
    || left.index - right.index
  ));
  return ranked[0]?.doc || null;
}

async function verifyOpenLibrarySuggestion(suggestion, {
  fetchImpl = globalThis.fetch,
  timeoutMs = OPEN_LIBRARY_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "catalog_unavailable" };
  }
  const requestedTitle = String(suggestion?.title || "").split(/\r?\n/, 1)[0].trim();
  const requestedCreator = extractSuggestionCreator(suggestion?.metadata);
  const params = new URLSearchParams({
    title: requestedTitle,
    ...(requestedCreator ? { author: requestedCreator } : {}),
    limit: "20",
    fields: "key,title,author_name,first_publish_year",
  });
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(new URL(`${OPEN_LIBRARY_SEARCH_URL}?${params}`), {
      headers: {
        accept: "application/json",
        "user-agent": OPEN_LIBRARY_USER_AGENT,
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return { ok: false, reason: "catalog_unavailable" };
    const data = await response.json();
    const result = chooseOpenLibraryResult(
      data?.docs,
      requestedTitle,
      requestedCreator,
    );
    const seenAuthors = new Set();
    const author = (result?.author_name || [])
      .map((name) => String(name || "").trim())
      .filter((name) => {
        if (!name) return false;
        const normalized = normalizeCreator(name);
        if (!normalized || seenAuthors.has(normalized)) return false;
        seenAuthors.add(normalized);
        return true;
      })
      .slice(0, 2)
      .join(", ");
    const year = extractYear(result?.first_publish_year);
    if (!result || !author || !year) {
      const catalogCandidates = (data?.docs || []).slice(0, 3).map((doc) => ({
        title: String(doc?.title || "").trim(),
        creators: (doc?.author_name || [])
          .map((name) => String(name || "").trim())
          .filter(Boolean)
          .slice(0, 3),
        year: extractYear(doc?.first_publish_year),
      }));
      return {
        ok: false,
        reason: "catalog_unverified",
        qualityIssue: result ? "catalog_missing_metadata" : "catalog_title_creator_mismatch",
        diagnostics: {
          requestedTitle,
          requestedCreator,
          normalizedRequestedTitle: normalizeCatalogueTitle(requestedTitle),
          normalizedRequestedCreator: normalizeCreator(requestedCreator),
          catalogCandidates,
        },
      };
    }
    return {
      ok: true,
      verified: true,
      suggestion: {
        ...suggestion,
        title: result.title,
        metadata: `Author: ${author} · ${year}`,
        openLibraryKey: result.key,
      },
    };
  } catch (error) {
    logger.warn("Open Library suggestion verification request failed", {
      name: error?.name || "Error",
    });
    return { ok: false, reason: "catalog_unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  chooseOpenLibraryResult,
  verifyOpenLibrarySuggestion,
};
