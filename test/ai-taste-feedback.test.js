const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTasteFeedbackFallbackWithItem,
  buildInterestSuggestionFallback,
  extractAiResponseText,
  getAiTasteItemFeedback,
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  getSuggestionRealityIssue,
  isEncyclopedicTasteFeedback,
  isFeedbackRelevantToItem,
  isGenericTasteFeedback,
  sanitizeTasteFeedback,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
} = require("../src/services/ai");
const {
  isSavedOnlyTasteFeedback,
} = require("../src/services/ai-feedback-quality");

test("uses predefined feedback for known Interests chips", async () => {
  const faCoding = await getAiTasteItemFeedback({
    mode: "random",
    lang: "fa",
    item: "کدنویسی",
    labelKey: "tech_minded",
    labelTitle: "تکنولوژی‌ذهن",
  });
  const enGaming = await getAiTasteItemFeedback({
    mode: "random",
    lang: "en",
    item: "Gaming",
    labelKey: "gamer",
    labelTitle: "Gamer",
  });

  assert.equal(faCoding.ok, true);
  assert.equal(faCoding.matchType, "predefined");
  assert.equal(faCoding.text, "کدنویسی یعنی ذهنت اهل ساختنه.");
  assert.equal(enGaming.ok, true);
  assert.equal(enGaming.matchType, "predefined");
  assert.equal(enGaming.text, "Gaming says you enjoy challenge and flow.");
});

test("uses lively predefined feedback for The Office", async () => {
  const faResult = await getAiTasteItemFeedback({
    mode: "movies",
    lang: "fa",
    item: "آفیس",
    labelKey: "comedy_fan",
    labelTitle: "Comedy Fan",
  });
  const enResult = await getAiTasteItemFeedback({
    mode: "movies",
    lang: "en",
    item: "The Office",
    labelKey: "comedy_fan",
    labelTitle: "Comedy Fan",
  });

  assert.equal(faResult.matchType, "predefined");
  assert.match(faResult.text, /معذب|خنده/);
  assert.doesNotMatch(faResult.text, /یکی از کمدی‌های محبوب/);
  assert.equal(enResult.matchType, "predefined");
  assert.match(enResult.text, /funniest|awkward/i);
});

test("uses predefined feedback for every provided Interests chip", async () => {
  const chips = [
    ["fa", "شطرنج"],
    ["fa", "کدنویسی"],
    ["fa", "گیم"],
    ["fa", "فیلم"],
    ["fa", "موسیقی"],
    ["fa", "کتاب"],
    ["fa", "انیمه"],
    ["fa", "فوتبال"],
    ["fa", "باشگاه"],
    ["fa", "سفر"],
    ["fa", "طبیعت"],
    ["fa", "غذا"],
    ["fa", "آشپزی"],
    ["fa", "قهوه"],
    ["fa", "کافه‌گردی"],
    ["fa", "هنر"],
    ["fa", "عکاسی"],
    ["fa", "نوشتن"],
    ["fa", "مد و فشن"],
    ["fa", "روانشناسی"],
    ["fa", "علم"],
    ["fa", "تاریخ"],
    ["fa", "پادکست"],
    ["fa", "یوتیوب"],
    ["fa", "دورهمی"],
    ["fa", "آرامش"],
    ["fa", "پیاده‌روی"],
    ["fa", "سلامتی"],
    ["fa", "رشد فردی"],
    ["fa", "کسب‌وکار"],
    ["fa", "سرمایه‌گذاری"],
    ["fa", "بازی فکری"],
    ["fa", "منچ"],
    ["fa", "تئاتر"],
    ["en", "Chess"],
    ["en", "Coding"],
    ["en", "Gaming"],
    ["en", "Movies"],
    ["en", "Music"],
    ["en", "Books"],
    ["en", "Anime"],
    ["en", "Football"],
    ["en", "Gym"],
    ["en", "Travel"],
    ["en", "Nature"],
    ["en", "Food"],
    ["en", "Cooking"],
    ["en", "Coffee"],
    ["en", "Cafes"],
    ["en", "Art"],
    ["en", "Photography"],
    ["en", "Writing"],
    ["en", "Fashion"],
    ["en", "Psychology"],
    ["en", "Science"],
    ["en", "History"],
    ["en", "Podcast"],
    ["en", "YouTube"],
    ["en", "Social events"],
    ["en", "Calm"],
    ["en", "Walking"],
    ["en", "Wellness"],
    ["en", "Self growth"],
    ["en", "Business"],
    ["en", "Investing"],
    ["en", "Board games"],
    ["en", "Mensch"],
    ["en", "Theater"],
  ];

  for (const [lang, item] of chips) {
    const result = await getAiTasteItemFeedback({
      mode: "random",
      lang,
      item,
      labelKey: "multi_interest",
      labelTitle: "Multi-interest",
    });

    assert.equal(result.matchType, "predefined", item);
    assert.equal(result.ok, true, item);
    assert.ok(result.text.length > 0, item);
  }
});

