function normalizeCode(value) {
  return String(value || "").trim();
}

const RTL_MARK = "\u200F";
const LTR_MARK = "\u200E";
const FSI = "\u2068";
const PDI = "\u2069";

function lineForLang(lang, text) {
  return lang === "fa" ? `${RTL_MARK}${text}` : text;
}

function firstStrongDirection(text) {
  const value = String(text || "");
  for (const ch of value) {
    if (/[A-Za-z]/.test(ch)) return "ltr";
    if (/[\u0590-\u08FF]/.test(ch)) return "rtl";
  }
  return "rtl";
}

function mixedValueLine(lang, emoji, text) {
  const value = String(text || "");
  if (lang !== "fa") return `${emoji} ${value}`;
  const dirMark = firstStrongDirection(value) === "ltr" ? LTR_MARK : RTL_MARK;
  return `${dirMark}${emoji} ${FSI}${value}${PDI}`;
}

function formatListIndex(lang, value) {
  const index = Number(value) || 0;
  if (lang !== "fa") return String(index);
  return new Intl.NumberFormat("fa-IR").format(index);
}

const { paginateItems } = require("./pagination");
const { PAGINATION } = require("../constants/pagination");
const { getProfileGenderEmoji } = require("./profile");
const SAVED_PROFILES_PAGE_SIZE = PAGINATION.savedProfilesPageSize;
const SAVED_PROFILES_DIVIDER = PAGINATION.listDivider;

function toSavedProfileListItems(codes = [], usersByCode = new Map()) {
  const uniqueCodes = [...new Set((codes || []).map((entry) => normalizeCode(entry)).filter(Boolean))];
  return uniqueCodes.map((code) => {
    const user = usersByCode.get(code);
    const name = user?.profileName || user?.firstName || code;
    const visibleDiscussionCount = Math.max(0, Number(user?.visibleDiscussionCount) || 0);
    return {
      code,
      name: [name, user?.profileEmoji].filter(Boolean).join(" "),
      genderEmoji: getProfileGenderEmoji(user?.gender),
      age: user?.age,
      userId: user?.userId,
      ...(visibleDiscussionCount > 0 ? { visibleDiscussionCount } : {}),
      hasDiscussions: Boolean(user?.hasDiscussions || visibleDiscussionCount > 0),
    };
  });
}

function isCodeSaved(codes = [], code = "") {
  const needle = normalizeCode(code).toLowerCase();
  if (!needle) return false;
  return (codes || []).some((entry) => normalizeCode(entry).toLowerCase() === needle);
}

async function buildSavedProfileListItems({
  codes = [],
  normalizePublicProfileCode,
  findUsersByCodes,
  findDiscussionUserIds,
  findDiscussionCounts,
}) {
  const normalized = [...new Set(
    (codes || []).map((entry) => normalizePublicProfileCode(entry)).filter(Boolean),
  )].reverse();
  if (!normalized.length) return [];
  const users = await findUsersByCodes(normalized);
  const discussionCounts = findDiscussionCounts ? await findDiscussionCounts(users || []) : new Map();
  const discussionUserIds = findDiscussionUserIds ? await findDiscussionUserIds(users || []) : new Set();
  const byCode = new Map((users || []).map((entry) => [
    entry.publicProfileCode,
    {
      ...entry,
      ...(Number(discussionCounts.get(Number(entry.userId))) > 0
        ? { visibleDiscussionCount: Number(discussionCounts.get(Number(entry.userId))) }
        : {}),
      hasDiscussions: discussionUserIds.has(Number(entry.userId))
        || Number(discussionCounts.get(Number(entry.userId))) > 0,
    },
  ]));
  return toSavedProfileListItems(normalized, byCode);
}

function paginateSavedProfiles(items = [], page = 0) {
  return paginateItems(items, page, SAVED_PROFILES_PAGE_SIZE);
}

function buildSavedProfilesListText(messages, lang, items = [], { startIndex = 0, totalCount = items.length } = {}) {
  if (!items.length) return messages[lang].savedProfilesEmpty;

  const viewLabel = messages[lang].savedProfileOpen;
  const baseIndex = Math.max(0, Number(startIndex) || 0);
  const lines = items.map((entry, index, arr) => {
    const viewCommand = `/${entry.code}`;
    const viewAction = lang === "fa"
      ? `👁 ${viewLabel} 👈 ${viewCommand}`
      : `👁 ${viewLabel} 👉 ${viewCommand}`;
    const isLast = index === arr.length - 1;
    const details = [
      lineForLang(lang, `${formatListIndex(lang, baseIndex + index + 1)}.`),
      mixedValueLine(
        lang,
        entry.genderEmoji || "👤",
        `${entry.name}${Number.isInteger(Number(entry.age)) && Number(entry.age) > 0 ? ` — 🎂 ${formatListIndex(lang, entry.age)}` : ""}`,
      ),
      Number(entry.visibleDiscussionCount) > 0
        ? lineForLang(lang, messages[lang].peopleDiscoverProfileDiscussionCount.replace(
          "{count}",
          formatListIndex(lang, entry.visibleDiscussionCount),
        ))
        : "",
    ].filter(Boolean).join("\n");
    const actions = lineForLang(lang, viewAction);
    const item = `${details}\n\n${actions}`;
    return isLast ? `${item}\n\n${SAVED_PROFILES_DIVIDER}` : item;
  });

  const title = `${messages[lang].savedProfilesTitle} (${formatListIndex(lang, totalCount)})`;
  const tip = messages[lang].savedProfilesTip;
  return `${title}\n\n${tip}\n\n${lines.join(`\n\n${SAVED_PROFILES_DIVIDER}\n\n`).replace(new RegExp(`${SAVED_PROFILES_DIVIDER}\\n\\n${SAVED_PROFILES_DIVIDER}$`), SAVED_PROFILES_DIVIDER)}`;
}

function buildProfileDiscussionSectionsText(title, sections = []) {
  const visibleSections = (sections || []).map((section) => String(section || "").trim()).filter(Boolean);
  return [String(title || "").trim(), visibleSections.join("\n\n━━━━━━━━━━\n\n")].filter(Boolean).join("\n\n");
}

module.exports = {
  toSavedProfileListItems,
  isCodeSaved,
  buildSavedProfileListItems,
  paginateSavedProfiles,
  buildSavedProfilesListText,
  buildProfileDiscussionSectionsText,
};
