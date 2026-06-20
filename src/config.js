const DEFAULT_ALLOWED_USERNAMES = [];
const DEFAULT_AI_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_AI_TIMEOUT_MS = 8000;
const DEFAULT_REPORT_BAN_THRESHOLD = 5;
const DEFAULT_AI_CACHE_CONFIG = {
  cacheEnabled: true,
  fuzzyMatchThreshold: 88,
  semanticMatchThreshold: 0.9,
  minFuzzyInputLength: 4,
  shortTextHigherThreshold: 94,
  enableSemanticMatching: true,
  candidateLimit: 500,
  ambiguousFuzzyScoreGap: 2,
  ambiguousSemanticScoreGap: 0.02,
};

function clean(value) {
  return String(value || "").trim();
}

function normalizeUsername(value) {
  return clean(value).replace(/^@+/, "").toLowerCase();
}

function resolveAllowedUsernames(env = process.env) {
  const fromEnv = clean(env.ALLOWED_USERNAMES);
  const source = fromEnv ? fromEnv.split(",") : DEFAULT_ALLOWED_USERNAMES;
  return new Set(source.map((value) => normalizeUsername(value)).filter(Boolean));
}

function parseNumberEnv(env, key, fallback) {
  const value = clean(env[key]);
  if (!value) return fallback;
  return Number(value);
}

function parseBooleanEnv(env, key, fallback) {
  const value = clean(env[key]).toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}

function resolveAiCacheConfig(env = process.env) {
  return {
    cacheEnabled: parseBooleanEnv(env, "CACHE_ENABLED", DEFAULT_AI_CACHE_CONFIG.cacheEnabled),
    fuzzyMatchThreshold: parseNumberEnv(env, "FUZZY_MATCH_THRESHOLD", DEFAULT_AI_CACHE_CONFIG.fuzzyMatchThreshold),
    semanticMatchThreshold: parseNumberEnv(env, "SEMANTIC_MATCH_THRESHOLD", DEFAULT_AI_CACHE_CONFIG.semanticMatchThreshold),
    minFuzzyInputLength: parseNumberEnv(env, "MIN_FUZZY_INPUT_LENGTH", DEFAULT_AI_CACHE_CONFIG.minFuzzyInputLength),
    shortTextHigherThreshold: parseNumberEnv(env, "SHORT_TEXT_HIGHER_THRESHOLD", DEFAULT_AI_CACHE_CONFIG.shortTextHigherThreshold),
    enableSemanticMatching: parseBooleanEnv(env, "ENABLE_SEMANTIC_MATCHING", DEFAULT_AI_CACHE_CONFIG.enableSemanticMatching),
    candidateLimit: parseNumberEnv(env, "CACHE_CANDIDATE_LIMIT", DEFAULT_AI_CACHE_CONFIG.candidateLimit),
    ambiguousFuzzyScoreGap: parseNumberEnv(env, "FUZZY_AMBIGUOUS_SCORE_GAP", DEFAULT_AI_CACHE_CONFIG.ambiguousFuzzyScoreGap),
    ambiguousSemanticScoreGap: parseNumberEnv(env, "SEMANTIC_AMBIGUOUS_SCORE_GAP", DEFAULT_AI_CACHE_CONFIG.ambiguousSemanticScoreGap),
  };
}

function looksLikeBaleApiRoot(value) {
  const normalized = clean(value).toLowerCase();
  return !normalized || normalized.includes("bale") || normalized.includes("tapi") || normalized.includes("ble.ir");
}

function looksLikeAiApiBaseUrl(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized.includes("bale") || normalized.includes("tapi") || normalized.includes("ble.ir")) {
    return false;
  }
  return (
    !normalized ||
    normalized.includes("openai") ||
    normalized.includes("gapgpt") ||
    normalized.includes("/v1") ||
    normalized.includes("api.")
  );
}

