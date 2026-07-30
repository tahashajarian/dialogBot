const { URL, URLSearchParams } = require("url");
const { logger } = require("./logger");
const { extractSuggestionCreator } = require("./ai-suggestion-quality");
const {
  extractYear,
  normalizeCatalogueTitle,
} = require("./catalogue-normalization");

const MUSICBRAINZ_BASE_URL = "https://musicbrainz.org/ws/2";
const MUSICBRAINZ_TIMEOUT_MS = 5000;
const MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS = 1100;
const MUSICBRAINZ_USER_AGENT = "MuzeBot/1.0 (https://t.me/HeyMuzeBot)";
let musicBrainzRequestQueue = Promise.resolve();
let lastMusicBrainzRequestAt = 0;

function getArtistCreditName(entry) {
  return (entry?.["artist-credit"] || [])
    .map((credit) => {
      const name = String(credit?.name || credit?.artist?.name || "").trim();
      return name ? `${name}${credit?.joinphrase || ""}` : "";
    })
    .filter(Boolean)
    .join("");
}

function normalizeCreator(value) {
  return normalizeCatalogueTitle(value);
}

function hasReleaseTitle(entry, expectedAlbum) {
  const normalizedAlbum = normalizeCatalogueTitle(expectedAlbum);
  return !normalizedAlbum || (entry?.releases || []).some((release) => (
    normalizeCatalogueTitle(release?.title) === normalizedAlbum
  ));
}

function chooseMusicBrainzResult(entries, title, expectedCreator, expectedAlbum = "") {
  const normalizedTitle = normalizeCatalogueTitle(title);
  const normalizedCreator = normalizeCreator(expectedCreator);
  const exact = (entries || []).filter((entry) => (
    normalizeCatalogueTitle(entry?.title) === normalizedTitle
  ));
  if (!exact.length) return null;
  if (!normalizedCreator) return exact[0];
  return exact.find((entry) => (
    normalizeCreator(getArtistCreditName(entry)) === normalizedCreator
    && hasReleaseTitle(entry, expectedAlbum)
  )) || null;
}

function extractExpectedAlbum(metadata) {
  const value = String(metadata || "");
  const match = value.match(/(?:\bAlbum|آلبوم)\s*:\s*([^·|،;]+)/i);
  return String(match?.[1] || "")
    .replace(/\b(?:18|19|20)\d{2}\b.*$/g, "")
    .replace(/(?:۱۸|۱۹|۲۰)[۰-۹]{2}.*$/g, "")
    .trim();
}

function chooseRecordingRelease(recording, expectedAlbum = "") {
  const releases = [...(recording?.releases || [])];
  const normalizedAlbum = normalizeCatalogueTitle(expectedAlbum);
  const matchingAlbum = normalizedAlbum
    ? releases.filter((release) => (
      normalizeCatalogueTitle(release?.title) === normalizedAlbum
    ))
    : [];
  if (normalizedAlbum && !matchingAlbum.length) return null;
  const officialAlbums = releases.filter((release) => (
    (!release?.status || release.status === "Official")
    && (!release?.["release-group"]?.["primary-type"]
      || release["release-group"]["primary-type"] === "Album")
  ));
  const candidates = matchingAlbum.length ? matchingAlbum : officialAlbums;
  return [...candidates].sort((left, right) => {
    const leftYear = Number(extractYear(left?.date)) || Number.MAX_SAFE_INTEGER;
    const rightYear = Number(extractYear(right?.date)) || Number.MAX_SAFE_INTEGER;
    return leftYear - rightYear;
  })[0] || {};
}

