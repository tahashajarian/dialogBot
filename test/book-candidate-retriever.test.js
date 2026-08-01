const test = require("node:test");
const assert = require("node:assert/strict");

const {
  googleBookCandidates,
  isRomanizedPersianCandidate,
  openLibraryBookCandidates,
  retrieveBookCandidates,
  uniqueBookCandidates,
} = require("../src/services/book-candidate-retriever");

test("book catalogue parsers keep only real title-author records with source identities", () => {
  assert.deepEqual(googleBookCandidates({
    items: [
      {
        id: "google-1",
        volumeInfo: {
          title: "The Man Without Qualities",
          authors: ["Robert Musil"],
          categories: ["Fiction"],
          industryIdentifiers: [{ identifier: "9780000000001" }],
        },
      },
      { volumeInfo: { title: "Missing Source", authors: ["Nobody"] } },
    ],
  }).map(({ title, author, source, sourceId }) => ({ title, author, source, sourceId })), [{
    title: "The Man Without Qualities",
    author: "Robert Musil",
    source: "google_books",
    sourceId: "google-1",
  }]);

  assert.deepEqual(openLibraryBookCandidates({
    docs: [{
      key: "/works/OL1W",
      title: "یادداشت‌های خانه مردگان",
      author_name: ["فئودور داستایفسکی"],
    }],
  }).map(({ title, author, source, sourceId }) => ({ title, author, source, sourceId })), [{
    title: "یادداشت‌های خانه مردگان",
    author: "فئودور داستایفسکی",
    source: "open_library",
    sourceId: "/works/OL1W",
  }]);
});

test("book candidates deduplicate the same catalogue pair across sources", () => {
  const result = uniqueBookCandidates([
    { title: "The Trial", author: "Franz Kafka", source: "google_books", sourceId: "g1" },
    { title: "The Trial", author: "Franz Kafka", source: "open_library", sourceId: "o1" },
    { title: "The Castle", author: "Franz Kafka", source: "open_library", sourceId: "o2" },
  ]);

  assert.deepEqual(result.map(({ title, author }) => ({ title, author })), [
    { title: "The Trial", author: "Franz Kafka" },
    { title: "The Castle", author: "Franz Kafka" },
  ]);
});

test("book retrieval discovers candidates only from catalogue responses and prefers the requested script", async () => {
  const openLibraryLanguages = [];
  const fetchImpl = async (urlValue) => {
    const url = new URL(urlValue);
    const isGoogle = url.hostname === "www.googleapis.com";
    if (!isGoogle) openLibraryLanguages.push(url.searchParams.get("lang"));
    const query = url.searchParams.get("q") || url.searchParams.get("subject") || url.searchParams.get("author") || "";

    if (isGoogle && query === "بوف کور") {
      return {
        ok: true,
        json: async () => ({
          items: [{
            id: "seed-google",
            volumeInfo: {
              title: "بوف کور",
              authors: ["صادق هدایت"],
              categories: ["Psychological fiction"],
            },
          }],
        }),
      };
    }
    if (!isGoogle && query === "بوف کور") {
      return {
        ok: true,
        json: async () => ({
          docs: [{
            key: "/works/seed",
            title: "بوف کور",
            author_name: ["صادق هدایت"],
            subject: ["Psychological fiction"],
          }],
        }),
      };
    }
    if (query.includes("Psychological fiction")) {
      return {
        ok: true,
        json: async () => isGoogle ? ({
          items: [{
            id: "candidate-google",
            volumeInfo: {
              title: "ملکوت",
              authors: ["بهرام صادقی"],
              categories: ["Psychological fiction"],
            },
          }],
        }) : ({
          docs: [{
            key: "/works/candidate",
            title: "The Metamorphosis",
            author_name: ["Franz Kafka"],
            subject: ["Psychological fiction"],
          }],
        }),
      };
    }
    return { ok: true, json: async () => isGoogle ? ({ items: [] }) : ({ docs: [] }) };
  };

  const result = await retrieveBookCandidates({
    favorites: ["بوف کور"],
    displayLanguage: "fa",
  }, { fetchImpl, timeoutMs: 100 });

  assert.equal(result[0].title, "ملکوت");
  assert.equal(result[0].author, "بهرام صادقی");
  assert.ok(result.every((candidate) => candidate.sourceId));
  assert.ok(openLibraryLanguages.every((language) => language === "fa"));
  assert.equal(result.some((candidate) => candidate.title === "گدایان و مفتخورها"), false);
});

