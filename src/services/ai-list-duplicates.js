const { normalizeAiInput, tokenizeNormalizedInput } = require("./input-normalization");

function damerauLevenshteinDistance(a, b) {
  const left = Array.from(String(a || ""));
  const right = Array.from(String(b || ""));
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix = Array.from(
    { length: left.length + 1 },
    () => Array(right.length + 1).fill(0),
  );

  for (let i = 0; i <= left.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i][j - 1] + 1,
        matrix[i - 1][j] + 1,
        matrix[i - 1][j - 1] + cost,
      );

      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }

  return matrix[left.length][right.length];
}

function similarityScore(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  const maxLength = Math.max(Array.from(left).length, Array.from(right).length);
  if (!maxLength) return 100;
  return Math.round((1 - (damerauLevenshteinDistance(left, right) / maxLength)) * 100);
}

function compactText(value) {
  return tokenizeNormalizedInput(value).join("");
}

function sortedTokenText(tokens) {
  return [...tokens].sort().join(" ");
}

function bestSubstringSimilarity(shorter, longer) {
  if (!shorter || !longer || shorter.length > longer.length) return 0;
  let best = similarityScore(shorter, longer.slice(0, shorter.length));
  const minLength = Math.max(3, shorter.length - 2);
  const maxLength = Math.min(longer.length, shorter.length + 2);

  for (let size = minLength; size <= maxLength; size += 1) {
    for (let index = 0; index <= longer.length - size; index += 1) {
      best = Math.max(best, similarityScore(shorter, longer.slice(index, index + size)));
      if (best >= 100) return best;
    }
  }

  return best;
}

function isSingleTokenSubset(leftTokens, rightTokens) {
  if (leftTokens.length === rightTokens.length) return false;
  const smaller = leftTokens.length < rightTokens.length ? leftTokens : rightTokens;
  const larger = leftTokens.length < rightTokens.length ? rightTokens : leftTokens;
  return smaller.length === 1 && larger.includes(smaller[0]);
}

function getAiListDuplicateMatch(title, items = []) {
  const normalizedTitle = normalizeAiInput(title);
  const titleTokens = tokenizeNormalizedInput(normalizedTitle);
  const titleCompact = compactText(normalizedTitle);
  if (!normalizedTitle || !titleCompact) return null;

  for (const entry of items) {
    const existingTitle = entry?.title || entry;
    const normalizedExisting = normalizeAiInput(existingTitle);
    const existingTokens = tokenizeNormalizedInput(normalizedExisting);
    const existingCompact = compactText(normalizedExisting);
    if (!normalizedExisting || !existingCompact) continue;

    if (normalizedTitle === normalizedExisting || titleCompact === existingCompact) {
      return { item: entry, score: 100, type: "exact" };
    }

    if (isSingleTokenSubset(titleTokens, existingTokens)) {
      continue;
    }

    const directScore = similarityScore(normalizedTitle, normalizedExisting);
    const tokenSortScore = similarityScore(sortedTokenText(titleTokens), sortedTokenText(existingTokens));
    const compactScore = similarityScore(titleCompact, existingCompact);
    const singleToken = titleTokens.length === 1 && existingTokens.length === 1;
    const threshold = singleToken && Math.max(titleCompact.length, existingCompact.length) <= 8
      ? 94
      : 88;

    if (Math.max(directScore, tokenSortScore, compactScore) >= threshold) {
      return {
        item: entry,
        score: Math.max(directScore, tokenSortScore, compactScore),
        type: "fuzzy",
      };
    }

    const shorterCompact = titleCompact.length <= existingCompact.length ? titleCompact : existingCompact;
    const longerCompact = titleCompact.length <= existingCompact.length ? existingCompact : titleCompact;
    const shorterTokens = titleCompact.length <= existingCompact.length ? titleTokens : existingTokens;
    if (shorterTokens.length >= 2 && shorterCompact.length >= 6) {
      const substringScore = bestSubstringSimilarity(shorterCompact, longerCompact);
      if (substringScore >= 90) {
        return { item: entry, score: substringScore, type: "fuzzy_substring" };
      }
    }
  }

  return null;
}

module.exports = {
  getAiListDuplicateMatch,
  similarityScore,
};
