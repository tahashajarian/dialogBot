const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTasteFeedbackFallbackWithItem,
  buildInterestSuggestionFallback,
  extractAiResponseText,
  getAiTasteItemFeedback,
  getInterestSuggestionFamily,
  getInterestSuggestionQualityIssue,
  isFeedbackRelevantToItem,
  isGenericTasteFeedback,
  sanitizeTasteFeedback,
  parseSingleSuggestionResponse,
  splitSuggestionSentence,
} = require("../src/services/ai");

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
  assert.match(enResult.text, /don't recognize/i);
  assert.equal(faResult.ok, true);
  assert.equal(faResult.matchType, "unknown_input");
  assert.match(faResult.text, /نمی‌شناسم/);
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

test("fallback admits uncertainty instead of giving empty praise", () => {
  const fa = buildTasteFeedbackFallbackWithItem({
    lang: "fa",
    item: "سفر به انتهای شب",
  });
  const en = buildTasteFeedbackFallbackWithItem({
    lang: "en",
    item: "An Obscure Work",
  });

  assert.match(fa, /حدس نزنم/);
  assert.doesNotMatch(fa, /انتخاب (باحال|خوب|عالی)/);
  assert.match(en, /don't know/i);
  assert.doesNotMatch(en, /solid pick|great choice/i);
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
