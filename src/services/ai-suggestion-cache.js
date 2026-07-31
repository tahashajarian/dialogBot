const pendingSuggestions = new Map();
const suggestionMoods = new Map();
const activeSuggestionActions = new Set();

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

function setPendingSuggestion(userId, section, title, comment = "", metadata = "", identity = {}) {
  const key = buildKey(userId, section);
  const cleanTitle = normalizeSuggestionTitle(title);
  const cleanComment = normalizeSuggestionComment(comment);
  const cleanMetadata = normalizeSuggestionComment(metadata);
  if (!key || !cleanTitle) return "";
  pendingSuggestions.set(key, {
    title: cleanTitle,
    metadata: cleanMetadata,
    comment: cleanComment,
    sourceTitle: normalizeSuggestionTitle(identity?.sourceTitle),
    sourceArtist: normalizeSuggestionComment(identity?.sourceArtist),
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

function claimSuggestionAction(userId, section) {
  const key = buildKey(userId, section);
  if (!key || activeSuggestionActions.has(key)) return null;
  activeSuggestionActions.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeSuggestionActions.delete(key);
  };
}

function setSuggestionMood(userId, section, mood) {
  const key = buildKey(userId, section);
  const cleanMood = normalizeSuggestionComment(mood).slice(0, 80);
  if (!key) return "";
  if (!cleanMood) {
    suggestionMoods.delete(key);
    return "";
  }
  suggestionMoods.set(key, cleanMood);
  return cleanMood;
}

function getSuggestionMood(userId, section) {
  return suggestionMoods.get(buildKey(userId, section)) || "";
}

function clearSuggestionMood(userId, section) {
  suggestionMoods.delete(buildKey(userId, section));
}

module.exports = {
  claimSuggestionAction,
  setPendingSuggestion,
  getPendingSuggestion,
  clearPendingSuggestion,
  clearSuggestionMood,
  getSuggestionMood,
  setSuggestionMood,
};
