const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateUsableSuggestion,
} = require("../src/services/ai-suggestion-generation");

function baseRequest(overrides = {}) {
  return {
    userId: 42,
    section: "movies",
    lang: "en",
    userText: "series only",
    topTenItems: ["Persona"],
    blockedSuggestionItems: [{ title: "Known" }],
    ...overrides,
  };
}

test("shared suggestion generation retries local quality failures with preserved context", async () => {
  const inputs = [];
  const results = [
    { ok: false, reason: "low_quality_media", qualityIssue: "generic_reason" },
    { ok: true, title: "Dark", metadata: "Creator: Baran bo Odar", reason: "Dense mystery." },
  ];
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async (request) => { inputs.push(request.userText); return results.shift(); },
    findDuplicate: () => null,
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
  });
  assert.equal(result.title, "Dark");
  assert.equal(inputs.length, 2);
  assert.match(inputs[1], /compact description/);
});

test("shared suggestion generation does not retry provider failures", async () => {
  let calls = 0;
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => { calls += 1; return { ok: false, reason: "capacity_busy" }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.reason, "capacity_busy");
});

test("shared suggestion generation retries duplicate batches but remains bounded", async () => {
  let calls = 0;
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => {
      calls += 1;
      return { ok: true, title: "Known", metadata: "Director: Test", reason: "Specific reason." };
    },
    findDuplicate: () => ({ title: "Known" }),
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
  });
  assert.equal(calls, 2);
  assert.equal(result.reason, "duplicate_suggestion");
});

test("media pair check tries batch candidates in order", async () => {
  const checked = [];
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => ({
      ok: true,
      candidates: [
        { ok: true, title: "Invented", metadata: "Director: Nobody", reason: "Specific qualities connect." },
        { ok: true, title: "Dark", metadata: "Creator: Baran bo Odar", reason: "Dense mystery and fractured timelines." },
      ],
    }),
    verifyMediaPair: async ({ title }) => {
      checked.push(title);
      return title === "Dark"
        ? { ok: true, verdict: "valid" }
        : { ok: false, reason: "invalid_title_creator_pair" };
    },
    findDuplicate: () => null,
  });
  assert.deepEqual(checked, ["Invented", "Dark"]);
  assert.equal(result.title, "Dark");
  assert.equal(result.metadata, "Creator: Baran bo Odar");
});

test("uncertain pair checks fail open and output strips extra movie metadata", async () => {
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => ({
      ok: true,
      title: "A Separation",
      metadata: "2011 · Director: Asghar Farhadi · IMDb: 8.3/10",
      reason: "Moral tension and intimate family conflict.",
    }),
    verifyMediaPair: async () => ({ ok: true, verdict: "uncertain" }),
    findDuplicate: () => null,
  });
  assert.equal(result.metadata, "Director: Asghar Farhadi");
});

test("music uses retrieved real candidates and keeps only title and artist identity", async () => {
  const rankInputs = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "music",
    topTenItems: ["بهت قول میدم محسن یگانه"],
    rejectedSuggestionItems: ["فاصله‌ها — احسان خواجه‌امیری"],
  }), {
    retrieveMusic: async () => [
      { title: "Gole Yakh", artist: "Kourosh Yaghmaei" },
      { title: "Parvaz", artist: "Googoosh" },
    ],
    rankMusic: async (request) => {
      rankInputs.push(request);
      return {
        ok: true,
        candidate: request.candidates[0],
        displayTitle: "Gole Yakh",
        displayArtist: "Kourosh Yaghmaei",
        mood: "Warm and nostalgic",
        reason: "Memorable melody; warm and urban.",
      };
    },
    findDuplicate: () => null,
  });

  assert.equal(rankInputs.length, 1);
  assert.deepEqual(rankInputs[0].favorites, ["بهت قول میدم محسن یگانه"]);
  assert.deepEqual(rankInputs[0].rejectedSuggestions, ["فاصله‌ها — احسان خواجه‌امیری"]);
  assert.equal(result.title, "Gole Yakh");
  assert.equal(result.metadata, "Artist: Kourosh Yaghmaei");
  assert.equal(result.sourceTitle, "Gole Yakh");
  assert.equal(result.sourceArtist, "Kourosh Yaghmaei");
});

