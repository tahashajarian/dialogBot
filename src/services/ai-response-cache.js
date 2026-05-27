const Fuse = require("fuse.js");
const AiResponseCache = require("../models/ai-response-cache");
const {
  normalizeAiInput,
  tokenizeNormalizedInput,
  isMeaningfulNormalizedInput,
} = require("./input-normalization");

const DEFAULT_CONFIG = {
  cacheEnabled: process.env.CACHE_ENABLED !== "false",
  fuzzyMatchThreshold: Number(process.env.FUZZY_MATCH_THRESHOLD || 88),
  semanticMatchThreshold: Number(process.env.SEMANTIC_MATCH_THRESHOLD || 0.9),
  minFuzzyInputLength: Number(process.env.MIN_FUZZY_INPUT_LENGTH || 4),
  shortTextHigherThreshold: Number(process.env.SHORT_TEXT_HIGHER_THRESHOLD || 94),
  enableSemanticMatching: process.env.ENABLE_SEMANTIC_MATCHING !== "false",
  candidateLimit: Number(process.env.CACHE_CANDIDATE_LIMIT || 500),
  ambiguousFuzzyScoreGap: Number(process.env.FUZZY_AMBIGUOUS_SCORE_GAP || 2),
  ambiguousSemanticScoreGap: Number(process.env.SEMANTIC_AMBIGUOUS_SCORE_GAP || 0.02),
};

const CACHE_STATS = {
  total: 0,
  exact: 0,
  fuzzy: 0,
  semantic: 0,
  newApiCall: 0,
  cacheDisabled: 0,
  newApiCallFailed: 0,
};

function cloneStats() {
  return { ...CACHE_STATS };
}

function incrementStats(matchType) {
  CACHE_STATS.total += 1;

  if (matchType === "exact") CACHE_STATS.exact += 1;
  else if (matchType === "fuzzy") CACHE_STATS.fuzzy += 1;
  else if (matchType === "semantic") CACHE_STATS.semantic += 1;
  else if (matchType === "new_api_call") CACHE_STATS.newApiCall += 1;
  else if (matchType === "cache_disabled") CACHE_STATS.cacheDisabled += 1;
  else if (matchType === "new_api_call_failed") CACHE_STATS.newApiCallFailed += 1;
}

function getAiResponseCacheStats() {
  return cloneStats();
}

function resetAiResponseCacheStats() {
  for (const key of Object.keys(CACHE_STATS)) {
    CACHE_STATS[key] = 0;
  }
}

function normalizeScore(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    fuzzyMatchThreshold: normalizeScore(overrides.fuzzyMatchThreshold, DEFAULT_CONFIG.fuzzyMatchThreshold),
    semanticMatchThreshold: normalizeScore(overrides.semanticMatchThreshold, DEFAULT_CONFIG.semanticMatchThreshold),
    minFuzzyInputLength: normalizeScore(overrides.minFuzzyInputLength, DEFAULT_CONFIG.minFuzzyInputLength),
    shortTextHigherThreshold: normalizeScore(overrides.shortTextHigherThreshold, DEFAULT_CONFIG.shortTextHigherThreshold),
  };
}

function normalizeCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["movie", "movies"].includes(normalized)) return "movie";
  if (["song", "songs", "music", "artist", "album"].includes(normalized)) return "music";
  if (["book", "books"].includes(normalized)) return "book";
  if (["game", "games"].includes(normalized)) return "game";
  if (normalized === "random") return "unknown";
  return normalized || "unknown";
}

function getComparableText(entry) {
  return String(entry?.normalizedInput || entry?.normalized_input || "").trim();
}

function levenshteinDistance(a, b) {
  const left = Array.from(String(a || ""));
  const right = Array.from(String(b || ""));
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function ratio(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  const maxLength = Math.max(Array.from(left).length, Array.from(right).length);
  if (!maxLength) return 100;
  return Math.round((1 - (levenshteinDistance(left, right) / maxLength)) * 100);
}

function sortTokens(value) {
  return tokenizeNormalizedInput(value).sort().join(" ");
}

function tokenSortRatio(a, b) {
  return ratio(sortTokens(a), sortTokens(b));
}

function tokenSet(value) {
  return new Set(tokenizeNormalizedInput(value));
}

function isUnsafeSubsetMatch(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size || left.size === right.size) return false;

  const smaller = left.size < right.size ? left : right;
  const larger = left.size < right.size ? right : left;
  return [...smaller].every((token) => larger.has(token));
}

function isUnsafeSingleTokenSubsetMatch(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size || left.size === right.size) return false;

  const smaller = left.size < right.size ? left : right;
  const larger = left.size < right.size ? right : left;
  return smaller.size === 1 && [...smaller].every((token) => larger.has(token));
}

