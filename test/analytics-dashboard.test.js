const test = require("node:test");
const assert = require("node:assert/strict");

const { buildUserListMetrics } = require("../src/services/analytics-dashboard");

function section(rows, name) {
  return rows.find((row) => row.section === name);
}

test("analytics list metrics count structured and legacy AI lists", () => {
  const rows = buildUserListMetrics([
    {
      aiLists: {
        movies: {
          topTen: Array.from({ length: 10 }, (_, index) => ({ title: `Movie ${index}` })),
          watchlist: [{ title: "Later" }],
        },
      },
      aiTaste: {
        movies: { labelKey: "cinephile", sampleCount: 10 },
      },
    },
    {
      aiTopTenMusic: ["Metallica", "Slayer", "Megadeth"],
      aiWatchlistMusic: ["Tool", "Pantera"],
      aiTaste: {
        music: { labelKey: "metalhead", sampleCount: 3 },
      },
    },
    {
      aiLists: {
        random: {
          topTen: [{ title: "Chess" }],
          watchlist: [],
        },
      },
      aiTaste: {
        random: { labelKey: "curious", sampleCount: 0 },
      },
    },
  ]);

  assert.deepEqual(section(rows, "movies"), {
    section: "movies",
    label: "Movies",
    topTenItems: 10,
    watchlistItems: 1,
    usersWithTopTenItem: 1,
    usersWithThreeTopTen: 1,
    usersWithFullTopTen: 1,
    usersWithTasteLabel: 1,
  });

  assert.deepEqual(section(rows, "music"), {
    section: "music",
    label: "Music",
    topTenItems: 3,
    watchlistItems: 2,
    usersWithTopTenItem: 1,
    usersWithThreeTopTen: 1,
    usersWithFullTopTen: 0,
    usersWithTasteLabel: 1,
  });

  assert.equal(section(rows, "random").usersWithTasteLabel, 0);
});