test("music removes exact blocked catalogue titles before AI ranking", async () => {
  const rankInputs = [];
  const result = await generateUsableSuggestion(baseRequest({ section: "music" }), {
    retrieveMusic: async () => [
      { title: "Rejected Track", artist: "Artist A" },
      { title: "Allowed Track", artist: "Artist B" },
    ],
    findDuplicate: (title) => title === "Rejected Track" ? { title } : null,
    rankMusic: async (request) => {
      rankInputs.push(request);
      return {
        ok: true,
        candidate: request.candidates[0],
        displayTitle: request.candidates[0].title,
        displayArtist: request.candidates[0].artist,
        mood: "Focused",
        reason: "Clear melody; direct and memorable.",
      };
    },
  });

  assert.deepEqual(rankInputs[0].candidates, [{ title: "Allowed Track", artist: "Artist B" }]);
  assert.equal(result.title, "Allowed Track");
});

test("music returns a bounded failure when retrieval or ranking has no usable candidate", async () => {
  let rankCalls = 0;
  const result = await generateUsableSuggestion(baseRequest({ section: "music" }), {
    retrieveMusic: async () => [],
    rankMusic: async () => { rankCalls += 1; return { ok: false, reason: "no_catalog_candidates" }; },
    findDuplicate: () => null,
  });

  assert.equal(rankCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_catalog_candidates");
});

test("book suggestions use only the verified catalogue display identity", async () => {
  const generationInputs = [];
  const verified = [];
  const candidate = {
    originalTitle: "Missing Soluch",
    originalAuthor: "Mahmoud Dowlatabadi",
    mood: "تلخ و انسانی",
    reason: "روایت فرسایش خانواده و فقر؛ تلخ و انسانی.",
  };
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    topTenItems: ["سووشون", "بوف کور", "چشم‌هایش"],
  }), {
    generateBooks: async (request) => {
      generationInputs.push(request);
      return { ok: true, candidates: [candidate] };
    },
    verifyBook: async (entry, options) => {
      verified.push({ entry, options });
      return {
        ok: true,
        candidate: entry,
        source: "open_library",
        sourceId: "/works/OL1W",
        canonicalTitle: "Missing Soluch",
        canonicalAuthors: ["Mahmoud Dowlatabadi"],
        aliases: ["Missing Soluch", "جای خالی سلوچ"],
        authorAliases: ["Mahmoud Dowlatabadi", "محمود دولت‌آبادی"],
        displayTitle: "جای خالی سلوچ",
        displayAuthor: "محمود دولت‌آبادی",
      };
    },
    findDuplicate: () => null,
  });

  assert.equal(generationInputs.length, 1);
  assert.equal(verified[0].entry, candidate);
  assert.equal(verified[0].options.displayLanguage, "fa");
  assert.equal(result.title, "جای خالی سلوچ");
  assert.equal(result.metadata, "Author: محمود دولت‌آبادی");
  assert.equal(result.sourceTitle, "Missing Soluch");
  assert.equal(result.sourceAuthor, "Mahmoud Dowlatabadi");
  assert.equal(result.source, "open_library");
});

test("English book suggestions use the verified canonical identity", async () => {
  const candidate = {
    originalTitle: "The House of the Spirits",
    originalAuthor: "Isabel Allende",
    mood: "reflective",
    reason: "Family history and political upheaval intertwine.",
  };
  const result = await generateUsableSuggestion(baseRequest({ section: "books", lang: "en" }), {
    generateBooks: async () => ({ ok: true, candidates: [candidate] }),
    verifyBook: async (entry) => ({
      ok: true,
      candidate: entry,
      source: "open_library",
      canonicalTitle: "The House of the Spirits",
      canonicalAuthors: ["Isabel Allende"],
      aliases: ["The House of the Spirits"],
      displayTitle: "The House of the Spirits",
      displayAuthor: "Isabel Allende",
    }),
    findDuplicate: () => null,
  });

  assert.equal(result.title, "The House of the Spirits");
  assert.equal(result.metadata, "Author: Isabel Allende");
});