function getConfigIssues(config, options = {}) {
  const issues = [];
  const requireRuntime = Boolean(options.requireRuntime);

  if (requireRuntime && !config.botToken) {
    issues.push("BOT_TOKEN is required.");
  }
  if (requireRuntime && !config.mongoUri) {
    issues.push("MONGO_URI is required.");
  }
  if (config.baleApiRoot && !/^https?:\/\//i.test(config.baleApiRoot)) {
    issues.push("API_ROOT must be an http(s) Bale Bot API root URL.");
  }
  if (config.aiBaseUrl && !/^https?:\/\//i.test(config.aiBaseUrl)) {
    issues.push("API_BASE_URL must be an http(s) AI endpoint base URL.");
  }
  if (config.baleApiRoot && !looksLikeBaleApiRoot(config.baleApiRoot)) {
    issues.push("API_ROOT appears not to be a Bale Bot API root. Use API_BASE_URL for AI endpoints.");
  }
  if (config.aiBaseUrl && !looksLikeAiApiBaseUrl(config.aiBaseUrl)) {
    issues.push("API_BASE_URL appears not to be an AI endpoint. Use API_ROOT for Bale Bot API root.");
  }
  if (config.baleApiRoot && config.aiBaseUrl && config.baleApiRoot === config.aiBaseUrl) {
    issues.push("API_ROOT and API_BASE_URL must not point to the same URL.");
  }
  if (!Number.isFinite(config.aiTimeoutMs) || config.aiTimeoutMs <= 0) {
    issues.push("AI_TIMEOUT_MS must be a positive number when set.");
  }
  if (!Number.isInteger(config.moderation.reportBanThreshold) || config.moderation.reportBanThreshold <= 0) {
    issues.push("REPORT_BAN_THRESHOLD must be a positive integer when set.");
  }
  for (const [key, value] of Object.entries(config.aiCache || {})) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
      issues.push(`AI cache config ${key} must be a non-negative number when set.`);
    }
  }

  return issues;
}

function buildConfig(env = process.env) {
  const aiTimeoutMs = env.AI_TIMEOUT_MS === undefined || clean(env.AI_TIMEOUT_MS) === ""
    ? DEFAULT_AI_TIMEOUT_MS
    : Number(env.AI_TIMEOUT_MS);
  const reportBanThreshold = env.REPORT_BAN_THRESHOLD === undefined || clean(env.REPORT_BAN_THRESHOLD) === ""
    ? DEFAULT_REPORT_BAN_THRESHOLD
    : Number(env.REPORT_BAN_THRESHOLD);

  return {
    botToken: clean(env.BOT_TOKEN),
    mongoUri: clean(env.MONGO_URI),
    dbName: clean(env.MONGO_DB_NAME) || "bot",
    baleApiRoot: clean(env.API_ROOT) || null,
    allowedUsernames: resolveAllowedUsernames(env),
    aiApiKey: clean(env.OPENAI_API_KEY || env.API_KEY),
    aiBaseUrl: clean(env.API_BASE_URL || env.api_base_url) || null,
    aiModel: clean(env.OPENAI_MODEL || env.MODEL_NAME) || DEFAULT_AI_MODEL,
    embeddingModel: clean(env.EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL,
    aiTimeoutMs,
    aiCache: resolveAiCacheConfig(env),
    moderation: {
      reportBanThreshold,
    },
    invite: {
      deepLinkBaseUrl: clean(env.BOT_DEEP_LINK_BASE_URL),
      publicUrl: clean(env.BOT_PUBLIC_URL || env.PUBLIC_BOT_URL),
      username: clean(env.BOT_USERNAME),
    },
  };
}

function validateConfig(config, options = {}) {
  const issues = getConfigIssues(config, options);
  if (issues.length) {
    const error = new Error(`Configuration error:\n- ${issues.join("\n- ")}`);
    error.issues = issues;
    throw error;
  }
  return config;
}

function getRuntimeConfig(env = process.env) {
  return validateConfig(buildConfig(env), { requireRuntime: true });
}

function getAiConfig(env = process.env) {
  const config = validateConfig(buildConfig(env), { requireRuntime: false });
  return {
    apiKey: config.aiApiKey,
    baseUrl: config.aiBaseUrl,
    model: config.aiModel,
    embeddingModel: config.embeddingModel,
    timeoutMs: config.aiTimeoutMs,
  };
}

function getAiCacheConfig(env = process.env) {
  return validateConfig(buildConfig(env), { requireRuntime: false }).aiCache;
}

function getInviteConfig(env = process.env) {
  return buildConfig(env).invite;
}

function getModerationConfig(env = process.env) {
  return validateConfig(buildConfig(env), { requireRuntime: false }).moderation;
}

module.exports = {
  DEFAULT_ALLOWED_USERNAMES,
  DEFAULT_AI_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_REPORT_BAN_THRESHOLD,
  DEFAULT_AI_CACHE_CONFIG,
  buildConfig,
  validateConfig,
  getConfigIssues,
  getRuntimeConfig,
  getAiConfig,
  getAiCacheConfig,
  getInviteConfig,
  getModerationConfig,
  normalizeUsername,
  resolveAiCacheConfig,
  resolveAllowedUsernames,
};
