const crypto = require("crypto");
const AiTasteRecheck = require("../models/ai-taste-recheck");
const User = require("../models/user");
const { operationalLimits } = require("./operational-limits");
const { starEconomy } = require("./star-settings");
const { spendStars, refundStars } = require("./stars");
const { buildTasteInputFingerprint, isMediaTasteSection } = require("./taste-label-classifier");
const { getAiListItemsFromUser, getAiTasteFromUser } = require("./users");

const TASTE_RECHECK_QUOTE_TTL_MS = 10 * 60 * 1000;

function isTasteLabelRecheckAvailable() {
  return Boolean(
    starEconomy.economyEnabled &&
    starEconomy.spendingEnabled &&
    starEconomy.tasteLabelRecheckEnabled
  );
}

function generatePublicCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

async function createTasteLabelRecheckQuote(userId, section, { now = new Date() } = {}) {
  if (!isTasteLabelRecheckAvailable()) return { ok: false, reason: "disabled" };
  if (!isMediaTasteSection(section)) return { ok: false, reason: "invalid_section" };
  const user = await User.findOne({ userId: Number(userId) });
  if (!user) return { ok: false, reason: "missing_user" };
  const items = getAiListItemsFromUser(user, section, "topTen");
  if (items.length !== operationalLimits.aiTopTenItems) return { ok: false, reason: "incomplete_list" };
  const taste = getAiTasteFromUser(user, section);
  const hasConfirmedLabel = Boolean(taste.labelKey) && taste.classificationStatus === "confirmed";
  const hasConfirmedNoLabel = !taste.labelKey && taste.classificationStatus === "skipped" && taste.freeClassificationUsedAt;
  if (!hasConfirmedLabel && !hasConfirmedNoLabel) {
    return { ok: false, reason: "missing_confirmed_label" };
  }
  const quote = await AiTasteRecheck.create({
    publicCode: generatePublicCode(),
    userId: Number(userId),
    section,
    quotedCost: starEconomy.tasteLabelRecheckCost,
    quoteExpiresAt: new Date(now.getTime() + TASTE_RECHECK_QUOTE_TTL_MS),
    inputFingerprint: buildTasteInputFingerprint(section, items),
    previousLabelKey: taste.labelKey,
    previousClassificationStatus: taste.classificationStatus,
    settingsSnapshot: { tasteLabelRecheckCost: starEconomy.tasteLabelRecheckCost },
  });
  return { ok: true, quote, balance: Number(user.starBalance) || 0 };
}

async function confirmTasteLabelRecheck(userId, publicCode, { now = new Date() } = {}) {
  if (!isTasteLabelRecheckAvailable()) return { ok: false, reason: "disabled" };
  const quote = await AiTasteRecheck.findOne({ publicCode: String(publicCode || "").toUpperCase() });
  if (!quote || Number(quote.userId) !== Number(userId)) return { ok: false, reason: "missing_quote" };
  if (quote.status !== "pending" || quote.quoteExpiresAt <= now) {
    if (quote.status === "pending") await AiTasteRecheck.findByIdAndUpdate(quote._id, { $set: { status: "cancelled" } });
    return { ok: false, reason: "quote_expired", quote };
  }
  if (Number(quote.quotedCost) !== Number(starEconomy.tasteLabelRecheckCost)) {
    await AiTasteRecheck.findByIdAndUpdate(quote._id, { $set: { status: "cancelled" } });
    return { ok: false, reason: "stale_price", quote };
  }
  const user = await User.findOne({ userId: Number(userId) });
  const items = getAiListItemsFromUser(user, quote.section, "topTen");
  const taste = getAiTasteFromUser(user, quote.section);
  const previousClassificationStatus = quote.previousClassificationStatus ||
    (quote.previousLabelKey ? "confirmed" : "skipped");
  if (
    !user ||
    items.length !== operationalLimits.aiTopTenItems ||
    buildTasteInputFingerprint(quote.section, items) !== quote.inputFingerprint ||
    taste.classificationStatus !== previousClassificationStatus ||
    taste.labelKey !== quote.previousLabelKey
  ) {
    await AiTasteRecheck.findByIdAndUpdate(quote._id, { $set: { status: "cancelled" } });
    return { ok: false, reason: "list_changed", quote };
  }
  const spending = await AiTasteRecheck.findOneAndUpdate(
    { _id: quote._id, status: "pending" },
    { $set: { status: "spending" } },
    { returnDocument: "after" },
  );
  if (!spending) return confirmTasteLabelRecheck(userId, publicCode, { now });
  const spend = Number(quote.quotedCost) === 0
    ? { ok: true, balance: Number(user?.starBalance) || 0, transaction: { _id: null } }
    : await spendStars({
      userId,
      amount: quote.quotedCost,
      reason: "ai_taste_label_recheck",
      idempotencyKey: `ai:taste-label:recheck:spend:${quote._id}`,
      settingsSnapshot: quote.settingsSnapshot,
      metadata: { section: quote.section },
    });
  if (!spend.ok) {
    await AiTasteRecheck.findByIdAndUpdate(quote._id, { $set: { status: "pending" } });
    return { ...spend, quote };
  }
  await AiTasteRecheck.findByIdAndUpdate(quote._id, { $set: { spendTransactionId: spend.transaction?._id || null } });
  return { ok: true, quote: spending, spend };
}

async function completeTasteLabelRecheck(quoteId, suggestedLabelKeys, suggestionInsight = "") {
  const quote = await AiTasteRecheck.findOneAndUpdate(
    { _id: quoteId, status: "spending" },
    { $set: {
      status: "completed",
      suggestedLabelKeys: Array.isArray(suggestedLabelKeys) ? suggestedLabelKeys : [],
      suggestionInsight: String(suggestionInsight || "").trim().slice(0, 120),
    } },
    { returnDocument: "after" },
  );
  return quote ? { ok: true, quote } : { ok: false, reason: "not_spending" };
}

async function cancelTasteLabelRecheck(userId, publicCode) {
  const quote = await AiTasteRecheck.findOneAndUpdate(
    {
      publicCode: String(publicCode || "").toUpperCase(),
      userId: Number(userId),
      status: "pending",
    },
    { $set: { status: "cancelled" } },
    { returnDocument: "after" },
  );
  return quote ? { ok: true, quote } : { ok: false, reason: "missing_quote" };
}

async function refundTasteLabelRecheck(quoteId, spendTransactionId, { reason = "ai_taste_label_recheck_failed" } = {}) {
  const refund = spendTransactionId
    ? await refundStars({
      transactionId: spendTransactionId,
      idempotencyKey: `ai:taste-label:recheck:refund:${quoteId}`,
      reason,
      metadata: { quoteId: String(quoteId) },
    })
    : { ok: true, transaction: null };
  await AiTasteRecheck.findByIdAndUpdate(quoteId, { $set: {
    status: refund.ok ? "refunded" : "cancelled",
    refundTransactionId: refund.transaction?._id || null,
  } });
  return refund;
}

module.exports = {
  cancelTasteLabelRecheck,
  completeTasteLabelRecheck,
  confirmTasteLabelRecheck,
  createTasteLabelRecheckQuote,
  isTasteLabelRecheckAvailable,
  refundTasteLabelRecheck,
};
