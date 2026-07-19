const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { getTasteLabelTitle } = require("../src/services/ai-section");
const {
  TASTE_LABEL_CATALOG,
  TASTE_CLASSIFIER_VERSION,
  buildRankedTasteShortlist,
  buildTasteInputFingerprint,
  classifyMediaTaste,
  parseTasteClassification,
} = require("../src/services/taste-label-classifier");
const User = require("../src/models/user");
const { confirmAiTasteLabel, skipAiTasteLabel, syncAiTasteForSection } = require("../src/services/users");
const { buildTasteReviewPresentation } = require("../src/flows/ai-taste-labels");
const { callBacks } = require("../src/constants");
const { aiTasteSuggestionKeyboard } = require("../src/keyboards");
const { getTopTenManageEntryMessage } = require("../src/services/ai-list-ui");

test("media taste labels use broad Persian and English category names", () => {
  const expected = {
    music: {
      metalhead: ["متال‌هد", "Metalhead"], rocker: ["راکر", "Rocker"], post_rocker: ["پست‌راکر", "Post-Rocker"],
      punk: ["پانک", "Punk"],
      pop_lover: ["پاپ‌باز", "Pop Lover"], hiphop_head: ["هیپ‌هاپ‌هد", "Hip-Hop Head"],
      electronic_fan: ["الکترونیک‌باز", "Electronic Fan"], classical_listener: ["کلاسیک‌باز", "Classical Listener"],
      jazz_head: ["جزباز", "Jazz Head"], indie_spirit: ["روح‌ایندی", "Indie Spirit"],
      traditional_fan: ["سنتی‌باز", "Traditional Music Fan"],
      music_buff: ["موزیک‌باز", "Music Buff"],
    },
    movies: {
      sci_fi_fan: ["علمی‌تخیلی‌باز", "Sci-Fi Fan"], action_junkie: ["اکشن‌باز", "Action Junkie"],
      drama_lover: ["درام‌باز", "Drama Lover"], mystery_fan: ["معما و تریلر", "Mystery & Thriller Fan"],
      comedy_fan: ["کمدی‌باز", "Comedy Fan"], horror_fan: ["ترسناک‌باز", "Horror Fan"],
      romance_fan: ["عاشقانه‌باز", "Romance Fan"], fantasy_fan: ["فانتزی‌باز", "Fantasy Fan"],
      animation_lover: ["انیمیشن‌باز", "Animation Lover"], documentary_viewer: ["مستندبین", "Documentary Viewer"],
      cinephile: ["سینه‌فیل", "Cinephile"], movie_buff: ["فیلم‌باز", "Movie Buff"],
    },
    books: {
      novel_reader: ["رمان‌خوان", "Novel Reader"], old_soul: ["روح قدیمی", "Old Soul"],
      fantasy_dreamer: ["خیال‌پرداز", "Fantasy Dreamer"], sci_fi_explorer: ["کاوشگر علمی‌تخیلی", "Sci-Fi Explorer"],
      born_detective: ["کارآگاه بالفطره", "Natural Detective"], hopeless_romantic: ["رمانتیک درمان‌ناپذیر", "Hopeless Romantic"],
      midnight_philosopher: ["فیلسوف نیمه‌شب", "Midnight Philosopher"],
      amateur_psychoanalyst: ["روان‌کاو آماتور", "Amateur Psychoanalyst"], truth_seeker: ["حقیقت‌یاب", "Truth Seeker"],
      poetic_soul: ["شاعرانه", "Poetic Soul"],
      book_buff: ["کتاب‌باز", "Book Buff"],
    },
  };

  for (const [section, labels] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(TASTE_LABEL_CATALOG[section]).sort(), Object.keys(labels).sort());
    for (const [labelKey, [fa, en]] of Object.entries(labels)) {
      assert.equal(getTasteLabelTitle(messages, "fa", section, labelKey), fa);
      assert.equal(getTasteLabelTitle(messages, "en", section, labelKey), en);
    }
  }
});

