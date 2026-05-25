const pendingSuggestions = new Map();

function buildKey(userId, section) {
  return `${Number(userId) || 0}:${String(section || "").trim()}`;
}

function normalizeSuggestionTitle(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function normalizeSuggestionComment(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function setPendingSuggestion(userId, section, title, comment = "") {
  const key = buildKey(userId, section);
  const cleanTitle = normalizeSuggestionTitle(title);
  const cleanComment = normalizeSuggestionComment(comment);
  if (!key || !cleanTitle) return "";
  pendingSuggestions.set(key, {
    title: cleanTitle,
    comment: cleanComment,
  });
  return cleanTitle;
}

function getPendingSuggestion(userId, section) {
  const key = buildKey(userId, section);
  if (!key) return "";
  return pendingSuggestions.get(key) || null;
}

function clearPendingSuggestion(userId, section) {
  const key = buildKey(userId, section);
  if (!key) return;
  pendingSuggestions.delete(key);
}

module.exports = {
  setPendingSuggestion,
  getPendingSuggestion,
  clearPendingSuggestion,
};
