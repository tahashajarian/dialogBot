const { normalizeAiListItem, getAiListItemsFromUser, getAiTasteFromUser } = require("./users");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");
const { operationalLimits } = require("./operational-limits");

const DISCUSSION_JOIN_RULE_TYPES = ["open", "top_ten_completed", "taste_label", "top_ten_item"];
const DISCUSSION_JOIN_RULE_SECTIONS = ["movies", "music", "books", "random"];

function validateJoinRulePayload(joinRule = {}) {
  const type = String(joinRule.type || "open");
  if (!DISCUSSION_JOIN_RULE_TYPES.includes(type)) {
    return { ok: false, reason: "invalid_join_rule" };
  }

  if (type === "open") return { ok: true, joinRule: { type: "open" } };

  const section = String(joinRule.section || "");
  if (!DISCUSSION_JOIN_RULE_SECTIONS.includes(section)) {
    return { ok: false, reason: "invalid_section" };
  }

  if (type === "top_ten_completed") {
    return { ok: true, joinRule: { type, section } };
  }

  if (type === "taste_label") {
    const tasteLabelKey = String(joinRule.tasteLabelKey || "").trim();
    if (!tasteLabelKey) return { ok: false, reason: "missing_taste_label" };
    return { ok: true, joinRule: { type, section, tasteLabelKey } };
  }

  const itemTitle = normalizeAiListItem(joinRule.itemTitle || "");
  if (!itemTitle) return { ok: false, reason: "missing_item" };
  const itemAliases = Array.isArray(joinRule.itemAliases)
    ? joinRule.itemAliases.map(normalizeAiListItem).filter(Boolean)
    : [];
  const aliases = [...new Set([itemTitle, ...itemAliases])];
  return { ok: true, joinRule: { type, section, itemTitle, itemAliases: aliases } };
}

async function validateJoinRules({ user, joinRule }) {
  if (!user) return { ok: false, reason: "missing_user" };
  const type = joinRule?.type || "open";

  if (type === "open") {
    return { ok: true };
  }

  const section = joinRule.section;
  if (type === "top_ten_completed") {
    const topTen = getAiListItemsFromUser(user, section, "topTen");
    if (topTen.length >= operationalLimits.aiTopTenItems) return { ok: true };
    return { ok: false, reason: "requires_top_ten_completed", section };
  }

  if (type === "taste_label") {
    const taste = getAiTasteFromUser(user, section);
    if (taste?.labelKey && taste.labelKey === joinRule.tasteLabelKey) {
      return { ok: true };
    }
    return { ok: false, reason: "requires_taste_label", section, tasteLabelKey: joinRule.tasteLabelKey };
  }

  if (type === "top_ten_item") {
    const topTen = getAiListItemsFromUser(user, section, "topTen");
    const candidates = [
      joinRule.itemTitle,
      ...(Array.isArray(joinRule.itemAliases) ? joinRule.itemAliases : []),
    ].filter(Boolean);
    const match = candidates.some((itemTitle) => getAiListDuplicateMatch(itemTitle, topTen));
    const hasItem = Boolean(match);
    if (hasItem) return { ok: true };
    return { ok: false, reason: "requires_top_ten_item", section, itemTitle: joinRule.itemTitle };
  }

  return { ok: false, reason: "invalid_join_rule" };
}

module.exports = {
  DISCUSSION_JOIN_RULE_SECTIONS,
  DISCUSSION_JOIN_RULE_TYPES,
  validateJoinRulePayload,
  validateJoinRules,
};
