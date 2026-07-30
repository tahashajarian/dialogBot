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
    { ok: true, title: "Dark", metadata: "2017 · Creator: Baran bo Odar", reason: "Dense mystery." },
  ];

  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async (request) => {
      inputs.push(request.userText);
      return results.shift();
    },
    findDuplicate: () => null,
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
  });

  assert.equal(calls, 1);
  assert.equal(result.reason, "capacity_busy");
});

test("shared suggestion generation retries duplicate candidates but remains bounded", async () => {
  let calls = 0;
  const result = await generateUsableSuggestion(baseRequest(), {
    requestSuggestion: async () => {
      calls += 1;
      return { ok: true, title: "Known", metadata: "2000 · Director: Test", reason: "Specific reason." };
    },
    findDuplicate: () => ({ title: "Known" }),
  });

  assert.equal(calls, 3);
  assert.equal(result.reason, "duplicate_suggestion");
});
