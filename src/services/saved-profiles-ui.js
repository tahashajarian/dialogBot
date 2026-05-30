function normalizeCode(value) {
  return String(value || "").trim();
}

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

function buildSavedProfilesListText(messages, lang, items = []) {
  if (!items.length) return messages[lang].savedProfilesEmpty;

  const viewLabel = messages[lang].savedProfileOpen;
  const removeLabel = messages[lang].savedProfileRemove;
  const lines = items.map((entry, index) => {
    const viewCommand = `/${entry.code}`;
    const removeCommand = `/unsave_${entry.code.replace(/^u_/i, "")}`;
    const viewAction = lang === "fa" ? `${viewLabel} 👈 ${viewCommand}` : `${viewLabel} 👉 ${viewCommand}`;
    const removeAction = lang === "fa" ? `${removeLabel} 👈 ${removeCommand}` : `${removeLabel} 👉 ${removeCommand}`;
    return `${index + 1}. 👤 ${entry.name}\n${viewAction}\n${removeAction}`;
  });

  return `${messages[lang].savedProfilesTitle}\n\n${lines.join("\n\n")}`;
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
  buildSavedProfilesListText,
  buildProfileSavedFooter,
};
