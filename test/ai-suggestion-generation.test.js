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

test("book suggestions use the localized title and author without catalogue verification", async () => {
  let verificationCalls = 0;
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    topTenItems: ["سووشون", "بوف کور", "چشم‌هایش"],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      candidates: [{
        ok: true,
        title: "Soluch's Empty Place",
        localizedTitle: "جای خالی سلوچ",
        localizedCreator: "محمود دولت‌آبادی",
        metadata: "Author: Mahmoud Dowlatabadi · 1979",
        reason: "روایت فرسایش خانواده و فقر؛ تلخ و انسانی.",
      }],
    }),
    verifyBookSuggestion: async () => {
      verificationCalls += 1;
      return { ok: false, reason: "catalog_unverified" };
    },
    findDuplicate: () => null,
  });

  assert.equal(verificationCalls, 0);
  assert.equal(result.title, "جای خالی سلوچ");
  assert.equal(result.metadata, "Author: محمود دولت‌آبادی");
  assert.equal(result.originalTitle, "");
});

test("English book suggestions keep only title and author", async () => {
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "en",
  }), {
    requestSuggestion: async () => ({
      ok: true,
      title: "The House of the Spirits",
      metadata: "Author: Isabel Allende · 1982",
      reason: "Family history and political upheaval intertwine.",
    }),
    findDuplicate: () => null,
  });

  assert.equal(result.title, "The House of the Spirits");
  assert.equal(result.metadata, "Author: Isabel Allende");
});

test("book generation retries malformed output once", async () => {
  let calls = 0;
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    topTenItems: ["سووشون", "بوف کور", "چشم‌هایش"],
  }), {
    requestSuggestion: async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, reason: "invalid_output" }
        : {
          ok: true,
          title: "جای خالی سلوچ",
          metadata: "محمود دولت‌آبادی",
          reason: "خانواده و فقر را بی‌پرده روایت می‌کند.",
        };
    },
    findDuplicate: () => null,
  });

  assert.equal(calls, 2);
  assert.equal(result.title, "جای خالی سلوچ");
});

test("book duplicate checks use the displayed title", async () => {
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    blockedSuggestionItems: [{ title: "جای خالی سلوچ محمود دولت‌آبادی" }],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      title: "جای خالی سلوچ",
      metadata: "محمود دولت‌آبادی",
      reason: "خانواده و فقر را بی‌پرده روایت می‌کند.",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "duplicate_suggestion");
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

test("Persian UI with Latin-script book favorites keeps original book identity", async () => {
  const requests = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    topTenItems: ["The Trial", "The Stranger", "One Hundred Years of Solitude"],
  }), {
    requestSuggestion: async (request) => {
      requests.push(request);
      return {
        ok: true,
        title: "The Remains of the Day",
        localizedTitle: "بازمانده روز",
        localizedCreator: "کازوئو ایشی‌گورو",
        metadata: "Author: Kazuo Ishiguro",
        reason: "حافظه و پشیمانی فروخورده؛ آرام و دقیق.",
      };
    },
    findDuplicate: () => null,
  });

  assert.equal(requests[0].displayLanguage, "en");
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

test("English UI with Persian-script favorites prefers Persian display identity", async () => {
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

  const bookRequests = [];
  const book = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "en",
    topTenItems: ["سووشون", "بوف کور", "چشم‌هایش"],
  }), {
    requestSuggestion: async (request) => {
      bookRequests.push(request);
      return {
        ok: true,
        title: "جای خالی سلوچ",
        metadata: "Author: محمود دولت‌آبادی",
        reason: "Family erosion and poverty; stark and humane.",
      };
    },
    findDuplicate: () => null,
  });

  assert.equal(bookRequests[0].displayLanguage, "fa");
  assert.equal(book.title, "جای خالی سلوچ");
  assert.equal(book.metadata, "Author: محمود دولت‌آبادی");
});
