const { URL, URLSearchParams } = require("url");
const { logger } = require("./logger");
const {
  extractYear,
  normalizeCatalogueTitle,
} = require("./catalogue-normalization");
const { extractSuggestionCreator } = require("./ai-suggestion-quality");

const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
const WIKIDATA_TIMEOUT_MS = 5000;
const WIKIDATA_USER_AGENT = "MuzeBot/1.0 (https://t.me/HeyMuzeBot)";
const MOVIE_INSTANCE_IDS = new Set([
  "Q11424", // film
  "Q506240", // television film
  "Q24869", // feature film
  "Q226730", // silent film
  "Q202866", // animated film
]);
const SERIES_INSTANCE_IDS = new Set([
  "Q5398426", // television series
  "Q1259759", // miniseries
  "Q15416", // television program
]);
const BOOK_INSTANCE_IDS = new Set([
  "Q571", // book
  "Q7725634", // literary work
  "Q8261", // novel
  "Q149537", // novella
  "Q1279564", // short story collection
  "Q25379", // play
  "Q482", // poetry
]);

function getEntityClaimIds(entity, property) {
  return (entity?.claims?.[property] || [])
    .map((claim) => claim?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}

function getEntityClaimYears(entity, property = "P577") {
  return (entity?.claims?.[property] || [])
    .map((claim) => claim?.mainsnak?.datavalue?.value?.time)
    .map(extractYear)
    .filter(Boolean);
}

function getEntityYears(entity) {
  return [
    ...getEntityClaimYears(entity, "P577"),
    ...getEntityClaimYears(entity, "P580"),
    ...getEntityClaimYears(entity, "P571"),
  ].filter((year, index, years) => years.indexOf(year) === index);
}

function getEntityNames(entity) {
  return [
    ...(entity?._searchNames || []),
    ...Object.values(entity?.labels || {}).map((entry) => entry?.value),
    ...Object.values(entity?.aliases || {}).flatMap((entries) => (
      (entries || []).map((entry) => entry?.value)
    )),
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function addSearchNamesToEntities(entities, searchResults) {
  const namesById = new Map((searchResults || []).map((result) => [
    result?.id,
    [
      result?.label,
      result?.match?.text,
      ...(result?.aliases || []),
    ].filter(Boolean),
  ]));
  return Object.fromEntries(Object.entries(entities || {}).map(([id, entity]) => [
    id,
    {
      ...entity,
      _searchNames: namesById.get(id) || [],
    },
  ]));
}

function getEntityMediaType(entity) {
  const instances = getEntityClaimIds(entity, "P31");
  if (instances.some((id) => MOVIE_INSTANCE_IDS.has(id))) return "movie";
  if (instances.some((id) => SERIES_INSTANCE_IDS.has(id))) return "tv";
  return "";
}

function isBookEntity(entity) {
  return getEntityClaimIds(entity, "P31").some((id) => BOOK_INSTANCE_IDS.has(id));
}

function chooseWikidataEntity(entities, title, metadata = "") {
  const normalizedTitle = normalizeCatalogueTitle(title);
  const requestedYear = extractYear(metadata);
  const exact = Object.values(entities || {}).filter((entity) => (
    !entity?.missing
    && getEntityMediaType(entity)
    && getEntityNames(entity).some((name) => (
      normalizeCatalogueTitle(name) === normalizedTitle
    ))
  ));
  if (!exact.length) return null;
  if (requestedYear) {
    const yearMatches = exact.filter((entity) => (
      getEntityYears(entity).includes(requestedYear)
    ));
    if (!yearMatches.length) return null;
    return yearMatches[0];
  }
  return [...exact].sort((left, right) => {
    const leftDates = getEntityYears(left).length;
    const rightDates = getEntityYears(right).length;
    return rightDates - leftDates;
  })[0];
}

async function fetchWikidata(params, {
  fetchImpl = globalThis.fetch,
  timeoutMs = WIKIDATA_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "catalog_unavailable" };
  }
  const url = new URL(WIKIDATA_API_URL);
  url.search = new URLSearchParams({
    format: "json",
    formatversion: "2",
    origin: "*",
    ...params,
  }).toString();
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": WIKIDATA_USER_AGENT,
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return { ok: false, reason: "catalog_unavailable" };
    return { ok: true, data: await response.json() };
  } catch (error) {
    logger.warn("Wikidata suggestion verification request failed", {
      name: error?.name || "Error",
    });
    return { ok: false, reason: "catalog_unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getWikidataEntities(ids, options) {
  if (!ids.length) return { ok: true, entities: {} };
  const response = await fetchWikidata({
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "claims|labels|aliases",
    languages: "en|fa",
    languagefallback: "1",
  }, options);
  return response.ok
    ? { ok: true, entities: response.data?.entities || {} }
    : response;
}

function getEntityDisplayTitle(entity, requestedTitle) {
  const requested = normalizeCatalogueTitle(requestedTitle);
  return getEntityNames(entity).find((name) => (
    normalizeCatalogueTitle(name) === requested
  )) || entity?.labels?.en?.value || entity?.labels?.fa?.value || "";
}

async function verifyWikidataSuggestion(suggestion, options = {}) {
  const search = await fetchWikidata({
    action: "wbsearchentities",
    search: String(suggestion?.title || "").trim(),
    language: "en",
    uselang: "en",
    type: "item",
    limit: "10",
  }, options);
  if (!search.ok) return search;

  const ids = (search.data?.search || []).map((entry) => entry?.id).filter(Boolean);
  const entityResult = await getWikidataEntities(ids, options);
  if (!entityResult.ok) return entityResult;
  const entitiesWithSearchNames = addSearchNamesToEntities(
    entityResult.entities,
    search.data?.search,
  );
  const entity = chooseWikidataEntity(
    entitiesWithSearchNames,
    suggestion?.title,
    suggestion?.metadata,
  );
  if (!entity) {
    return {
      ok: false,
      reason: "catalog_unverified",
      qualityIssue: "catalog_title_mismatch",
    };
  }

  const mediaType = getEntityMediaType(entity);
  const creatorProperty = mediaType === "movie" ? "P57" : "P170";
  let creatorIds = getEntityClaimIds(entity, creatorProperty);
  if (!creatorIds.length && mediaType === "tv") {
    creatorIds = getEntityClaimIds(entity, "P57");
  }
  const creatorResult = await getWikidataEntities(creatorIds.slice(0, 2), options);
  if (!creatorResult.ok) return creatorResult;
  const requestedCreator = extractSuggestionCreator(suggestion?.metadata || "");
  const creatorNames = creatorIds.flatMap((id) => (
    getEntityNames(creatorResult.entities?.[id])
  ));
  if (!creatorIds.length || !creatorNames.length) {
    return {
      ok: false,
      reason: "catalog_unverified",
      qualityIssue: "catalog_missing_metadata",
    };
  }
  if (requestedCreator && !creatorNames.some((name) => (
    normalizeCatalogueTitle(name) === normalizeCatalogueTitle(requestedCreator)
  ))) {
    return {
      ok: false,
      reason: "catalog_unverified",
      qualityIssue: "catalog_creator_mismatch",
    };
  }
  const creators = creatorIds
    .map((id) => creatorResult.entities?.[id]?.labels?.en?.value
      || creatorResult.entities?.[id]?.labels?.fa?.value)
    .filter(Boolean)
    .slice(0, 2);
  const genreIds = getEntityClaimIds(entity, "P136").slice(0, 8);
  const genreResult = await getWikidataEntities(genreIds, options);
  if (!genreResult.ok) return genreResult;
  const catalogGenres = genreIds.map((id) => (
    genreResult.entities?.[id]?.labels?.en?.value
      || genreResult.entities?.[id]?.labels?.fa?.value
  )).filter(Boolean);
  const year = getEntityYears(entity)[0] || "";
  const title = String(suggestion?.title || "").trim()
    || getEntityDisplayTitle(entity, suggestion?.title);
  if (!title || !creators.length) {
    return {
      ok: false,
      reason: "catalog_unverified",
      qualityIssue: "catalog_missing_metadata",
    };
  }

  const creatorLabel = mediaType === "movie" ? "Director" : "Creator";
  const displayCreators = requestedCreator ? [requestedCreator] : creators;
  return {
    ok: true,
    verified: true,
    suggestion: {
      ...suggestion,
      title,
      metadata: [year, `${creatorLabel}: ${displayCreators.join(", ")}`].filter(Boolean).join(" · "),
      mediaType,
      wikidataId: entity.id,
      catalogGenres,
      aliases: getEntityNames(entity),
    },
  };
}

async function verifyWikidataBookCandidate(candidate, options = {}) {
  const requestedTitle = String(candidate?.originalTitle || candidate?.title || "").trim();
  const requestedAuthor = String(candidate?.originalAuthor || candidate?.author || "").trim();
  if (!requestedTitle || !requestedAuthor) {
    return { ok: false, reason: "catalog_unverified", qualityIssue: "catalog_missing_metadata" };
  }
  const searchLanguage = /[\u0600-\u06ff]/u.test(requestedTitle) ? "fa" : "en";
  const search = await fetchWikidata({
    action: "wbsearchentities",
    search: requestedTitle,
    language: searchLanguage,
    uselang: searchLanguage,
    type: "item",
    limit: "10",
  }, options);
  if (!search.ok) return search;
  const ids = (search.data?.search || []).map((entry) => entry?.id).filter(Boolean);
  const entityResult = await getWikidataEntities(ids, options);
  if (!entityResult.ok) return entityResult;
  const entities = addSearchNamesToEntities(entityResult.entities, search.data?.search);
  const normalizedTitle = normalizeCatalogueTitle(requestedTitle);
  const exactTitleEntities = Object.values(entities).filter((entry) => (
    !entry?.missing
    && !getEntityMediaType(entry)
    && getEntityNames(entry).some((name) => normalizeCatalogueTitle(name) === normalizedTitle)
  ));
  if (!exactTitleEntities.length) {
    return { ok: false, reason: "catalog_unverified", qualityIssue: "catalog_title_mismatch" };
  }
  const orderedEntities = [...exactTitleEntities].sort((left, right) => (
    Number(isBookEntity(right)) - Number(isBookEntity(left))
  ));
  const authorIds = [...new Set(orderedEntities.flatMap((entry) => (
    getEntityClaimIds(entry, "P50").slice(0, 4)
  )))];
  const authorResult = await getWikidataEntities(authorIds, options);
  if (!authorResult.ok) return authorResult;
  const normalizedAuthor = normalizeCatalogueTitle(requestedAuthor);
  const entity = orderedEntities.find((entry) => getEntityClaimIds(entry, "P50")
    .slice(0, 4)
    .some((id) => getEntityNames(authorResult.entities?.[id])
      .some((name) => normalizeCatalogueTitle(name) === normalizedAuthor)));
  if (!entity) {
    return { ok: false, reason: "catalog_unverified", qualityIssue: "catalog_creator_mismatch" };
  }
  const matchedAuthorIds = getEntityClaimIds(entity, "P50").slice(0, 4);
  const authorNames = matchedAuthorIds.flatMap((id) => getEntityNames(authorResult.entities?.[id]));
  return {
    ok: true,
    verified: true,
    candidate,
    source: "wikidata",
    sourceId: entity.id,
    canonicalTitle: requestedTitle,
    canonicalAuthors: [requestedAuthor],
    aliases: getEntityNames(entity),
    authorAliases: authorNames,
    displayTitle: requestedTitle,
    displayAuthor: requestedAuthor,
  };
}

module.exports = {
  addSearchNamesToEntities,
  chooseWikidataEntity,
  getEntityMediaType,
  isBookEntity,
  verifyWikidataBookCandidate,
  verifyWikidataSuggestion,
};
