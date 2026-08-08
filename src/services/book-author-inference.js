const { normalizeCatalogueTitle } = require("./catalogue-normalization");

function clean(value, maxLength = 160) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function inferAuthorQueries(favorites, limit = 4) {
  const counts = new Map();
  const order = new Map();
  for (const [index, favorite] of (favorites || []).entries()) {
    const tokens = clean(favorite, 140)
      .replace(/[«»“”"'()[\]{}،,:؛;!?]+/gu, " ")
      .split(/\s+/u)
      .map((token) => clean(token, 40))
      .filter((token) => token.length >= 2 && !/^\d+$/u.test(token));
    if (tokens.length < 3) continue;
    const author = tokens.slice(-2).join(" ");
    const key = normalizeCatalogueTitle(author);
    if (!key) continue;
    counts.set(author, (counts.get(author) || 0) + 1);
    if (!order.has(author)) order.set(author, index);
  }
  return [...counts.keys()]
    .sort((left, right) => (counts.get(right) - counts.get(left)) || (order.get(left) - order.get(right)))
    .slice(0, limit);
}

module.exports = { inferAuthorQueries };
