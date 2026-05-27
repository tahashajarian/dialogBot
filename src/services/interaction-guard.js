const activeInteractions = new Map();
const DEFAULT_COOLDOWN_MS = 1200;
const MAX_KEY_AGE_MS = 5 * 60 * 1000;

function normalizeInteractionText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function buildInteractionKey({ userId, callbackData, text, state }) {
  const userKey = String(userId || "");
  if (!userKey) {
    return "";
  }

  if (callbackData) {
    return `${userKey}:cb:${callbackData}`;
  }

  const normalizedText = normalizeInteractionText(text);
  if (!normalizedText) {
    return "";
  }

  return `${userKey}:msg:${state || "idle"}:${normalizedText}`;
}

function cleanupOldInteractions(now = Date.now()) {
  for (const [key, entry] of activeInteractions.entries()) {
    if (now - entry.updatedAt > MAX_KEY_AGE_MS) {
      activeInteractions.delete(key);
    }
  }
}

function beginInteraction(input, options = {}) {
  const now = Date.now();
  const cooldownMs = Number(options.cooldownMs) || DEFAULT_COOLDOWN_MS;
  const key = buildInteractionKey(input);

  if (!key) {
    return { allowed: true, finish: () => {} };
  }

  cleanupOldInteractions(now);

  const current = activeInteractions.get(key);
  if (current?.inFlight || (current?.cooldownUntil && current.cooldownUntil > now)) {
    return { allowed: false, finish: () => {} };
  }

  activeInteractions.set(key, {
    inFlight: true,
    cooldownUntil: 0,
    updatedAt: now,
  });

  return {
    allowed: true,
    finish: () => {
      activeInteractions.set(key, {
        inFlight: false,
        cooldownUntil: Date.now() + cooldownMs,
        updatedAt: Date.now(),
      });
    },
  };
}

module.exports = {
  beginInteraction,
  buildInteractionKey,
};
