const { getAiListDuplicateMatch, similarityScore } = require("./ai-list-duplicates");
const { tokenizeNormalizedInput } = require("./input-normalization");

function compactTasteItem(value) {
  return tokenizeNormalizedInput(value).join("");
}

function buildTasteMatchKeys(value) {
  const compact = compactTasteItem(value);
  if (!compact) return [];

  const keys = new Set([compact]);
  if (compact.length >= 5) {
    for (let index = 0; index < compact.length; index += 1) {
      keys.add(`${compact.slice(0, index)}${compact.slice(index + 1)}`);
    }
  }
  if (compact.length >= 9) {
    for (let index = 0; index <= compact.length - 4; index += 1) {
      keys.add(`4:${compact.slice(index, index + 4)}`);
    }
  }
  return [...keys];
}

function areTasteItemsEquivalent(left, right) {
  if (String(left || "") === String(right || "")) return true;
  const leftCompact = compactTasteItem(left);
  const rightCompact = compactTasteItem(right);
  if (!leftCompact || !rightCompact) return false;
  if (leftCompact === rightCompact) return true;
  if (getAiListDuplicateMatch(left, [right])) return true;

  const longerLength = Math.max(leftCompact.length, rightCompact.length);
  return longerLength >= 9 &&
    Math.abs(leftCompact.length - rightCompact.length) <= 2 &&
    leftCompact[0] === rightCompact[0] &&
    similarityScore(leftCompact, rightCompact) >= 82;
}

function countSharedTasteItems(viewerItems = [], candidateItems = []) {
  const matchedCandidateIndexes = new Set();
  let count = 0;

  for (const viewerItem of viewerItems) {
    const matchIndex = candidateItems.findIndex((candidateItem, index) => (
      !matchedCandidateIndexes.has(index) && areTasteItemsEquivalent(viewerItem, candidateItem)
    ));
    if (matchIndex < 0) continue;
    matchedCandidateIndexes.add(matchIndex);
    count += 1;
  }

  return count;
}

module.exports = {
  areTasteItemsEquivalent,
  buildTasteMatchKeys,
  countSharedTasteItems,
};