test("book retrieval can use the existing taste label only as a catalogue search fallback", async () => {
  const queries = [];
  const fetchImpl = async (urlValue) => {
    const url = new URL(urlValue);
    const isGoogle = url.hostname === "www.googleapis.com";
    const query = url.searchParams.get("q") || url.searchParams.get("author") || "";
    queries.push(query);

    if (query === "ادبیات اگزیستانسیال") {
      return {
        ok: true,
        json: async () => isGoogle ? ({
          items: [{
            id: "google-fallback",
            volumeInfo: {
              title: "تهوع",
              authors: ["ژان پل سارتر"],
              categories: ["Existential fiction"],
            },
          }],
        }) : ({ docs: [] }),
      };
    }

    if (query.includes("Existential fiction")) {
      return {
        ok: true,
        json: async () => isGoogle ? ({
          items: [{
            id: "google-discovery",
            volumeInfo: {
              title: "بیگانه",
              authors: ["آلبر کامو"],
              categories: ["Existential fiction"],
            },
          }],
        }) : ({ docs: [] }),
      };
    }

    return { ok: true, json: async () => isGoogle ? ({ items: [] }) : ({ docs: [] }) };
  };

  const result = await retrieveBookCandidates({
    favorites: ["عنوان محلی ناشناخته"],
    displayLanguage: "fa",
    tasteStyleHint: "ادبیات اگزیستانسیال",
  }, { fetchImpl, timeoutMs: 100 });

  assert.ok(queries.includes("ادبیات اگزیستانسیال"));
  assert.equal(result.some((candidate) => candidate.title === "بیگانه" && candidate.author === "آلبر کامو"), true);
  assert.ok(result.every((candidate) => candidate.sourceId));
});



test("Persian book retrieval rejects romanized and Latin-title fallbacks when favorites are Persian", async () => {
  assert.equal(isRomanizedPersianCandidate({
    title: "Faridun sih pisar dasht",
    author: "Abbas Maroufi",
    language: "per",
  }), true);
  assert.equal(isRomanizedPersianCandidate({
    title: "Faridun ۳ pisar dasht",
    author: "Abbas Maroufi",
    language: "fa-IR",
  }), true);
  assert.equal(isRomanizedPersianCandidate({
    title: "The Blind Owl",
    author: "Sadegh Hedayat",
    language: "en",
  }), false);

  const fetchImpl = async (urlValue) => {
    const url = new URL(urlValue);
    const isGoogle = url.hostname === "www.googleapis.com";
    const query = url.searchParams.get("q") || url.searchParams.get("author") || "";

    if (query === "سمفونی مردگان") {
      return {
        ok: true,
        json: async () => isGoogle ? ({
          items: [{
            id: "seed-google",
            volumeInfo: {
              title: "سمفونی مردگان",
              authors: ["عباس معروفی"],
              language: "fa",
              categories: ["Iranian fiction"],
            },
          }],
        }) : ({ docs: [] }),
      };
    }

    if (query.includes("Iranian fiction") || query.includes("عباس معروفی")) {
      return {
        ok: true,
        json: async () => isGoogle ? ({
          items: [
            {
              id: "persian-edition",
              volumeInfo: {
                title: "فریدون سه پسر داشت",
                authors: ["عباس معروفی"],
                language: "fa",
                categories: ["Iranian fiction"],
              },
            },
            {
              id: "english-translation",
              volumeInfo: {
                title: "The Year of Turmoil",
                authors: ["Abbas Maroufi"],
                language: "en",
                categories: ["Iranian fiction"],
              },
            },
          ],
        }) : ({
          docs: [{
            key: "/works/romanized",
            title: "Faridun sih pisar dasht",
            author_name: ["Abbas Maroufi"],
            language: ["per"],
            subject: ["Iranian fiction"],
          }],
        }),
      };
    }

    return { ok: true, json: async () => isGoogle ? ({ items: [] }) : ({ docs: [] }) };
  };

  const result = await retrieveBookCandidates({
    favorites: ["سمفونی مردگان"],
    displayLanguage: "fa",
  }, { fetchImpl, timeoutMs: 100 });

  assert.equal(result.some((candidate) => candidate.title === "Faridun sih pisar dasht"), false);
  assert.equal(result[0].title, "فریدون سه پسر داشت");
  assert.equal(result[0].author, "عباس معروفی");
  assert.equal(result.some((candidate) => candidate.title === "The Year of Turmoil"), false);
});


