function getRestrictionDisplayName(messages, lang, entry) {
  const user = entry?.user;
  const base = String(user?.profileName || user?.firstName || "").trim();
  if (!base) return messages[lang].profileInvitationRestrictionUnavailable;
  return [base, user?.profileEmoji].filter(Boolean).join(" ");
}

function buildInvitationRestrictionsView(messages, lang, entries = [], { start = 0, totalCount = entries.length } = {}) {
  const prepared = entries.map((entry, index) => ({
    restrictionId: String(entry?.restriction?._id || ""),
    userId: Number(entry?.restriction?.mutedUserId),
    publicProfileCode: String(entry?.user?.publicProfileCode || ""),
    name: getRestrictionDisplayName(messages, lang, entry),
    index: start + index + 1,
  }));
  const localizeNumber = (value) => lang === "fa"
    ? new Intl.NumberFormat("fa-IR").format(Number(value) || 0)
    : String(Number(value) || 0);
  const pointer = lang === "fa" ? "👈" : "👉";
  const body = prepared.length
    ? prepared.map((entry) => [
      messages[lang].profileInvitationRestrictionEntry
        .replace("{index}", localizeNumber(entry.index))
        .replace("{name}", entry.name),
      entry.publicProfileCode
        ? `👁 ${messages[lang].profileInvitationRestrictionView} ${pointer} /${entry.publicProfileCode}`
        : "",
      `✅ ${messages[lang].profileInvitationRestrictionAllow} ${pointer} ${entry.publicProfileCode
        ? `/allow_inv_${entry.publicProfileCode.replace(/^u_/i, "")}`
        : `/allow_ir_${entry.restrictionId}`}`,
    ].filter(Boolean).join("\n")).join("\n\n-----\n\n")
    : messages[lang].profileInvitationRestrictionsEmpty;
  return {
    entries: prepared,
    text: [
      messages[lang].profileInvitationRestrictionsTitle.replace("{count}", localizeNumber(totalCount)),
      messages[lang].profileInvitationRestrictionsIntro,
      body,
    ].join("\n\n"),
  };
}

module.exports = {
  buildInvitationRestrictionsView,
  getRestrictionDisplayName,
};
