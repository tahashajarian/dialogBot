const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSlidingWindowRateLimiter,
  createUpdateRateLimits,
  isDirectProfileCodeLookup,
} = require("../src/services/update-rate-limit");

test("sliding-window limiter allows normal traffic and reports a bounded retry", () => {
  const limiter = createSlidingWindowRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.check(1, 1000).allowed, true);
  assert.equal(limiter.check(1, 1100).allowed, true);
  assert.deepEqual(limiter.check(1, 1200), { allowed: false, retryAfterMs: 800 });
  assert.equal(limiter.check(2, 1200).allowed, true);
  assert.equal(limiter.check(1, 2001).allowed, true);
});

test("general update bursts are limited independently per user", () => {
  const limits = createUpdateRateLimits({
    generalLimit: 2,
    generalWindowMs: 1000,
    profileLookupLimit: 10,
  });
  assert.equal(limits.check({ userId: 1, text: "Hello", now: 1000 }).allowed, true);
  assert.equal(limits.check({ userId: 1, text: "Next", now: 1100 }).allowed, true);
  assert.equal(
    limits.check({ userId: 1, text: "Again", now: 1200 }).reason,
    "update_rate_limit",
  );
  assert.equal(limits.check({ userId: 2, text: "Hello", now: 1200 }).allowed, true);
});

test("direct profile commands have a stricter scanner limit without affecting internal navigation", () => {
  const limits = createUpdateRateLimits({
    generalLimit: 20,
    profileLookupLimit: 2,
    profileLookupWindowMs: 1000,
  });
  assert.equal(limits.check({ userId: 1, text: "/u_A1", now: 1000 }).allowed, true);
  assert.equal(limits.check({ userId: 1, text: "/u_B2", now: 1100 }).allowed, true);
  assert.equal(
    limits.check({ userId: 1, text: "/u_C3", now: 1200 }).reason,
    "profile_lookup_rate_limit",
  );
  assert.equal(limits.check({ userId: 1, text: "Profile button", now: 1200 }).allowed, true);
});

test("profile lookup detection accepts only exact direct profile commands", () => {
  assert.equal(isDirectProfileCodeLookup("/u_A1B2"), true);
  assert.equal(isDirectProfileCodeLookup("/save_u_A1B2"), false);
  assert.equal(isDirectProfileCodeLookup("/u_A1B2 extra"), false);
});
