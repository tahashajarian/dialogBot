const crypto = require("crypto");
const AiPaidSuggestion = require("../models/ai-paid-suggestion");
const User = require("../models/user");
const { spendStars, refundStars } = require("./stars");
const { starEconomy } = require("./star-settings");

const PAID_SUGGESTION_QUOTE_TTL_MS = 10 * 60 * 1000;

function generatePaidSuggestionCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

function isPaidSuggestionsAvailable() {
  return Boolean(starEconomy.economyEnabled && starEconomy.spendingEnabled && starEconomy.paidSuggestionsEnabled);
}

async function createPaidSuggestionQuote(userId, section, { userText = "", now = new Date() } = {}) {
  if (!isPaidSuggestionsAvailable()) return { ok: false, reason: "disabled" };
  const normalizedSection = String(section || "").trim();
  if (!["movies", "series", "music", "books", "random"].includes(normalizedSection)) {
    return { ok: false, reason: "invalid_section" };
  }
  const quote = await AiPaidSuggestion.create({
    publicCode: generatePaidSuggestionCode(),
    userId: Number(userId),
    section: normalizedSection,
    userText: String(userText || "").trim().replace(/\s+/g, " ").slice(0, 80),
    status: "pending",
    quotedCost: starEconomy.paidSuggestionCost,
    quoteExpiresAt: new Date(now.getTime() + PAID_SUGGESTION_QUOTE_TTL_MS),
    settingsSnapshot: {
      paidSuggestionCost: starEconomy.paidSuggestionCost,
    },
  });
  return { ok: true, quote };
}

async function confirmPaidSuggestion(userId, publicCode, { now = new Date() } = {}) {
  if (!isPaidSuggestionsAvailable()) return { ok: false, reason: "disabled" };
  const quote = await AiPaidSuggestion.findOne({ publicCode: String(publicCode || "").toUpperCase() });
  if (!quote || Number(quote.userId) !== Number(userId)) return { ok: false, reason: "missing_quote" };

  if (quote.status !== "pending" || quote.quoteExpiresAt <= now) {
    if (quote.status === "pending") {
      quote.status = "cancelled";
      await quote.save();
    }
    return { ok: false, reason: "quote_expired", quote };
  }

  if (Number(quote.quotedCost) !== Number(starEconomy.paidSuggestionCost)) {
    quote.status = "cancelled";
    await quote.save();
    return { ok: false, reason: "stale_price", quote };
  }

  const spending = await AiPaidSuggestion.findOneAndUpdate(
    { _id: quote._id, status: "pending" },
    { $set: { status: "spending" } },
    { returnDocument: "after" },
  );
  if (!spending) return confirmPaidSuggestion(userId, publicCode, { now });

  const spend = Number(quote.quotedCost) === 0
    ? {
      ok: true,
      applied: true,
      balance: Number((await User.findOne({ userId: Number(userId) }).select("starBalance").lean())?.starBalance) || 0,
      transaction: { _id: null },
    }
    : await spendStars({
      userId,
      amount: quote.quotedCost,
      reason: "ai_extra_suggestion",
      idempotencyKey: `ai:suggestion:spend:${quote._id}`,
      settingsSnapshot: quote.settingsSnapshot,
      metadata: { section: quote.section },
    });

  if (!spend.ok) {
    await AiPaidSuggestion.findByIdAndUpdate(quote._id, { $set: { status: "pending" } });
    return { ...spend, quote };
  }

  return { ok: true, quote: spending, spend };
}

async function completePaidSuggestion(quoteId, suggestionTitle = "") {
  if (!quoteId) return { ok: false, reason: "missing_quote" };
  const updated = await AiPaidSuggestion.findOneAndUpdate(
    { _id: quoteId, status: "spending" },
    { $set: { status: "completed", suggestionTitle: String(suggestionTitle || "").slice(0, 200) } },
    { returnDocument: "after" },
  );
  return updated ? { ok: true, quote: updated } : { ok: false, reason: "not_spending" };
}

async function refundPaidSuggestion(quoteId, spendTransactionId, { reason = "ai_paid_suggestion_failed" } = {}) {
  if (!quoteId) return { ok: false, reason: "missing_quote" };
  const refund = spendTransactionId
    ? await refundStars({
      transactionId: spendTransactionId,
      idempotencyKey: `ai:suggestion:refund:${quoteId}`,
      reason,
      metadata: { quoteId: String(quoteId) },
    })
    : { ok: true, transaction: null };
  await AiPaidSuggestion.findByIdAndUpdate(quoteId, {
    $set: {
      status: refund.ok ? "refunded" : "cancelled",
      refundTransactionId: refund.transaction?._id || null,
    },
  });
  return refund;
}

module.exports = {
  createPaidSuggestionQuote,
  confirmPaidSuggestion,
  completePaidSuggestion,
  refundPaidSuggestion,
  isPaidSuggestionsAvailable,
};
