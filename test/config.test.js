const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildConfig,
  getConfigIssues,
  getRuntimeConfig,
  getAiConfig,
  getAiCacheConfig,
  getModerationConfig,
  normalizeUsername,
} = require("../src/config");

test("runtime config requires bot token and mongo uri", () => {
  assert.throws(
    () => getRuntimeConfig({}),
    /BOT_TOKEN is required[\s\S]*MONGO_URI is required/,
  );
});

test("config keeps bot platform API root and AI base URL separate", () => {
  const issues = getConfigIssues(buildConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    API_ROOT: "https://api.openai.com/v1",
    API_BASE_URL: "https://tapi.bale.ai",
  }), { requireRuntime: true });

  assert.ok(issues.some((issue) => issue.includes("API_ROOT appears not to be a bot platform")));
  assert.ok(issues.some((issue) => issue.includes("API_BASE_URL appears not to be an AI")));
});

test("config rejects identical API_ROOT and API_BASE_URL", () => {
  const issues = getConfigIssues(buildConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    API_ROOT: "https://tapi.bale.ai",
    API_BASE_URL: "https://tapi.bale.ai",
  }), { requireRuntime: true });

  assert.ok(issues.some((issue) => issue.includes("must not point to the same URL")));
});

test("config normalizes defaults and allowlist usernames", () => {
  const config = getRuntimeConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    ALLOWED_USERNAMES: " @Alice, Bob ,, ",
  });

  assert.equal(config.dbName, "bot");
  assert.equal(config.aiModel, "gpt-4o-mini");
  assert.equal(config.embeddingModel, "text-embedding-3-small");
  assert.equal(config.aiCache.cacheEnabled, true);
  assert.equal(config.aiCache.candidateLimit, 500);
  assert.deepEqual([...config.allowedUsernames], ["alice", "bob"]);
  assert.equal(config.moderation.reportBanThreshold, 5);
});

test("moderation config parses report ban threshold", () => {
  assert.deepEqual(getModerationConfig({ REPORT_BAN_THRESHOLD: "3" }), {
    reportBanThreshold: 3,
  });

  const issues = getConfigIssues(buildConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    REPORT_BAN_THRESHOLD: "0",
  }), { requireRuntime: true });
  assert.ok(issues.some((issue) => issue.includes("REPORT_BAN_THRESHOLD")));
});

test("config accepts optional Telegram proxy URL", () => {
  const config = getRuntimeConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    HTTPS_PROXY: "socks5://127.0.0.1:1080",
    TELEGRAM_PROXY_URL: "http://127.0.0.1:7890",
  });

  assert.equal(config.telegramProxyUrl, "http://127.0.0.1:7890");
});

test("config ignores generic HTTPS_PROXY for Telegram proxy", () => {
  const config = getRuntimeConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    HTTPS_PROXY: "socks5://127.0.0.1:1080",
    BOT_API_PROXY_URL: "http://127.0.0.1:7890",
  });

  assert.equal(config.telegramProxyUrl, null);
});

test("config rejects invalid Telegram proxy URL", () => {
  const issues = getConfigIssues(buildConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    TELEGRAM_PROXY_URL: "socks5://127.0.0.1:1080",
  }), { requireRuntime: true });

  assert.ok(issues.some((issue) => issue.includes("TELEGRAM_PROXY_URL")));
});

test("ai config can be used without runtime bot credentials", () => {
  const config = getAiConfig({
    OPENAI_API_KEY: "ai-key",
    API_BASE_URL: "https://api.openai.com/v1",
    OPENAI_MODEL: "test-model",
    AI_TIMEOUT_MS: "1234",
  });

  assert.deepEqual(config, {
    apiKey: "ai-key",
    baseUrl: "https://api.openai.com/v1",
    model: "test-model",
    embeddingModel: "text-embedding-3-small",
    timeoutMs: 1234,
  });
});

test("normalizeUsername strips at signs and lowercases", () => {
  assert.equal(normalizeUsername("@Taha_SHJ"), "taha_shj");
});

test("ai cache config parses documented environment overrides", () => {
  const config = getAiCacheConfig({
    CACHE_ENABLED: "false",
    ENABLE_SEMANTIC_MATCHING: "off",
    FUZZY_MATCH_THRESHOLD: "91",
    SEMANTIC_MATCH_THRESHOLD: "0.95",
    MIN_FUZZY_INPUT_LENGTH: "5",
    SHORT_TEXT_HIGHER_THRESHOLD: "97",
    CACHE_CANDIDATE_LIMIT: "250",
    FUZZY_AMBIGUOUS_SCORE_GAP: "3",
    SEMANTIC_AMBIGUOUS_SCORE_GAP: "0.04",
  });

  assert.deepEqual(config, {
    cacheEnabled: false,
    enableSemanticMatching: false,
    fuzzyMatchThreshold: 91,
    semanticMatchThreshold: 0.95,
    minFuzzyInputLength: 5,
    shortTextHigherThreshold: 97,
    candidateLimit: 250,
    ambiguousFuzzyScoreGap: 3,
    ambiguousSemanticScoreGap: 0.04,
  });
});

test("config rejects invalid AI cache numeric overrides", () => {
  const issues = getConfigIssues(buildConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    FUZZY_MATCH_THRESHOLD: "bad",
  }), { requireRuntime: true });

  assert.ok(issues.some((issue) => issue.includes("fuzzyMatchThreshold")));
});
