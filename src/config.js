const { URL } = require("url");

const DEFAULT_ALLOWED_USERNAMES = [];
const DEFAULT_AI_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_AI_TIMEOUT_MS = 20000;
const DEFAULT_AI_SUGGESTION_PROVIDER = "auto";
const DEFAULT_REPORT_BAN_THRESHOLD = 5;
const MIN_PRODUCTION_SECRET_LENGTH = 32;

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

function normalizeAiSuggestionProvider(value) {
  const normalized = clean(value).toLowerCase();
  return normalized || DEFAULT_AI_SUGGESTION_PROVIDER;
}

function enabledByEnv(value) {
  return ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());
}

function looksLikeBotApiRoot(value) {
  const normalized = clean(value).toLowerCase();
  return (
    !normalized ||
    normalized.includes("api.telegram.org") ||
    normalized.includes("telegram") ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("bale") ||
    normalized.includes("tapi") ||
    normalized.includes("ble.ir")
  );
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

function isProductionEnvironment(value) {
  return clean(value).toLowerCase() === "production";
}

function isSecureOrLoopbackUrl(value) {
  const normalized = clean(value);
  if (!normalized) return true;
  try {
    const url = new URL(normalized);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1";
  } catch {
    return false;
  }
}

function normalizeComparableUrl(value) {
  const normalized = clean(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return normalized.replace(/\/+$/, "").toLowerCase();
  }
}

function resolveAccountDeletionSecret(env = process.env) {
  const explicitSecret = clean(env.ACCOUNT_DELETION_SECRET);
  if (explicitSecret) return explicitSecret;
  if (!isProductionEnvironment(env.NODE_ENV)) return clean(env.BOT_TOKEN);
  return "";
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
  if (requireRuntime && config.production) {
    if (!config.accountDeletionSecret) {
      issues.push("ACCOUNT_DELETION_SECRET is required in production and must not fall back to BOT_TOKEN.");
    } else if (config.accountDeletionSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      issues.push(`ACCOUNT_DELETION_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production.`);
    }
    if (config.accountDeletionSecret && config.accountDeletionSecret === config.botToken) {
      issues.push("ACCOUNT_DELETION_SECRET must be independent from BOT_TOKEN in production.");
    }
    if (config.aiApiKey && config.accountDeletionSecret === config.aiApiKey) {
      issues.push("ACCOUNT_DELETION_SECRET must be independent from the AI API key in production.");
    }
    if (config.botApiRoot && !isSecureOrLoopbackUrl(config.botApiRoot)) {
      issues.push("API_ROOT must use HTTPS in production unless it points to localhost.");
    }
    if (config.aiBaseUrl && !isSecureOrLoopbackUrl(config.aiBaseUrl)) {
      issues.push("API_BASE_URL must use HTTPS in production unless it points to localhost.");
    }
  }
  if (config.botApiRoot && !/^https?:\/\//i.test(config.botApiRoot)) {
    issues.push("API_ROOT must be an http(s) bot platform API root URL.");
  }
  if (config.aiBaseUrl && !/^https?:\/\//i.test(config.aiBaseUrl)) {
    issues.push("API_BASE_URL must be an http(s) AI endpoint base URL.");
  }
  if (config.telegramProxyUrl && !/^https?:\/\//i.test(config.telegramProxyUrl)) {
    issues.push("TELEGRAM_PROXY_URL must be an http(s) proxy URL.");
  }
  if (config.botApiRoot && !looksLikeBotApiRoot(config.botApiRoot)) {
    issues.push("API_ROOT appears not to be a bot platform API root. Use API_BASE_URL for AI endpoints.");
  }
  if (config.aiBaseUrl && !looksLikeAiApiBaseUrl(config.aiBaseUrl)) {
    issues.push("API_BASE_URL appears not to be an AI endpoint. Use API_ROOT only for a bot platform API root.");
  }
  if (
    config.botApiRoot
    && config.aiBaseUrl
    && normalizeComparableUrl(config.botApiRoot) === normalizeComparableUrl(config.aiBaseUrl)
  ) {
    issues.push("API_ROOT and API_BASE_URL must not point to the same URL.");
  }
  if (!Number.isFinite(config.aiTimeoutMs) || config.aiTimeoutMs <= 0) {
    issues.push("AI_TIMEOUT_MS must be a positive number when set.");
  }
  if (!["auto", "chat", "responses"].includes(config.aiSuggestionProvider)) {
    issues.push("AI_SUGGESTION_PROVIDER must be one of: auto, chat, responses.");
  }
  if (!Number.isInteger(config.moderation.reportBanThreshold) || config.moderation.reportBanThreshold <= 0) {
    issues.push("REPORT_BAN_THRESHOLD must be a positive integer when set.");
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
    production: isProductionEnvironment(env.NODE_ENV),
    botToken: clean(env.BOT_TOKEN),
    mongoUri: clean(env.MONGO_URI),
    dbName: clean(env.MONGO_DB_NAME) || "bot",
    botApiRoot: clean(env.API_ROOT) || null,
    telegramProxyUrl: clean(env.TELEGRAM_PROXY_URL) || null,
    allowedUsernames: resolveAllowedUsernames(env),
    aiApiKey: clean(env.OPENAI_API_KEY || env.API_KEY),
    aiBaseUrl: clean(env.API_BASE_URL || env.api_base_url) || null,
    aiModel: clean(env.OPENAI_MODEL || env.MODEL_NAME) || DEFAULT_AI_MODEL,
    embeddingModel: clean(env.EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL,
    aiSuggestionProvider: normalizeAiSuggestionProvider(env.AI_SUGGESTION_PROVIDER),
    aiTimeoutMs,
    accountDeletionSecret: clean(env.ACCOUNT_DELETION_SECRET),
    moderation: {
      reportBanThreshold,
    },
    discussionOwnerJoinNotices: {
      enabled: enabledByEnv(env.DISCUSSION_OWNER_JOIN_NOTICES_ENABLED),
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
    suggestionProvider: config.aiSuggestionProvider,
    timeoutMs: config.aiTimeoutMs,
  };
}

function getInviteConfig(env = process.env) {
  return buildConfig(env).invite;
}

function getModerationConfig(env = process.env) {
  return validateConfig(buildConfig(env), { requireRuntime: false }).moderation;
}

function getDiscussionOwnerJoinNoticeConfig(env = process.env) {
  return buildConfig(env).discussionOwnerJoinNotices;
}

module.exports = {
  DEFAULT_ALLOWED_USERNAMES,
  DEFAULT_AI_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_AI_SUGGESTION_PROVIDER,
  DEFAULT_REPORT_BAN_THRESHOLD,
  MIN_PRODUCTION_SECRET_LENGTH,
  buildConfig,
  validateConfig,
  getConfigIssues,
  getRuntimeConfig,
  getAiConfig,
  getInviteConfig,
  getModerationConfig,
  getDiscussionOwnerJoinNoticeConfig,
  normalizeUsername,
  isProductionEnvironment,
  isSecureOrLoopbackUrl,
  normalizeComparableUrl,
  resolveAccountDeletionSecret,
  resolveAllowedUsernames,
};
