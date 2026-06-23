const crypto = require("crypto");
const PeopleTasteUnlock = require("../models/people-taste-unlock");
const User = require("../models/user");
const { spendStars, refundStars } = require("./stars");
const { starEconomy } = require("./star-settings");
const { findPeopleBySharedTaste } = require("./people-discovery");

const TASTE_UNLOCK_QUOTE_TTL_MS = 10 * 60 * 1000;

function generateTasteUnlockCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

function isTasteMatchesUnlocked(user, { now = new Date() } = {}) {
  const until = user?.tasteMatchUnlockUntil ? new Date(user.tasteMatchUnlockUntil) : null;
  return Boolean(until && until > now);
}

async function hasTasteMatchCandidates(user, options = {}) {
  const result = await findPeopleBySharedTaste(user, { limit: options.limit || 50 });
  return result.ok && (result.items || []).length > 0;
}

function getTasteMatchesAvailability(user, { now = new Date() } = {}) {
  if (!starEconomy.economyEnabled || !starEconomy.spendingEnabled || !starEconomy.peopleTasteMatchesEnabled) {
    return { ok: false, reason: "disabled" };
  }
  if (isTasteMatchesUnlocked(user, { now })) {
    return { ok: true, unlocked: true, until: new Date(user.tasteMatchUnlockUntil) };
  }
  return { ok: true, unlocked: false };
}

async function createTasteMatchUnlockQuote(user, { now = new Date() } = {}) {
  const availability = getTasteMatchesAvailability(user, { now });
  if (!availability.ok) return availability;
  if (availability.unlocked) return availability;
  const hasCandidates = await hasTasteMatchCandidates(user);
  if (!hasCandidates) return { ok: false, reason: "no_candidates" };

  const settingsSnapshot = {
    peopleTasteMatchesCost: starEconomy.peopleTasteMatchesCost,
    peopleTasteMatchesDurationHours: starEconomy.peopleTasteMatchesDurationHours,
  };
  const quote = await PeopleTasteUnlock.create({
    publicCode: generateTasteUnlockCode(),
    userId: Number(user?.userId),
    status: "pending",
    quotedCost: starEconomy.peopleTasteMatchesCost,
    quotedDurationHours: starEconomy.peopleTasteMatchesDurationHours,
    quoteExpiresAt: new Date(now.getTime() + TASTE_UNLOCK_QUOTE_TTL_MS),
    settingsSnapshot,
  });
  return { ok: true, quote };
}

async function confirmTasteMatchUnlock(user, publicCode, { now = new Date() } = {}) {
  const quote = await PeopleTasteUnlock.findOne({ publicCode: String(publicCode || "").toUpperCase() });
  if (!quote || Number(quote.userId) !== Number(user?.userId)) return { ok: false, reason: "missing_quote" };

  if (quote.status === "active") {
    const wallet = await User.findOne({ userId: Number(user?.userId) }).select("starBalance tasteMatchUnlockUntil").lean();
    return {
      ok: true,
      applied: false,
      duplicate: true,
      until: wallet?.tasteMatchUnlockUntil || quote.entitlementUntil,
      spend: { balance: Number(wallet?.starBalance) || 0, transaction: { _id: quote.spendTransactionId } },
    };
  }

  if (quote.status !== "pending" || quote.quoteExpiresAt <= now) {
    if (quote.status === "pending") {
      quote.status = "cancelled";
      await quote.save();
    }
    return { ok: false, reason: "quote_expired" };
  }

  if (
    Number(quote.quotedCost) !== Number(starEconomy.peopleTasteMatchesCost) ||
    Number(quote.quotedDurationHours) !== Number(starEconomy.peopleTasteMatchesDurationHours)
  ) {
    quote.status = "cancelled";
    await quote.save();
    return { ok: false, reason: "stale_price" };
  }

  const availability = getTasteMatchesAvailability(user, { now });
  if (!availability.ok) return availability;
  if (availability.unlocked) return { ok: true, applied: false, until: availability.until };
  const hasCandidates = await hasTasteMatchCandidates(user);
  if (!hasCandidates) return { ok: false, reason: "no_candidates" };

  const activating = await PeopleTasteUnlock.findOneAndUpdate(
    { _id: quote._id, status: "pending" },
    { $set: { status: "activating" } },
    { returnDocument: "after" },
  );
  if (!activating) {
    return confirmTasteMatchUnlock(user, publicCode, { now });
  }

  const spend = Number(quote.quotedCost) === 0
    ? {
      ok: true,
      applied: true,
      balance: Number((await User.findOne({ userId: Number(user?.userId) }).select("starBalance").lean())?.starBalance) || 0,
      transaction: { _id: null },
    }
    : await spendStars({
      userId: user.userId,
      amount: quote.quotedCost,
      reason: "people_taste_matches_unlock",
      idempotencyKey: `people:taste:spend:${quote._id}`,
      settingsSnapshot: quote.settingsSnapshot,
      metadata: { durationHours: quote.quotedDurationHours },
    });
  if (!spend.ok) {
    await PeopleTasteUnlock.findByIdAndUpdate(quote._id, { $set: { status: "pending" } });
    return spend;
  }

  const entitlementUntil = new Date(now.getTime() + Number(quote.quotedDurationHours) * 60 * 60 * 1000);
  try {
    await User.findOneAndUpdate(
      { userId: Number(user.userId) },
      { $max: { tasteMatchUnlockUntil: entitlementUntil } },
    );
    const unlock = await PeopleTasteUnlock.findOneAndUpdate(
      { _id: quote._id, status: "activating" },
      {
        $set: {
          status: "active",
          entitlementUntil,
          spendTransactionId: spend.transaction?._id || null,
        },
      },
      { returnDocument: "after" },
    );
    if (!unlock) throw new Error("taste_unlock_activation_conflict");
    return { ok: true, applied: true, unlock, until: entitlementUntil, spend };
  } catch (error) {
    const refund = spend.transaction?._id
      ? await refundStars({
        transactionId: spend.transaction._id,
        idempotencyKey: `people:taste:refund:${quote._id}`,
        reason: "people_taste_unlock_failed",
        metadata: { status: "activation_failed" },
      })
      : { ok: true, transaction: null };
    await PeopleTasteUnlock.findByIdAndUpdate(quote._id, {
      $set: {
        status: refund.ok ? "refunded" : "cancelled",
        refundTransactionId: refund.transaction?._id || null,
      },
    });
    return { ok: false, reason: "activation_failed", refunded: Boolean(refund.ok), error };
  }
}

module.exports = {
  createTasteMatchUnlockQuote,
  confirmTasteMatchUnlock,
  getTasteMatchesAvailability,
  hasTasteMatchCandidates,
  isTasteMatchesUnlocked,
};
