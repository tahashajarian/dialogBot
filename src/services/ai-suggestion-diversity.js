const { normalizeCatalogueTitle } = require("./catalogue-normalization");

function normalizeCreator(value) {
  return normalizeCatalogueTitle(String(value || "")
    .replace(/^(?:artist|author|director|creator|band|singer|هنرمند|خواننده|نویسنده|کارگردان|سازنده)\s*:\s*/i, ""));
}

function creatorIsExplicitlyRequested(creator, requestText = "") {
  const normalizedCreator = normalizeCreator(creator);
  const normalizedRequest = normalizeCatalogueTitle(requestText);
  return Boolean(normalizedCreator && normalizedRequest.includes(normalizedCreator));
}

function countCreators(values = []) {
  const counts = new Map();
  for (const value of values) {
    const creator = normalizeCreator(value);
    if (creator) counts.set(creator, (counts.get(creator) || 0) + 1);
  }
  return counts;
}

function getCreatorDiversityIssue({
  creator,
  requestText = "",
  recentCreators = [],
  savedCreators = [],
  savedCreatorLimit = 2,
}) {
  const normalizedCreator = normalizeCreator(creator);
  if (!normalizedCreator || creatorIsExplicitlyRequested(creator, requestText)) return "";
  if (recentCreators.some((value) => normalizeCreator(value) === normalizedCreator)) {
    return "recent_creator";
  }
  if ((countCreators(savedCreators).get(normalizedCreator) || 0) >= savedCreatorLimit) {
    return "saved_creator_saturation";
  }
  return "";
}

module.exports = {
  countCreators,
  creatorIsExplicitlyRequested,
  getCreatorDiversityIssue,
  normalizeCreator,
};