test("taste classifier accepts only structured allowed label keys", () => {
  assert.deepEqual(
    parseTasteClassification('{"labelKeys":["novel_reader","midnight_philosopher"]}', "books"),
    { labelKeys: ["novel_reader", "midnight_philosopher"] },
  );
  assert.deepEqual(parseTasteClassification('{"labelKeys":["book_buff"]}', "books"), { labelKeys: [] });
  assert.equal(parseTasteClassification('{"labelKeys":["invented_label"]}', "books"), null);
  assert.equal(parseTasteClassification("novel_reader", "books"), null);
});

test("taste insight requires a short evidence-backed sentence in the requested language", () => {
  const titles = ["کتاب یک", "کتاب دو", "کتاب سه", "کتاب چهار", "کتاب پنج"];
  const valid = parseTasteClassification(JSON.stringify({
    labelKeys: ["novel_reader", "old_soul"],
    insight: "انتخاب‌هات بیشتر به سمت رمان‌های ادبی، کلاسیک و درون‌نگر می‌رن.",
    evidenceTitles: titles.slice(0, 4),
  }), "books", { itemTitles: titles, language: "fa" });
  assert.equal(valid.insight, "انتخاب‌هات بیشتر به سمت رمان‌های ادبی، کلاسیک و درون‌نگر می‌رن.");

  const weakEvidence = parseTasteClassification(JSON.stringify({
    labelKeys: ["novel_reader"],
    insight: "انتخاب‌هات بیشتر به سمت رمان‌های ادبی و درون‌نگر می‌رن.",
    evidenceTitles: titles.slice(0, 3),
  }), "books", { itemTitles: titles, language: "fa" });
  assert.equal(weakEvidence.insight, undefined);

  const fallbackOnly = parseTasteClassification(JSON.stringify({
    labelKeys: [],
    insight: "انتخاب‌هات بیشتر به سمت رمان‌های ادبی و درون‌نگر می‌رن.",
    evidenceTitles: titles.slice(0, 4),
  }), "books", { itemTitles: titles, language: "fa" });
  assert.equal(fallbackOnly.insight, undefined);

  const wrongLanguage = parseTasteClassification(JSON.stringify({
    labelKeys: ["novel_reader"],
    insight: "Your choices lean toward literary and introspective novels.",
    evidenceTitles: titles.slice(0, 4),
  }), "books", { itemTitles: titles, language: "fa" });
  assert.equal(wrongLanguage.insight, undefined);
});

test("taste shortlist keeps three meaningful matches and always appends the broad fallback", () => {
  assert.deepEqual(buildRankedTasteShortlist("books", [
    "novel_reader", "midnight_philosopher", "poetic_soul", "truth_seeker", "book_buff",
  ]), ["novel_reader", "midnight_philosopher", "poetic_soul", "book_buff"]);
  assert.deepEqual(buildRankedTasteShortlist("music", []), ["music_buff"]);
});

test("taste classifier sends the complete list and semantic catalog without title dictionaries", async () => {
  const items = [
    "سمفونی مردگان", "سال بلوا", "بوف کور", "فریدون سه پسر داشت", "پیکر فرهاد",
    "سفر به انتهای شب", "مرگ قسطی", "از غبار بپرس", "جاده منتهی به لس آنجلس", "سرشار از زندگی",
  ].map((title) => ({ title }));
  let captured;
  const result = await classifyMediaTaste("books", items, {
    openai: {},
    requestText: async (_client, request) => {
      captured = request;
      return { text: '{"labelKeys":["novel_reader","old_soul"]}' };
    },
  });

  assert.deepEqual(result, { ok: true, labelKeys: ["novel_reader", "old_soul"] });
  assert.equal(captured.operation, "taste_classification");
  for (const item of items) assert.match(captured.input, new RegExp(item.title));
  assert.match(captured.instructions, /novel_reader: novels and literary fiction/);
  assert.match(captured.instructions, /most titles cannot be confidently recognized/i);
  assert.match(captured.instructions, /Never infer a genre or taste from how an unknown title sounds/i);
  assert.match(captured.instructions, /at least four confidently recognized items/i);
  assert.match(captured.instructions, /at most 18 words/i);
  assert.doesNotMatch(captured.instructions, /سمفونی مردگان|هری پاتر|Harry Potter|Metallica|Interstellar/);
});

