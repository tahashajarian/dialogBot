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

function chooseOpenLibraryResult(docs, title, expectedAuthor) {
  const normalizedTitle = normalizeCatalogueTitle(title);
  const normalizedAuthor = normalizeCreator(expectedAuthor);
  const exact = (docs || []).filter((doc) => (
    normalizeCatalogueTitle(doc?.title) === normalizedTitle
  ));
  if (!exact.length) return null;
  if (!normalizedAuthor) return exact[0];
  return exact.find((doc) => (
    (doc?.author_name || []).some((author) => (
      normalizeCreator(author) === normalizedAuthor
    ))
  )) || null;
}

async function verifyOpenLibrarySuggestion(suggestion, {
  fetchImpl = globalThis.fetch,
  timeoutMs = OPEN_LIBRARY_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "catalog_unavailable" };
  }
  const params = new URLSearchParams({
    title: String(suggestion?.title || "").trim(),
    limit: "10",
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
      suggestion?.title,
      extractSuggestionCreator(suggestion?.metadata),
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
      return {
        ok: false,
        reason: "catalog_unverified",
        qualityIssue: result ? "catalog_missing_metadata" : "catalog_title_creator_mismatch",
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
