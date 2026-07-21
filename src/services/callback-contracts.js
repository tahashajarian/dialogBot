const { callBacks } = require("../constants");

const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;
const CALLBACK_DOMAINS = Object.freeze(new Set([
  "account",
  "ai",
  "discussion",
  "help",
  "lang",
  "menu",
  "onboarding",
  "people",
  "profile",
  "saved",
]));
const AI_SECTIONS = Object.freeze(new Set(["movies", "music", "books", "random"]));

/**
 * @typedef {Object} ParsedCallbackData
 * @property {string} raw
 * @property {string} domain
 * @property {string[]} segments
 * @property {number} byteLength
 * @property {boolean} withinTelegramLimit
 * @property {boolean} recognizedDomain
 */

/** @returns {ParsedCallbackData} */
function parseCallbackData(value = "") {
  const raw = String(value || "").trim();
  const segments = raw ? raw.split(":") : [];
  const domain = segments[0] || "";
  const byteLength = Buffer.byteLength(raw, "utf8");
  return {
    raw,
    domain,
    segments,
    byteLength,
    withinTelegramLimit: byteLength > 0 && byteLength <= TELEGRAM_CALLBACK_DATA_MAX_BYTES,
    recognizedDomain: CALLBACK_DOMAINS.has(domain),
  };
}

function normalizeCallbackRouteLabel(value = "") {
  const parsed = parseCallbackData(value);
  if (!parsed.raw) return "callback:unknown";
  const lengths = {
    menu: 3,
    ai: 4,
    profile: 4,
    people: 4,
    discussion: parsed.raw.startsWith("discussion:create:")
      || parsed.raw.startsWith("discussion:list:")
      || parsed.raw.startsWith("discussion:invite:") ? 4 : 3,
    saved: 3,
    onboarding: 3,
  };
  if (parsed.raw.startsWith("lang:set:")) return "callback:lang:set";
  const segmentCount = lengths[parsed.domain] || 2;
  return `callback:${parsed.segments.slice(0, segmentCount).join(":") || "unknown"}`;
}

function parseDiscussionClosePayload(value = "") {
  const [discussionId = "", requestedSource = "room"] = String(value || "").split(":");
  return {
    discussionId,
    source: requestedSource === "mine" || requestedSource === "active" ? requestedSource : "room",
  };
}

function getAiSuggestionCallbackSection(value = "") {
  const data = String(value || "");
  const prefixes = [
    callBacks.aiSectionAnotherSuggestion,
    callBacks.aiSectionSuggestMenu,
    callBacks.aiSectionSuggestFromTopTen,
    callBacks.aiSectionSuggestContextCancel,
    callBacks.aiPaidSuggestionCancel,
  ];
  const prefix = prefixes.find((entry) => data.startsWith(entry));
  if (!prefix) return "";
  const section = data.slice(prefix.length).trim();
  return AI_SECTIONS.has(section) ? section : "";
}

module.exports = {
  CALLBACK_DOMAINS,
  TELEGRAM_CALLBACK_DATA_MAX_BYTES,
  getAiSuggestionCallbackSection,
  normalizeCallbackRouteLabel,
  parseCallbackData,
  parseDiscussionClosePayload,
};
