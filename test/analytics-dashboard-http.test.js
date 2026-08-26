const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("stream");
const { URLSearchParams } = require("url");

const { handleRequest } = require("../scripts/analytics-dashboard");
const {
  createCsrfToken,
  createLoginAttemptLimiter,
  getSessionFromRequest,
} = require("../src/services/dashboard-security");

const TOKEN = "test-dashboard-token-with-enough-entropy";

function request(path, {
  method = "GET",
  headers = {},
  body = "",
  handlerOptions = {},
} = {}) {
  const req = Readable.from(body ? [body] : []);
  req.url = path;
  req.method = method;
  req.headers = headers;
  req.socket = { remoteAddress: "127.0.0.1" };

  return new Promise((resolve, reject) => {
    const responseHeaders = {};
    const chunks = [];
    const res = {
      setHeader(name, value) {
        responseHeaders[String(name).toLowerCase()] = value;
      },
      writeHead(statusCode, values = {}) {
        this.statusCode = statusCode;
        for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
      },
      end(chunk = "") {
        if (chunk) chunks.push(Buffer.from(String(chunk)));
        resolve({
          statusCode: this.statusCode || 200,
          headers: responseHeaders,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      },
    };
    handleRequest(req, res, {
      token: TOKEN,
      sessionSecret: TOKEN,
      localMode: false,
      requireSecure: false,
      loginLimiter: createLoginAttemptLimiter(),
      ...handlerOptions,
    }).catch(reject);
  });
}

test("dashboard login page uses hardened response headers", async () => {
  const response = await request("/login");

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(response.body, /type="password"/);
});

test("dashboard no longer accepts a token in the URL", async () => {
  const response = await request(`/?token=${encodeURIComponent(TOKEN)}`);

  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, "/login");
});

test("dashboard login creates an HTTP-only session cookie", async () => {
  const response = await request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `token=${encodeURIComponent(TOKEN)}`,
  });

  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, "/");
  assert.match(response.headers["set-cookie"], /^muze_admin_session=/);
  assert.match(response.headers["set-cookie"], /HttpOnly/);
  assert.match(response.headers["set-cookie"], /SameSite=Strict/);
  assert.equal(response.headers["set-cookie"].includes(TOKEN), false);
});

test("dashboard mutations reject a missing CSRF token before changing settings", async () => {
  const login = await request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `token=${encodeURIComponent(TOKEN)}`,
  });
  const cookie = login.headers["set-cookie"].split(";", 1)[0];
  const response = await request("/limits", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "discussionCapacity=20",
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body, "Invalid CSRF token.");
});

test("dashboard unban requires explicit confirmation and calls the audited service", async () => {
  const login = await request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `token=${encodeURIComponent(TOKEN)}`,
  });
  const cookie = login.headers["set-cookie"].split(";", 1)[0];
  const session = getSessionFromRequest({ headers: { cookie } }, TOKEN);
  const csrf = createCsrfToken(session, TOKEN);
  let requestValue;
  const response = await request("/moderation/unban", {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      _csrf: csrf,
      targetUserId: "42",
      reason: "Reviewed false-positive reports",
      confirmation: "UNBAN",
    }).toString(),
    handlerOptions: {
      unban: async (value) => {
        requestValue = value;
        return { ok: true, actionId: "audit-1" };
      },
    },
  });

  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, "/?saved=unbanned");
  assert.equal(requestValue.targetUserId, "42");
  assert.equal(requestValue.actor, "analytics-dashboard");
});

test("remote dashboard requests require HTTPS", async () => {
  const req = Readable.from([]);
  req.url = "/login";
  req.method = "GET";
  req.headers = {};
  req.socket = { remoteAddress: "10.0.0.2" };
  const result = await new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      writeHead(statusCode, values = {}) {
        this.statusCode = statusCode;
        for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
      },
      end(body = "") { resolve({ statusCode: this.statusCode, body: String(body) }); },
    };
    handleRequest(req, res, {
      token: TOKEN,
      sessionSecret: TOKEN,
      localMode: false,
      requireSecure: true,
      loginLimiter: createLoginAttemptLimiter(),
    }).catch(reject);
  });

  assert.equal(result.statusCode, 426);
});
