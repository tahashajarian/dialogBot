const { PAGINATION } = require("../constants/pagination");
const { callBacks } = require("../constants");
const { getTasteLabelEmoji, getTasteLabelTitle } = require("./ai-section");

function buildPeopleHubText(messages, lang, { showFirstVisitTip = false } = {}) {
  return [
    messages[lang].peopleMenu,
    showFirstVisitTip ? messages[lang].peopleFirstVisitTip : "",
  ].filter(Boolean).join("\n\n");
}

function addPeopleNearbyTip(text, tipText = "") {
  if (!tipText) return text;
  const value = String(text || "");
  const firstLineBreak = value.indexOf("\n");
  if (firstLineBreak < 0) return [value, tipText].filter(Boolean).join("\n\n");
  const title = value.slice(0, firstLineBreak).trimEnd();
  const body = value.slice(firstLineBreak).trim();
  return [title, tipText, body].filter(Boolean).join("\n\n");
}

const PEOPLE_DIVIDER = PAGINATION.listDivider;
const RTL_MARK = "\u200F";
const FSI = "\u2068";
const PDI = "\u2069";

function formatListIndex(lang, value) {
  const index = Number(value) || 0;
  if (lang !== "fa") return String(index);
  return new Intl.NumberFormat("fa-IR").format(index);
}

function formatProfileListNameLine(lang, {
  name = "",
  genderEmoji = "",
  age = null,
  isNearby = false,
} = {}) {
  const personEmoji = genderEmoji || "👤";
  const nearbySuffix = isNearby ? " 📍" : "";
  const numericAge = Number(age);
  const ageSuffix = Number.isInteger(numericAge) && numericAge > 0
    ? ` — 🎂 ${formatListIndex(lang, numericAge)}`
    : "";
  return lang === "fa"
    ? `${RTL_MARK}${personEmoji} ${FSI}${name}${PDI}${ageSuffix}${nearbySuffix}`
    : `${personEmoji} ${name}${ageSuffix}${nearbySuffix}`;
}

function formatPeopleDiscoveryRequirementText(template, lang, minSharedItems) {
  return String(template || "").replace(
    "{minimumSharedItems}",
    formatListIndex(lang, minSharedItems),
  );
}

function sectionLabel(messages, lang, section) {
  const key = `aiSuggest${section === "random" ? "Random" : section.charAt(0).toUpperCase() + section.slice(1)}`;
  return messages[lang][key] || section;
}

function formatSharedLine(messages, lang, sharedSection) {
  return messages[lang].peopleDiscoverSharedLine
    .replace("{section}", sectionLabel(messages, lang, sharedSection.section))
    .replace("{count}", formatListIndex(lang, sharedSection.count));
}

function formatTasteLabelMatchLine(messages, lang, sharedTasteLabel) {
  const { section, labelKey } = sharedTasteLabel;
  return messages[lang].peopleDiscoverTasteLabelLine
    .replace("{section}", sectionLabel(messages, lang, section))
    .replace("{emoji}", getTasteLabelEmoji(section, labelKey))
    .replace("{label}", getTasteLabelTitle(messages, lang, section, labelKey));
}

function buildPeopleDiscoveryText(messages, lang, items = [], {
  startIndex = 0,
  title = messages[lang].peopleDiscoverTitle,
  intro = messages[lang].peopleDiscoverIntro,
  emptyText = messages[lang].peopleDiscoverNoProfiles,
  showSharedSections = false,
  totalCount = items.length,
} = {}) {
  if (!items.length) return emptyText;

  const baseIndex = Math.max(0, Number(startIndex) || 0);
  const discoveryCount = Math.max(0, Number(totalCount) || 0);
  let nextDiscoveryIndex = Math.min(baseIndex, discoveryCount) + 1;
  let nextSavedIndex = Math.max(0, baseIndex - discoveryCount) + 1;
  const rows = items.map((entry, index) => {
    const shortCode = String(entry.code || "").replace(/^u_/i, "");
    const viewCommand = `/${entry.code}`;
    const saveCommand = `/save_${shortCode}`;
    const viewAction = lang === "fa"
      ? `👁 ${messages[lang].peopleDiscoverViewProfile} 👈 ${viewCommand}`
      : `👁 ${messages[lang].peopleDiscoverViewProfile} 👉 ${viewCommand}`;
    const saveAction = entry.isSaved
      ? messages[lang].profileSavedButton
      : lang === "fa"
        ? `🔖 ${messages[lang].peopleDiscoverSaveProfile} 👈 ${saveCommand}`
        : `🔖 ${messages[lang].peopleDiscoverSaveProfile} 👉 ${saveCommand}`;
    const sharedLines = showSharedSections ? [
      ...(entry.sharedTasteLabels || [])
        .map((shared) => `🏷 ${formatTasteLabelMatchLine(messages, lang, shared)}`),
      ...(entry.sharedSections || [])
        .map((shared) => `🎯 ${formatSharedLine(messages, lang, shared)}`),
    ].slice(0, 2).join("\n") : "";
    const nameLine = formatProfileListNameLine(lang, entry);
    const actions = [viewAction, saveAction].filter(Boolean).join("\n\n");

    const itemIndex = entry.isSaved ? nextSavedIndex++ : nextDiscoveryIndex++;
    const details = [
      `${formatListIndex(lang, itemIndex)}.`,
      nameLine,
      sharedLines,
    ].filter(Boolean).join("\n");
    const row = [details, actions].filter(Boolean).join("\n\n");
    const previous = items[index - 1];
    const startsSavedSection = entry.isSaved && !previous?.isSaved;
    return startsSavedSection
      ? `${messages[lang].peopleDiscoverSavedSection}\n\n${row}`
      : row;
  });

  const countedTitle = `${title} (${formatListIndex(lang, totalCount)})`;
  return `${countedTitle}\n\n${intro}\n\n${rows.join(`\n\n${PEOPLE_DIVIDER}\n\n`)}`;
}

function isPeopleCallback(data = "") {
  return data === callBacks.people ||
    data === callBacks.peopleListClose ||
    data === callBacks.peopleDiscover ||
    data === callBacks.peopleSimilarReengagementOpen ||
    data.startsWith(callBacks.peopleDiscoverLanguageOpen) ||
    data.startsWith(callBacks.peopleDiscoverLanguageSet) ||
    data === callBacks.peopleTasteMatches ||
    data === callBacks.peopleTasteMatchesUnlock ||
    data === callBacks.peopleTasteMatchesCancel ||
    data.startsWith(callBacks.peopleTasteMatchesConfirm) ||
    data.startsWith(callBacks.peopleTasteMatchesPage) ||
    data === callBacks.peopleAdvancedSearch ||
    data === callBacks.peopleAdvancedSearchNotify ||
    data === callBacks.peopleAdvancedSearchBack ||
    data.startsWith(callBacks.peopleDiscoverPage);
}

module.exports = {
  addPeopleNearbyTip,
  buildPeopleHubText,
  buildPeopleDiscoveryText,
  formatProfileListNameLine,
  formatPeopleDiscoveryRequirementText,
  isPeopleCallback,
};
