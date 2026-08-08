const { URL, URLSearchParams } = require("url");
const { logger } = require("./logger");

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_TIMEOUT_MS = 4500;
function getOpenLibraryUserAgent() {
  const contact = String(process.env.OPEN_LIBRARY_CONTACT_EMAIL || "").trim();
  return `MuzeBot/1.0 (${contact || "https://t.me/HeyMuzeBot"})`;
}
const MAX_VERIFIED_ALIASES = 100;

function cleanText(value, maxLength = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function hasPersianScript(value) {
  return /[\u0600-\u06ff]/u.test(String(value || ""));
}

function normalizeAliasKey(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
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

function isDisallowedBookRecordTitle(value) {
  return /\b(?:study guide|study notes?|notes?|summary|analysis|criticism|companion|workbook|coles notes?|cliffs?notes?)\b/i
    .test(String(value || ""));
}

function chooseExactBookResult(docs, requestedTitle, requestedAuthor) {
  const titleKey = normalizeAliasKey(requestedTitle);
  const authorKey = normalizeAliasKey(requestedAuthor);
  if (!titleKey || !authorKey || isDisallowedBookRecordTitle(requestedTitle)) return null;
  return (docs || []).find((doc) => {
    if (isDisallowedBookRecordTitle(doc?.title)) return false;
    const titles = [
      doc?.title,
      ...(doc?.editions?.docs || []).map((edition) => edition?.title),
    ];
    const hasExactSafeTitle = titles.some((title) => (
      !isDisallowedBookRecordTitle(title)
      && normalizeAliasKey(title) === titleKey
    ));
    if (!hasExactSafeTitle) return false;
    const authors = [
      ...(doc?.author_name || []),
      ...(doc?.author_alternative_name || []),
    ];
    return authors.some((author) => normalizeAliasKey(author) === authorKey);
  }) || null;
}

async function fetchOpenLibraryJson(url, { fetchImpl, timeoutMs }) {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(new URL(url), {
      headers: {
        accept: "application/json",
        "user-agent": getOpenLibraryUserAgent(),
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
  const result = chooseExactBookResult(docs, requestedTitle, requestedAuthor);
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
  const editionAliases = preferredEditionAliases;
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
  chooseExactBookResult,
  isDisallowedBookRecordTitle,
  verifyOpenLibraryBookCandidate,
};