test("uses neutral feedback for low-quality or placeholder inputs", async () => {
  const enResult = await getAiTasteItemFeedback({
    mode: "movies",
    lang: "en",
    item: "Test",
    labelKey: "arthouse_curious",
    labelTitle: "Arthouse Curious",
  });
  const faResult = await getAiTasteItemFeedback({
    mode: "random",
    lang: "fa",
    item: "نتاشایباشسمنیاب",
    labelKey: "multi_interest",
    labelTitle: "چندقسمتی",
  });

  assert.equal(enResult.ok, true);
  assert.equal(enResult.matchType, "unknown_input");
  assert.equal(enResult.text, 'Saved "Test".');
  assert.equal(faResult.ok, true);
  assert.equal(faResult.matchType, "unknown_input");
  assert.match(faResult.text, /ذخیره شد/);
});

test("rejects generic personality praise even when it repeats the item", () => {
  assert.equal(
    isFeedbackRelevantToItem("سفر به انتهای شب یعنی سلیقه‌ات خیلی خاصه.", "سفر به انتهای شب"),
    true,
  );
  assert.equal(
    isGenericTasteFeedback("سفر به انتهای شب یعنی سلیقه‌ات خیلی خاصه.", "fa"),
    true,
  );
  assert.equal(
    isGenericTasteFeedback("Journey to the End of the Night is a cool pick.", "en"),
    true,
  );
  assert.equal(
    isGenericTasteFeedback("وای! دزد دوچرخه، انتخاب فوق‌العاده‌ایه!", "fa"),
    true,
  );
  assert.equal(
    isGenericTasteFeedback("Bicycle Thieves is an amazing choice!", "en"),
    true,
  );
  assert.equal(
    isGenericTasteFeedback("متأسفانه، این مورد را نمی‌شناسم.", "fa"),
    true,
  );
  assert.equal(
    isGenericTasteFeedback("Sorry, I don't recognize this item.", "en"),
    true,
  );
});

test("rejects encyclopedia-style feedback summaries", () => {
  assert.equal(
    isEncyclopedicTasteFeedback(
      "سریال آفیس یکی از کمدی‌های محبوب است که به زندگی روزمره کارمندان یک دفتر می‌پردازد.",
      "fa",
    ),
    true,
  );
  assert.equal(
    isEncyclopedicTasteFeedback(
      "آفیس با سکوت‌های معذب‌کننده و موقعیت‌های خشک‌وخنده‌دارش هنوز خیلی می‌چسبه.",
      "fa",
    ),
    false,
  );
  assert.equal(
    isEncyclopedicTasteFeedback(
      "The Office is one of the most popular comedies about office workers.",
      "en",
    ),
    true,
  );
});

test("does not treat title stopwords as evidence of relevance", () => {
  assert.equal(
    isFeedbackRelevantToItem("این اثر به فضای آرامی نزدیک می‌شود.", "سفر به انتهای شب"),
    false,
  );
  assert.equal(
    isFeedbackRelevantToItem("The atmosphere is light and cheerful.", "Journey to the End of the Night"),
    false,
  );
});

test("accepts concrete work-focused feedback", () => {
  const feedback = "سفر به انتهای شب با تلخی و نثر تندش ماندگار می‌شود.";
  assert.equal(isFeedbackRelevantToItem(feedback, "سفر به انتهای شب"), true);
  assert.equal(isGenericTasteFeedback(feedback, "fa"), false);
});

test("fallback stays neutral instead of guessing or giving empty praise", () => {
  const fa = buildTasteFeedbackFallbackWithItem({
    lang: "fa",
    item: "سفر به انتهای شب",
  });
  const en = buildTasteFeedbackFallbackWithItem({
    lang: "en",
    item: "An Obscure Work",
  });

  assert.match(fa, /ذخیره شد/);
  assert.doesNotMatch(fa, /انتخاب (باحال|خوب|عالی)/);
  assert.match(en, /saved/i);
  assert.doesNotMatch(en, /solid pick|great choice/i);
});

test("saved-only cached feedback is detectable and can be hidden from add cards", () => {
  assert.equal(
    isSavedOnlyTasteFeedback("«کرم شب تاب دیده نیست» ذخیره شد.", "fa"),
    true,
  );
  assert.equal(
    isSavedOnlyTasteFeedback('Saved "Some made-up title".', "en"),
    true,
  );
  assert.equal(
    isSavedOnlyTasteFeedback("کرم شب تاب دیده نیست فضای شاعرانه و تاریکی دارد.", "fa"),
    false,
  );
});

test("feedback sanitizer allows a useful short sentence", () => {
  const feedback = sanitizeTasteFeedback(
    "سفر به انتهای شب با تلخی، طنز سیاه و نثر خشنش ضربه می‌زند.",
    "fa",
  );
  assert.equal(
    feedback,
    "سفر به انتهای شب با تلخی، طنز سیاه و نثر خشنش ضربه می‌زند.",
  );
});

