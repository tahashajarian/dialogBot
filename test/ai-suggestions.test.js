const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildInterestSuggestionFallback,
  extractAiResponseText,
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  getModeInstruction,
  getPersonalizedSuggestionInstruction,
  getSuggestionReasonInstruction,
  getSuggestionRealityIssue,
  isSuggestionUncertainResponse,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
} = require("../src/services/ai");
const { formatSuggestionResultMessage } = require("../src/services/ai-list-ui");
const { aiSuggestionCopyKeyboard } = require("../src/keyboards");
const {
  buildSuggestionAttemptText,
  buildSuggestionCopyText,
  extractSuggestionCreator,
  getMediaSuggestionQualityIssue,
  getSingleSuggestionDetailInstruction,
  getSuggestionCreatorIssue,
  isRetryableSuggestionFailure,
} = require("../src/services/ai-suggestion-quality");
const {
  AI_SUGGESTION_MAX_ATTEMPTS,
  AI_RECENT_SUGGESTION_CREATORS_LIMIT,
} = require("../src/constants/ai");
const {
  claimSuggestionAction,
  clearSuggestionMood,
  getSuggestionMood,
  setSuggestionMood,
} = require("../src/services/ai-suggestion-cache");

test("suggestion save actions allow only one in-flight action per user and section", () => {
  const release = claimSuggestionAction(41, "books");
  assert.equal(typeof release, "function");
  assert.equal(claimSuggestionAction(41, "books"), null);
  const releaseMovies = claimSuggestionAction(41, "movies");
  assert.equal(typeof releaseMovies, "function");
  release();
  const releaseBooksAgain = claimSuggestionAction(41, "books");
  assert.equal(typeof releaseBooksAgain, "function");
  releaseMovies();
  releaseBooksAgain();
});

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
  assert.match(buildSuggestionAttemptText("فقط سریال", "Suggest one movies item", 1), /different real item/);
});

test("suggestion retries stay bounded and explain the rejected quality issue", () => {
  assert.equal(AI_SUGGESTION_MAX_ATTEMPTS, 3);
  assert.equal(AI_RECENT_SUGGESTION_CREATORS_LIMIT, 5);
  assert.match(
    buildSuggestionAttemptText("", "Suggest one books item", 1, "generic_reason"),
    /two concrete connections/,
  );
  assert.match(
    buildSuggestionAttemptText("", "Suggest one books item", 2, "repeated_creator"),
    /different creator/,
  );
  assert.equal(isRetryableSuggestionFailure({ ok: false, reason: "low_quality_media" }), true);
  assert.equal(isRetryableSuggestionFailure({ ok: false, reason: "capacity_busy" }), false);
});

test("media suggestion quality rejects canned reasons but keeps concrete reasons", () => {
  assert.equal(
    getMediaSuggestionQualityIssue({ reason: "برای سلیقه‌ات گزینه خوبیه." }),
    "generic_reason",
  );
  assert.equal(
    getMediaSuggestionQualityIssue({ reason: "خیلی به سلیقه‌ات می‌خوره." }),
    "generic_reason",
  );
  assert.equal(
    getMediaSuggestionQualityIssue({ reason: "ریتم آرام و تنش اخلاقی‌اش به Stalker نزدیکه." }),
    "",
  );
});

test("creator safeguards reject favorite and recently suggested creators", () => {
  assert.equal(
    extractSuggestionCreator("۱۹۸۳ · کارگردان: Andrei Tarkovsky"),
    "Andrei Tarkovsky",
  );
  assert.equal(
    getSuggestionCreatorIssue({
      metadata: "۱۹۸۳ · کارگردان: Andrei Tarkovsky",
      topTenItems: ["Andrei Tarkovsky", "Persona"],
      recentSuggestionCreators: [],
    }),
    "favorite_creator_work",
  );
  assert.equal(
    getSuggestionCreatorIssue({
      metadata: "Author: Kazuo Ishiguro · 1989",
      topTenItems: ["The Trial"],
      recentSuggestionCreators: ["Kazuo Ishiguro"],
    }),
    "repeated_creator",
  );
  assert.equal(
    getSuggestionCreatorIssue({
      metadata: "1957 · Director: Sidney Lumet",
      topTenItems: ["Persona"],
      recentSuggestionCreators: ["Ingmar Bergman"],
    }),
    "",
  );
  assert.equal(
    getSuggestionCreatorIssue({
      metadata: "۱۹۸۳ · کارگردان: Andrei Tarkovsky",
      topTenItems: ["Andrei Tarkovsky"],
      recentSuggestionCreators: ["Andrei Tarkovsky"],
      requestText: "Suggest something by Andrei Tarkovsky",
    }),
    "",
  );
});