test("unverified book identities never reach the user", async () => {
  const result = await generateUsableSuggestion(baseRequest({ section: "books", lang: "fa" }), {
    generateBooks: async () => ({
      ok: true,
      candidates: [{
        originalTitle: "Beggars and Freeloaders",
        originalAuthor: "Ivan Klima",
        reason: "روایتی اجتماعی و تلخ؛ مستقیم و انسانی.",
      }],
    }),
    verifyBook: async () => ({ ok: false, reason: "catalog_unverified" }),
    findDuplicate: () => null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_catalog_candidates");
});

test("book duplicate checks use verified edition aliases after verification", async () => {
  let verifyCalls = 0;
  const duplicateChecks = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    blockedSuggestionItems: [{ title: "از غبار بپرس جان فانته" }],
  }), {
    generateBooks: async () => ({
      ok: true,
      candidates: [{
        originalTitle: "Ask the Dust",
        originalAuthor: "John Fante",
        reason: "نثر زنده و طنز تلخ؛ شهری و فرسوده.",
      }],
    }),
    verifyBook: async (candidate) => {
      verifyCalls += 1;
      return {
        ok: true,
        candidate,
        source: "open_library",
        sourceId: "/works/OL2W",
        canonicalTitle: "Ask the Dust",
        canonicalAuthors: ["John Fante"],
        aliases: ["Ask the Dust", "از غبار بپرس"],
        authorAliases: ["John Fante", "جان فانته"],
        displayTitle: "از غبار بپرس",
        displayAuthor: "جان فانته",
      };
    },
    findDuplicate: (identity) => {
      duplicateChecks.push(identity);
      return identity.includes("از غبار بپرس") ? { identity } : null;
    },
  });

  assert.equal(verifyCalls, 1);
  assert.ok(duplicateChecks.some((identity) => identity.includes("از غبار بپرس")));
  assert.equal(result.reason, "duplicate_suggestion");
});

test("book generation receives saved and recent books only as hard exclusions", async () => {
  const inputs = [];
  await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    watchlistItems: ["کتاب ذخیره‌شده"],
    recentSuggestionItems: ["پیشنهاد اخیر"],
    rejectedSuggestionItems: ["کتاب ردشده"],
    likedSuggestionItems: ["کتاب خوانده‌شده و پسندیده"],
  }), {
    generateBooks: async (request) => {
      inputs.push(request);
      return { ok: false, reason: "invalid_book_candidates", candidates: [] };
    },
    findDuplicate: () => null,
  });

  assert.deepEqual(inputs[0].likedSuggestions, ["کتاب خوانده‌شده و پسندیده"]);
  assert.deepEqual(inputs[0].hardExclusions, ["کتاب ذخیره‌شده", "پیشنهاد اخیر", "کتاب ردشده"]);
});

test("Persian-dominant book lists fall back to verified original title when no Persian edition exists", async () => {
  let verifyCalls = 0;
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    topTenItems: ["بوف کور", "سمفونی مردگان", "سووشون"],
  }), {
    generateBooks: async () => ({
      ok: true,
      candidates: [{
        originalTitle: "The House of the Spirits",
        originalAuthor: "Isabel Allende",
        reason: "تاریخ خانوادگی و آشوب سیاسی؛ روایی و چندنسلی.",
      }],
    }),
    verifyBook: async (candidate, options) => {
      verifyCalls += 1;
      assert.equal(options.displayLanguage, "fa");
      return {
        ok: true,
        candidate,
        canonicalTitle: "The House of the Spirits",
        canonicalAuthors: ["Isabel Allende"],
        aliases: ["The House of the Spirits"],
        displayTitle: "The House of the Spirits",
        displayAuthor: "Isabel Allende",
      };
    },
    findDuplicate: () => null,
  });

  assert.equal(verifyCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.title, "The House of the Spirits");
  assert.equal(result.metadata, "Author: Isabel Allende");
});

