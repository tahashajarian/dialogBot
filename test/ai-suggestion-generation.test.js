const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyLocalizedBookTitle,
  generateUsableSuggestion,
  normalizeEnglishBookTitle,
  normalizePersianBookTitle,
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
    { ok: true, title: "Dark", metadata: "2017 · Creator: Baran bo Odar", reason: "Dense mystery." },
  ];

  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async (request) => {
      inputs.push(request.userText);
      return results.shift();
    },
    findDuplicate: () => null,
    verifyMovieSuggestion: async (suggestion) => ({ ok: true, suggestion }),
  });

  assert.equal(result.title, "Dark");
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0], "series only");
  assert.match(inputs[1], /^series only/);
  assert.match(inputs[1], /two concrete connections/);
});

test("shared suggestion generation does not retry provider failures", async () => {
  let calls = 0;
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => {
      calls += 1;
      return { ok: false, reason: "capacity_busy" };
    },
    verifyMovieSuggestion: async (suggestion) => ({ ok: true, suggestion }),
  });

  assert.equal(calls, 1);
  assert.equal(result.reason, "capacity_busy");
});

test("shared suggestion generation retries duplicate batches but remains bounded", async () => {
  let calls = 0;
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => {
      calls += 1;
      return { ok: true, title: "Known", metadata: "2000 · Director: Test", reason: "Specific reason." };
    },
    findDuplicate: () => ({ title: "Known" }),
    verifyMovieSuggestion: async (suggestion) => ({ ok: true, suggestion }),
  });

  assert.equal(calls, 2);
  assert.equal(result.reason, "duplicate_suggestion");
});

test("shared suggestion generation checks batch candidates in order without another AI call", async () => {
  let requestCalls = 0;
  const checked = [];
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => {
      requestCalls += 1;
      return {
        ok: true,
        candidates: [
          { ok: true, title: "Invented", metadata: "2020 · Director: Nobody", reason: "Specific qualities connect." },
          { ok: true, title: "Dark", metadata: "2017 · Creator: Baran bo Odar", reason: "Dense mystery and fractured timelines." },
          { ok: true, title: "Extra", metadata: "2021 · Director: Somebody", reason: "Specific visual and thematic qualities." },
        ],
      };
    },
    verifyMovieSuggestion: async (suggestion) => {
      checked.push(suggestion.title);
      return suggestion.title === "Dark"
        ? { ok: true, suggestion }
        : { ok: false, reason: "catalog_unverified", qualityIssue: "catalog_title_mismatch" };
    },
    findDuplicate: () => null,
  });

  assert.equal(requestCalls, 1);
  assert.deepEqual(checked, ["Invented", "Dark"]);
  assert.equal(result.title, "Dark");
});

test("movie generation retries unverified catalogue candidates and uses verified metadata", async () => {
  let requestCalls = 0;
  let verificationCalls = 0;
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => {
      requestCalls += 1;
      return {
        ok: true,
        title: requestCalls === 1 ? "Invented Film" : "Dark",
        metadata: "2017 · Creator: Baran bo Odar",
        reason: "Dense mystery and fractured timelines reward close attention.",
      };
    },
    verifyMovieSuggestion: async (suggestion) => {
      verificationCalls += 1;
      if (suggestion.title === "Invented Film") {
        return {
          ok: false,
          reason: "catalog_unverified",
          qualityIssue: "catalog_title_mismatch",
        };
      }
      return {
        ok: true,
        suggestion: {
          ...suggestion,
          metadata: "2017 · Creator: Baran bo Odar, Jantje Friese",
        },
      };
    },
    findDuplicate: () => null,
  });

  assert.equal(requestCalls, 2);
  assert.equal(verificationCalls, 2);
  assert.equal(result.title, "Dark");
  assert.equal(result.metadata, "2017 · Creator: Baran bo Odar, Jantje Friese");
});

test("movie generation does not retry a catalogue outage", async () => {
  let requestCalls = 0;
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => {
      requestCalls += 1;
      return {
        ok: true,
        title: "Dark",
        metadata: "2017 · Creator: Baran bo Odar",
        reason: "Dense mystery and fractured timelines reward close attention.",
      };
    },
    verifyMovieSuggestion: async () => ({
      ok: false,
      reason: "catalog_unavailable",
    }),
  });

  assert.equal(requestCalls, 1);
  assert.equal(result.reason, "catalog_unavailable");
});

