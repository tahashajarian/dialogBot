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
  const lines = items.map((entry, index) => {
    const command = `/${entry.code}`;
    const action = lang === "fa" ? `${viewLabel} 👈 ${command}` : `${viewLabel} 👉 ${command}`;
    return `${index + 1}. 👤 ${entry.name}\n${action}`;
  });

  return `${messages[lang].savedProfilesTitle}\n\n${lines.join("\n\n")}`;
}

module.exports = {
  toSavedProfileListItems,
  isCodeSaved,
  buildSavedProfileListItems,
  buildSavedProfilesListText,
};
