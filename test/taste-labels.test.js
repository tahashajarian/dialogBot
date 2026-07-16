const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { getTasteLabelTitle } = require("../src/services/ai-section");
const { inferTasteLabel } = require("../src/services/users");

test("taste label titles use the approved Persian and English catalog", () => {
  const expected = {
    music: {
      metalhead: ["متال‌هد", "Metalhead"], rocker: ["راکر", "Rocker"], pop_lover: ["پاپ‌استن", "Pop Stan"],
      hiphop_head: ["هیپ‌هاپ‌هد", "Hip-Hop Head"], electronic_fan: ["ریور", "Raver"], classical_soul: ["روح کلاسیک", "Classical Soul"],
      jazz_vibe: ["جزکت", "Jazz Cat"], indie_spirit: ["ایندی‌کید", "Indie Kid"], eclectic_listener: ["کنجکاو", "Curious Listener"],
    },
    movies: {
      sci_fi_explorer: ["سای‌فای‌گیک", "Sci-Fi Geek"], action_junkie: ["اکشن‌فریک", "Action Junkie"], drama_seeker: ["درام‌باز", "Drama Buff"],
      comedy_chaser: ["کمدی‌نرد", "Comedy Nerd"], horror_hunter: ["هارر هد", "Horror Head"], animation_lover: ["انیمیشن‌گیک", "Animation Geek"],
      arthouse_curious: ["آرت‌هاوسر", "Arthouse Aficionado"], documentary_mind: ["مستندبین", "Documentary Buff"], eclectic_watcher: ["فیلم‌باز", "Movie Buff"],
    },
    books: {
      fantasy_dreamer: ["فانتزی‌خوان", "Fantasy Reader"], sci_fi_reader: ["علمی‌تخیلی‌خوان", "Sci-Fi Reader"], thriller_detective: ["جنایی‌خوان", "Crime Reader"],
      classic_reader: ["کلاسیک‌خوان", "Classics Reader"], self_growth: ["توسعه‌فردی", "Personal Growth"], romance_reader: ["عاشقانه‌خوان", "Romance Reader"],
      history_buff: ["تاریخ‌خوان", "History Reader"], non_fiction_curious: ["غیرداستان‌خوان", "Nonfiction Reader"], eclectic_reader: ["کتاب‌باز", "Book Lover"],
    },
  };

  for (const [section, labels] of Object.entries(expected)) {
    for (const [labelKey, [fa, en]] of Object.entries(labels)) {
      assert.equal(getTasteLabelTitle(messages, "fa", section, labelKey), fa);
      assert.equal(getTasteLabelTitle(messages, "en", section, labelKey), en);
    }
  }
});

test("infers music label from common song titles", () => {
  const taste = inferTasteLabel("music", ["Enter Sandman", "Master of Puppets", "Metallica"]);

  assert.equal(taste.labelKey, "metalhead");
  assert.equal(taste.emoji, "🤘");
  assert.ok(taste.confidence >= 0.5);
});

test("infers metalhead from metal and hard-rock music variants", () => {
  const taste = inferTasteLabel("music", [
    "killing in the name of",
    "enter sand man metalica",
    "highway to the hell",
    "pulp fiction tarantino",
    "toranj mohsen namjoo",
    "جبر جغرافیایی محسن نامجو",
    "bleeding me metalica",
    "nothing else matter metalica",
    "stand by me sting",
    "welocme to the jungle - guns and roses",
  ]);

  assert.equal(taste.labelKey, "metalhead");
  assert.equal(taste.emoji, "🤘");
});

test("infers movie label from common drama titles and misspellings", () => {
  const taste = inferTasteLabel("movies", ["forest gump", "The Green Mile", "Whiplash"]);

  assert.equal(taste.labelKey, "drama_seeker");
  assert.equal(taste.emoji, "🎭");
  assert.ok(taste.confidence >= 0.5);
});

test("uses default label with lower confidence when no signal matches", () => {
  const taste = inferTasteLabel("movies", ["unknown title one", "unknown title two"]);

  assert.equal(taste.labelKey, "eclectic_watcher");
  assert.equal(taste.emoji, "🎬");
  assert.equal(taste.confidence, 0.45);
});

test("infers the nearest existing Books label from a Persian literary list", () => {
  const taste = inferTasteLabel("books", [
    "سال بلوا عباس معروفی",
    "سمفونی مردگان عباس معروفی",
    "گور به گور ویلیام فاکنر",
    "سفر به انتهای شب",
    "جاده منتهی به لس آنجلس",
    "از غبار بپرس",
    "عامه پسند بوکوفسکی",
    "سرشار از زندگی جان فانته",
    "مرگ قسطی فردینان سلین",
    "جنایات و مکافات داستایفسکی",
  ]);

  assert.equal(taste.labelKey, "classic_reader");
  assert.equal(taste.emoji, "📜");
  assert.ok(taste.confidence >= 0.5);
});

test("uses the majority of recognized favorites without requiring every item to match", () => {
  const taste = inferTasteLabel("movies", [
    "ماتریکس",
    "میان‌ستاره‌ای",
    "بلید رانر",
    "ورود",
    "تل‌ماسه",
    "پدرخوانده",
    "ویپلش",
    "یک عنوان ناشناخته",
    "another unknown title",
    "فیلمی دیگر",
  ]);

  assert.equal(taste.labelKey, "sci_fi_explorer");
  assert.equal(taste.emoji, "🚀");
});

test("normalizes Persian and Arabic letter variants for taste matching", () => {
  const taste = inferTasteLabel("books", ["جنايات و مكافات داستايوفسكي"]);

  assert.equal(taste.labelKey, "classic_reader");
});
