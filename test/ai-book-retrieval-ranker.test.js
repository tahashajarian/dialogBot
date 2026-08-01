const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseRankedBook,
  rankRetrievedBooks,
} = require("../src/services/ai-book-retrieval-ranker");

test("book ranker parses only an in-range catalogue index", () => {
  assert.deepEqual(parseRankedBook('{"index":2,"mood":"تلخ","reason":"روایت فروپاشی آرام؛ دقیق و انسانی."}', 3), {
    index: 1,
    mood: "تلخ",
    reason: "روایت فروپاشی آرام؛ دقیق و انسانی.",
  });
  assert.equal(parseRankedBook('{"index":4,"reason":"Invalid"}', 3), null);
  assert.equal(parseRankedBook('{"index":1}', 3), null);
});

test("book ranker selects an existing candidate without changing its identity", async () => {
  const candidates = [
    { title: "The Castle", author: "Franz Kafka", source: "open_library", sourceId: "ol-1" },
    { title: "The Man Without Qualities", author: "Robert Musil", source: "google_books", sourceId: "gb-1" },
  ];
  const requests = [];
  const result = await rankRetrievedBooks({
    userId: 1,
    lang: "en",
    displayLanguage: "en",
    favorites: ["The Trial — Franz Kafka"],
    candidates,
  }, {
    config: { timeoutMs: 20000 },
    client: {},
    requestText: async (_client, request) => {
      requests.push(request);
      return {
        text: '{"index":2,"mood":"reflective","reason":"Identity and social paralysis unfold with patient precision."}',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.candidate, candidates[1]);
  assert.equal(result.candidate.title, "The Man Without Qualities");
  assert.equal(result.candidate.author, "Robert Musil");
  assert.match(requests[0].instructions, /Never invent, translate, rewrite/);
  assert.match(requests[0].instructions, /soft direction unless the request explicitly says/);
});

test("book ranker fails rather than accepting an invented index", async () => {
  const result = await rankRetrievedBooks({
    userId: 1,
    lang: "en",
    candidates: [{ title: "The Castle", author: "Franz Kafka" }],
  }, {
    config: { timeoutMs: 20000 },
    client: {},
    requestText: async () => ({ text: '{"index":99,"mood":"dark","reason":"Invented"}' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_ranker_output");
});

test("book ranker can decline a catalogue pool with no relevant candidate", async () => {
  const requests = [];
  const result = await rankRetrievedBooks({
    userId: 1,
    lang: "en",
    userText: "speculative fiction",
    candidates: [{ title: "Lectures on Literature", author: "A Critic" }],
  }, {
    config: { timeoutMs: 20000 },
    client: {},
    requestText: async (_client, request) => {
      requests.push(request);
      return { text: '{"index":0,"mood":"","reason":""}' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_ranker_output");
  assert.match(requests[0].instructions, /If no candidate is clearly relevant/);
});
