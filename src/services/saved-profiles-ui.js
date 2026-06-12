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
const SAVED_PROFILES_PAGE_SIZE = PAGINATION.savedProfilesPageSize;
const SAVED_PROFILES_DIVIDER = PAGINATION.listDivider;

function toSavedProfileListItems(codes = [], usersByCode = new Map()) {
  const uniqueCodes = [...new Set((codes || []).map((entry) => normalizeCode(entry)).filter(Boolean))];
  return uniqueCodes.map((code) => {
    const user = usersByCode.get(code);
    return {
      code,
      name: user?.profileName || user?.firstName || code,
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
}) {
  const normalized = [...new Set((codes || []).map((entry) => normalizePublicProfileCode(entry)).filter(Boolean))];
  if (!normalized.length) return [];
  const users = await findUsersByCodes(normalized);
  const byCode = new Map((users || []).map((entry) => [entry.publicProfileCode, entry]));
  return toSavedProfileListItems(normalized, byCode);
}

function paginateSavedProfiles(items = [], page = 0) {
  return paginateItems(items, page, SAVED_PROFILES_PAGE_SIZE);
}

function buildSavedProfilesListText(messages, lang, items = [], { startIndex = 0 } = {}) {
  if (!items.length) return messages[lang].savedProfilesEmpty;

  const viewLabel = messages[lang].savedProfileOpen;
  const removeLabel = messages[lang].savedProfileRemove;
  const discussionsLabel = messages[lang].savedProfileDiscussions;
  const baseIndex = Math.max(0, Number(startIndex) || 0);
  const lines = items.map((entry, index, arr) => {
    const viewCommand = `/${entry.code}`;
    const removeCommand = `/unsave_${entry.code.replace(/^u_/i, "")}`;
    const discussionsCommand = `/discussions_${entry.code.replace(/^u_/i, "")}`;
    const viewAction = lang === "fa"
      ? `👁 ${viewLabel} 👈 ${viewCommand}`
      : `👁 ${viewLabel} 👉 ${viewCommand}`;
    const removeAction = lang === "fa"
      ? `🗑 ${removeLabel} 👈 ${removeCommand}`
      : `🗑 ${removeLabel} 👉 ${removeCommand}`;
    const discussionsAction = lang === "fa"
      ? `${discussionsLabel} 👈 ${discussionsCommand}`
      : `${discussionsLabel} 👉 ${discussionsCommand}`;
    const isLast = index === arr.length - 1;
    const item = `${lineForLang(lang, `${formatListIndex(lang, baseIndex + index + 1)}.`)}\n${mixedValueLine(lang, "👤", entry.name)}\n${lineForLang(lang, viewAction)}\n${lineForLang(lang, discussionsAction)}\n${lineForLang(lang, removeAction)}`;
    return isLast ? `${item}\n\n${SAVED_PROFILES_DIVIDER}` : item;
  });

  return `${messages[lang].savedProfilesTitle}\n\n${lines.join(`\n\n${SAVED_PROFILES_DIVIDER}\n\n`).replace(new RegExp(`${SAVED_PROFILES_DIVIDER}\\n\\n${SAVED_PROFILES_DIVIDER}$`), SAVED_PROFILES_DIVIDER)}`;
}

function buildProfileSavedFooter(messages, lang, code, isSaved) {
  if (isSaved) return `🤖 ${messages[lang].profileSavedButton}`;
  const command = `/save_${String(code || "").replace(/^u_/i, "")}`;
  const action = lang === "fa"
    ? `${messages[lang].profileSaveButton} 👈 ${command}`
    : `${messages[lang].profileSaveButton} 👉 ${command}`;
  return `🤖 ${action}`;
}

module.exports = {
  toSavedProfileListItems,
  isCodeSaved,
  buildSavedProfileListItems,
  paginateSavedProfiles,
  buildSavedProfilesListText,
  buildProfileSavedFooter,
};