test("Persian book suggestions show a safe localized title with the verified original", () => {
  assert.equal(normalizePersianBookTitle("«مردم مستقل»"), "مردم مستقل");
  assert.equal(normalizePersianBookTitle("Independent People"), "");
  assert.equal(normalizeEnglishBookTitle("The death of the heart"), "The Death of the Heart");
  assert.deepEqual(
    applyLocalizedBookTitle({
      ok: true,
      title: "Independent People",
      localizedTitle: "مردم مستقل",
      metadata: "Author: Halldór Laxness · 1934",
      reason: "روایت تلخ زندگی فرودستان؛ زمخت و انسانی.",
    }, "books", "fa"),
    {
      ok: true,
      title: "مردم مستقل (Independent People)",
      originalTitle: "Independent People",
      localizedTitle: "مردم مستقل",
      metadata: "Author: Halldór Laxness · 1934",
      reason: "روایت تلخ زندگی فرودستان؛ زمخت و انسانی.",
    },
  );
});

test("localized book titles are applied only after duplicate and catalogue checks", async () => {
  const duplicateChecks = [];
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
  }), {
    requestSuggestion: async () => ({
      ok: true,
      candidates: [{
        ok: true,
        title: "Independent People",
        localizedTitle: "مردم مستقل",
        metadata: "Author: Halldór Laxness · 1946",
        reason: "روایت تلخ زندگی فرودستان؛ زمخت و انسانی.",
      }],
    }),
    verifyBookSuggestion: async (suggestion) => ({
      ok: true,
      suggestion: {
        ...suggestion,
        metadata: "Author: Halldór Laxness · 1934",
      },
    }),
    findDuplicate: (title) => {
      duplicateChecks.push(title);
      return null;
    },
  });

  assert.deepEqual(duplicateChecks, ["Independent People", "مردم مستقل"]);
  assert.equal(result.title, "مردم مستقل (Independent People)");
  assert.equal(result.originalTitle, "Independent People");
});

test("Persian book generation keeps verified original when no trustworthy localized title exists", async () => {
  let calls = 0;
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
  }), {
    requestSuggestion: async () => {
      calls += 1;
      return {
        ok: true,
        candidates: [{
          ok: true,
          title: "A Fan's Notes",
          metadata: "Author: Frederick Exley · 1968",
          reason: "راوی شکست‌خورده و نثر بی‌پرده؛ تلخ و زنده.",
        }],
      };
    },
    verifyBookSuggestion: async (suggestion) => ({ ok: true, suggestion }),
    resolveBookTitle: async () => "",
    findDuplicate: () => null,
  });

  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.title, "A Fan's Notes");
});

test("Persian book generation resolves a missing established title", async () => {
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
  }), {
    requestSuggestion: async () => ({
      ok: true,
      candidates: [{
        ok: true,
        title: "The Sheltering Sky",
        metadata: "Author: Paul Bowles · 1949",
        reason: "فرسودگی اگزیستانسیال و نثر بی‌پرده؛ تیره و تب‌دار.",
      }],
    }),
    verifyBookSuggestion: async (suggestion) => ({ ok: true, suggestion }),
    resolveBookTitle: async ({ title, metadata }) => {
      assert.equal(title, "The Sheltering Sky");
      assert.match(metadata, /Paul Bowles/);
      return "آسمان سرپناه";
    },
    findDuplicate: () => null,
  });

  assert.equal(result.title, "آسمان سرپناه (The Sheltering Sky)");
});

test("Persian book duplicate checks include the localized title", async () => {
  const result = await generateUsableSuggestion(baseRequest({
    section: "books",
    lang: "fa",
    blockedSuggestionItems: [{ title: "مرگ قسطی فردینان سلین" }],
  }), {
    requestSuggestion: async () => ({
      ok: true,
      candidates: [{
        ok: true,
        title: "Death on the Installment Plan",
        localizedTitle: "مرگ قسطی",
        metadata: "Author: Louis-Ferdinand Céline · 1936",
        reason: "فضای فرسوده شهری و نثر عصبی؛ تلخ و بی‌پرده.",
      }],
    }),
    verifyBookSuggestion: async (suggestion) => ({ ok: true, suggestion }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "duplicate_suggestion");
});
