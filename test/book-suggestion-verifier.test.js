const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyBookSuggestionCandidate } = require("../src/services/book-suggestion-verifier");

function candidate(suffix = "") {
  return {
    originalTitle: `Verified Book ${suffix}`.trim(),
    originalAuthor: "Known Author",
  };
}

test("book verification prefers Open Library and does not call Wikidata after success", async () => {
  let wikidataCalls = 0;
  const item = candidate("OL");
  const result = await verifyBookSuggestionCandidate(item, {}, {
    verifyOpenLibrary: async () => ({ ok: true, candidate: item, source: "open_library" }),
    verifyWikidata: async () => { wikidataCalls += 1; return { ok: false }; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "open_library");
  assert.equal(wikidataCalls, 0);
});

test("book verification uses strict Wikidata fallback after Open Library failure", async () => {
  const item = candidate("WD");
  const result = await verifyBookSuggestionCandidate(item, {}, {
    verifyOpenLibrary: async () => ({ ok: false, reason: "catalog_unavailable" }),
    verifyWikidata: async () => ({ ok: true, candidate: item, source: "wikidata" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "wikidata");
});

test("book verification never treats two unavailable catalogues as model verification", async () => {
  const result = await verifyBookSuggestionCandidate(candidate("DOWN"), {}, {
    verifyOpenLibrary: async () => ({ ok: false, reason: "catalog_unavailable" }),
    verifyWikidata: async () => ({ ok: false, reason: "catalog_unavailable" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "catalog_unavailable");
});
