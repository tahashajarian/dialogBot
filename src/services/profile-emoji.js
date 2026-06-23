const User = require("../models/user");
const { getReservedProfileEmojis } = require("./bot-appearance");
const { starEconomy } = require("./star-settings");
const { spendStars } = require("./stars");

const PROFILE_EMOJI_CATALOG = Object.freeze([
  "🌙", "✨", "🌿", "🔥", "🎧", "🎮",
  "📚", "🎬", "☕", "🧠", "🎨", "🏃",
  "🧘", "💻", "🪐", "🎭",
  "💫", "🌞", "🌻", "🍀", "🌊", "⛰️",
  "🕊️", "🦋", "🐚", "🍄", "🍒", "🍓",
  "🍉", "🍯", "🫖", "🍰", "🎹", "🎸",
  "🎲", "♟️", "🧩", "🪄", "🔮", "💎",
  "🧭", "🗺️", "📷", "✏️", "🖋️", "🧵",
  "🪴", "🛼", "🚲", "🏕️", "🌌", "🌅",
  "🌈", "☁️", "⚡", "🪩", "🎀", "🪬",
  "🧿", "🕯️", "🧸", "🛸", "🧬", "🧪",
  "🔭", "🎐", "🪁", "🧺", "🏛️", "🗿",
]);

function getProfileEmojiOptions() {
  const reserved = getReservedProfileEmojis();
  return PROFILE_EMOJI_CATALOG.filter((emoji) => !reserved.has(emoji));
}

function getProfileEmojiCost() {
  return Number(starEconomy.profileEmojiCost) || 0;
}

function getProfileEmojiOption(index) {
  const normalized = Number(index);
  if (!Number.isInteger(normalized) || normalized < 0) return "";
  return getProfileEmojiOptions()[normalized] || "";
}

function getProfileEmojiIndex(emoji) {
  return getProfileEmojiOptions().indexOf(String(emoji || "").trim());
}

async function setProfileEmojiWithStars({ userId, emoji, nonce }) {
  if (!getProfileEmojiOptions().includes(emoji)) {
    return { ok: false, reason: "invalid_emoji" };
  }

  const cost = getProfileEmojiCost();
  const wallet = await User.findOne({ userId: Number(userId) }).select("starBalance profileEmoji").lean();
  if (!wallet) return { ok: false, reason: "missing_user" };
  if (wallet.profileEmoji === emoji) {
    return { ok: true, unchanged: true, balance: Number(wallet.starBalance) || 0 };
  }
  if (cost > 0 && Number(wallet.starBalance || 0) < cost) {
    return { ok: false, reason: "insufficient_balance", balance: Number(wallet.starBalance) || 0, cost };
  }

  const spend = cost > 0
    ? await spendStars({
      userId,
      amount: cost,
      reason: "profile_emoji",
      idempotencyKey: `profile:emoji:${userId}:${nonce}`,
      settingsSnapshot: { profileEmojiCost: cost },
      metadata: { emoji },
    })
    : { ok: true, applied: true, balance: Number(wallet.starBalance) || 0 };

  if (!spend.ok) {
    return { ok: false, reason: spend.reason, balance: spend.balance, cost };
  }

  await User.findOneAndUpdate(
    { userId: Number(userId) },
    { $set: { profileEmoji: emoji } },
  );
  return { ok: true, emoji, cost, balance: Number(spend.balance) || 0, spend };
}

module.exports = {
  PROFILE_EMOJI_CATALOG,
  getProfileEmojiOptions,
  getProfileEmojiCost,
  getProfileEmojiIndex,
  getProfileEmojiOption,
  setProfileEmojiWithStars,
};
