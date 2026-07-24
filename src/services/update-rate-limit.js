const GENERAL_UPDATE_LIMIT = 30;
const GENERAL_UPDATE_WINDOW_MS = 10 * 1000;
const PROFILE_LOOKUP_LIMIT = 6;
const PROFILE_LOOKUP_WINDOW_MS = 60 * 1000;
const ENTRY_MAX_AGE_MS = 5 * 60 * 1000;

function createSlidingWindowRateLimiter({
  limit,
  windowMs,
  maxEntryAgeMs = ENTRY_MAX_AGE_MS,
} = {}) {
  const safeLimit = Math.max(1, Math.floor(Number(limit)) || 1);
  const safeWindowMs = Math.max(1, Math.floor(Number(windowMs)) || 1);
  const entries = new Map();

  function cleanup(now) {
    if (entries.size <= 10_000) return;
    for (const [key, entry] of entries) {
      if (now - entry.updatedAt >= maxEntryAgeMs) entries.delete(key);
    }
  }

  function check(key, now = Date.now()) {
    const normalizedKey = String(key || "");
    if (!normalizedKey) return { allowed: true, retryAfterMs: 0 };
    cleanup(now);
    const cutoff = now - safeWindowMs;
    const previous = entries.get(normalizedKey);
    const timestamps = (previous?.timestamps || []).filter((timestamp) => timestamp > cutoff);
    if (timestamps.length >= safeLimit) {
      entries.set(normalizedKey, { timestamps, updatedAt: now });
      return {
        allowed: false,
        retryAfterMs: Math.max(1, timestamps[0] + safeWindowMs - now),
      };
    }
    timestamps.push(now);
    entries.set(normalizedKey, { timestamps, updatedAt: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  return { check };
}

function isDirectProfileCodeLookup(text = "") {
  return /^\/u_[a-z0-9]+$/i.test(String(text || "").trim());
}

function createUpdateRateLimits({
  generalLimit = GENERAL_UPDATE_LIMIT,
  generalWindowMs = GENERAL_UPDATE_WINDOW_MS,
  profileLookupLimit = PROFILE_LOOKUP_LIMIT,
  profileLookupWindowMs = PROFILE_LOOKUP_WINDOW_MS,
} = {}) {
  const general = createSlidingWindowRateLimiter({
    limit: generalLimit,
    windowMs: generalWindowMs,
  });
  const profileLookup = createSlidingWindowRateLimiter({
    limit: profileLookupLimit,
    windowMs: profileLookupWindowMs,
  });

  function check({ userId, text = "", now = Date.now() } = {}) {
    const generalResult = general.check(userId, now);
    if (!generalResult.allowed) return { ...generalResult, reason: "update_rate_limit" };
    if (!isDirectProfileCodeLookup(text)) return { allowed: true, retryAfterMs: 0 };
    const profileResult = profileLookup.check(userId, now);
    if (!profileResult.allowed) return { ...profileResult, reason: "profile_lookup_rate_limit" };
    return { allowed: true, retryAfterMs: 0 };
  }

  return { check };
}

module.exports = {
  GENERAL_UPDATE_LIMIT,
  GENERAL_UPDATE_WINDOW_MS,
  PROFILE_LOOKUP_LIMIT,
  PROFILE_LOOKUP_WINDOW_MS,
  createSlidingWindowRateLimiter,
  createUpdateRateLimits,
  isDirectProfileCodeLookup,
};
