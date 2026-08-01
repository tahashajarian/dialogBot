const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateBookCandidates,
  parseBookCandidates,
} = require("../src/services/ai-book-candidate-generator");

test("book candidate parser keeps only original catalogue identity and discards AI display titles", () => {
  const candidates = parseBookCandidates(JSON.stringify([{
    title: "ناطور خرمن",
    author: "جروم دیوید سالینجر",
    originalTitle: "The Catcher in the Rye",
    originalAuthor: "J. D. Salinger",
    mood: "تلخ و عصبی",
    reason: "روایت اول‌شخص و بی‌پرده؛ شهری و ناآرام.",
  }]), {
    favorites: ["مرگ قسطی", "سفر به انتهای شب"],
  });

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    originalTitle: "The Catcher in the Rye",
    originalAuthor: "J. D. Salinger",
    mood: "تلخ و عصبی",
    reason: "روایت اول‌شخص و بی‌پرده؛ شهری و ناآرام.",
  });
  assert.equal(Object.hasOwn(candidates[0], "title"), false);
  assert.equal(Object.hasOwn(candidates[0], "author"), false);
});

test("book candidate parser rejects entries without exact original identity", () => {
  const candidates = parseBookCandidates(JSON.stringify([
    {
      title: "پرسه‌گردی‌های آرتورو باندینی",
      author: "جان فانته",
      reason: "نثر زنده و طنز تلخ؛ شهری و فرسوده.",
    },
    {
      originalTitle: "",
      originalAuthor: "John Fante",
      reason: "نثر زنده و طنز تلخ؛ شهری و فرسوده.",
    },
  ]), {
    favorites: ["از غبار بپرس جان فانته"],
  });

  assert.deepEqual(candidates, []);
});

test("book candidate parser retains Persian display identity only for Persian output", () => {
  const input = JSON.stringify([{
    originalTitle: "Hunger",
    originalAuthor: "Knut Hamsun",
    localizedTitle: "گرسنگی",
    localizedAuthor: "کنوت هامسون",
    mood: "تلخ",
    reason: "فقر و فروپاشی روانی؛ عصبی و فرساینده.",
  }]);
  const [candidate] = parseBookCandidates(input, { favorites: [], lang: "fa" });
  assert.equal(candidate.localizedTitle, "گرسنگی");
  assert.equal(candidate.localizedAuthor, "کنوت هامسون");
  const [englishCandidate] = parseBookCandidates(input, { favorites: [], lang: "en" });
  assert.equal(Object.hasOwn(englishCandidate, "localizedTitle"), false);
});

test("book generation asks AI only for original identity and treats saved items as hard exclusions", async () => {
  const requests = [];
  const result = await generateBookCandidates({
    userId: 42,
    lang: "fa",
    favorites: ["مرگ قسطی فردینان سلین"],
    likedSuggestions: ["کتاب خوانده‌شده"],
    rejectedSuggestions: ["کتاب ردشده"],
    hardExclusions: ["کتاب ذخیره‌شده"],
  }, {
    config: { timeoutMs: 20000 },
    client: {},
    requestText: async (_client, request) => {
      requests.push(request);
      return {
        text: JSON.stringify([{
          title: "خوشه‌های خشم",
          author: "جان اشتاین‌بک",
          originalTitle: "The Grapes of Wrath",
          originalAuthor: "John Steinbeck",
          mood: "اجتماعی",
          reason: "فقر و خشم جمعی؛ انسانی و کوبنده.",
        }]),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requests[0].config.timeoutMs, 14000);
  assert.match(requests[0].instructions, /originalTitle, originalAuthor, localizedTitle, localizedAuthor, mood, reason/);
  assert.match(requests[0].instructions, /Never translate, localize, transliterate, rename/);
  assert.match(requests[0].instructions, /Saved-for-later items are neutral hard exclusions/);
  assert.match(requests[0].instructions, /soft direction, not an exact subtype requirement/);
  assert.match(requests[0].input, /Explicitly liked and read: کتاب خوانده‌شده/);
  assert.match(requests[0].input, /Hard exclusions — saved for later and recent: کتاب ذخیره‌شده/);
  assert.equal(result.candidates[0].originalTitle, "The Grapes of Wrath");
  assert.equal(Object.hasOwn(result.candidates[0], "title"), false);
});