test("taste classifier falls back to user choice when the provider output is unavailable or invalid", async () => {
  const unavailable = await classifyMediaTaste("movies", [{ title: "A" }], {
    openai: {}, requestText: async () => ({ text: "" }),
  });
  const invalid = await classifyMediaTaste("music", [{ title: "A" }], {
    openai: {}, requestText: async () => ({ text: '{"labelKeys":["anything"]}' }),
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.reason, "provider_unavailable");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "invalid_output");
});

test("taste fingerprints change with list order, titles, or comments", () => {
  const base = buildTasteInputFingerprint("books", [{ title: "Book A", comment: "Author A" }, { title: "Book B" }]);
  assert.equal(base, buildTasteInputFingerprint("books", [{ title: "Book A", comment: "Author A" }, { title: "Book B" }]));
  assert.notEqual(base, buildTasteInputFingerprint("books", [{ title: "Book B" }, { title: "Book A", comment: "Author A" }]));
  assert.notEqual(base, buildTasteInputFingerprint("books", [{ title: "Book A", comment: "Author B" }, { title: "Book B" }]));
});

test("profile Interests never become eligible for taste-label classification", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  User.findOne = async () => ({
    userId: 46,
    aiLists: { random: { topTen: Array.from({ length: 10 }, (_, index) => ({ title: `Interest ${index}` })) } },
    aiTaste: { random: { labelKey: "gamer" } },
  });
  User.findOneAndUpdate = async () => {
    throw new Error("Interests taste state must not be written");
  };

  try {
    const result = await syncAiTasteForSection(46, "random");
    assert.equal(result.ok, true);
    assert.equal(result.progress.completed, true);
    assert.equal(result.progress.labelReady, false);
    assert.equal(result.taste.labelKey, "");
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("AI taste suggestions require a choice and failures offer retry or a return to the full list", () => {
  const suggested = buildTasteReviewPresentation("fa", "books", {
    taste: {
      classificationStatus: "suggested",
      suggestedLabelKeys: ["novel_reader", "midnight_philosopher", "book_buff"],
      suggestionInsight: "انتخاب‌هات بیشتر به سمت رمان‌های ادبی، اجتماعی و درون‌نگر می‌رن.",
    },
  });
  assert.match(suggested.text, /نزدیک‌ترین تا کلی‌ترین/);
  assert.match(suggested.text, /✨ انتخاب‌هات بیشتر به سمت رمان‌های ادبی/);
  const suggestedCallbacks = suggested.extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  const suggestedButtons = suggested.extra.reply_markup.inline_keyboard.flat();
  assert.deepEqual(suggestedButtons.slice(0, 3).map((button) => button.text.split(" ")[0]), ["🥇", "🥈", "🧩"]);
  assert.ok(suggestedCallbacks.includes(`${callBacks.aiTasteConfirm}books:novel_reader`));
  assert.ok(suggestedCallbacks.includes(`${callBacks.aiTasteConfirm}books:midnight_philosopher`));
  assert.ok(suggestedCallbacks.includes(`${callBacks.aiTasteConfirm}books:book_buff`));
  assert.ok(!suggestedCallbacks.includes(`${callBacks.aiTasteChoose}books`));
  assert.ok(suggestedCallbacks.includes(`${callBacks.aiTasteSkip}books`));

  const failed = buildTasteReviewPresentation("en", "books", {
    taste: { classificationStatus: "needs_choice" },
    needsManualSelection: true,
    classificationReason: "provider_unavailable",
  });
  assert.match(failed.text, /retry later/i);
  const failureCallbacks = failed.extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.deepEqual(failureCallbacks, [
    `${callBacks.aiTasteRetry}books`,
    `${callBacks.aiListManageMenu}books:top_ten`,
  ]);

  const alreadyUsed = buildTasteReviewPresentation("en", "books", {
    taste: { classificationStatus: "suggested", suggestedLabelKeys: ["book_buff"] },
    classificationReason: "free_check_used",
  });
  const fallbackCallbacks = alreadyUsed.extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(fallbackCallbacks.includes(`${callBacks.aiTasteConfirm}books:book_buff`));
  assert.ok(!fallbackCallbacks.includes(`${callBacks.aiTasteConfirm}books:novel_reader`));
  assert.doesNotMatch(alreadyUsed.text, /✨/);
});

test("changing a taste label marks only the current saved suggestion with the plain Interest-style tick", () => {
  const keyboard = aiTasteSuggestionKeyboard(
    "fa",
    "music",
    ["metalhead", "post_rocker", "music_buff"],
    { selectedLabelKey: "post_rocker", includeClose: true },
  );
  const buttons = keyboard.reply_markup.inline_keyboard.flat();
  assert.equal(buttons[0].text.startsWith("✓"), false);
  assert.equal(buttons[1].text.startsWith("✓"), true);
  assert.equal(buttons[1].text.startsWith("✅"), false);
  assert.ok(buttons.some((button) => button.callback_data === callBacks.aiTasteClose));
  assert.ok(!buttons.some((button) => button.callback_data === `${callBacks.aiTasteReview}music`));
});

test("taste recheck is shown only when explicitly enabled for a completed confirmed list", () => {
  const hidden = buildTasteReviewPresentation("en", "books", {
    taste: { classificationStatus: "confirmed", labelKey: "novel_reader" },
  });
  const hiddenCallbacks = hidden.extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(!hiddenCallbacks.includes(`${callBacks.aiTasteRecheck}books`));
  assert.ok(hiddenCallbacks.includes(callBacks.aiTasteClose));

  const visible = buildTasteReviewPresentation("fa", "books", {
    taste: { classificationStatus: "confirmed", labelKey: "novel_reader" },
  }, { canRecheck: true, recheckCost: "۱۰" });
  const buttons = visible.extra.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.callback_data === `${callBacks.aiTasteRecheck}books`));
  assert.ok(buttons.some((button) => /۱۰/.test(button.text)));
});