test("Persian book retrieval inspects multiple Open Library editions and keeps the Persian one", () => {
  const result = openLibraryBookCandidates({
    docs: [{
      key: "/works/OLXW",
      title: "Symphony of the Dead",
      author_name: ["Abbas Maroufi"],
      author_alternative_name: ["عباس معروفی"],
      editions: {
        docs: [
          { key: "/books/EN", title: "Symphony of the Dead", language: ["eng"] },
          { key: "/books/FA", title: "سمفونی مردگان", language: ["per"] },
        ],
      },
    }],
  }, { languagePreference: "fa" });

  assert.equal(result[0].title, "سمفونی مردگان");
  assert.equal(result[0].sourceId, "/books/FA");
  assert.equal(result[0].author, "عباس معروفی");
});

test("book retrieval runs a second catalogue pass when first-page Persian results are blocked", async () => {
  const queries = [];
  const fetchImpl = async (urlValue) => {
    const url = new URL(urlValue);
    const isGoogle = url.hostname === "www.googleapis.com";
    const query = url.searchParams.get("q") || url.searchParams.get("author") || "";
    const page = Number(url.searchParams.get("page") || 1);
    const startIndex = Number(url.searchParams.get("startIndex") || 0);
    queries.push({ query, page, startIndex });

    if (query === "سمفونی مردگان" || query.includes("عباس معروفی")) {
      return {
        ok: true,
        json: async () => isGoogle ? ({
          items: [{
            id: "blocked",
            volumeInfo: {
              title: "فریدون سه پسر داشت",
              authors: ["عباس معروفی"],
              language: "fa",
              categories: ["Iranian fiction"],
            },
          }],
        }) : ({ docs: [] }),
      };
    }

    if ((startIndex >= 12 || page >= 2) && (query.includes("Iranian fiction") || query.includes("رمان فارسی"))) {
      return {
        ok: true,
        json: async () => isGoogle ? ({
          items: [{
            id: "expanded",
            volumeInfo: {
              title: "چراغ‌ها را من خاموش می‌کنم",
              authors: ["زویا پیرزاد"],
              language: "fa",
              categories: ["Iranian fiction"],
            },
          }],
        }) : ({ docs: [] }),
      };
    }

    return { ok: true, json: async () => isGoogle ? ({ items: [] }) : ({ docs: [] }) };
  };

  const result = await retrieveBookCandidates({
    favorites: ["سمفونی مردگان"],
    displayLanguage: "fa",
    blockedItems: [{ title: "فریدون سه پسر داشت عباس معروفی" }],
  }, { fetchImpl, timeoutMs: 100 });

  assert.equal(result.some((candidate) => candidate.title === "فریدون سه پسر داشت"), false);
  assert.equal(result.some((candidate) => candidate.title === "چراغ‌ها را من خاموش می‌کنم"), true);
  assert.equal(queries.some(({ page, startIndex }) => page >= 2 || startIndex >= 12), true);
});

test("book retrieval infers repeated Persian author suffixes from translated favorites", () => {
  const { inferAuthorQueries } = require("../src/services/book-candidate-retriever");
  assert.deepEqual(inferAuthorQueries([
    "مرگ قسطی فردینان سلین",
    "سفر به انتهای شب فردینان سلین",
    "عامه پسند چارلز بوکوفسکی",
    "زن ها چارلز بوکوفسکی",
    "از غبار بپرس جان فانته",
    "جاده منتهی به لس آنجلس جان فانته",
    "تا بهار صبر کن باندینی جان فانته",
    "گور به گور ویلیام فاکنر",
  ]), [
    "جان فانته",
    "فردینان سلین",
    "چارلز بوکوفسکی",
    "ویلیام فاکنر",
  ]);
});

