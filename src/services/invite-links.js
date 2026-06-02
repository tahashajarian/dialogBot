function normalizeBotUsername(value = "") {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/gi, "");
}

function normalizePublicUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getConfiguredBotBaseUrl(env = process.env) {
  const configuredUrl = normalizePublicUrl(
    env.BOT_DEEP_LINK_BASE_URL ||
    env.BOT_PUBLIC_URL ||
    env.PUBLIC_BOT_URL ||
    "",
  );
  if (configuredUrl) {
    if (/^https?:\/\//i.test(configuredUrl)) return configuredUrl;
    const configuredUsername = normalizeBotUsername(configuredUrl);
    if (configuredUsername) return `https://ble.ir/@${configuredUsername}`;
  }

  const username = normalizeBotUsername(env.BOT_USERNAME || "");
  return username ? `https://ble.ir/@${username}` : "";
}

function buildBotStartLink(payload, env = process.env) {
  const cleanPayload = String(payload || "").trim().replace(/^\/+/, "");
  if (!cleanPayload) return "";

  const encodedPayload = encodeURIComponent(cleanPayload);
  const baseUrl = getConfiguredBotBaseUrl(env);
  if (!baseUrl) return "";

  if (baseUrl.includes("{payload}")) {
    return baseUrl.replace("{payload}", encodedPayload);
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}start=${encodedPayload}`;
}

module.exports = {
  normalizeBotUsername,
  buildBotStartLink,
};
