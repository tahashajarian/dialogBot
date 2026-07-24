const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SESSION_TTL_SECONDS,
  buildSessionCookie,
  createCsrfToken,
  createLoginAttemptLimiter,
  createSession,
  isApiAuthorized,
  parseCookies,
  timingSafeMatch,
  verifyCsrfToken,
  verifySession,
  validateDashboardRuntimeSecurity,
} = require("../src/services/dashboard-security");

const TOKEN = "a-long-test-only-dashboard-token";
const FIXED_RANDOM = () => Buffer.alloc(18, 7);

test("dashboard sessions are signed, expire, and reject tampering", () => {
  const now = 1_800_000_000_000;
  const value = createSession(TOKEN, { now, randomBytes: FIXED_RANDOM });
  const session = verifySession(value, TOKEN, { now });

  assert.equal(session.exp, Math.floor(now / 1000) + SESSION_TTL_SECONDS);
  assert.equal(verifySession(`${value}x`, TOKEN, { now }), null);
  assert.equal(verifySession(value, "wrong-token", { now }), null);
  assert.equal(verifySession(value, TOKEN, { now: now + (SESSION_TTL_SECONDS * 1000) }), null);
});

test("dashboard CSRF tokens are bound to the authenticated session", () => {
  const first = verifySession(createSession(TOKEN, { randomBytes: FIXED_RANDOM }), TOKEN);
  const second = verifySession(createSession(TOKEN), TOKEN);
  const csrf = createCsrfToken(first, TOKEN);

  assert.equal(verifyCsrfToken(csrf, first, TOKEN), true);
  assert.equal(verifyCsrfToken(csrf, second, TOKEN), false);
  assert.equal(verifyCsrfToken(`${csrf}x`, first, TOKEN), false);
});

test("dashboard cookies use strict browser protections", () => {
  const cookie = buildSessionCookie("signed-value", { secure: true });

  assert.match(cookie, /^muze_admin_session=signed-value;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(parseCookies("one=1; muze_admin_session=signed-value").muze_admin_session, "signed-value");
});

test("dashboard bearer authorization does not accept query or custom-header tokens", () => {
  assert.equal(isApiAuthorized({ headers: { authorization: `Bearer ${TOKEN}` } }, TOKEN), true);
  assert.equal(isApiAuthorized({ headers: { "x-dashboard-token": TOKEN } }, TOKEN), false);
  assert.equal(isApiAuthorized({ headers: {} }, TOKEN), false);
});

test("timing-safe token comparison handles unequal lengths without throwing", () => {
  assert.equal(timingSafeMatch(TOKEN, TOKEN), true);
  assert.equal(timingSafeMatch("short", TOKEN), false);
});

test("production dashboard requires a strong token without exposing its value", () => {
  assert.throws(
    () => validateDashboardRuntimeSecurity({
      token: "too-short",
      host: "127.0.0.1",
      nodeEnv: "production",
    }),
    /at least 32 characters/,
  );
  assert.equal(validateDashboardRuntimeSecurity({
    token: "d".repeat(40),
    host: "127.0.0.1",
    nodeEnv: "production",
  }), true);
});

test("dashboard login limiter blocks repeated attempts and resets after its window", () => {
  let now = 1000;
  const limiter = createLoginAttemptLimiter({ limit: 2, windowMs: 5000, now: () => now });

  assert.equal(limiter.check("client").allowed, true);
  assert.equal(limiter.check("client").allowed, true);
  assert.equal(limiter.check("client").allowed, false);
  now += 5000;
  assert.equal(limiter.check("client").allowed, true);
});
