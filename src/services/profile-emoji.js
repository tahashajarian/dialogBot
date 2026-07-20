const User = require("../models/user");
const { getReservedProfileEmojis } = require("./bot-appearance");
const { starEconomy } = require("./star-settings");
const { spendStars } = require("./stars");

const PROFILE_EMOJI_CATALOG = Object.freeze([
  "🎬", "🎭", "🎨", "🎧", "🎤", "🎹", "🎸", "🥁",
  "🎻", "🎷", "🎺", "🪕", "🎼", "🎵", "🎶", "🪩",
  "📚", "📖", "✍️", "🖋️", "📝", "📰", "📜", "🔖",
  "📷", "🎥", "🎞️", "📺", "📻", "🎙️", "🎚️", "🎛️",
  "🧠", "💡", "🔭", "🔬", "🧪", "💻", "⌨️", "🧮",
  "🧩", "♟️", "🎲", "🎯", "🧭", "🗿", "🏛️", "⚖️",
  "🌌", "🌙", "☀️", "⭐", "⚡", "🔥", "🌊", "⛰️",
  "🌿", "🌱", "🌻", "🌺", "🌵", "🍀", "🍂", "❄️",
  "☕", "🫖", "🍰", "🍜", "🍣", "🍕", "🥐", "🍳",
  "✈️", "🗺️", "🏕️", "🚲", "🛼", "🛹", "🚶", "🧗",
  "🏃", "🏋️", "🏊", "🧘", "⚽", "🏀", "🎾", "🏐",
  "🏓", "🥊", "🎮", "🕹️", "🪄", "🔮", "💎", "🌈",
  "💫", "✨", "💪", "💼", "🚀", "📈", "🛠️", "🧰",
  "🗣️", "👑", "🕶️", "🎒", "🧵", "🪴", "🧿", "🫶",
  "💛", "💙", "💚", "💜", "🤍", "🖤", "🤎", "❤️",
]);

function getProfileEmojiOptions() {
  const reserved = getReservedProfileEmojis();
  return PROFILE_EMOJI_CATALOG.filter((emoji) => !reserved.has(emoji));
}

function getProfileEmojiCost() {
  return Number(starEconomy.profileEmojiCost) || 0;
}

function isProfileEmojiUnlocked(user = {}) {
  return Boolean(user?.profileEmojiUnlockedAt || String(user?.profileEmoji || "").trim());
}

function getProfileEmojiSelectionCost(user = {}) {
  return isProfileEmojiUnlocked(user) ? 0 : getProfileEmojiCost();
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

  const normalizedUserId = Number(userId);
  const wallet = await User.findOne({ userId: normalizedUserId })
    .select("starBalance profileEmoji profileEmojiUnlockedAt profileEmojiUnlockPendingNonce")
    .lean();
  if (!wallet) return { ok: false, reason: "missing_user" };
  if (wallet.profileEmoji === emoji) {
    return {
      ok: true,
      unchanged: true,
      unlocked: isProfileEmojiUnlocked(wallet),
      balance: Number(wallet.starBalance) || 0,
    };
  }

  if (isProfileEmojiUnlocked(wallet)) {
    const unlockedAt = wallet.profileEmojiUnlockedAt || new Date();
    await User.findOneAndUpdate(
      { userId: normalizedUserId },
      {
        $set: { profileEmoji: emoji, profileEmojiUnlockedAt: unlockedAt },
        $unset: { profileEmojiUnlockPendingNonce: "" },
      },
    );
    return {
      ok: true,
      emoji,
      cost: 0,
      charged: false,
      unlocked: true,
      balance: Number(wallet.starBalance) || 0,
    };
  }

  const cost = getProfileEmojiCost();
  let availableBalance = Number(wallet.starBalance) || 0;
  let unlockNonce = String(wallet.profileEmojiUnlockPendingNonce || "").trim();
  if (!unlockNonce) {
    const claimed = await User.findOneAndUpdate(
      {
        userId: normalizedUserId,
        profileEmoji: "",
        profileEmojiUnlockedAt: null,
        profileEmojiUnlockPendingNonce: { $in: ["", null] },
      },
      { $set: { profileEmojiUnlockPendingNonce: String(nonce || "") } },
      { returnDocument: "after" },
    );
    if (claimed) {
      unlockNonce = String(claimed.profileEmojiUnlockPendingNonce || nonce || "");
    } else {
      const latest = await User.findOne({ userId: normalizedUserId })
        .select("starBalance profileEmoji profileEmojiUnlockedAt profileEmojiUnlockPendingNonce")
        .lean();
      if (!latest) return { ok: false, reason: "missing_user" };
      availableBalance = Number(latest.starBalance) || 0;
      if (isProfileEmojiUnlocked(latest)) {
        await User.findOneAndUpdate(
          { userId: normalizedUserId },
          { $set: { profileEmoji: emoji, profileEmojiUnlockedAt: latest.profileEmojiUnlockedAt || new Date() } },
        );
        return {
          ok: true,
          emoji,
          cost: 0,
          charged: false,
          unlocked: true,
          balance: Number(latest.starBalance) || 0,
        };
      }
      unlockNonce = String(latest.profileEmojiUnlockPendingNonce || nonce || "");
    }
  }

  if (!unlockNonce) return { ok: false, reason: "invalid_nonce" };
  if (cost > 0 && availableBalance < cost) {
    await User.findOneAndUpdate(
      { userId: normalizedUserId, profileEmojiUnlockPendingNonce: unlockNonce },
      { $unset: { profileEmojiUnlockPendingNonce: "" } },
    );
    return { ok: false, reason: "insufficient_balance", balance: availableBalance, cost };
  }
  const spend = cost > 0
    ? await spendStars({
      userId: normalizedUserId,
      amount: cost,
      reason: "profile_emoji",
      idempotencyKey: `profile:emoji:unlock:${normalizedUserId}:${unlockNonce}`,
      settingsSnapshot: { profileEmojiCost: cost },
      metadata: { emoji },
    })
    : { ok: true, applied: true, balance: Number(wallet.starBalance) || 0 };

  if (!spend.ok) {
    await User.findOneAndUpdate(
      { userId: normalizedUserId, profileEmojiUnlockPendingNonce: unlockNonce },
      { $unset: { profileEmojiUnlockPendingNonce: "" } },
    );
    return { ok: false, reason: spend.reason, balance: spend.balance, cost };
  }

  await User.findOneAndUpdate(
    { userId: normalizedUserId },
    {
      $set: { profileEmoji: emoji, profileEmojiUnlockedAt: new Date() },
      $unset: { profileEmojiUnlockPendingNonce: "" },
    },
  );
  return {
    ok: true,
    emoji,
    cost,
    charged: cost > 0,
    unlocked: true,
    balance: Number(spend.balance) || 0,
    spend,
  };
}

module.exports = {
  PROFILE_EMOJI_CATALOG,
  getProfileEmojiOptions,
  getProfileEmojiCost,
  getProfileEmojiSelectionCost,
  getProfileEmojiIndex,
  getProfileEmojiOption,
  isProfileEmojiUnlocked,
  setProfileEmojiWithStars,
};
