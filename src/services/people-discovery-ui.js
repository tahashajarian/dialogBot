const { PAGINATION } = require("../constants/pagination");
const { callBacks } = require("../constants");

const PEOPLE_DIVIDER = PAGINATION.listDivider;
const RTL_MARK = "\u200F";
const FSI = "\u2068";
const PDI = "\u2069";

function formatListIndex(lang, value) {
  const index = Number(value) || 0;
  if (lang !== "fa") return String(index);
  return new Intl.NumberFormat("fa-IR").format(index);
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
    const sharedLines = showSharedSections ? (entry.sharedSections || [])
      .slice(0, 2)
      .map((shared) => `🎯 ${formatSharedLine(messages, lang, shared)}`)
      .join("\n") : "";
    const personEmoji = entry.genderEmoji || "👤";
    const age = Number(entry.age);
    const ageSuffix = Number.isInteger(age) && age > 0
      ? ` — 🎂 ${formatListIndex(lang, age)}`
      : "";
    const nameLine = lang === "fa"
      ? `${RTL_MARK}${personEmoji} ${FSI}${entry.name}${PDI}${ageSuffix}`
      : `${personEmoji} ${entry.name}${ageSuffix}`;

    return [
      `${formatListIndex(lang, baseIndex + index + 1)}.`,
      nameLine,
      sharedLines,
      viewAction,
      saveAction,
    ].filter(Boolean).join("\n");
  });

  const countedTitle = `${title} (${formatListIndex(lang, totalCount)})`;
  return `${countedTitle}\n\n${intro}\n\n${rows.join(`\n\n${PEOPLE_DIVIDER}\n\n`)}`;
}

function isPeopleCallback(data = "") {
  return data === callBacks.people ||
    data === callBacks.peopleDiscover ||
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
  buildPeopleDiscoveryText,
  isPeopleCallback,
};
