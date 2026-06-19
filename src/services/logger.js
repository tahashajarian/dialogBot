const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function normalizeLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, level) ? level : "info";
}

function getConfiguredLevel(env = process.env) {
  return normalizeLevel(env.LOG_LEVEL || (env.NODE_ENV === "test" ? "warn" : "info"));
}

function isEnabled(level, currentLevel = getConfiguredLevel()) {
  return LEVEL_PRIORITY[normalizeLevel(level)] >= LEVEL_PRIORITY[normalizeLevel(currentLevel)];
}

function serializeError(error) {
  if (!error || typeof error !== "object") return error;
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    stack: error.stack,
  };
}

function normalizeDetails(details) {
  if (details instanceof Error) return serializeError(details);
  if (Array.isArray(details)) return details.map(normalizeDetails);
  if (!details || typeof details !== "object") return details;

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      value instanceof Error ? serializeError(value) : value,
    ]),
  );
}

function write(level, message, details) {
  if (!isEnabled(level)) return;
  const payload = {
    level,
    time: new Date().toISOString(),
    message: String(message || ""),
  };
  if (details !== undefined) {
    payload.details = normalizeDetails(details);
  }

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

const logger = {
  debug: (message, details) => write("debug", message, details),
  info: (message, details) => write("info", message, details),
  log: (message, details) => write("info", message, details),
  warn: (message, details) => write("warn", message, details),
  error: (message, details) => write("error", message, details),
};

module.exports = {
  logger,
  normalizeLevel,
  isEnabled,
  serializeError,
};
