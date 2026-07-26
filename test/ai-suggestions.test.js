const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildInterestSuggestionFallback,
  extractAiResponseText,
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  getModeInstruction,
  getSuggestionRealityIssue,
  isSuggestionUncertainResponse,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
} = require("../src/services/ai");
const { formatSuggestionResultMessage } = require("../src/services/ai-list-ui");
const {
  buildSuggestionAttemptText,
  getSingleSuggestionDetailInstruction,
} = require("../src/services/ai-suggestion-quality");
const {
  clearSuggestionMood,
  getSuggestionMood,
  setSuggestionMood,
} = require("../src/services/ai-suggestion-cache");

test("suggestion mood persists for a session and can be reset", () => {
  clearSuggestionMood(42, "movies");
  assert.equal(setSuggestionMood(42, "movies", "  dark comedy  "), "dark comedy");
  assert.equal(getSuggestionMood(42, "movies"), "dark comedy");
  assert.equal(getSuggestionMood(42, "books"), "");
  clearSuggestionMood(42, "movies");
  assert.equal(getSuggestionMood(42, "movies"), "");
});

test("duplicate retries preserve an explicit series-only request", () => {
  assert.equal(buildSuggestionAttemptText("فقط سریال", "Suggest one movies item", 0), "فقط سریال");
  assert.match(buildSuggestionAttemptText("فقط سریال", "Suggest one movies item", 1), /^فقط سریال/);
  assert.match(buildSuggestionAttemptText("فقط سریال", "Suggest one movies item", 1), /different item/);
});

test("uncertain suggestion sentinel accepts only the standalone fallback", () => {
  assert.equal(isSuggestionUncertainResponse("UNSURE"), true);
  assert.equal(isSuggestionUncertainResponse(" unsure. "), true);
  assert.equal(isSuggestionUncertainResponse("UNSURE\nPossible title"), false);
  assert.equal(isSuggestionUncertainResponse("The Unsure Album (Artist)"), false);
});

test("suggestion results show active mood only when provided", () => {
  const withMood = formatSuggestionResultMessage("en", "In Bruges", "Dark and dry humor.", "dark comedy");
  const withoutMood = formatSuggestionResultMessage("en", "Arrival", "Thoughtful science fiction.");
  assert.match(withMood, /Mood\/genre: dark comedy/);
  assert.doesNotMatch(withoutMood, /Mood\/genre/);
  assert.match(withMood, /✨ Dark and dry humor\./);
  assert.doesNotMatch(withMood, /Why\?/);
  assert.doesNotMatch(
    formatSuggestionResultMessage("fa", "زیر آتشفشان", "روایتی تلخ و تب‌آلود."),
    /چرا؟/,
  );
});

test("extracts suggestion text from Responses and Chat Completions payloads", () => {
  assert.equal(extractAiResponseText({ output_text: "Lichess puzzles\nRelated to chess." }), "Lichess puzzles\nRelated to chess.");
  assert.equal(extractAiResponseText({ choices: [{ message: { content: "Photo walk\nRelated to photography." } }] }), "Photo walk\nRelated to photography.");
});

test("parses providers that compress suggestion and reason into one line", () => {
  const parsed = parseSingleSuggestionResponse("(tool) Coffee roasting starter kit. It builds directly on your coffee interest.", "en");
  assert.equal(parsed.title, "Coffee roasting starter kit.");
  assert.equal(parsed.reason, "It builds directly on your coffee interest.");
});

test("removes Why labels supplied by the model from suggestion reasons", () => {
  assert.equal(
    parseSingleSuggestionResponse("Under the Volcano (Malcolm Lowry, 1947)\nچرا؟ روایتی تلخ و تب‌آلود.", "fa").reason,
    "روایتی تلخ و تب‌آلود.",
  );
  assert.equal(
    parseSingleSuggestionResponse("Under the Volcano (Malcolm Lowry, 1947)\nWhy? Feverish and tragic.", "en").reason,
    "Feverish and tragic.",
  );
});

test("does not split movie metadata at director abbreviation", () => {
  assert.deepEqual(splitSuggestionSentence("Blade Runner 2049 (2017, Dir. Denis Villeneuve). A visual continuation of thoughtful sci-fi."), ["Blade Runner 2049 (2017, Dir. Denis Villeneuve).", "A visual continuation of thoughtful sci-fi."]);
});

test("Movies & Series suggestions define metadata for both formats", () => {
  const instruction = getSingleSuggestionDetailInstruction("movies");
  const modeInstruction = getModeInstruction("movies", "en");
  assert.match(instruction, /For a movie/);
  assert.match(instruction, /For a series/);
  assert.match(instruction, /Creator/);
  assert.match(modeInstruction, /movies and TV\/streaming series/);
  assert.match(modeInstruction, /explicitly asks for a movie or series, honor it/);
});

test("suggestion reality gate rejects fabricated-looking outputs", () => {
  assert.equal(getSuggestionRealityIssue({ mode: "books", title: "The Silent Path (Unknown Author)", reason: "Matches your reflective mood." }), "placeholder_metadata");
  assert.equal(getSuggestionRealityIssue({ mode: "music", title: "Moon Dust Symphony", reason: "A fictional track for metal fans." }), "fabrication_marker");
  assert.equal(getSuggestionRealityIssue({ mode: "movies", title: "Blade Runner 2049 (2017, Dir. Denis Villeneuve)", reason: "Slow sci-fi with neon melancholy." }), "");
  assert.equal(getSuggestionRealityIssue({ mode: "movies", title: "Dark (2017, Creator: Baran bo Odar)", reason: "A layered science-fiction mystery." }), "");
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