test("Persian movie suggestions display localized identity and reject cross-language duplicates", async () => {
  const duplicateChecks = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "movies",
    lang: "fa",
    topTenItems: ["جدایی نادر از سیمین", "طعم گیلاس", "هامون"],
    blockedSuggestionItems: [{ title: "خانه دوست کجاست — عباس کیارستمی" }],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      title: "Where Is the Friend's House?",
      localizedTitle: "خانه دوست کجاست",
      localizedCreator: "عباس کیارستمی",
      metadata: "Director: Abbas Kiarostami",
      reason: "واقع‌گرایی انسانی و نگاه کودکانه؛ ساده و عمیق.",
    }),
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
    findDuplicate: (title, items) => {
      duplicateChecks.push(title);
      return title === "خانه دوست کجاست" ? { item: items[0], type: "exact" } : null;
    },
  });

  assert.ok(duplicateChecks.length >= 1);
  assert.ok(duplicateChecks.every((title) => title === "خانه دوست کجاست"));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "duplicate_suggestion");
});

test("Persian movie suggestions show Persian title and director when not duplicated", async () => {
  const result = await generateUsableSuggestion(baseRequest({ section: "movies", lang: "fa", topTenItems: ["جدایی نادر از سیمین", "طعم گیلاس", "هامون"] }), {
    requestSuggestion: async () => ({
      ok: true,
      title: "Close-Up",
      localizedTitle: "کلوزآپ",
      localizedCreator: "عباس کیارستمی",
      metadata: "Director: Abbas Kiarostami",
      reason: "مرز واقعیت و بازسازی؛ انسانی و چندلایه.",
    }),
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
    findDuplicate: () => null,
  });

  assert.equal(result.title, "کلوزآپ");
  assert.equal(result.metadata, "Director: عباس کیارستمی");
  assert.equal(result.originalTitle, "Close-Up");
});

test("English movie suggestions keep original title and director", async () => {
  const result = await generateUsableSuggestion(baseRequest({ section: "movies", lang: "en" }), {
    requestSuggestion: async () => ({
      ok: true,
      title: "Close-Up",
      localizedTitle: "کلوزآپ",
      localizedCreator: "عباس کیارستمی",
      metadata: "Director: Abbas Kiarostami",
      reason: "Reality and reconstruction blur together; humane and layered.",
    }),
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
    findDuplicate: () => null,
  });

  assert.equal(result.title, "Close-Up");
  assert.equal(result.metadata, "Director: Abbas Kiarostami");
});


test("Persian UI with Latin-script movie favorites keeps original movie identity", async () => {
  const requests = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "movies",
    lang: "fa",
    topTenItems: ["Pulp Fiction", "Forrest Gump", "The Matrix", "Inception"],
  }), {
    requestSuggestion: async (request) => {
      requests.push(request);
      return {
        ok: true,
        title: "Enemy",
        localizedTitle: "دشمن",
        localizedCreator: "دنی ویلنوو",
        metadata: "Director: Denis Villeneuve",
        reason: "هویت دوپاره و فضای مبهم ذهنی؛ دقیق و ناآرام.",
      };
    },
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
    findDuplicate: () => null,
  });

  assert.equal(requests[0].displayLanguage, "en");
  assert.equal(result.title, "Enemy");
  assert.equal(result.metadata, "Director: Denis Villeneuve");
});