test("a paid recheck suggestion keeps the current label active until confirmation", () => {
  const review = buildTasteReviewPresentation("en", "books", {
    taste: {
      classificationStatus: "confirmed_review",
      labelKey: "novel_reader",
      suggestedLabelKeys: ["midnight_philosopher", "book_buff"],
    },
  });
  assert.match(review.text, /current label stays active/i);
  const callbacks = review.extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(callbacks.includes(`${callBacks.aiTasteConfirm}books:midnight_philosopher`));
  assert.ok(callbacks.includes(`${callBacks.aiTasteConfirm}books:book_buff`));
});

test("an unchanged completed list reuses its versioned classification without another write", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const topTen = Array.from({ length: 10 }, (_, index) => ({ title: `Book ${index + 1}`, comment: "" }));
  const inputFingerprint = buildTasteInputFingerprint("books", topTen);
  User.findOne = async () => ({
    userId: 42,
    aiLists: { books: { topTen } },
    aiTaste: { books: {
      suggestedLabelKeys: ["novel_reader", "book_buff"],
      suggestionInsight: "Your choices lean toward literary and introspective novels.",
      classifierVersion: TASTE_CLASSIFIER_VERSION,
      inputFingerprint,
      classificationStatus: "suggested",
      sampleCount: 10,
    } },
  });
  User.findOneAndUpdate = async () => {
    throw new Error("cached classification must not be rewritten");
  };

  try {
    const result = await syncAiTasteForSection(42, "books");
    assert.equal(result.ok, true);
    assert.equal(result.needsConfirmation, true);
    assert.deepEqual(result.taste.suggestedLabelKeys, ["novel_reader", "book_buff"]);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("editing the list after a successful free check does not trigger another free AI check", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  let writtenUpdate = null;
  User.findOne = async () => ({
    userId: 45,
    aiLists: {
      books: {
        topTen: Array.from({ length: 10 }, (_, index) => ({ title: `Changed Book ${index + 1}` })),
      },
    },
    aiTaste: { books: {
      freeClassificationUsedAt: new Date("2026-01-01T00:00:00Z"),
      classifierVersion: TASTE_CLASSIFIER_VERSION,
      inputFingerprint: "old-list",
      classificationStatus: "suggested",
      suggestedLabelKeys: ["novel_reader", "book_buff"],
    } },
  });
  User.findOneAndUpdate = async (_filter, update) => {
    writtenUpdate = update;
    return null;
  };

  try {
    const result = await syncAiTasteForSection(45, "books");
    assert.equal(result.ok, true);
    assert.equal(result.needsConfirmation, true);
    assert.equal(result.classificationReason, "free_check_used");
    assert.equal(result.taste.classificationStatus, "suggested");
    assert.deepEqual(writtenUpdate.$set["aiTaste.books.suggestedLabelKeys"], ["book_buff"]);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("taste confirmation accepts only the saved AI shortlist and keeps it for later changes", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const topTen = Array.from({ length: 10 }, (_, index) => ({ title: `Book ${index + 1}` }));
  const inputFingerprint = buildTasteInputFingerprint("books", topTen);
  let storedFingerprint = inputFingerprint;
  let writtenUpdate = null;
  User.findOne = async () => ({
    userId: 47,
    aiLists: { books: { topTen } },
    aiTaste: { books: {
      suggestedLabelKeys: ["novel_reader", "book_buff"],
      suggestionInsight: "Your choices lean toward literary and introspective novels.",
      inputFingerprint: storedFingerprint,
      classificationStatus: "suggested",
      freeClassificationUsedAt: new Date("2026-01-01T00:00:00Z"),
    } },
  });
  User.findOneAndUpdate = async (_filter, update) => {
    writtenUpdate = update;
    return null;
  };

  try {
    const forged = await confirmAiTasteLabel(47, "books", "old_soul");
    assert.deepEqual(forged, { ok: false, reason: "stale_suggestion" });
    assert.equal(writtenUpdate, null);

    const accepted = await confirmAiTasteLabel(47, "books", "novel_reader");
    assert.equal(accepted.ok, true);
    assert.deepEqual(accepted.taste.suggestedLabelKeys, ["novel_reader", "book_buff"]);
    assert.equal(accepted.taste.suggestionInsight, "Your choices lean toward literary and introspective novels.");
    assert.deepEqual(writtenUpdate.$set["aiTaste.books.suggestedLabelKeys"], ["novel_reader", "book_buff"]);
    assert.equal(writtenUpdate.$set["aiTaste.books.suggestionInsight"], "Your choices lean toward literary and introspective novels.");
    assert.equal(writtenUpdate.$set["aiTaste.books.source"], "ai_confirmed");

    storedFingerprint = "older-list";
    writtenUpdate = null;
    const staleSkip = await skipAiTasteLabel(47, "books");
    assert.deepEqual(staleSkip, { ok: false, reason: "stale_suggestion" });
    assert.equal(writtenUpdate, null);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("a confirmed earned label remains after favorites drop below 10", async () => {
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  let writtenUpdate = null;
  User.findOne = async () => ({
    userId: 43,
    aiLists: { books: { topTen: Array.from({ length: 9 }, (_, index) => ({ title: `Book ${index + 1}` })) } },
    aiTaste: { books: {
      labelKey: "novel_reader",
      emoji: "📖",
      source: "user",
      classificationStatus: "confirmed",
      sampleCount: 10,
    } },
  });
  User.findOneAndUpdate = async (_filter, update) => {
    writtenUpdate = update;
    return null;
  };

  try {
    const result = await syncAiTasteForSection(43, "books");
    assert.equal(result.ok, true);
    assert.equal(result.taste.labelKey, "novel_reader");
    assert.equal(result.taste.classificationStatus, "confirmed");
    assert.equal(result.taste.sampleCount, 9);
    assert.equal(writtenUpdate.$set["aiTaste.books.sampleCount"], 9);
    assert.equal(writtenUpdate.$set["aiTaste.books.labelKey"], undefined);
  } finally {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("an earned label remains visible in an incomplete Favorites manager", async () => {
  const text = await getTopTenManageEntryMessage({
    userId: 44,
    user: {
      aiLists: { books: { topTen: Array.from({ length: 9 }, (_, index) => ({ title: `Book ${index + 1}` })) } },
      aiTaste: { books: { labelKey: "novel_reader", emoji: "📖", classificationStatus: "confirmed" } },
    },
  }, "fa", "books");
  assert.match(text, /برچسب انتخابی تو: 📖 رمان‌خوان/);
});
