const { URL, URLSearchParams } = require("url");
const { logger } = require("./logger");
const { chooseOpenLibraryResult } = require("./open-library-suggestion-verifier");

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_BASE_URL = "https://openlibrary.org";
const OPEN_LIBRARY_TIMEOUT_MS = 4500;
const OPEN_LIBRARY_USER_AGENT = "MuzeBot/1.0 (https://t.me/HeyMuzeBot)";
const MAX_VERIFIED_ALIASES = 100;

function cleanText(value, maxLength = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function hasPersianScript(value) {
  return /[\u0600-\u06ff]/u.test(String(value || ""));
}

function normalizeAliasKey(value) {
  return cleanText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function uniqueTextValues(values, limit = MAX_VERIFIED_ALIASES) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const clean = cleanText(value);
    const key = normalizeAliasKey(clean);
    if (!clean || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= limit) break;
  }
  return result;
}

function getPersianAliases(values) {
  return uniqueTextValues(values).filter(hasPersianScript);
}

function choosePersianTitle(values) {
  return getPersianAliases(values)[0] || "";
}

function choosePersianAuthor(values) {
  return getPersianAliases(values)
    .sort((left, right) => {
      const tokenDifference = right.split(/\s+/u).length - left.split(/\s+/u).length;
      return tokenDifference || left.length - right.length;
    })[0] || "";
}

async function fetchOpenLibraryJson(url, { fetchImpl, timeoutMs }) {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(new URL(url), {
      headers: {
        accept: "application/json",
        "user-agent": OPEN_LIBRARY_USER_AGENT,
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: "catalog_unavailable",
        diagnostics: { status: Number(response.status) || 0 },
      };
    }
    return { ok: true, data: await response.json() };
  } catch (error) {
    return {
      ok: false,
      reason: "catalog_unavailable",
      diagnostics: { name: error?.name || "Error" },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getVerifiedEditionAliases(workKey, options) {
  const cleanWorkKey = String(workKey || "").trim();
  if (!/^\/works\/OL\d+W$/i.test(cleanWorkKey)) return [];
  const params = new URLSearchParams({ limit: String(MAX_VERIFIED_ALIASES) });
  const response = await fetchOpenLibraryJson(
    `${OPEN_LIBRARY_BASE_URL}${cleanWorkKey}/editions.json?${params}`,
    options,
  );
  if (!response.ok) return [];
  return uniqueTextValues((response.data?.entries || []).map((entry) => entry?.title));
}

async function verifyOpenLibraryBookCandidate(candidate, {
  fetchImpl = globalThis.fetch,
  timeoutMs = OPEN_LIBRARY_TIMEOUT_MS,
  displayLanguage = "en",
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "catalog_unavailable" };
  }
  const requestedTitle = cleanText(candidate?.originalTitle || candidate?.title);
  const requestedAuthor = cleanText(candidate?.originalAuthor || candidate?.author);
  if (!requestedTitle || !requestedAuthor) {
    return { ok: false, reason: "catalog_unverified" };
  }

  const params = new URLSearchParams({
    title: requestedTitle,
    author: requestedAuthor,
    limit: "12",
    ...(displayLanguage === "fa" ? { lang: "fa" } : {}),
    fields: "key,title,author_name,author_alternative_name,first_publish_year,editions,editions.title,editions.language",
  });
  const searchResponse = await fetchOpenLibraryJson(
    `${OPEN_LIBRARY_SEARCH_URL}?${params}`,
    { fetchImpl, timeoutMs },
  );
  if (!searchResponse.ok) {
    logger.warn("Open Library book identity check failed", {
      name: searchResponse.diagnostics?.name || "HTTPError",
      status: searchResponse.diagnostics?.status || 0,
    });
    return searchResponse;
  }

  const docs = searchResponse.data?.docs || [];
  const result = chooseOpenLibraryResult(docs, requestedTitle, requestedAuthor);
  if (!result) {
    return {
      ok: false,
      reason: "catalog_unverified",
      diagnostics: {
        requestedTitle,
        requestedAuthor,
        candidates: docs.slice(0, 3).map((doc) => ({
          title: cleanText(doc?.title),
          authors: (doc?.author_name || []).slice(0, 3),
        })),
      },
    };
  }

  const canonicalTitle = cleanText(result.title);
  const canonicalAuthors = uniqueTextValues(result.author_name || [], 10);
  const authorAliases = uniqueTextValues([
    ...canonicalAuthors,
    ...(result.author_alternative_name || []),
  ], 50);
  const preferredEditionAliases = uniqueTextValues(
    (result.editions?.docs || []).map((edition) => edition?.title),
  );
  const editionAliases = uniqueTextValues([
    ...preferredEditionAliases,
    ...await getVerifiedEditionAliases(result.key, { fetchImpl, timeoutMs }),
  ]);
  const aliases = uniqueTextValues([
    canonicalTitle,
    requestedTitle,
    ...editionAliases,
  ]);
  const displayTitle = displayLanguage === "fa"
    ? choosePersianTitle(editionAliases)
    : canonicalTitle;
  const displayAuthor = displayLanguage === "fa"
    ? choosePersianAuthor(authorAliases)
    : canonicalAuthors[0] || requestedAuthor;

  return {
    ok: true,
    candidate,
    source: "open_library",
    sourceId: cleanText(result.key),
    canonicalTitle,
    canonicalAuthors,
    aliases,
    authorAliases,
    displayTitle: displayTitle || canonicalTitle,
    displayAuthor: displayAuthor || canonicalAuthors[0] || requestedAuthor,
  };
}

module.exports = {
  verifyOpenLibraryBookCandidate,
};