test("Persian UI with Latin-script book favorites keeps verified original display identity", async () => {
  const generationInputs = [];
  const verificationInputs = [];
  const candidate = {
    originalTitle: "The Remains of the Day",
    originalAuthor: "Kazuo Ishiguro",
    mood: "آرام و تلخ",
    reason: "حافظه و پشیمانی فروخورده؛ آرام و دقیق.",
  };
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    topTenItems: ["The Trial", "The Stranger", "One Hundred Years of Solitude"],
  }), {
    generateBooks: async (request) => {
      generationInputs.push(request);
      return { ok: true, candidates: [candidate] };
    },
    verifyBook: async (entry, options) => {
      verificationInputs.push(options);
      return {
        ok: true,
        candidate: entry,
        canonicalTitle: "The Remains of the Day",
        canonicalAuthors: ["Kazuo Ishiguro"],
        aliases: ["The Remains of the Day"],
        displayTitle: "The Remains of the Day",
        displayAuthor: "Kazuo Ishiguro",
      };
    },
    findDuplicate: () => null,
  });

  assert.equal(Object.hasOwn(generationInputs[0], "displayLanguage"), false);
  assert.equal(verificationInputs[0].displayLanguage, "en");
  assert.equal(result.title, "The Remains of the Day");
  assert.equal(result.metadata, "Author: Kazuo Ishiguro");
});

test("Persian UI with Latin-script music favorites asks ranker for original display", async () => {
  const rankInputs = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "music",
    lang: "fa",
    topTenItems: ["Paranoid Android — Radiohead", "Roads — Portishead", "Teardrop — Massive Attack"],
  }), {
    retrieveMusic: async () => [{ title: "All Mine", artist: "Portishead" }],
    rankMusic: async (request) => {
      rankInputs.push(request);
      return {
        ok: true,
        candidate: request.candidates[0],
        displayTitle: request.candidates[0].title,
        displayArtist: request.candidates[0].artist,
        mood: "تیره و آرام",
        reason: "ضرب کند و وکال شکننده؛ سنگین و درون‌گرا.",
      };
    },
    findDuplicate: () => null,
  });

  assert.equal(rankInputs[0].displayLanguage, "en");
  assert.equal(result.title, "All Mine");
  assert.equal(result.metadata, "Artist: Portishead");
});

test("English UI with Persian-script favorites prefers verified Persian display identity", async () => {
  const movieRequests = [];
  const movie = await generateUsableSuggestion(baseRequest({
    section: "movies",
    lang: "en",
    topTenItems: ["جدایی نادر از سیمین", "طعم گیلاس", "هامون"],
  }), {
    requestSuggestion: async (request) => {
      movieRequests.push(request);
      return {
        ok: true,
        title: "Close-Up",
        localizedTitle: "کلوزآپ",
        localizedCreator: "عباس کیارستمی",
        metadata: "Director: Abbas Kiarostami",
        reason: "Reality and reconstruction blur together; humane and layered.",
      };
    },
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
    findDuplicate: () => null,
  });

  assert.equal(movieRequests[0].displayLanguage, "fa");
  assert.equal(movie.title, "کلوزآپ");
  assert.equal(movie.metadata, "Director: عباس کیارستمی");

  const bookGenerationInputs = [];
  const bookVerificationInputs = [];
  const bookCandidate = {
    originalTitle: "Missing Soluch",
    originalAuthor: "Mahmoud Dowlatabadi",
    mood: "stark",
    reason: "Family erosion and poverty; stark and humane.",
  };
  const book = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "en",
    topTenItems: ["سووشون", "بوف کور", "چشم‌هایش"],
  }), {
    generateBooks: async (request) => {
      bookGenerationInputs.push(request);
      return { ok: true, candidates: [bookCandidate] };
    },
    verifyBook: async (entry, options) => {
      bookVerificationInputs.push(options);
      return {
        ok: true,
        candidate: entry,
        canonicalTitle: "Missing Soluch",
        canonicalAuthors: ["Mahmoud Dowlatabadi"],
        aliases: ["Missing Soluch", "جای خالی سلوچ"],
        authorAliases: ["Mahmoud Dowlatabadi", "محمود دولت‌آبادی"],
        displayTitle: "جای خالی سلوچ",
        displayAuthor: "محمود دولت‌آبادی",
      };
    },
    findDuplicate: () => null,
  });

  assert.equal(Object.hasOwn(bookGenerationInputs[0], "displayLanguage"), false);
  assert.equal(bookVerificationInputs[0].displayLanguage, "fa");
  assert.equal(book.title, "جای خالی سلوچ");
  assert.equal(book.metadata, "Author: محمود دولت‌آبادی");
});

