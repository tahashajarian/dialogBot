const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildConfig,
  getConfigIssues,
  getRuntimeConfig,
  getAiConfig,
  getModerationConfig,
  resolveAccountDeletionSecret,
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

test("config rejects equivalent API roots with superficial URL differences", () => {
  const issues = getConfigIssues(buildConfig({
    BOT_TOKEN: "token",
    MONGO_URI: "mongodb://localhost:27017/test",
    API_ROOT: "https://tapi.bale.ai/",
    API_BASE_URL: "https://tapi.bale.ai",
  }), { requireRuntime: true });

  assert.ok(issues.some((issue) => issue.includes("must not point to the same URL")));
});

test("production requires a strong independent account-deletion secret", () => {
  const base = {
    NODE_ENV: "production",
    BOT_TOKEN: "telegram-bot-token-value",
    MONGO_URI: "mongodb://localhost:27017/test",
  };
  assert.throws(
    () => getRuntimeConfig(base),
    /ACCOUNT_DELETION_SECRET is required in production/,
  );
  assert.throws(
    () => getRuntimeConfig({ ...base, ACCOUNT_DELETION_SECRET: "too-short" }),
    /at least 32 characters/,
  );
  assert.throws(
    () => getRuntimeConfig({
      ...base,
      BOT_TOKEN: "x".repeat(40),
      ACCOUNT_DELETION_SECRET: "x".repeat(40),
    }),
    /independent from BOT_TOKEN/,
  );
});

test("production configuration errors never include secret values", () => {
  const botToken = "shared-secret-value-that-must-not-be-logged";
  let error;
  try {
    getRuntimeConfig({
      NODE_ENV: "production",
      BOT_TOKEN: botToken,
      MONGO_URI: "mongodb://localhost:27017/test",
      ACCOUNT_DELETION_SECRET: botToken,
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.equal(error.message.includes(botToken), false);
});

test("production rejects remote HTTP API endpoints but allows loopback development services", () => {
  const base = {
    NODE_ENV: "production",
    BOT_TOKEN: "telegram-bot-token-value",
    MONGO_URI: "mongodb://localhost:27017/test",
    ACCOUNT_DELETION_SECRET: "d".repeat(40),
  };
  assert.throws(
    () => getRuntimeConfig({ ...base, API_BASE_URL: "http://api.openai.example/v1" }),
    /API_BASE_URL must use HTTPS/,
  );
  assert.throws(
    () => getRuntimeConfig({ ...base, API_ROOT: "http://telegram.example/api" }),
    /API_ROOT must use HTTPS/,
  );
  assert.equal(
    getRuntimeConfig({ ...base, API_BASE_URL: "http://127.0.0.1:8080/v1" }).aiBaseUrl,
    "http://127.0.0.1:8080/v1",
  );
});

test("account deletion keeps the bot-token fallback outside production only", () => {
  assert.equal(resolveAccountDeletionSecret({ BOT_TOKEN: "development-token" }), "development-token");
  assert.equal(resolveAccountDeletionSecret({
    NODE_ENV: "production",
    BOT_TOKEN: "production-token",
  }), "");
  assert.equal(resolveAccountDeletionSecret({
    NODE_ENV: "production",
    ACCOUNT_DELETION_SECRET: "independent-secret",
    BOT_TOKEN: "production-token",
  }), "independent-secret");
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
    suggestionProvider: "auto",
    timeoutMs: 1234,
  });
});

test("ai suggestion provider accepts documented modes", () => {
  assert.equal(getAiConfig({ AI_SUGGESTION_PROVIDER: "chat" }).suggestionProvider, "chat");
  assert.equal(getAiConfig({ AI_SUGGESTION_PROVIDER: "responses" }).suggestionProvider, "responses");

  const issues = getConfigIssues(buildConfig({
    AI_SUGGESTION_PROVIDER: "other",
  }));
  assert.ok(issues.some((issue) => issue.includes("AI_SUGGESTION_PROVIDER")));
});

test("normalizeUsername strips at signs and lowercases", () => {
  assert.equal(normalizeUsername("@Taha_SHJ"), "taha_shj");
});
