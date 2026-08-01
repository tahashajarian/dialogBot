const { URL, URLSearchParams } = require("url");
const { logger } = require("./logger");
const { normalizeCatalogueTitle } = require("./catalogue-normalization");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");

const GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const BOOK_RETRIEVAL_TIMEOUT_MS = 5000;
const OPEN_LIBRARY_USER_AGENT = "MuzeBot/1.0 (https://t.me/HeyMuzeBot)";
const MAX_SEEDS = 3;
const MAX_AUTHOR_HINTS = 4;
const MAX_CANDIDATES = 36;
const MIN_AVAILABLE_CANDIDATES = 3;
const MAX_DISCOVERY_SUBJECTS = 4;
const MAX_DISCOVERY_AUTHORS = 3;
const MAX_EXPANSION_QUERIES = 4;

const GENERIC_SUBJECTS = new Set([
  "book",
  "books",
  "fiction",
  "general",
  "literature",
  "novel",
  "novels",
  "reading",
]);

function clean(value, maxLength = 160) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function hasPersianScript(value) {
  return /[\u0621-\u063a\u0641-\u064a\u0671-\u06d3\u06fa-\u06fc]/u.test(String(value || ""));
}

function inferAuthorQueries(favorites, limit = MAX_AUTHOR_HINTS) {
  const counts = new Map();
  const order = new Map();
  for (const [index, favorite] of (favorites || []).entries()) {
    const tokens = clean(favorite, 140)
      .replace(/[«»“”"'()[\]{}،,:؛;!?]+/gu, " ")
      .split(/\s+/u)
      .map((token) => clean(token, 40))
      .filter((token) => token.length >= 2 && !/^\d+$/u.test(token));
    if (tokens.length < 3) continue;
    const author = tokens.slice(-2).join(" ");
    const key = normalizeCatalogueTitle(author);
    if (!key) continue;
    counts.set(author, (counts.get(author) || 0) + 1);
    if (!order.has(author)) order.set(author, index);
  }
  return [...counts.keys()]
    .sort((left, right) => (counts.get(right) - counts.get(left)) || (order.get(left) - order.get(right)))
    .slice(0, limit);
}

function createSourceStats() {
  return {
    requests: 0,
    successes: 0,
    timeouts: 0,
    httpErrors: 0,
    networkErrors: 0,
    statuses: {},
  };
}

function createRetrievalStats() {
  return {
    requests: 0,
    successfulResponses: 0,
    timeouts: 0,
    httpErrors: 0,
    networkErrors: 0,
    googleBooksResponses: 0,
    openLibraryResponses: 0,
    sources: {
      google_books: createSourceStats(),
      open_library: createSourceStats(),
    },
  };
}

function recordRetrievalStat(stats, key, amount = 1) {
  if (!stats || !Object.prototype.hasOwnProperty.call(stats, key)) return;
  stats[key] += amount;
}

function recordSourceStat(stats, source, key, amount = 1) {
  const sourceStats = stats?.sources?.[source];
  if (!sourceStats || !Object.prototype.hasOwnProperty.call(sourceStats, key)) return;
  sourceStats[key] += amount;
}

function attachRetrievalDiagnostics(candidates, diagnostics) {
  Object.defineProperty(candidates, "diagnostics", {
    value: diagnostics,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return candidates;
}

function isPersianLanguage(value) {
  const language = clean(value, 20).toLocaleLowerCase("en-US");
  return language === "fa"
    || language.startsWith("fa-")
    || language === "per"
    || language === "fas"
    || language === "persian";
}

function isRomanizedPersianCandidate(candidate) {
  return Boolean(
    candidate
    && !hasPersianScript(candidate.title)
    && isPersianLanguage(candidate.language),
  );
}

function firstAuthor(candidate) {
  return clean(candidate?.author || candidate?.authors?.[0] || "", 100);
}

function preferredAuthorName(doc, languagePreference = "") {
  const names = [
    ...(Array.isArray(doc?.author_name) ? doc.author_name : []),
    ...(Array.isArray(doc?.author_alternative_name) ? doc.author_alternative_name : []),
  ].map((name) => clean(name, 100)).filter(Boolean);
  if (!names.length) return "";
  const wantsPersian = languagePreference === "fa";
  return names.find((name) => hasPersianScript(name) === wantsPersian) || names[0];
}

function bookKey(candidate) {
  const identifiers = Array.isArray(candidate?.identifiers) ? candidate.identifiers : [];
  const stableIdentifier = identifiers.map(clean).find(Boolean);
  if (stableIdentifier) return `id:${normalizeCatalogueTitle(stableIdentifier)}`;
  const sourceId = clean(candidate?.sourceId);
  if (sourceId) return `${candidate?.source || "catalog"}:${sourceId}`;
  return `${normalizeCatalogueTitle(candidate?.title)}::${normalizeCatalogueTitle(firstAuthor(candidate))}`;
}

function titleAuthorKey(candidate) {
  const title = normalizeCatalogueTitle(candidate?.title);
  const author = normalizeCatalogueTitle(firstAuthor(candidate));
  return title && author ? `${title}::${author}` : "";
}

function uniqueBookCandidates(items, limit = MAX_CANDIDATES) {
  const seenIdentity = new Set();
  const seenTitleAuthor = new Set();
  const result = [];
  for (const item of items || []) {
    const title = clean(item?.title, 180);
    const author = firstAuthor(item);
    if (!title || !author) continue;
    const identityKey = bookKey({ ...item, title, author });
    const pairKey = titleAuthorKey({ ...item, title, author });
    if (!pairKey || seenIdentity.has(identityKey) || seenTitleAuthor.has(pairKey)) continue;
    seenIdentity.add(identityKey);
    seenTitleAuthor.add(pairKey);
    result.push({
      ...item,
      title,
      author,
      authors: undefined,
      subjects: (item?.subjects || []).map((subject) => clean(subject, 80)).filter(Boolean).slice(0, 8),
      identifiers: (item?.identifiers || []).map(clean).filter(Boolean).slice(0, 4),
    });
    if (result.length >= limit) break;
  }
  return result;
}

async function fetchJson(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = BOOK_RETRIEVAL_TIMEOUT_MS,
  headers = {},
  source = "book_catalog",
  stats = null,
} = {}) {
  if (typeof fetchImpl !== "function") return null;
  recordRetrievalStat(stats, "requests");
  recordSourceStat(stats, source, "requests");
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", ...headers },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) {
      recordRetrievalStat(stats, "httpErrors");
      recordSourceStat(stats, source, "httpErrors");
      const statusKey = String(Number(response.status) || "unknown");
      const statuses = stats?.sources?.[source]?.statuses;
      if (statuses) statuses[statusKey] = (statuses[statusKey] || 0) + 1;
      return null;
    }
    const data = await response.json();
    recordRetrievalStat(stats, "successfulResponses");
    recordSourceStat(stats, source, "successes");
    recordRetrievalStat(stats, source === "google_books" ? "googleBooksResponses" : "openLibraryResponses");
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      recordRetrievalStat(stats, "timeouts");
      recordSourceStat(stats, source, "timeouts");
    } else {
      recordRetrievalStat(stats, "networkErrors");
      recordSourceStat(stats, source, "networkErrors");
      logger.warn("Book candidate retrieval request failed", {
        source,
        name: error?.name || "Error",
      });
    }
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function googleBookCandidates(data) {
  return (data?.items || []).map((entry) => {
    const info = entry?.volumeInfo || {};
    return {
      title: clean(info.title, 180),
      author: clean(info.authors?.[0], 100),
      source: "google_books",
      sourceId: clean(entry?.id, 100),
      language: clean(info.language, 12),
      subjects: Array.isArray(info.categories) ? info.categories : [],
      description: clean(info.description, 360),
      identifiers: (info.industryIdentifiers || []).map((item) => item?.identifier),
    };
  }).filter((candidate) => candidate.title && candidate.author && candidate.sourceId);
}

function openLibraryBookCandidates(data, { languagePreference = "" } = {}) {
  const wantsPersian = languagePreference === "fa";
  const candidates = [];
  for (const doc of data?.docs || []) {
    const author = preferredAuthorName(doc, languagePreference);
    if (!author) continue;
    const editions = Array.isArray(doc?.editions?.docs) ? doc.editions.docs : [];
    const orderedEditions = [...editions].sort((left, right) => {
      const score = (edition) => {
        const title = clean(edition?.title, 180);
        const language = clean(edition?.language?.[0], 12);
        return (hasPersianScript(title) === wantsPersian ? 4 : 0)
          + (isPersianLanguage(language) === wantsPersian ? 2 : 0);
      };
      return score(right) - score(left);
    });
    const records = orderedEditions.length ? orderedEditions.slice(0, 8) : [{}];
    for (const edition of records) {
      candidates.push({
        title: clean(edition?.title || doc?.title, 180),
        author,
        source: "open_library",
        sourceId: clean(edition?.key || doc?.key, 100),
        language: clean(edition?.language?.[0] || doc?.language?.[0], 12),
        subjects: Array.isArray(doc?.subject) ? doc.subject : [],
        description: clean(
          Array.isArray(doc?.first_sentence) ? doc.first_sentence[0] : doc?.first_sentence,
          360,
        ),
        identifiers: Array.isArray(edition?.isbn)
          ? edition.isbn
          : Array.isArray(doc?.isbn)
            ? doc.isbn
            : [],
      });
    }
  }
  return candidates.filter((candidate) => candidate.title && candidate.author && candidate.sourceId);
}

async function searchGoogleBooks(query, {
  field = "query",
  maxResults = 20,
  language = "",
  startIndex = 0,
  apiKey = process.env.GOOGLE_BOOKS_API_KEY || "",
  ...options
} = {}) {
  const cleanQuery = clean(query, 120);
  if (!cleanQuery) return [];
  const q = field === "author"
    ? `inauthor:"${cleanQuery}"`
    : field === "subject"
      ? `subject:"${cleanQuery}"`
      : cleanQuery;
  const params = new URLSearchParams({
    q,
    maxResults: String(Math.min(40, Math.max(1, maxResults))),
    startIndex: String(Math.max(0, Number(startIndex) || 0)),
    orderBy: "relevance",
    printType: "books",
    ...(language ? { langRestrict: language } : {}),
    ...(clean(apiKey, 200) ? { key: clean(apiKey, 200) } : {}),
  });
  const data = await fetchJson(new URL(`${GOOGLE_BOOKS_URL}?${params}`), {
    ...options,
    source: "google_books",
  });
  return googleBookCandidates(data);
}

async function searchOpenLibrary(query, {
  field = "query",
  limit = 20,
  languagePreference = "",
  page = 1,
  includeEditions = true,
  ...options
} = {}) {
  const cleanQuery = clean(query, 120);
  if (!cleanQuery) return [];
  const params = new URLSearchParams({
    ...(field === "author"
      ? { author: cleanQuery }
      : field === "subject"
        ? { q: `subject:"${cleanQuery}"` }
        : { q: cleanQuery }),
    limit: String(Math.min(40, Math.max(1, limit))),
    page: String(Math.max(1, Number(page) || 1)),
    fields: includeEditions
      ? "key,title,author_name,author_alternative_name,subject,language,isbn,first_sentence,editions,editions.key,editions.title,editions.language,editions.isbn"
      : "key,title,author_name,author_alternative_name,subject,language,isbn,first_sentence",
    ...(languagePreference ? { lang: languagePreference } : {}),
  });
  const data = await fetchJson(new URL(`${OPEN_LIBRARY_SEARCH_URL}?${params}`), {
    ...options,
    headers: { "user-agent": OPEN_LIBRARY_USER_AGENT },
    source: "open_library",
  });
  return openLibraryBookCandidates(data, { languagePreference });
}

function getDiscoverySubjects(candidates, limit = MAX_DISCOVERY_SUBJECTS) {
  const counts = new Map();
  for (const candidate of candidates || []) {
    for (const rawSubject of candidate?.subjects || []) {
      const variants = clean(rawSubject, 80).split(/\s*\/\s*/).map((part) => clean(part, 60));
      for (const subject of variants) {
        const normalized = subject.toLocaleLowerCase("en-US");
        if (
          subject.length < 4
          || subject.length > 60
          || GENERIC_SUBJECTS.has(normalized)
          || /^\d+$/.test(subject)
        ) continue;
        counts.set(subject, (counts.get(subject) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .map(([subject]) => subject)
    .slice(0, limit);
}

function getDiscoveryAuthors(candidates, limit = MAX_DISCOVERY_AUTHORS) {
  const counts = new Map();
  for (const candidate of candidates || []) {
    const author = firstAuthor(candidate);
    if (!author) continue;
    counts.set(author, (counts.get(author) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([author]) => author)
    .slice(0, limit);
}

function orderCandidates(candidates, displayLanguage, seedAuthors = []) {
  const wantsPersian = displayLanguage === "fa";
  const seedAuthorKeys = new Set(seedAuthors.map(normalizeCatalogueTitle).filter(Boolean));
  return [...candidates].sort((left, right) => {
    const score = (candidate) => {
      const titleScript = hasPersianScript(candidate.title) === wantsPersian ? 6 : 0;
      const authorScript = hasPersianScript(candidate.author) === wantsPersian ? 2 : 0;
      const differentAuthor = seedAuthorKeys.has(normalizeCatalogueTitle(candidate.author)) ? 0 : 2;
      const sourcePriority = candidate.source === "google_books" ? 1 : 0;
      return titleScript + authorScript + differentAuthor + sourcePriority;
    };
    return score(right) - score(left);
  });
}

function isBlockedBookCandidate(candidate, blockedItems = []) {
  return Boolean(
    getAiListDuplicateMatch(candidate?.title, blockedItems)
    || getAiListDuplicateMatch(`${candidate?.title || ""} ${firstAuthor(candidate)}`, blockedItems),
  );
}

function isDisplayableBookCandidate(candidate, displayLanguage) {
  if (!candidate || isRomanizedPersianCandidate(candidate)) return false;
  if (displayLanguage === "fa") return hasPersianScript(candidate.title);
  return true;
}

function availableBookCandidates(candidates, {
  blockedItems = [],
  displayLanguage = "en",
} = {}) {
  return uniqueBookCandidates(candidates, 96).filter((candidate) => (
    isDisplayableBookCandidate(candidate, displayLanguage)
    && !isBlockedBookCandidate(candidate, blockedItems)
  ));
}

function getExpansionQueries(tasteStyleHint, subjects, displayLanguage) {
  const tasteParts = clean(tasteStyleHint, 160)
    .split(/[،,؛;|/]+/u)
    .map((part) => clean(part, 60))
    .filter((part) => part.length >= 4);
  const defaults = displayLanguage === "fa"
    ? ["رمان ادبی", "ادبیات داستانی"]
    : ["literary fiction", "contemporary fiction"];
  return [...new Set([
    ...tasteParts,
    ...(subjects || []).slice(0, 2),
    ...defaults,
  ])].slice(0, MAX_EXPANSION_QUERIES);
}

function initialSearchRequests(query, displayLanguage, options, maxResults = 12) {
  const requests = [
    searchGoogleBooks(query, { ...options, maxResults }),
    searchOpenLibrary(query, {
      ...options,
      limit: maxResults,
      languagePreference: displayLanguage,
      includeEditions: false,
    }),
  ];
  return requests;
}

function authorSearchRequests(author, displayLanguage, options, {
  maxResults = 18,
  startIndex = 0,
  page = 1,
} = {}) {
  const requests = [
    searchOpenLibrary(author, {
      ...options,
      field: "author",
      limit: maxResults,
      page,
      languagePreference: displayLanguage,
      includeEditions: true,
    }),
  ];
  if (displayLanguage === "fa") {
    requests.push(searchGoogleBooks(author, {
      ...options,
      field: "author",
      maxResults,
      startIndex,
      language: "fa",
    }));
  } else {
    requests.push(searchGoogleBooks(author, {
      ...options,
      field: "author",
      maxResults,
      startIndex,
    }));
  }
  return requests;
}

async function retrieveBookCandidates({
  favorites = [],
  displayLanguage = "en",
  tasteStyleHint = "",
  blockedItems = [],
} = {}, options = {}) {
  const seeds = [...new Set(
    (favorites || []).map((item) => clean(item, 140)).filter(Boolean),
  )].slice(0, MAX_SEEDS);
  const authorHints = inferAuthorQueries(favorites);
  const fallbackQuery = clean(tasteStyleHint, 120);
  const stats = createRetrievalStats();
  const requestOptions = { ...options, stats };
  if (!seeds.length && !fallbackQuery && !authorHints.length) {
    return attachRetrievalDiagnostics([], { ...stats, authorHints: [] });
  }

  const initialRequests = [
    ...seeds.flatMap((seed) => initialSearchRequests(seed, displayLanguage, requestOptions, 12)),
    ...authorHints.flatMap((author) => authorSearchRequests(
      author,
      displayLanguage,
      requestOptions,
      { maxResults: 18 },
    )),
  ];
  if (fallbackQuery) {
    initialRequests.push(...initialSearchRequests(fallbackQuery, displayLanguage, requestOptions, 16));
  }

  const seedGroups = initialRequests.length ? await Promise.all(initialRequests) : [];
  const seedCandidates = uniqueBookCandidates(seedGroups.flat(), 80);
  const subjects = getDiscoverySubjects(seedCandidates);
  const discoveredAuthors = getDiscoveryAuthors(seedCandidates);
  const authorHintKeys = new Set(authorHints.map(normalizeCatalogueTitle));
  const newDiscoveredAuthors = discoveredAuthors.filter((author) => (
    !authorHintKeys.has(normalizeCatalogueTitle(author))
  ));
  const authorQueries = [...new Set([...authorHints, ...newDiscoveredAuthors])].slice(0, MAX_DISCOVERY_AUTHORS + 2);
  const discoveryRequests = [
    ...subjects.flatMap((subject) => [
      searchGoogleBooks(subject, {
        ...requestOptions,
        field: "subject",
        maxResults: 20,
        ...(displayLanguage === "fa" ? { language: "fa" } : {}),
      }),
      searchOpenLibrary(subject, {
        ...requestOptions,
        field: "subject",
        limit: 20,
        languagePreference: displayLanguage,
        includeEditions: true,
      }),
    ]),
    ...newDiscoveredAuthors.flatMap((author) => authorSearchRequests(
      author,
      displayLanguage,
      requestOptions,
      { maxResults: 18 },
    )),
  ];

  const discoveredGroups = discoveryRequests.length ? await Promise.all(discoveryRequests) : [];
  const firstPool = [...discoveredGroups.flat(), ...seedCandidates];
  let available = availableBookCandidates(firstPool, { blockedItems, displayLanguage });

  // If the first catalogue pass is empty or mostly blocked, keep using the
  // remaining request budget. Author hints are especially important when the
  // favorites are Persian translations of non-Persian books.
  if (available.length < MIN_AVAILABLE_CANDIDATES) {
    const expansionQueries = getExpansionQueries(
      fallbackQuery,
      subjects,
      displayLanguage,
    );
    const expansionRequests = [
      ...expansionQueries.flatMap((query) => [
        searchGoogleBooks(query, {
          ...requestOptions,
          maxResults: 30,
          startIndex: 12,
          ...(displayLanguage === "fa" ? { language: "fa" } : {}),
        }),
        searchOpenLibrary(query, {
          ...requestOptions,
          limit: 30,
          page: 2,
          languagePreference: displayLanguage,
          includeEditions: true,
        }),
      ]),
      ...authorHints.flatMap((author) => authorSearchRequests(
        author,
        displayLanguage,
        requestOptions,
        { maxResults: 24, startIndex: 12, page: 2 },
      )),
      ...subjects.slice(0, 2).flatMap((subject) => [
        searchGoogleBooks(subject, {
          ...requestOptions,
          field: "subject",
          maxResults: 24,
          startIndex: 16,
          ...(displayLanguage === "fa" ? { language: "fa" } : {}),
        }),
        searchOpenLibrary(subject, {
          ...requestOptions,
          field: "subject",
          limit: 24,
          page: 2,
          languagePreference: displayLanguage,
          includeEditions: true,
        }),
      ]),
    ];
    const expandedGroups = expansionRequests.length ? await Promise.all(expansionRequests) : [];
    available = availableBookCandidates(
      [...expandedGroups.flat(), ...firstPool],
      { blockedItems, displayLanguage },
    );
  }

  const result = orderCandidates(available, displayLanguage, authorQueries).slice(0, MAX_CANDIDATES);
  const diagnostics = {
    ...stats,
    seedCandidates: seedCandidates.length,
    availableCandidates: result.length,
    authorHints,
  };
  if (!result.length) {
    logger.warn("Book catalogue retrieval returned no usable candidates", diagnostics);
  }
  return attachRetrievalDiagnostics(result, diagnostics);
}

module.exports = {
  bookKey,
  getDiscoveryAuthors,
  getDiscoverySubjects,
  availableBookCandidates,
  googleBookCandidates,
  hasPersianScript,
  inferAuthorQueries,
  isBlockedBookCandidate,
  isDisplayableBookCandidate,
  isPersianLanguage,
  isRomanizedPersianCandidate,
  openLibraryBookCandidates,
  preferredAuthorName,
  retrieveBookCandidates,
  searchGoogleBooks,
  searchOpenLibrary,
  titleAuthorKey,
  uniqueBookCandidates,
};
