const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyItemScript,
  countScriptLetters,
  getPreferredSuggestionDisplayLanguage,
} = require("../src/services/ai-suggestion-display-language");

test("display language follows the dominant script of section favorites", () => {
  assert.equal(getPreferredSuggestionDisplayLanguage([
    "Pulp Fiction",
    "Forrest Gump",
    "The Godfather",
    "Inception",
    "The Matrix",
    "Interstellar",
    "The Usual Suspects — Bryan Singer",
    "Se7en — David Fincher",
    "The Dark Knight — Christopher Nolan",
    "Memento — Christopher Nolan",
  ], "fa"), "en");

  assert.equal(getPreferredSuggestionDisplayLanguage([
    "سووشون — سیمین دانشور",
    "جای خالی سلوچ — محمود دولت‌آبادی",
    "چشم‌هایش — بزرگ علوی",
  ], "en"), "fa");
});

test("display language falls back to interface language for a tied or empty list", () => {
  assert.equal(getPreferredSuggestionDisplayLanguage([], "en"), "en");
  assert.equal(getPreferredSuggestionDisplayLanguage(["استاکر", "Stalker"], "fa"), "fa");
});

test("script classification ignores digits and punctuation", () => {
  assert.equal(classifyItemScript("Se۷en David Fincher — ۱۹۹۵"), "en");
  assert.equal(classifyItemScript("ماتریکس — ۱۹۹۹"), "fa");
  assert.equal(classifyItemScript("دشمن Denis Villeneuve"), "fa");
  assert.equal(classifyItemScript("Enemy دنی ویلنوو"), "en");
  assert.deepEqual(countScriptLetters("Godfather ۱"), { fa: 0, en: 9 });
});