test("extracts suggestion text from Responses and Chat Completions payloads", () => {
  assert.equal(
    extractAiResponseText({ output_text: "Lichess puzzles\nRelated to chess." }),
    "Lichess puzzles\nRelated to chess.",
  );
  assert.equal(
    extractAiResponseText({ choices: [{ message: { content: "Photo walk\nRelated to photography." } }] }),
    "Photo walk\nRelated to photography.",
  );
});

test("parses providers that compress suggestion and reason into one line", () => {
  const parsed = parseSingleSuggestionResponse(
    "(tool) Coffee roasting starter kit. It builds directly on your coffee interest.",
    "en",
  );

  assert.equal(parsed.title, "Coffee roasting starter kit.");
  assert.equal(parsed.reason, "It builds directly on your coffee interest.");
});

test("does not split movie metadata at director abbreviation", () => {
  assert.deepEqual(
    splitSuggestionSentence(
      "Blade Runner 2049 (2017, Dir. Denis Villeneuve). A visual continuation of thoughtful sci-fi.",
    ),
    [
      "Blade Runner 2049 (2017, Dir. Denis Villeneuve).",
      "A visual continuation of thoughtful sci-fi.",
    ],
  );
});

test("suggestion reality gate rejects fabricated-looking outputs", () => {
  assert.equal(
    getSuggestionRealityIssue({
      mode: "books",
      title: "The Silent Path (Unknown Author)",
      reason: "Matches your reflective mood.",
    }),
    "placeholder_metadata",
  );
  assert.equal(
    getSuggestionRealityIssue({
      mode: "music",
      title: "Moon Dust Symphony",
      reason: "A fictional track for metal fans.",
    }),
    "fabrication_marker",
  );
  assert.equal(
    getSuggestionRealityIssue({
      mode: "movies",
      title: "Blade Runner 2049 (2017, Dir. Denis Villeneuve)",
      reason: "Slow sci-fi with neon melancholy.",
    }),
    "",
  );
});

test("Interests fallback is concrete and derived from the user's interests", () => {
  const coding = buildInterestSuggestionFallback({
    lang: "en",
    topTenItems: ["Coding", "Chess", "Coffee"],
  });
  const travel = buildInterestSuggestionFallback({
    lang: "fa",
    topTenItems: ["سفر", "طبیعت", "عکاسی"],
  });

  assert.match(coding.title, /project/i);
  assert.match(coding.reason, /coding/i);
  assert.match(`${travel.title} ${travel.reason}`, /عکاسی|خلاق|سفر|طبیعت|پیاده‌روی/);
  assert.doesNotMatch(`${coding.title} ${travel.title}`, /book|کتاب/i);
  assert.doesNotMatch(`${coding.title} ${travel.title}`, /\((?:activity|فعالیت)\)/i);
});

test("Interests quality gate rejects generic repeated social suggestions", () => {
  assert.equal(
    getInterestSuggestionQualityIssue({
      title: "(فعالیت) شرکت در کارگاه شطرنج.",
      reason: "تقویت مهارت‌های شطرنج و ملاقات با افراد جدید.",
      topTenItems: ["شطرنج", "دورهمی", "پیاده‌روی"],
      recentSuggestionItems: [],
    }),
    "generic_container",
  );
  assert.equal(
    getInterestSuggestionQualityIssue({
      title: "چالش روزانه حل معماهای شطرنج در Lichess",
      reason: "برای تقویت استراتژی‌های شطرنج شما مناسب است.",
      topTenItems: ["شطرنج", "دورهمی"],
      recentSuggestionItems: [],
    }),
    "generic_reason",
  );
  assert.equal(
    getInterestSuggestionQualityIssue({
      title: "پیوستن به گروه‌های شطرنج محلی",
      reason: "برای یادگیری و رقابت با دیگران عالی است.",
      topTenItems: ["شطرنج", "دورهمی"],
      recentSuggestionItems: ["شرکت در کلاس فعالیت‌های گروهی"],
    }),
    "generic_container",
  );
  assert.equal(getInterestSuggestionFamily("Join a local chess club"), "social_group");
  assert.equal(getInterestSuggestionFamily("پازل روزانه شطرنج"), "challenge");
});

test("Interests quality gate accepts a specific recommendation with a concrete reason", () => {
  assert.equal(
    getInterestSuggestionQualityIssue({
      title: "پازل روزانه شطرنج در Lichess",
      reason: "شطرنج را با تمرین تاکتیکی پنج‌دقیقه‌ای جلو می‌برد.",
      topTenItems: ["شطرنج", "کدنویسی", "قهوه"],
      recentSuggestionItems: ["ساخت یک پروژه کوچک آخرهفته"],
    }),
    "",
  );
});