function getFuzzyScore(a, b) {
  return Math.max(ratio(a, b), tokenSortRatio(a, b));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = Number(a[index]) || 0;
    const right = Number(b[index]) || 0;
    dot += left * right;
    aNorm += left * left;
    bNorm += right * right;
  }

  if (!aNorm || !bNorm) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function isAmbiguousMatch(bestScore, secondScore, gap) {
  return Number.isFinite(secondScore) && bestScore - secondScore < gap;
}

function mapCacheDoc(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    ...plain,
    id: String(plain._id || plain.id || ""),
    aiResponse: plain.aiResponse || plain.ai_response,
    normalizedInput: plain.normalizedInput || plain.normalized_input,
    hitCount: plain.hitCount || plain.hit_count || 0,
  };
}

function createMongoCacheStore() {
  return {
    async findExact({ normalizedInput, category, purpose, lang }) {
      return mapCacheDoc(await AiResponseCache.findOne({
        normalizedInput,
        category,
        purpose,
        lang,
      }));
    },

    async findCandidates({ category, purpose, lang, limit }) {
      const docs = await AiResponseCache.find({ category, purpose, lang })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      return docs.map(mapCacheDoc);
    },

    async markUsed(entry) {
      const id = entry?._id || entry?.id;
      if (!id) return;
      await AiResponseCache.findByIdAndUpdate(id, {
        $inc: { hitCount: 1 },
        $set: { lastUsedAt: new Date() },
      });
    },

    async save(entry) {
      const update = {
        originalInput: entry.originalInput,
        normalizedInput: entry.normalizedInput,
        aiResponse: entry.aiResponse,
        embedding: Array.isArray(entry.embedding) ? entry.embedding : [],
        category: entry.category,
        purpose: entry.purpose,
        lang: entry.lang,
        metadata: entry.metadata || {},
      };

      const doc = await AiResponseCache.findOneAndUpdate(
        {
          normalizedInput: entry.normalizedInput,
          category: entry.category,
          purpose: entry.purpose,
          lang: entry.lang,
        },
        {
          $set: update,
          $setOnInsert: {
            hitCount: 0,
            lastUsedAt: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return mapCacheDoc(doc);
    },
  };
}

function createAiResponseCache({
  store = createMongoCacheStore(),
  config = {},
  logger = console,
} = {}) {
  const resolvedConfig = getConfig(config);

  async function logMatch(payload) {
    const log = logger?.info || logger?.log;
    if (!log) return;
    log.call(logger, "AI cache lookup:", payload);
  }

  async function returnCacheHit({ entry, matchType, score, originalInput, normalizedInput }) {
    await store.markUsed(entry);
    incrementStats(matchType);
    await logMatch({
      originalInput,
      normalizedInput,
      cacheHit: true,
      matchType,
      score,
      cachedItemId: entry.id,
      openAiCalled: false,
      stats: cloneStats(),
    });
    return {
      ok: true,
      text: entry.aiResponse,
      cached: true,
      matchType,
      score,
      cachedItemId: entry.id,
      normalizedInput,
    };
  }

  async function findFuzzyMatch({ normalizedInput, category, purpose, lang }) {
    if (
      normalizedInput.length < resolvedConfig.minFuzzyInputLength ||
      tokenizeNormalizedInput(normalizedInput).some((token) => token.length <= 2)
    ) {
      return null;
    }

    const candidates = await store.findCandidates({
      category,
      purpose,
      lang,
      limit: resolvedConfig.candidateLimit,
    });
    if (!candidates.length) return null;

    const fuse = new Fuse(candidates, {
      keys: ["normalizedInput"],
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.45,
    });
    const fuseResults = fuse.search(normalizedInput).slice(0, 12);
    const scored = (fuseResults.length ? fuseResults.map((result) => result.item) : candidates)
      .map((entry) => {
        const candidateText = getComparableText(entry);
        return {
          entry,
          score: getFuzzyScore(normalizedInput, candidateText),
          candidateText,
        };
      })
      .filter((result) => result.candidateText)
      .filter((result) => !isUnsafeSubsetMatch(normalizedInput, result.candidateText))
      .sort((a, b) => b.score - a.score);

    if (!scored.length) return null;

    const best = scored[0];
    const second = scored[1];
    const requiredThreshold = normalizedInput.length <= 6
      ? resolvedConfig.shortTextHigherThreshold
      : resolvedConfig.fuzzyMatchThreshold;

    // Default threshold 88 means only very close spelling variants should reuse cache.
    if (best.score < requiredThreshold) return null;
    if (isAmbiguousMatch(best.score, second?.score, resolvedConfig.ambiguousFuzzyScoreGap)) {
      return null;
    }

    return best;
  }

  async function findSemanticMatch({ normalizedInput, category, purpose, lang, embedding }) {
    if (!resolvedConfig.enableSemanticMatching || !Array.isArray(embedding) || !embedding.length) {
      return null;
    }

    const candidates = await store.findCandidates({
      category,
      purpose,
      lang,
      limit: resolvedConfig.candidateLimit,
    });

    const scored = candidates
      .filter((entry) => Array.isArray(entry.embedding) && entry.embedding.length === embedding.length)
      .filter((entry) => !isUnsafeSingleTokenSubsetMatch(normalizedInput, getComparableText(entry)))
      .map((entry) => ({
        entry,
        score: cosineSimilarity(embedding, entry.embedding),
      }))
      .sort((a, b) => b.score - a.score);

    if (!scored.length) return null;
    const best = scored[0];
    const second = scored[1];
    if (best.score < resolvedConfig.semanticMatchThreshold) return null;
    if (isAmbiguousMatch(best.score, second?.score, resolvedConfig.ambiguousSemanticScoreGap)) {
      return null;
    }
    return best;
  }

  async function getOrCreate({
    originalInput,
    category = "unknown",
    purpose = "general_feedback",
    lang = "fa",
    metadata = {},
    generateResponse,
    generateEmbedding,
  }) {
    const normalizedInput = normalizeAiInput(originalInput);
    const cacheCategory = normalizeCategory(category);
    const cacheLang = String(lang || "fa").trim() || "fa";

    if (!isMeaningfulNormalizedInput(normalizedInput)) {
      return { ok: false, reason: "empty_or_meaningless_input", normalizedInput };
    }

    if (!resolvedConfig.cacheEnabled) {
      const response = await generateResponse();
      incrementStats("cache_disabled");
      await logMatch({
        originalInput,
        normalizedInput,
        cacheHit: false,
        matchType: "cache_disabled",
        openAiCalled: true,
        stats: cloneStats(),
      });
      return { ...response, cached: false, matchType: "cache_disabled", normalizedInput };
    }

    const exact = await store.findExact({
      normalizedInput,
      category: cacheCategory,
      purpose,
      lang: cacheLang,
    });
    if (exact?.aiResponse) {
      return returnCacheHit({
        entry: exact,
        matchType: "exact",
        score: 100,
        originalInput,
        normalizedInput,
      });
    }

    const fuzzy = await findFuzzyMatch({
      normalizedInput,
      category: cacheCategory,
      purpose,
      lang: cacheLang,
    });
    if (fuzzy?.entry?.aiResponse) {
      return returnCacheHit({
        entry: fuzzy.entry,
        matchType: "fuzzy",
        score: fuzzy.score,
        originalInput,
        normalizedInput,
      });
    }

    let embedding = null;
    if (resolvedConfig.enableSemanticMatching && generateEmbedding) {
      embedding = await generateEmbedding(normalizedInput);
      const semantic = await findSemanticMatch({
        normalizedInput,
        category: cacheCategory,
        purpose,
        lang: cacheLang,
        embedding,
      });
      if (semantic?.entry?.aiResponse) {
        return returnCacheHit({
          entry: semantic.entry,
          matchType: "semantic",
          score: semantic.score,
          originalInput,
          normalizedInput,
        });
      }
    }

    const response = await generateResponse();
    if (!response?.ok || !response.text) {
      incrementStats("new_api_call_failed");
      await logMatch({
        originalInput,
        normalizedInput,
        cacheHit: false,
        matchType: "new_api_call_failed",
        openAiCalled: true,
        stats: cloneStats(),
      });
      return { ...response, cached: false, matchType: "new_api_call_failed", normalizedInput };
    }

    if (!embedding && resolvedConfig.enableSemanticMatching && generateEmbedding) {
      embedding = await generateEmbedding(normalizedInput);
    }

    const saved = await store.save({
      originalInput,
      normalizedInput,
      aiResponse: response.text,
      embedding,
      category: cacheCategory,
      purpose,
      lang: cacheLang,
      metadata,
    });

    incrementStats("new_api_call");
    await logMatch({
      originalInput,
      normalizedInput,
      cacheHit: false,
      matchType: "new_api_call",
      score: null,
      cachedItemId: saved?.id,
      openAiCalled: true,
      stats: cloneStats(),
    });

    return {
      ...response,
      cached: false,
      matchType: "new_api_call",
      cachedItemId: saved?.id,
      normalizedInput,
    };
  }

  return {
    getOrCreate,
    findFuzzyMatch,
    findSemanticMatch,
  };
}

module.exports = {
  createAiResponseCache,
  createMongoCacheStore,
  getConfig,
  normalizeCategory,
  cosineSimilarity,
  getFuzzyScore,
  getAiResponseCacheStats,
  resetAiResponseCacheStats,
};
