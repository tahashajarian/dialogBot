const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getBlockedItems,
  normalizeScenario,
  parseArgs,
  runScenario,
  splitPipeList,
} = require("../scripts/qa-ai-suggestions");
const { getPreset, listPresets } = require("../scripts/qa-suggestion-presets");

test("QA presets are valid bilingual media scenarios", () => {
  const presets = listPresets();
  assert.ok(presets.length >= 6);
  assert.ok(presets.some((entry) => entry.lang === "fa"));
  assert.ok(presets.some((entry) => entry.lang === "en"));
  assert.ok(presets.some((entry) => entry.section === "books"));
  assert.ok(presets.some((entry) => entry.section === "movies"));
  assert.ok(presets.some((entry) => entry.section === "music"));
  for (const entry of presets) {
    const preset = getPreset(entry.id);
    const normalized = normalizeScenario({ ...preset, id: entry.id }, entry.id);
    assert.equal(normalized.id, entry.id);
    assert.ok(normalized.favorites.length >= 3);
  }
});

test("QA argument parser supports positional commands and named options", () => {
  assert.deepEqual(
    parseArgs(["run", "fa-iranian-music", "--count=7", "--verbose", "--mood=آرام"]),
    {
      positional: ["run", "fa-iranian-music"],
      options: { count: "7", verbose: true, mood: "آرام" },
    },
  );
});

test("QA blocked items combine favorites, watchlist, rejections, and current run history", () => {
  assert.deepEqual(
    getBlockedItems({
      favorites: ["Favorite"],
      watchlist: [{ title: "Saved" }],
      rejected: ["Rejected"],
      seen: ["Seen"],
    }),
    [
      { title: "Favorite" },
      { title: "Saved" },
      { title: "Rejected" },
      { title: "Seen" },
    ],
  );
});

test("QA pipe list parser accepts convenient rejected and liked lists", () => {
  assert.deepEqual(splitPipeList("one | two|| three "), ["one", "two", "three"]);
});

test("QA scenario validation rejects unsupported section and missing favorites", () => {
  assert.throws(
    () => normalizeScenario({ section: "games", lang: "fa", favorites: ["x"] }),
    /section must be books, movies, or music/,
  );
  assert.throws(
    () => normalizeScenario({ section: "books", lang: "fa", favorites: [] }),
    /favorites must contain at least one item/,
  );
});


test("QA runner reuses real flow inputs without persistence and blocks earlier run results", async () => {
  const calls = [];
  const runtime = {
    generateUsableSuggestion: async (input) => {
      calls.push(input);
      return {
        ok: true,
        title: calls.length === 1 ? "First result" : "Second result",
        metadata: "Author: Test Author",
        reason: "A concise reason; calm and precise.",
      };
    },
    extractSuggestionCreator: () => "Test Author",
    formatSuggestionResultMessage: () => "formatted",
  };

  const results = await runScenario({
    id: "unit",
    label: "Unit",
    section: "books",
    lang: "en",
    favorites: ["Favorite book"],
  }, { count: 2, silent: true }, runtime);

  assert.equal(results.length, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].recentSuggestionItems, []);
  assert.ok(calls[1].recentSuggestionItems.includes("First result"));
  assert.ok(calls[1].blockedSuggestionItems.some((entry) => entry.title === "First result"));
});
