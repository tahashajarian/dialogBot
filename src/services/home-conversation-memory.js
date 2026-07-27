const MAX_TURNS = 4;
const MAX_TEXT_LENGTH = 360;
const TTL_MS = 30 * 60 * 1000;
const MAX_USER_ENTRIES = 5000;
const SWEEP_INTERVAL = 100;
const conversations = new Map();
let operationsSinceSweep = 0;

function keyFor(userId) { return String(userId ?? ""); }

function sweepExpired(now = Date.now()) {
  for (const [key, entry] of conversations) {
    if (!entry || now - entry.updatedAt > TTL_MS) conversations.delete(key);
  }
}

function evictOldest() {
  while (conversations.size > MAX_USER_ENTRIES) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [key, entry] of conversations) {
      const updatedAt = Number(entry?.updatedAt) || 0;
      if (updatedAt < oldestAt) {
        oldestAt = updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey === null) break;
    conversations.delete(oldestKey);
  }
}

function maintain(now = Date.now()) {
  operationsSinceSweep += 1;
  if (operationsSinceSweep >= SWEEP_INTERVAL) {
    operationsSinceSweep = 0;
    sweepExpired(now);
  }
  evictOldest();
}

function getHomeConversationHistory(userId, now = Date.now()) {
  maintain(now);
  const key = keyFor(userId);
  const entry = conversations.get(key);
  if (!entry || now - entry.updatedAt > TTL_MS) {
    conversations.delete(key);
    return [];
  }
  return entry.turns.map((turn) => ({ ...turn }));
}

function rememberHomeConversationTurn(userId, userText, assistantText, now = Date.now()) {
  const key = keyFor(userId);
  if (!key) return;
  const turns = [
    ...getHomeConversationHistory(userId, now),
    { role: "user", text: String(userText || "").trim().slice(0, MAX_TEXT_LENGTH) },
    { role: "assistant", text: String(assistantText || "").trim().slice(0, MAX_TEXT_LENGTH) },
  ].filter((turn) => turn.text).slice(-MAX_TURNS);
  conversations.set(key, { updatedAt: now, turns });
  maintain(now);
}

function clearHomeConversationHistory(userId) { conversations.delete(keyFor(userId)); }

module.exports = {
  MAX_TURNS,
  MAX_TEXT_LENGTH,
  TTL_MS,
  MAX_USER_ENTRIES,
  SWEEP_INTERVAL,
  getHomeConversationHistory,
  rememberHomeConversationTurn,
  clearHomeConversationHistory,
  sweepExpired,
};
