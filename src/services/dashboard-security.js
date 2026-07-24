const crypto = require("crypto");

const SESSION_COOKIE = "muze_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function sign(value, token, purpose) {
  return crypto.createHmac("sha256", String(token))
    .update(`muze-dashboard:${purpose}:${value}`)
    .digest("base64url");
}

function timingSafeMatch(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSession(token, { now = Date.now(), randomBytes = crypto.randomBytes } = {}) {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    nonce: randomBytes(18).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${sign(payload, token, "session")}`;
}

function verifySession(value, token, { now = Date.now() } = {}) {
  const [payload, signature, extra] = String(value || "").split(".");
  if (!payload || !signature || extra || !timingSafeMatch(signature, sign(payload, token, "session"))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isFinite(parsed.exp) || parsed.exp <= Math.floor(now / 1000)) return null;
    if (!/^[A-Za-z0-9_-]{16,}$/.test(String(parsed.nonce || ""))) return null;
    return { payload, ...parsed };
  } catch {
    return null;
  }
}

function createCsrfToken(session, token) {
  return sign(session.payload, token, "csrf");
}

function verifyCsrfToken(value, session, token) {
  return Boolean(session) && timingSafeMatch(value, createCsrfToken(session, token));
}

function parseCookies(header = "") {
  return Object.fromEntries(String(header).split(";").flatMap((entry) => {
    const separator = entry.indexOf("=");
    if (separator < 1) return [];
    return [[entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()]];
  }));
}

function getSessionFromRequest(req, token, options) {
  return verifySession(parseCookies(req?.headers?.cookie)[SESSION_COOKIE], token, options);
}

function isSecureRequest(req) {
  if (req?.socket?.encrypted) return true;
  return String(req?.headers?.["x-forwarded-proto"] || "").split(",", 1)[0].trim().toLowerCase() === "https";
}

function buildSessionCookie(value, { secure = false, maxAge = SESSION_TTL_SECONDS } = {}) {
  const attributes = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Number(maxAge) || 0)}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function isApiAuthorized(req, expectedToken) {
  const auth = String(req?.headers?.authorization || "");
  const supplied = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return Boolean(expectedToken) && timingSafeMatch(supplied, expectedToken);
}

function createLoginAttemptLimiter({ limit = 8, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const attempts = new Map();
  return {
    check(key) {
      const id = String(key || "unknown");
      const timestamp = now();
      const current = attempts.get(id);
      if (!current || current.resetAt <= timestamp) {
        attempts.set(id, { count: 1, resetAt: timestamp + windowMs });
        return { allowed: true };
      }
      current.count += 1;
      return {
        allowed: current.count <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000)),
      };
    },
    clear(key) {
      attempts.delete(String(key || "unknown"));
    },
  };
}

module.exports = {
  SESSION_TTL_SECONDS,
  buildSessionCookie,
  createCsrfToken,
  createLoginAttemptLimiter,
  createSession,
  getSessionFromRequest,
  isApiAuthorized,
  isSecureRequest,
  parseCookies,
  timingSafeMatch,
  verifyCsrfToken,
  verifySession,
};
