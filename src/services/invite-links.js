const { getInviteConfig } = require("../config");

function normalizeBotUsername(value = "") {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/gi, "");
}

function normalizePublicUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveBotUsername(ctx = null, env = process.env) {
  return normalizeBotUsername(
    ctx?.botInfo?.username
    || getInviteConfig(env).username
    || "",
  );
}

function getConfiguredBotBaseUrl(env = process.env) {
  const inviteConfig = getInviteConfig(env);
  const configuredUrl = normalizePublicUrl(
    inviteConfig.deepLinkBaseUrl ||
    inviteConfig.publicUrl ||
    "",
  );
  if (configuredUrl) {
    if (/^https?:\/\//i.test(configuredUrl)) return configuredUrl;
    const configuredUsername = normalizeBotUsername(configuredUrl);
    if (configuredUsername) return `https://ble.ir/@${configuredUsername}`;
  }

  const username = normalizeBotUsername(inviteConfig.username || "");
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

function buildBotBaseLink(env = process.env) {
  const baseUrl = getConfiguredBotBaseUrl(env);
  if (!baseUrl) return "";
  return normalizePublicUrl(baseUrl.replace("{payload}", ""));
}

module.exports = {
  normalizeBotUsername,
  resolveBotUsername,
  buildBotBaseLink,
  buildBotStartLink,
};
