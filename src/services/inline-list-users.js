const User = require("../models/user");

const INLINE_USER_CACHE_TTL_MS = 30 * 1000;
const INLINE_USER_CACHE_LIMIT = 5000;
const inlineUserCache = new Map();

function rememberInlineUser(userId, user, nowMs) {
  inlineUserCache.delete(userId);
  inlineUserCache.set(userId, {
    user,
    expiresAt: nowMs + INLINE_USER_CACHE_TTL_MS,
  });
  if (inlineUserCache.size > INLINE_USER_CACHE_LIMIT) {
    inlineUserCache.delete(inlineUserCache.keys().next().value);
  }
}

async function getInlineListUser(userId, {
  force = false,
  now = Date.now(),
} = {}) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) return null;
  const cached = inlineUserCache.get(normalizedUserId);
  if (!force && cached && cached.expiresAt > now) return cached.user;

  const user = await User.findOne({ userId: normalizedUserId })
    .select("userId lang bannedAt")
    .lean();
  rememberInlineUser(normalizedUserId, user || null, now);
  return user || null;
}

function forgetInlineListUser(userId) {
  inlineUserCache.delete(Number(userId));
}

module.exports = {
  forgetInlineListUser,
  getInlineListUser,
};
