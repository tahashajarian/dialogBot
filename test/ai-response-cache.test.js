const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeAiInput } = require("../src/services/input-normalization");
const {
  createAiResponseCache,
  getConfig,
  getAiResponseCacheStats,
  resetAiResponseCacheStats,
} = require("../src/services/ai-response-cache");

class MemoryCacheStore {
  constructor() {
    this.entries = [];
    this.nextId = 1;
  }

  async findExact({ normalizedInput, category, purpose, lang }) {
    return this.entries.find((entry) => (
      entry.normalizedInput === normalizedInput &&
      entry.category === category &&
      entry.purpose === purpose &&
      entry.lang === lang
    )) || null;
  }

  async findCandidates({ category, purpose, lang }) {
    return this.entries.filter((entry) => (
      entry.category === category &&
      entry.purpose === purpose &&
      entry.lang === lang
    ));
  }

  async markUsed(entry) {
    const found = this.entries.find((candidate) => candidate.id === entry.id);
    if (!found) return;
    found.hitCount += 1;
    found.lastUsedAt = new Date();
  }

  async save(entry) {
    const existing = await this.findExact(entry);
    if (existing) {
      Object.assign(existing, entry);
      return existing;
    }

    const saved = {
      ...entry,
      id: String(this.nextId),
      hitCount: 0,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.nextId += 1;
    this.entries.push(saved);
    return saved;
  }
}

function createSilentCache(store, overrides = {}) {
  return createAiResponseCache({
    store,
    logger: { info: () => {} },
    config: {
      enableSemanticMatching: true,
      semanticMatchThreshold: 0.9,
      ...overrides,
    },
  });
}

test.beforeEach(() => {
  resetAiResponseCacheStats();
});

test("cache service exposes centralized default config", () => {
  assert.deepEqual(getConfig(), {
    cacheEnabled: true,
    fuzzyMatchThreshold: 88,
    semanticMatchThreshold: 0.9,
    minFuzzyInputLength: 4,
    shortTextHigherThreshold: 94,
    enableSemanticMatching: true,
    candidateLimit: 500,
    ambiguousFuzzyScoreGap: 2,
    ambiguousSemanticScoreGap: 0.02,
  });
});

function embeddingFor(text) {
  const normalized = normalizeAiInput(text);
  if (normalized.includes("enter") && normalized.includes("sandman")) return [1, 0, 0];
  if (normalized.includes("metallica")) return [0.98, 0.02, 0];
  if (normalized.includes("madonna")) return [0, 1, 0];
  if (normalized.includes("megadeth")) return [0, 0.9, 0.1];
  if (normalized.includes("batman")) return [0, 0, 1];
  return [0.2, 0.3, 0.4];
}

test("normalizes exact-equivalent inputs", () => {
  const values = [
    "Metallica",
    "metallica",
    "METALLICA",
    " the band Metallica ",
    "Give me feedback about the band Metallica!!!",
  ];

  assert.deepEqual(values.map(normalizeAiInput), [
    "metallica",
    "metallica",
    "metallica",
    "metallica",
    "metallica",
  ]);
  assert.equal(normalizeAiInput("Metallica - Enter Sandman"), "metallica enter sandman");
});

test("exact normalized cache hit skips response generation", async () => {
  const store = new MemoryCacheStore();
  await store.save({
    originalInput: "Metallica",
    normalizedInput: "metallica",
    aiResponse: "Metalhead radar activated.",
    embedding: embeddingFor("metallica"),
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
  });

  let apiCalls = 0;
  const result = await createSilentCache(store).getOrCreate({
    originalInput: "the band Metallica",
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
    generateEmbedding: async () => embeddingFor("metallica"),
    generateResponse: async () => {
      apiCalls += 1;
      return { ok: true, text: "new" };
    },
  });

  assert.equal(result.matchType, "exact");
  assert.equal(result.text, "Metalhead radar activated.");
  assert.equal(apiCalls, 0);
  assert.equal(store.entries[0].hitCount, 1);
  assert.ok(store.entries[0].lastUsedAt instanceof Date);
  assert.deepEqual(getAiResponseCacheStats(), {
    total: 1,
    exact: 1,
    fuzzy: 0,
    semantic: 0,
    newApiCall: 0,
    cacheDisabled: 0,
    newApiCallFailed: 0,
  });
});

test("fuzzy typo matching reuses high-confidence cached response", async () => {
  const store = new MemoryCacheStore();
  await store.save({
    originalInput: "Metallica",
    normalizedInput: "metallica",
    aiResponse: "Metalhead radar activated.",
    embedding: embeddingFor("metallica"),
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
  });

  const cache = createSilentCache(store);
  const metalica = await cache.getOrCreate({
    originalInput: "metalica",
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
    generateEmbedding: async () => embeddingFor("metalica"),
    generateResponse: async () => ({ ok: true, text: "new" }),
  });
  const metallca = await cache.getOrCreate({
    originalInput: "metallca",
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
    generateEmbedding: async () => embeddingFor("metallca"),
    generateResponse: async () => ({ ok: true, text: "new" }),
  });

  assert.equal(metalica.matchType, "fuzzy");
  assert.equal(metallca.matchType, "fuzzy");
  assert.equal(store.entries[0].hitCount, 2);
});

test("semantic matching reuses close entity when exact and fuzzy fail", async () => {
  const store = new MemoryCacheStore();
  await store.save({
    originalInput: "Metallica - Enter Sandman",
    normalizedInput: "metallica enter sandman",
    aiResponse: "Sandman-level classic.",
    embedding: embeddingFor("metallica enter sandman"),
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
  });

  let apiCalls = 0;
  const result = await createSilentCache(store).getOrCreate({
    originalInput: "the song Enter Sandman",
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
    generateEmbedding: async (input) => embeddingFor(input),
    generateResponse: async () => {
      apiCalls += 1;
      return { ok: true, text: "new" };
    },
  });

  assert.equal(result.matchType, "semantic");
  assert.equal(result.text, "Sandman-level classic.");
  assert.equal(apiCalls, 0);
});

test("false positives are not reused", async () => {
  const store = new MemoryCacheStore();
  await store.save({
    originalInput: "Metallica",
    normalizedInput: "metallica",
    aiResponse: "Metalhead radar activated.",
    embedding: embeddingFor("metallica"),
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
  });
  await store.save({
    originalInput: "Batman",
    normalizedInput: "batman",
    aiResponse: "Dark knight pick.",
    embedding: embeddingFor("batman"),
    category: "movie",
    purpose: "taste_item_feedback",
    lang: "en",
  });

  let apiCalls = 0;
  const cache = createSilentCache(store);
  const megadeth = await cache.getOrCreate({
    originalInput: "Megadeth",
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
    generateEmbedding: async (input) => embeddingFor(input),
    generateResponse: async () => {
      apiCalls += 1;
      return { ok: true, text: "fresh megadeth" };
    },
  });
  const batmanReturns = await cache.getOrCreate({
    originalInput: "Batman Returns",
    category: "movie",
    purpose: "taste_item_feedback",
    lang: "en",
    generateEmbedding: async (input) => embeddingFor(input),
    generateResponse: async () => {
      apiCalls += 1;
      return { ok: true, text: "fresh batman returns" };
    },
  });

  assert.equal(megadeth.matchType, "new_api_call");
  assert.equal(batmanReturns.matchType, "new_api_call");
  assert.equal(apiCalls, 2);
});

test("new API result is saved and later reused", async () => {
  const store = new MemoryCacheStore();
  const cache = createSilentCache(store);
  let apiCalls = 0;

  const first = await cache.getOrCreate({
    originalInput: "Madonna",
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
    generateEmbedding: async (input) => embeddingFor(input),
    generateResponse: async () => {
      apiCalls += 1;
      return { ok: true, text: "Pop royalty detected." };
    },
  });
  const second = await cache.getOrCreate({
    originalInput: "what do you think about Madonna",
    category: "music",
    purpose: "taste_item_feedback",
    lang: "en",
    generateEmbedding: async (input) => embeddingFor(input),
    generateResponse: async () => {
      apiCalls += 1;
      return { ok: true, text: "new" };
    },
  });

  assert.equal(first.matchType, "new_api_call");
  assert.equal(second.matchType, "exact");
  assert.equal(second.text, "Pop royalty detected.");
  assert.equal(apiCalls, 1);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].hitCount, 1);
  assert.equal(getAiResponseCacheStats().newApiCall, 1);
  assert.equal(getAiResponseCacheStats().exact, 1);
});