async function fetchMusicBrainz(path, {
  fetchImpl = globalThis.fetch,
  timeoutMs = MUSICBRAINZ_TIMEOUT_MS,
  minRequestIntervalMs = MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "catalog_unavailable" };
  }
  const request = async () => {
    const waitMs = Math.max(
      0,
      lastMusicBrainzRequestAt + Math.max(0, minRequestIntervalMs) - Date.now(),
    );
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(new URL(`${MUSICBRAINZ_BASE_URL}${path}`), {
        headers: {
          accept: "application/json",
          "user-agent": MUSICBRAINZ_USER_AGENT,
        },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) return { ok: false, reason: "catalog_unavailable" };
      return { ok: true, data: await response.json() };
    } catch (error) {
      logger.warn("MusicBrainz suggestion verification request failed", {
        name: error?.name || "Error",
      });
      return { ok: false, reason: "catalog_unavailable" };
    } finally {
      lastMusicBrainzRequestAt = Date.now();
      if (timer) clearTimeout(timer);
    }
  };
  const scheduled = musicBrainzRequestQueue.then(request, request);
  musicBrainzRequestQueue = scheduled.catch(() => {});
  return scheduled;
}

function buildRecordingMetadata(recording, expectedAlbum = "") {
  const artist = getArtistCreditName(recording);
  const release = chooseRecordingRelease(recording, expectedAlbum);
  if (!release) return "";
  const album = String(release?.title || "").trim();
  return [
    artist ? `Artist: ${artist}` : "",
    album ? `Album: ${album}` : "",
  ].filter(Boolean).join(" · ");
}

function buildReleaseGroupMetadata(releaseGroup) {
  const artist = getArtistCreditName(releaseGroup);
  const year = extractYear(releaseGroup?.["first-release-date"]);
  return [
    artist ? `Artist: ${artist}` : "",
    year,
  ].filter(Boolean).join(" · ");
}

async function verifyMusicBrainzSuggestion(suggestion, options = {}) {
  const title = String(suggestion?.title || "").trim();
  const expectedCreator = extractSuggestionCreator(suggestion?.metadata);
  const expectedAlbum = extractExpectedAlbum(suggestion?.metadata);
  const cleanQueryValue = (value) => String(value || "").replaceAll("\"", "").trim();
  const recordingQuery = [
    `recording:"${cleanQueryValue(title)}"`,
    expectedCreator ? `artist:"${cleanQueryValue(expectedCreator)}"` : "",
    expectedAlbum ? `release:"${cleanQueryValue(expectedAlbum)}"` : "",
  ].filter(Boolean).join(" AND ");
  const query = new URLSearchParams({
    query: recordingQuery,
    fmt: "json",
    limit: "10",
  });
  const recordings = await fetchMusicBrainz(`/recording/?${query}`, options);
  if (!recordings.ok) return recordings;
  const recording = chooseMusicBrainzResult(
    recordings.data?.recordings,
    title,
    expectedCreator,
    expectedAlbum,
  );
  if (recording) {
    const metadata = buildRecordingMetadata(recording, expectedAlbum);
    if (!metadata || !getArtistCreditName(recording)) {
      return {
        ok: false,
        reason: "catalog_unverified",
        qualityIssue: "catalog_missing_metadata",
      };
    }
    return {
      ok: true,
      verified: true,
      suggestion: {
        ...suggestion,
        title: recording.title,
        metadata,
        musicBrainzId: recording.id,
      },
    };
  }

  const albumQuery = new URLSearchParams({
    query: `releasegroup:"${title.replaceAll("\"", "")}"`,
    fmt: "json",
    limit: "10",
  });
  const releaseGroups = await fetchMusicBrainz(`/release-group/?${albumQuery}`, options);
  if (!releaseGroups.ok) return releaseGroups;
  const releaseGroup = chooseMusicBrainzResult(
    releaseGroups.data?.["release-groups"],
    title,
    expectedCreator,
  );
  if (!releaseGroup) {
    return {
      ok: false,
      reason: "catalog_unverified",
      qualityIssue: "catalog_title_creator_mismatch",
    };
  }
  const metadata = buildReleaseGroupMetadata(releaseGroup);
  if (!metadata || !getArtistCreditName(releaseGroup)) {
    return {
      ok: false,
      reason: "catalog_unverified",
      qualityIssue: "catalog_missing_metadata",
    };
  }
  return {
    ok: true,
    verified: true,
    suggestion: {
      ...suggestion,
      title: releaseGroup.title,
      metadata,
      musicBrainzId: releaseGroup.id,
    },
  };
}

module.exports = {
  chooseMusicBrainzResult,
  getArtistCreditName,
  verifyMusicBrainzSuggestion,
};