test("Persian translated favorites recover through author catalogue searches", async () => {
  const queries = [];
  const fetchImpl = async (urlValue) => {
    const url = new URL(urlValue);
    const isGoogle = url.hostname === "www.googleapis.com";
    const query = url.searchParams.get("q") || url.searchParams.get("author") || "";
    queries.push(query);

    if (query.includes('inauthor:"جان فانته"')) {
      return {
        ok: true,
        json: async () => ({
          items: [{
            id: "fa-fante-candidate",
            volumeInfo: {
              title: "رویای بانکر هیل",
              authors: ["جان فانته"],
              language: "fa",
              categories: ["Literary fiction"],
              description: "رمانی درباره فقر، جاه طلبی و نویسندگی در لس آنجلس.",
            },
          }],
        }),
      };
    }

    if (!isGoogle && query === "جان فانته") {
      return {
        ok: true,
        json: async () => ({
          docs: [{
            key: "/works/fante",
            title: "Dreams from Bunker Hill",
            author_name: ["John Fante"],
            author_alternative_name: ["جان فانته"],
            subject: ["Literary fiction"],
            editions: {
              docs: [{
                key: "/books/fante-fa",
                title: "رویای بانکر هیل",
                language: ["per"],
              }],
            },
          }],
        }),
      };
    }

    return { ok: true, json: async () => isGoogle ? ({ items: [] }) : ({ docs: [] }) };
  };

  const result = await retrieveBookCandidates({
    favorites: [
      "مرگ قسطی فردینان سلین",
      "سفر به انتهای شب فردینان سلین",
      "عامه پسند چارلز بوکوفسکی",
      "زن ها چارلز بوکوفسکی",
      "از غبار بپرس جان فانته",
      "جاده منتهی به لس آنجلس جان فانته",
      "تا بهار صبر کن باندینی جان فانته",
      "گور به گور ویلیام فاکنر",
    ],
    displayLanguage: "fa",
    blockedItems: [
      { title: "از غبار بپرس جان فانته" },
      { title: "جاده منتهی به لس آنجلس جان فانته" },
      { title: "تا بهار صبر کن باندینی جان فانته" },
    ],
  }, { fetchImpl, timeoutMs: 100 });

  assert.equal(queries.some((query) => query.includes('inauthor:"جان فانته"')), true);
  assert.equal(result.some((candidate) => candidate.title === "رویای بانکر هیل"), true);
  assert.ok(result.every((candidate) => /[\u0600-\u06ff]/u.test(candidate.title)));
});

test("book retrieval exposes timeout diagnostics instead of silent zero results", async () => {
  const fetchImpl = async (_urlValue, options = {}) => new Promise((resolve, reject) => {
    const abort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    void resolve;
  });

  const result = await retrieveBookCandidates({
    favorites: ["مرگ قسطی فردینان سلین"],
    displayLanguage: "fa",
  }, { fetchImpl, timeoutMs: 5 });

  assert.equal(result.length, 0);
  assert.ok(result.diagnostics.requests > 0);
  assert.equal(result.diagnostics.successfulResponses, 0);
  assert.ok(result.diagnostics.timeouts > 0);
});

test("book retrieval records catalogue HTTP status codes for production diagnosis", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({}),
  });

  const result = await retrieveBookCandidates({
    favorites: ["مرگ قسطی فردینان سلین"],
    displayLanguage: "fa",
  }, { fetchImpl, timeoutMs: 100 });

  assert.equal(result.length, 0);
  assert.ok(result.diagnostics.httpErrors > 0);
  assert.ok(result.diagnostics.sources.google_books.statuses["403"] > 0);
  assert.ok(result.diagnostics.sources.open_library.statuses["403"] > 0);
});
