const test = require("node:test");
const assert = require("node:assert/strict");

const { MONGO_CONNECTION_OPTIONS } = require("../src/db");
const { getDatabaseHealth, stateLabel } = require("../src/services/database-health");
const {
  createOutageNoticeGuard,
  isDatabaseReady,
  isTransientDatabaseError,
  retryWithJitter,
  sendTemporaryUnavailableNotice,
  withTimeout,
} = require("../src/services/runtime-resilience");
const messages = require("../src/messages");

test("MongoDB runtime options bound selection, sockets, queues, and pool size", () => {
  assert.deepEqual(MONGO_CONNECTION_OPTIONS, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 20000,
    waitQueueTimeoutMS: 2500,
    maxPoolSize: 20,
    minPoolSize: 2,
    heartbeatFrequencyMS: 10000,
  });
});

test("database readiness and health expose useful lifecycle states", () => {
  const connection = { readyState: 2, name: "bot", host: "mongo.internal" };
  assert.equal(isDatabaseReady(connection), false);
  assert.equal(stateLabel(2), "connecting");
  assert.deepEqual(getDatabaseHealth(connection), {
    connected: false,
    ready: false,
    readyState: 2,
    state: "connecting",
    name: "bot",
    host: "mongo.internal",
    lastChangedAt: getDatabaseHealth(connection).lastChangedAt,
    lastError: "",
  });
});

test("transient database failures are distinguished from application bugs", () => {
  assert.equal(isTransientDatabaseError({ name: "MongoServerSelectionError" }), true);
  assert.equal(isTransientDatabaseError(new Error("connection pool was cleared")), true);
  assert.equal(isTransientDatabaseError(new TypeError("bad application value")), false);
});

test("outage message reply preserves state and sends no reply keyboard markup", async () => {
  const user = { userId: 10, lang: "en", state: "profile:edit_bio", navigationMode: "profile" };
  const before = { ...user };
  const calls = [];
  const sent = await sendTemporaryUnavailableNotice({
    from: { id: 10, language_code: "en" },
    reply: async (...args) => calls.push(args),
  }, {
    user,
    messages,
    claim: () => true,
  });

  assert.equal(sent, true);
  assert.deepEqual(user, before);
  assert.deepEqual(calls, [[messages.en.serviceTemporarilyUnavailable]]);
});

test("callback outage uses an alert without editing cards or keyboards", async () => {
  const calls = [];
  const ctx = {
    callbackQuery: { from: { id: 11 } },
    answerCbQuery: async (...args) => calls.push(["answer", ...args]),
    reply: async (...args) => calls.push(["reply", ...args]),
  };

  await sendTemporaryUnavailableNotice(ctx, {
    user: { userId: 11, lang: "fa", state: "idle" },
    messages,
    claim: () => true,
  });

  assert.deepEqual(calls, [[
    "answer",
    messages.fa.serviceTemporarilyUnavailable,
    { show_alert: true },
  ]]);
});

test("outage notices are throttled per user without blocking other users", () => {
  let now = 100_000;
  const guard = createOutageNoticeGuard({ cooldownMs: 30_000, now: () => now });
  assert.equal(guard.claim(1), true);
  assert.equal(guard.claim(1), false);
  assert.equal(guard.claim(2), true);
  now += 30_000;
  assert.equal(guard.claim(1), true);
});

test("startup retry adds bounded jitter and reports the next delay", async () => {
  const delays = [];
  const reports = [];
  let attempts = 0;
  const result = await retryWithJitter(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("temporary");
    return "ready";
  }, {
    attempts: 3,
    delayMs: 100,
    jitterMs: 50,
    random: () => 0.5,
    wait: async (ms) => delays.push(ms),
    onRetry: (_error, attempt, maxAttempts, nextDelayMs) => {
      reports.push({ attempt, maxAttempts, nextDelayMs });
    },
  });

  assert.equal(result, "ready");
  assert.deepEqual(delays, [125, 225]);
  assert.deepEqual(reports, [
    { attempt: 1, maxAttempts: 3, nextDelayMs: 125 },
    { attempt: 2, maxAttempts: 3, nextDelayMs: 225 },
  ]);
});

test("shutdown timeout rejects stalled work without waiting indefinitely", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, "shutdown work"),
    /shutdown work timed out after 5ms/,
  );
});