test("movie pair checks receive the bounded verification timeout", async () => {
  const timeouts = [];
  const result = await generateUsableSuggestion(baseRequest({ section: "movies" }), {
    requestSuggestion: async () => ({
      ok: true,
      title: "Coherence",
      metadata: "Director: James Ward Byrkit",
      reason: "Intimate tension and puzzle-box structure.",
    }),
    findDuplicate: () => null,
    verifyMediaPair: async ({ timeoutMs }) => {
      timeouts.push(timeoutMs);
      return { ok: true, verdict: "valid" };
    },
  });

  assert.deepEqual(timeouts, [3500]);
  assert.equal(result.title, "Coherence");
});

test("movie duplicate candidates are skipped before pair verification", async () => {
  const verified = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "movies",
    blockedSuggestionItems: [{ title: "Enemy" }],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      candidates: [
        { ok: true, title: "Enemy", metadata: "Director: Denis Villeneuve", reason: "Fractured identity and dread." },
        { ok: true, title: "Coherence", metadata: "Director: James Ward Byrkit", reason: "Intimate tension and puzzle-box structure." },
      ],
    }),
    findDuplicate: (title) => title === "Enemy" ? { title } : null,
    verifyMediaPair: async ({ title }) => {
      verified.push(title);
      return { ok: true, verdict: "valid" };
    },
  });

  assert.deepEqual(verified, ["Coherence"]);
  assert.equal(result.title, "Coherence");
});

test("movie profiles with large saved history receive one bounded extra batch", async () => {
  let calls = 0;
  const blocked = Array.from({ length: 25 }, (_, index) => ({ title: `Saved ${index}` }));
  const result = await generateUsableSuggestion(baseRequest({
    section: "movies",
    blockedSuggestionItems: blocked,
  }), {
    requestSuggestion: async () => {
      calls += 1;
      if (calls < 3) {
        return {
          ok: true,
          candidates: [
            { ok: true, title: "Saved 1", metadata: "Director: A", reason: "A specific reason." },
            { ok: true, title: "Saved 2", metadata: "Director: B", reason: "A specific reason." },
            { ok: true, title: "Saved 3", metadata: "Director: C", reason: "A specific reason." },
          ],
        };
      }
      return {
        ok: true,
        candidates: [{ ok: true, title: "Coherence", metadata: "Director: James Ward Byrkit", reason: "Intimate tension and puzzle-box structure." }],
      };
    },
    findDuplicate: (title) => title.startsWith("Saved") ? { title } : null,
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
  });

  assert.equal(calls, 3);
  assert.equal(result.title, "Coherence");
});

test("book catalogue outages are reported separately from identity mismatches", async () => {
  const candidate = {
    originalTitle: "The Grapes of Wrath",
    originalAuthor: "John Steinbeck",
    reason: "فقر و خشم جمعی؛ انسانی و کوبنده.",
  };
  const unavailable = await generateUsableSuggestion(baseRequest({ section: "books", lang: "fa" }), {
    generateBooks: async () => ({ ok: true, candidates: [candidate] }),
    verifyBook: async () => ({ ok: false, reason: "catalog_unavailable" }),
    findDuplicate: () => null,
  });
  assert.equal(unavailable.reason, "catalog_unavailable");

  const mismatch = await generateUsableSuggestion(baseRequest({ section: "books", lang: "fa" }), {
    generateBooks: async () => ({ ok: true, candidates: [candidate] }),
    verifyBook: async () => ({ ok: false, reason: "catalog_unverified" }),
    findDuplicate: () => null,
  });
  assert.equal(mismatch.reason, "no_catalog_candidates");
});


