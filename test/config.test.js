const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildConfig,
  getConfigIssues,
  getRuntimeConfig,
  getAiConfig,
  normalizeUsername,
} = require("../src/config");

test("runtime config requires bot token and mongo uri", () => {
  assert.throws(
    () => getRuntimeConfig({}),
    /BOT_TOKEN is required[\s\S]*MONGO_URI is required/,
  );
});

test("config keeps Bale API root and AI base URL separate", () => {
  const issues = getConfigIssues(buildConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    API_ROOT: "https://api.openai.com/v1",
    API_BASE_URL: "https://tapi.bale.ai",
  }), { requireRuntime: true });

  assert.ok(issues.some((issue) => issue.includes("API_ROOT appears not to be a Bale")));
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
  assert.deepEqual([...config.allowedUsernames], ["alice", "bob"]);
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
