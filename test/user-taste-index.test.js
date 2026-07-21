const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildUserTasteIndexSections,
} = require("../src/services/user-taste-index");
const { buildTasteMatchKeys } = require("../src/services/taste-item-matching");

test("taste index combines TopTen and watchlist items by section", () => {
  const index = buildUserTasteIndexSections({
    aiLists: {
      music: {
        topTen: [{ title: "Metallica" }, { title: "Nirvana" }],
        watchlist: [{ title: "Queen" }, { title: "Metallica" }],
      },
    },
  });

  assert.deepEqual(index.music, ["metallica", "nirvana", "queen"]);
});

test("taste index preserves legacy list fallback when structured list is empty", () => {
  const index = buildUserTasteIndexSections({
    aiLists: {
      books: {
        topTen: [],
        watchlist: [],
      },
    },
    aiTopTenBooks: ["Dune", "Foundation"],
  });

  assert.deepEqual(index.books, ["dune", "foundation"]);
});

test("taste index canonicalizes built-in Interests chips", () => {
  const index = buildUserTasteIndexSections({
    aiLists: {
      random: {
        topTen: [{ title: "برنامه نویسی" }, { title: "کافه گردی" }],
        watchlist: [],
      },
    },
  });

  assert.deepEqual(index.random, ["برنامه نویسی", "کافه گردی"]);
});

test("taste match keys give nearby long-title typos a shared lookup key", () => {
  const expectedKeys = new Set(buildTasteMatchKeys("interstellar"));
  const typoKeys = buildTasteMatchKeys("intersteler");

  assert.ok(typoKeys.some((key) => expectedKeys.has(key)));
});

test("taste match keys ignore title spacing and support nearby English and Persian spellings", () => {
  const englishKeys = new Set(buildTasteMatchKeys("Enter Sandman"));
  const englishTypoKeys = buildTasteMatchKeys("Enter Sadman");
  const spacedKeys = buildTasteMatchKeys("Enter Sand Man");
  const persianKeys = new Set(buildTasteMatchKeys("شازده احتجاب"));
  const persianTypoKeys = buildTasteMatchKeys("شازده احتجلب");

  assert.ok(englishTypoKeys.some((key) => englishKeys.has(key)));
  assert.ok(spacedKeys.some((key) => englishKeys.has(key)));
  assert.ok(persianTypoKeys.some((key) => persianKeys.has(key)));
});
