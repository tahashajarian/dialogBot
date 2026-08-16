const crypto = require("crypto");
const { version } = require("../../package.json");
const messages = require("../messages");
const { operationalLimits } = require("./operational-limits");
const { getAiListItemsFromUser } = require("./users");
const { countAllPendingReceivedInvitations } = require("./discussion-invitations");
const { listOwnedOpenDiscussionSummaries } = require("./discussions");
const { getDiscussionDisplayTitle } = require("./discussion-ui");
const { starEconomy } = require("./star-settings");
const { logger } = require("./logger");

const HOME_RUNTIME_KEYS = new Map([
  ["status", "status"],
  ["وضعیت", "status"],
  ["diagnostics", "diagnostics"],
]);
const MEDIA_SECTIONS = ["movies", "series", "music", "books"];

function normalizeHomeRuntimeKey(text) {
  const normalized = String(text || "").trim().toLowerCase();
  return HOME_RUNTIME_KEYS.get(normalized) || "";
}

function isHomeRuntimeContext(user) {
  return (
    String(user?.state || "idle") === "idle"
    && String(user?.navigationMode || "") === "global"
    && !user?.activeDiscussionId
  );
}

function replacePlaceholders(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function getMediaFavoriteCounts(user) {
  return Object.fromEntries(MEDIA_SECTIONS.map(
    (section) => [section, getAiListItemsFromUser(user, section, "topTen").length],
  ));
}

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function hasValidLocation(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return (
    Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
  );
}

function getActiveProfileCompletion(user, settings = starEconomy) {
  const fields = [
    hasText(user?.profileName || user?.firstName),
    hasText(user?.city),
    Number.isFinite(Number(user?.age)) && Number(user.age) > 0,
    ["female", "male", "other"].includes(user?.gender),
    hasText(user?.bio),
    hasText(user?.photoFileId),
    getAiListItemsFromUser(user, "random", "topTen").length > 0,
  ];
  if (settings.profilePetPreferenceEnabled) fields.push(hasText(user?.petPreference));
  if (settings.profileLocationEnabled) fields.push(hasValidLocation(user?.location));

  const completed = fields.filter(Boolean).length;
  const total = fields.length;
  return {
    completed,
    total,
    percentage: total ? Math.round((completed / total) * 100) : 0,
  };
}

async function getHomeStatusFacts(user, {
  countInvitations = countAllPendingReceivedInvitations,
  listDiscussions = listOwnedOpenDiscussionSummaries,
} = {}) {
  const [pendingInvitations, discussions] = await Promise.all([
    countInvitations(user?.userId).catch(() => null),
    listDiscussions(user?.userId, {
      limit: operationalLimits.ownedDiscussionHardLimit,
    }).catch(() => null),
  ]);
  return {
    favoriteCounts: getMediaFavoriteCounts(user),
    starBalance: Math.max(0, Number(user?.starBalance) || 0),
    savedProfiles: Array.isArray(user?.savedProfileCodes) ? user.savedProfileCodes.length : 0,
    pendingInvitations,
    discussions: Array.isArray(discussions) ? discussions : null,
    profileCompletion: getActiveProfileCompletion(user),
  };
}

function buildHomeDiscussionLines(lang, discussions) {
  const copy = messages[lang] || messages.fa;
  if (discussions === null) return copy.homeRuntimeUnknown;
  if (!discussions.length) return copy.homeStatusNoDiscussions;
  return discussions.map((discussion) => replacePlaceholders(copy.homeStatusDiscussionLine, {
    title: getDiscussionDisplayTitle(messages, lang, discussion),
    members: Array.isArray(discussion?.memberUserIds) ? discussion.memberUserIds.length : 0,
  })).join("\n");
}

function buildHomeStatusReply(lang, facts) {
  const copy = messages[lang] || messages.fa;
  return replacePlaceholders(copy.homeStatusAnswer, {
    movies: facts.favoriteCounts.movies,
    series: facts.favoriteCounts.series,
    music: facts.favoriteCounts.music,
    books: facts.favoriteCounts.books,
    goal: operationalLimits.aiTopTenItems,
    stars: facts.starBalance,
    saved: facts.savedProfiles,
    invitations: facts.pendingInvitations === null ? copy.homeRuntimeUnknown : facts.pendingInvitations,
    discussions: buildHomeDiscussionLines(lang, facts.discussions),
    profilePercent: facts.profileCompletion.percentage,
    profileCompleted: facts.profileCompletion.completed,
    profileTotal: facts.profileCompletion.total,
  });
}

function buildDiagnosticReference() {
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}

function buildHomeDiagnosticsReply(
  _lang,
  user,
  facts,
  now = new Date(),
  logDiagnostics = (details) => logger.info("Home diagnostics requested", details),
) {
  const copy = messages.en;
  const reference = buildDiagnosticReference();
  const values = {
    version,
    time: now.toISOString(),
    reference,
    userId: Number(user?.userId) || 0,
    profileCode: String(user?.publicProfileCode || "none"),
    language: String(user?.lang || _lang || "fa"),
    state: String(user?.state || "idle"),
    navigation: String(user?.navigationMode || "global"),
    discussions: facts.discussions === null ? copy.homeRuntimeUnknown : facts.discussions.length,
    movies: facts.favoriteCounts.movies,
    series: facts.favoriteCounts.series,
    music: facts.favoriteCounts.music,
    books: facts.favoriteCounts.books,
    saved: facts.savedProfiles,
    invitations: facts.pendingInvitations === null ? copy.homeRuntimeUnknown : facts.pendingInvitations,
    profilePercent: facts.profileCompletion.percentage,
  };
  logDiagnostics({
    reference,
    userId: values.userId,
    version,
    language: values.language,
    state: values.state,
    navigation: values.navigation,
  });
  return replacePlaceholders(copy.homeDiagnosticsAnswer, values);
}

async function getHomeRuntimeInfoReply({
  text,
  lang,
  user,
  now = new Date(),
  dependencies,
}) {
  if (!isHomeRuntimeContext(user)) return "";
  const key = normalizeHomeRuntimeKey(text);
  if (!key) return "";

  const facts = await getHomeStatusFacts(user, dependencies);
  if (key === "status") return buildHomeStatusReply(lang, facts);
  return buildHomeDiagnosticsReply(lang, user, facts, now, dependencies?.logDiagnostics);
}

module.exports = {
  HOME_RUNTIME_KEYS,
  buildHomeDiagnosticsReply,
  buildHomeStatusReply,
  getHomeRuntimeInfoReply,
  getHomeStatusFacts,
  getActiveProfileCompletion,
  isHomeRuntimeContext,
  normalizeHomeRuntimeKey,
};
