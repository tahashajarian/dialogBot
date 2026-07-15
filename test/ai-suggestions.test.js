const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildInterestSuggestionFallback,
  extractAiResponseText,
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  getSuggestionRealityIssue,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
} = require("../src/services/ai");

test("extracts suggestion text from Responses and Chat Completions payloads", () => {
  assert.equal(extractAiResponseText({ output_text: "Lichess puzzles\nRelated to chess." }), "Lichess puzzles\nRelated to chess.");
  assert.equal(extractAiResponseText({ choices: [{ message: { content: "Photo walk\nRelated to photography." } }] }), "Photo walk\nRelated to photography.");
});

test("parses providers that compress suggestion and reason into one line", () => {
  const parsed = parseSingleSuggestionResponse("(tool) Coffee roasting starter kit. It builds directly on your coffee interest.", "en");
  assert.equal(parsed.title, "Coffee roasting starter kit.");
  assert.equal(parsed.reason, "It builds directly on your coffee interest.");
});

test("does not split movie metadata at director abbreviation", () => {
  assert.deepEqual(splitSuggestionSentence("Blade Runner 2049 (2017, Dir. Denis Villeneuve). A visual continuation of thoughtful sci-fi."), ["Blade Runner 2049 (2017, Dir. Denis Villeneuve).", "A visual continuation of thoughtful sci-fi."]);
});

test("suggestion reality gate rejects fabricated-looking outputs", () => {
  assert.equal(getSuggestionRealityIssue({ mode: "books", title: "The Silent Path (Unknown Author)", reason: "Matches your reflective mood." }), "placeholder_metadata");
  assert.equal(getSuggestionRealityIssue({ mode: "music", title: "Moon Dust Symphony", reason: "A fictional track for metal fans." }), "fabrication_marker");
  assert.equal(getSuggestionRealityIssue({ mode: "movies", title: "Blade Runner 2049 (2017, Dir. Denis Villeneuve)", reason: "Slow sci-fi with neon melancholy." }), "");
});

test("Interests fallback is concrete and derived from the user's interests", () => {
  const coding = buildInterestSuggestionFallback({ lang: "en", topTenItems: ["Coding", "Chess", "Coffee"] });
  const travel = buildInterestSuggestionFallback({ lang: "fa", topTenItems: ["سفر", "طبیعت", "عکاسی"] });
  assert.match(coding.title, /project/i);
  assert.match(coding.reason, /coding/i);
  assert.match(`${travel.title} ${travel.reason}`, /عکاسی|خلاق|سفر|طبیعت|پیاده‌روی/);
  assert.doesNotMatch(`${coding.title} ${travel.title}`, /book|کتاب/i);
});

test("Interests quality gate rejects generic repeated social suggestions", () => {
  assert.equal(getInterestSuggestionQualityIssue({ title: "(فعالیت) شرکت در کارگاه شطرنج.", reason: "تقویت مهارت‌های شطرنج و ملاقات با افراد جدید.", topTenItems: ["شطرنج"], recentSuggestionItems: [] }), "generic_container");
  assert.equal(getInterestSuggestionQualityIssue({ title: "چالش روزانه حل معماهای شطرنج در Lichess", reason: "برای تقویت استراتژی‌های شطرنج شما مناسب است.", topTenItems: ["شطرنج"], recentSuggestionItems: [] }), "generic_reason");
  assert.equal(getInterestSuggestionFamily("Join a local chess club"), "social_group");
  assert.equal(getInterestSuggestionFamily("پازل روزانه شطرنج"), "challenge");
});

test("Interests quality gate accepts a specific recommendation with a concrete reason", () => {
  assert.equal(getInterestSuggestionQualityIssue({ title: "پازل روزانه شطرنج در Lichess", reason: "شطرنج را با تمرین تاکتیکی پنج‌دقیقه‌ای جلو می‌برد.", topTenItems: ["شطرنج", "کدنویسی", "قهوه"], recentSuggestionItems: ["ساخت یک پروژه کوچک آخرهفته"] }), "");
});