test("creator Favorites expand discovery instead of returning only obvious creator works", () => {
  const instruction = getPersonalizedSuggestionInstruction();
  assert.match(instruction, /directors, authors, artists, or bands/);
  assert.match(instruction, /recommend an established adjacent work by a different creator/);
  assert.match(instruction, /Do not recommend a work by a favorite creator unless the user's current request explicitly asks/);
  assert.match(instruction, /also applies when that creator's works appear in liked-and-already-consumed items/);
  assert.match(instruction, /Never describe a work as similar or close to a person/);
  assert.match(instruction, /never use a creator's name as the target of a comparison/);
  assert.match(instruction, /Saved-for-later items are neutral/);
});

test("suggestion reasons compare works to works and describe creator influence as qualities", () => {
  const instruction = getSuggestionReasonInstruction("fa");
  assert.match(instruction, /When the evidence is a creator, describe the shared qualities/);
  assert.match(instruction, /allowed only when X and Y are works, never people/);
  assert.doesNotMatch(instruction, /Refer directly to the relevant favorites or creators/);
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

test("media suggestions keep clean titles and separate searchable metadata", () => {
  const parsed = parseSingleSuggestionResponse(
    "Perfect Days\n2023 · Director: Wim Wenders\nIts quiet character study fits your reflective favorites.",
    "en",
  );
  assert.deepEqual(parsed, {
    title: "Perfect Days",
    metadata: "2023 · Director: Wim Wenders",
    reason: "Its quiet character study fits your reflective favorites.",
  });

  const message = formatSuggestionResultMessage(
    "en",
    parsed.title,
    parsed.reason,
    "",
    parsed.metadata,
  );
  assert.match(message, /Perfect Days"\n\n2023 · Director: Wim Wenders/);

  const copyButton = aiSuggestionCopyKeyboard("en", `${parsed.title} ${parsed.metadata}`)
    .reply_markup.inline_keyboard[0][0];
  assert.equal(copyButton.copy_text.text, "Perfect Days 2023 · Director: Wim Wenders");
});

test("numeric media titles keep their leading numbers", () => {
  assert.equal(
    parseSingleSuggestionResponse(
      "12 Angry Men\n1957 · Director: Sidney Lumet\nA tense moral chamber drama.",
      "en",
    ).title,
    "12 Angry Men",
  );
  assert.equal(
    parseSingleSuggestionResponse(
      "2001: A Space Odyssey\n1968 · Director: Stanley Kubrick\nVisionary philosophical science fiction.",
      "en",
    ).title,
    "2001: A Space Odyssey",
  );
  assert.equal(
    parseSingleSuggestionResponse(
      "1. Dune\n1965 · Author: Frank Herbert\nFoundational epic science fiction.",
      "en",
    ).title,
    "Dune",
  );
});

test("suggestion Copy text contains names without labels, years, or scores", () => {
  assert.equal(
    buildSuggestionCopyText("movies", "Perfect Days", "2023 · Director: Wim Wenders"),
    "Perfect Days Wim Wenders",
  );
  assert.equal(
    buildSuggestionCopyText("movies", "Perfect Days", "۲۰۲۳ · کارگردان: ویم وندرس"),
    "Perfect Days ویم وندرس",
  );
  assert.equal(
    buildSuggestionCopyText("music", "Weird Fishes/Arpeggi", "Artist: Radiohead · Album: In Rainbows · 2007"),
    "Weird Fishes/Arpeggi Radiohead",
  );
  assert.equal(
    buildSuggestionCopyText("books", "The Remains of the Day", "Author: Kazuo Ishiguro · 1989"),
    "The Remains of the Day Kazuo Ishiguro",
  );
});

test("Persian suggestions keep searchable names but localize metadata and explanation", () => {
  const parsed = parseSingleSuggestionResponse(
    "Perfect Days\n2023 · Director: Wim Wenders\nA quiet character study.",
    "fa",
  );
  assert.equal(parsed.title, "Perfect Days");
  assert.equal(parsed.metadata, "2023 · Director: Wim Wenders");
  assert.equal(parsed.reason, "برای سلیقه‌ات گزینه خوبیه.");
  assert.match(
    formatSuggestionResultMessage("fa", parsed.title, parsed.reason, "", parsed.metadata),
    /2023 · کارگردان: Wim Wenders[\s\S]*برای سلیقه‌ات گزینه خوبیه/,
  );
});

test("Persian suggestion reasons read naturally as standalone saved comments", () => {
  const parsed = parseSingleSuggestionResponse(
    "Ask the Dust\n1939 · Author: John Fante\nتلخیِ صمیمی و صدای بی‌پرده‌اش به سلیقه‌ات در فانته و پالپ می‌خورد.",
    "fa",
  );
  assert.equal(
    parsed.reason,
    "تلخیِ صمیمی و صدای بی‌پرده‌اش به فانته و پالپ می‌خورد.",
  );
});

test("awkward Persian comparisons are normalized into subject-first comments", () => {
  const parsed = parseSingleSuggestionResponse(
    "Example Film\n2001 · Director: Example Director\nبرای رستگاری در شاوشانگ و پالپ فیکشن، تلخ و ماندگار درمی‌آید.",
    "fa",
  );
  assert.equal(
    parsed.reason,
    "فضای تلخ و ماندگارش به رستگاری در شاوشانگ و پالپ فیکشن نزدیکه.",
  );
  assert.equal(
    parseSingleSuggestionResponse(
      "Example Film\n2001 · Director: Example Director\nبرای Fight Club و Pulp Fiction، همین تنهایی و زخم شهری می‌گیردت.",
      "fa",
    ).reason,
    "تنهایی و زخم شهری‌اش به Fight Club و Pulp Fiction نزدیکه.",
  );
});

test("legacy parenthesized suggestion metadata is separated from the saved title", () => {
  assert.deepEqual(
    parseSingleSuggestionResponse(
      "Blade Runner 2049 (2017, Dir. Denis Villeneuve)\nSlow sci-fi with neon melancholy.",
      "en",
    ),
    {
      title: "Blade Runner 2049",
      metadata: "2017, Dir. Denis Villeneuve",
      reason: "Slow sci-fi with neon melancholy.",
    },
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
  assert.match(instruction, /IMDb/);
  assert.match(getSingleSuggestionDetailInstruction("books"), /Goodreads/);
  assert.match(getSingleSuggestionDetailInstruction("music"), /Metacritic/);
  assert.match(instruction, /Creator/);
  assert.match(modeInstruction, /movies and TV\/streaming series/);
  assert.match(modeInstruction, /explicitly asks for a movie or series, honor it/);
});

test("suggestion reality gate rejects fabricated-looking outputs", () => {
  assert.equal(getSuggestionRealityIssue({ mode: "books", title: "The Silent Path (Unknown Author)", reason: "Matches your reflective mood." }), "placeholder_metadata");
  assert.equal(getSuggestionRealityIssue({ mode: "music", title: "Moon Dust Symphony", reason: "A fictional track for metal fans." }), "fabrication_marker");
  assert.equal(getSuggestionRealityIssue({ mode: "movies", title: "Blade Runner 2049 (2017, Dir. Denis Villeneuve)", reason: "Slow sci-fi with neon melancholy." }), "");
  assert.equal(getSuggestionRealityIssue({ mode: "movies", title: "Dark (2017, Creator: Baran bo Odar)", reason: "A layered science-fiction mystery." }), "");
  assert.equal(getSuggestionRealityIssue({ mode: "movies", title: "Perfect Days", metadata: "2023 · Director: Wim Wenders", reason: "A quiet character study." }), "");
  assert.equal(getSuggestionRealityIssue({ mode: "movies", title: "Perfect Days", metadata: "۲۰۲۳ · ویم وندرس", reason: "با سلیقه‌ات هماهنگه." }), "");
  assert.equal(getSuggestionRealityIssue({ mode: "movies", title: "Perfect Days", metadata: "2023", reason: "A quiet character study." }), "missing_movie_metadata");
  assert.equal(getSuggestionRealityIssue({ mode: "movies", title: "Perfect Days", metadata: "2023 · Director: Unknown", reason: "A quiet character study." }), "placeholder_metadata");
  assert.equal(getSuggestionRealityIssue({ mode: "books", title: "The Remains of the Day", metadata: "Author: Kazuo Ishiguro · 1989", reason: "Restrained and reflective." }), "");
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