test("movie duplicate filtering uses localized title plus director and continues to a valid candidate", async () => {
  const verified = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "movies",
    lang: "fa",
    topTenItems: ["جدایی نادر از سیمین", "گاو — داریوش مهرجویی"],
    blockedSuggestionItems: [{ title: "گاو — داریوش مهرجویی" }],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      candidates: [
        {
          ok: true,
          title: "The Cow",
          localizedTitle: "گاو (The Cow)",
          localizedCreator: "داریوش مهرجویی",
          metadata: "Director: Dariush Mehrjui",
          reason: "این هم از قبل در فهرستت هست و نباید تکرار شود.",
        },
        {
          ok: true,
          title: "Mother",
          localizedTitle: "مادر",
          localizedCreator: "بونگ جون-هو",
          metadata: "Director: Bong Joon-ho",
          reason: "رابطه خانوادگی پیچیده و تعلیق روان‌شناختی؛ تلخ و درگیرکننده.",
        },
      ],
    }),
    verifyMediaPair: async ({ title }) => {
      verified.push(title);
      return { ok: true, verdict: "valid" };
    },
  });

  assert.deepEqual(verified, ["Mother"]);
  assert.equal(result.ok, true);
  assert.equal(result.title, "مادر");
  assert.equal(result.metadata, "Director: بونگ جون-هو");
});

test("movie self-reported duplicates are skipped without failing the whole batch", async () => {
  const result = await generateUsableSuggestion(baseRequest({
    section: "movies",
    blockedSuggestionItems: [],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      candidates: [
        {
          ok: true,
          title: "Known duplicate",
          metadata: "Director: Someone",
          reason: "This is already in your favorites and should not be repeated.",
        },
        {
          ok: true,
          title: "A Separation",
          metadata: "Director: Asghar Farhadi",
          reason: "Moral pressure and intimate family conflict.",
        },
      ],
    }),
    findDuplicate: () => null,
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.title, "A Separation");
});

test("compact Persian movie duplicate warnings are skipped before display", async () => {
  const verified = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "movies",
    blockedSuggestionItems: [],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      candidates: [
        {
          ok: true,
          title: "About Elly",
          metadata: "Director: Asghar Farhadi",
          reason: "اثر تکراری در فهرستت؛ نامعتبر.",
        },
        {
          ok: true,
          title: "Mother",
          metadata: "Director: Bong Joon-ho",
          reason: "Family obsession and moral ambiguity; tense and character-driven.",
        },
      ],
    }),
    findDuplicate: () => null,
    verifyMediaPair: async ({ title }) => {
      verified.push(title);
      return { ok: true, verdict: "valid" };
    },
  });

  assert.deepEqual(verified, ["Mother"]);
  assert.equal(result.ok, true);
  assert.equal(result.title, "Mother");
});

test("Persian copy saying a movie is not duplicated is not rejected", async () => {
  const result = await generateUsableSuggestion(baseRequest({
    section: "movies",
    blockedSuggestionItems: [],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      title: "Mother",
      metadata: "Director: Bong Joon-ho",
      reason: "این اثر تکراری نیست؛ تنش خانوادگی و ابهام اخلاقی دارد.",
    }),
    findDuplicate: () => null,
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.title, "Mother");
});

test("movie relevance copy saying a title is not already saved is not treated as a duplicate", async () => {
  const result = await generateUsableSuggestion(baseRequest({
    section: "movies",
    blockedSuggestionItems: [],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      title: "Mother",
      metadata: "Director: Bong Joon-ho",
      reason: "Not already in your list; a strong family and moral-pressure match.",
    }),
    findDuplicate: () => null,
    verifyMediaPair: async () => ({ ok: true, verdict: "valid" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.title, "Mother");
});
