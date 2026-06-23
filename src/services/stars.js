const mongoose = require("mongoose");
const User = require("../models/user");
const StarTransaction = require("../models/star-transaction");
const { starEconomy } = require("./star-settings");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");

const SAFE_METADATA_KEYS = new Set([
  "section",
  "listType",
  "milestone",
  "source",
  "status",
  "count",
  "goal",
  "settingsVersion",
  "emoji",
]);

class StarMutationError extends Error {
  constructor(reason, details = {}) {
    super(reason);
    this.name = "StarMutationError";
    this.reason = reason;
    this.details = details;
  }
}

function normalizePositiveAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new StarMutationError("invalid_amount");
  }
  return amount;
}

function normalizeUserId(value) {
  const userId = Number(value);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new StarMutationError("invalid_user");
  }
  return userId;
}

function normalizeKey(value, field, maxLength = 200) {
  const normalized = String(value || "").trim().slice(0, maxLength);
  if (!normalized) throw new StarMutationError(`invalid_${field}`);
  return normalized;
}

function sanitizeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const entries = Object.entries(metadata)
    .filter(([key]) => SAFE_METADATA_KEYS.has(key))
    .map(([key, value]) => {
      if (typeof value === "boolean") return [key, value];
      if (typeof value === "number") return [key, Number.isFinite(value) ? value : 0];
      return [key, String(value || "").slice(0, 100)];
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function transactionToResult(transaction, { applied = false } = {}) {
  if (!transaction) return null;
  if (transaction.status === "rejected") {
    return {
      ok: false,
      reason: transaction.rejectionReason || "rejected",
      amount: Math.abs(Number(transaction.amount) || 0),
      balance: Number(transaction.balanceAfter) || 0,
      transaction,
    };
  }
  return {
    ok: true,
    applied,
    duplicate: !applied,
    balance: Number(transaction.balanceAfter) || 0,
    transaction,
  };
}

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function createStarsService({
  UserModel = User,
  TransactionModel = StarTransaction,
  connection = mongoose.connection,
  settings = starEconomy,
} = {}) {
  let transactionSupportPromise = null;

  async function findDuplicate({ idempotencyKey, reversesTransactionId = null }) {
    const clauses = [{ idempotencyKey }];
    if (reversesTransactionId) clauses.push({ reversesTransactionId });
    return TransactionModel.findOne({ $or: clauses });
  }

  async function supportsTransactions() {
    if (!connection.db?.admin) return true;
    if (!transactionSupportPromise) {
      transactionSupportPromise = connection.db.admin().command({ hello: 1 })
        .then((hello) => Boolean(hello.setName || hello.msg === "isdbgrid"))
        .catch(() => false);
    }
    return transactionSupportPromise;
  }

  function buildTransactionData(options) {
    return {
      userId: options.userId,
      amount: options.signedAmount,
      balanceAfter: null,
      status: "pending",
      bucket: options.bucket,
      type: options.type,
      reason: options.reason,
      idempotencyKey: options.idempotencyKey,
      relatedUserId: options.relatedUserId,
      discussionId: options.discussionId,
      invitationId: options.invitationId,
      boostId: options.boostId,
      entitlementId: options.entitlementId,
      paymentId: options.paymentId,
      reversesTransactionId: options.reversesTransactionId,
      settingsSnapshot: options.settingsSnapshot,
      metadata: options.metadata,
      constraints: options.windowLimit ? {
        earningWindow: {
          cap: Number(options.windowLimit.cap),
          since: new Date(options.windowLimit.since),
          windowHours: Number(options.windowLimit.windowHours) || 0,
        },
      } : undefined,
    };
  }

  async function checkWindowLimit({ userId, reason, amount, windowLimit, session = null }) {
    if (!windowLimit || !(Number(windowLimit.cap) >= 0)) return null;
    const aggregate = TransactionModel.aggregate([
      {
        $match: {
          userId,
          type: "earn",
          reason,
          status: "applied",
          createdAt: { $gte: new Date(windowLimit.since) },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const rows = session ? await aggregate.session(session) : await aggregate;
    const used = Number(rows[0]?.total) || 0;
    if (used + amount <= Number(windowLimit.cap)) return null;
    return {
      reason: "earning_window_cap",
      cap: Number(windowLimit.cap),
      used,
      windowHours: Number(windowLimit.windowHours) || 0,
    };
  }

  async function rejectStandaloneTransaction(transaction, reason, balance = 0) {
    let rejected = await TransactionModel.findOneAndUpdate(
      { _id: transaction._id, status: "pending" },
      { $set: { status: "rejected", rejectionReason: reason, balanceAfter: balance } },
      { returnDocument: "after" },
    );
    await UserModel.findOneAndUpdate(
      { userId: transaction.userId, starPendingTransactionId: transaction._id },
      { $set: { starPendingTransactionId: null } },
    );
    if (!rejected) rejected = await TransactionModel.findById(transaction._id);
    return transactionToResult(rejected || transaction);
  }

  async function resumeStandaloneTransaction(transaction, depth = 0) {
    if (!transaction) return null;
    if (transaction.status !== "pending") return transactionToResult(transaction);
    if (depth > 10) return { ok: false, reason: "wallet_busy" };
    const amount = Number(transaction.amount) || 0;
    const debitAmount = amount < 0 ? Math.abs(amount) : 0;
    let lockedWallet = null;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const locked = await UserModel.findOneAndUpdate(
        {
          userId: transaction.userId,
          starPendingTransactionId: { $in: [null, transaction._id] },
        },
        { $set: { starPendingTransactionId: transaction._id } },
        { returnDocument: "after" },
      );
      if (locked) {
        lockedWallet = locked;
        break;
      }

      const wallet = await UserModel.findOne({ userId: transaction.userId })
        .select("starBalance starPendingTransactionId starLastAppliedTransactionId");
      if (!wallet) return rejectStandaloneTransaction(transaction, "user_not_found", 0);
      if (String(wallet.starLastAppliedTransactionId || "") === String(transaction._id)) break;
      if (wallet.starPendingTransactionId) {
        const blocking = await TransactionModel.findById(wallet.starPendingTransactionId);
        if (blocking && String(blocking._id) !== String(transaction._id)) {
          if (blocking.status === "pending") {
            await resumeStandaloneTransaction(blocking, depth + 1);
          } else {
            await UserModel.findOneAndUpdate(
              { userId: transaction.userId, starPendingTransactionId: blocking._id },
              { $set: { starPendingTransactionId: null } },
            );
          }
          continue;
        }
        if (!blocking) {
          await UserModel.findOneAndUpdate(
            { userId: transaction.userId, starPendingTransactionId: wallet.starPendingTransactionId },
            { $set: { starPendingTransactionId: null } },
          );
          continue;
        }
      }
      if (debitAmount && Number(wallet.starBalance || 0) < debitAmount) {
        return rejectStandaloneTransaction(transaction, "insufficient_balance", Number(wallet.starBalance) || 0);
      }
    }

    if (!lockedWallet) {
      const wallet = await UserModel.findOne({ userId: transaction.userId })
        .select("starBalance starPendingTransactionId starLastAppliedTransactionId");
      if (!wallet) return rejectStandaloneTransaction(transaction, "user_not_found", 0);
      if (String(wallet.starLastAppliedTransactionId || "") === String(transaction._id)) {
        lockedWallet = wallet;
      } else {
        return { ok: false, reason: "wallet_busy", balance: Number(wallet.starBalance) || 0 };
      }
    }

    const windowLimit = transaction.constraints?.earningWindow || null;
    const capFailure = await checkWindowLimit({
      userId: transaction.userId,
      reason: transaction.reason,
      amount: Math.abs(amount),
      windowLimit,
    });
    if (capFailure) {
      const rejected = await rejectStandaloneTransaction(
        transaction,
        capFailure.reason,
        Number(lockedWallet.starBalance) || 0,
      );
      return { ...rejected, ...capFailure };
    }

    let wallet = await UserModel.findOneAndUpdate(
      {
        userId: transaction.userId,
        starPendingTransactionId: transaction._id,
        starLastAppliedTransactionId: { $ne: transaction._id },
        ...(debitAmount ? { starBalance: { $gte: debitAmount } } : {}),
      },
      {
        $inc: { starBalance: amount },
        $set: { starLastAppliedTransactionId: transaction._id },
      },
      { returnDocument: "after" },
    );

    if (!wallet) {
      wallet = await UserModel.findOne({ userId: transaction.userId })
        .select("starBalance starPendingTransactionId starLastAppliedTransactionId");
      if (!wallet) return rejectStandaloneTransaction(transaction, "user_not_found", 0);
      if (String(wallet.starLastAppliedTransactionId || "") !== String(transaction._id)) {
        return rejectStandaloneTransaction(transaction, "insufficient_balance", Number(wallet.starBalance) || 0);
      }
    }

    let applied = await TransactionModel.findOneAndUpdate(
      { _id: transaction._id, status: "pending" },
      {
        $set: {
          status: "applied",
          rejectionReason: "",
          balanceAfter: Number(wallet.starBalance) || 0,
        },
      },
      { returnDocument: "after" },
    );
    await UserModel.findOneAndUpdate(
      { userId: transaction.userId, starPendingTransactionId: transaction._id },
      { $set: { starPendingTransactionId: null } },
    );
    const didFinalize = Boolean(applied);
    if (!applied) applied = await TransactionModel.findById(transaction._id);
    return transactionToResult(applied || transaction, { applied: didFinalize });
  }

  async function performStandaloneMutation(options) {
    let transaction = await findDuplicate({
      idempotencyKey: options.idempotencyKey,
      reversesTransactionId: options.reversesTransactionId,
    });
    if (transaction) {
      if (transaction.status === "pending") return resumeStandaloneTransaction(transaction);
      return transactionToResult(transaction);
    }
    try {
      transaction = await TransactionModel.create(buildTransactionData(options));
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      transaction = await findDuplicate({
        idempotencyKey: options.idempotencyKey,
        reversesTransactionId: options.reversesTransactionId,
      });
      if (!transaction) throw error;
      if (transaction.status !== "pending") return transactionToResult(transaction);
    }
    return resumeStandaloneTransaction(transaction);
  }

  async function performTransactionalMutation(options) {
    let result = null;
    await connection.transaction(async (session) => {
      const existing = await TransactionModel.findOne({
        idempotencyKey: options.idempotencyKey,
      }).session(session);
      if (existing) {
        result = transactionToResult(existing);
        return;
      }

      const capFailure = await checkWindowLimit({
        userId: options.userId,
        reason: options.reason,
        amount: Math.abs(options.signedAmount),
        windowLimit: options.windowLimit,
        session,
      });
      if (capFailure) throw new StarMutationError(capFailure.reason, capFailure);

      const [created] = await TransactionModel.create([buildTransactionData(options)], { session });
      const debitAmount = options.signedAmount < 0 ? Math.abs(options.signedAmount) : 0;
      const user = await UserModel.findOneAndUpdate(
        {
          userId: options.userId,
          ...(debitAmount ? { starBalance: { $gte: debitAmount } } : {}),
        },
        { $inc: { starBalance: options.signedAmount } },
        { returnDocument: "after", session },
      );
      if (!user) {
        const existingUser = debitAmount
          ? await UserModel.findOne({ userId: options.userId }).select("starBalance").session(session)
          : null;
        throw new StarMutationError(existingUser ? "insufficient_balance" : "user_not_found", {
          amount: Math.abs(options.signedAmount),
          ...(existingUser ? { balance: Number(existingUser.starBalance) || 0 } : {}),
        });
      }
      created.balanceAfter = Number(user.starBalance) || 0;
      created.status = "applied";
      await created.save({ session });
      result = transactionToResult(created, { applied: true });
    });
    return result;
  }

  async function performMutation({
    userId: rawUserId,
    amount: rawAmount,
    direction,
    type,
    reason,
    idempotencyKey,
    bucket = "earned",
    relatedUserId = null,
    discussionId = null,
    invitationId = null,
    boostId = null,
    entitlementId = null,
    paymentId = "",
    reversesTransactionId = null,
    settingsSnapshot,
    metadata,
    windowLimit = null,
  }) {
    if (typeof connection.readyState === "number" && connection.readyState !== 1) {
      return { ok: false, reason: "storage_unavailable" };
    }
    const userId = normalizeUserId(rawUserId);
    const amount = normalizePositiveAmount(rawAmount);
    const normalizedReason = normalizeKey(reason, "reason", 100);
    const normalizedIdempotencyKey = normalizeKey(idempotencyKey, "idempotency_key");
    const signedAmount = direction === "debit" ? -amount : amount;
    const options = {
      userId,
      signedAmount,
      type,
      reason: normalizedReason,
      idempotencyKey: normalizedIdempotencyKey,
      bucket,
      relatedUserId,
      discussionId,
      invitationId,
      boostId,
      entitlementId,
      paymentId: String(paymentId || "").slice(0, 200),
      reversesTransactionId,
      settingsSnapshot,
      metadata: sanitizeMetadata(metadata),
      windowLimit,
    };

    try {
      const result = await (await supportsTransactions()
        ? performTransactionalMutation(options)
        : performStandaloneMutation(options));
      if (result?.applied) {
        const eventName = type === "spend"
          ? EVENT_NAMES.starsSpent
          : type === "refund"
            ? EVENT_NAMES.starsRefunded
            : EVENT_NAMES.starsEarned;
        void trackEvent({
          name: eventName,
          userId,
          source: normalizedReason,
          metadata: {
            amount: Math.abs(signedAmount),
            balance: result.balance,
            reason: normalizedReason,
          },
        });
      }
      return result;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const existing = await findDuplicate({
          idempotencyKey: normalizedIdempotencyKey,
          reversesTransactionId,
        });
        if (existing) return transactionToResult(existing);
      }
      if (error instanceof StarMutationError) {
        return { ok: false, reason: error.reason, ...error.details };
      }
      throw error;
    }
  }

  async function earnStars(options) {
    if (!settings.economyEnabled || !settings.earningEnabled) {
      return { ok: false, reason: "earning_disabled" };
    }
    return performMutation({ ...options, direction: "credit", type: "earn", bucket: "earned" });
  }

  async function spendStars(options) {
    if (!settings.economyEnabled || !settings.spendingEnabled) {
      return { ok: false, reason: "spending_disabled" };
    }
    return performMutation({ ...options, direction: "debit", type: "spend" });
  }

  async function grantStars(options) {
    return performMutation({ ...options, direction: "credit", type: "grant", bucket: options.bucket || "promotional" });
  }

  async function refundStars({ transactionId, idempotencyKey, reason = "automatic_refund", metadata } = {}) {
    const original = await TransactionModel.findById(transactionId);
    if (!original) return { ok: false, reason: "transaction_not_found" };
    if (original.status !== "applied" || original.type !== "spend" || Number(original.amount) >= 0) {
      return { ok: false, reason: "transaction_not_refundable" };
    }
    return performMutation({
      userId: original.userId,
      amount: Math.abs(Number(original.amount)),
      direction: "credit",
      type: "refund",
      reason,
      idempotencyKey,
      bucket: original.bucket,
      reversesTransactionId: original._id,
      discussionId: original.discussionId,
      invitationId: original.invitationId,
      boostId: original.boostId,
      entitlementId: original.entitlementId,
      settingsSnapshot: original.settingsSnapshot,
      metadata,
    });
  }

  async function getStarBalance(userId) {
    const normalizedUserId = normalizeUserId(userId);
    const user = await UserModel.findOne({ userId: normalizedUserId }).select("starBalance").lean();
    return user ? Number(user.starBalance) || 0 : null;
  }

  async function hasStarTransaction(idempotencyKey) {
    const normalizedIdempotencyKey = normalizeKey(idempotencyKey, "idempotency_key");
    if (typeof connection.readyState === "number" && connection.readyState !== 1) return false;
    return Boolean(await TransactionModel.exists({
      idempotencyKey: normalizedIdempotencyKey,
      status: "applied",
    }));
  }

  async function recoverPendingStarTransactions({ limit = 100 } = {}) {
    if (await supportsTransactions()) return { checked: 0, recovered: 0, failed: 0 };
    const normalizedLimit = Math.max(1, Math.min(1000, Math.round(Number(limit) || 100)));
    const pending = await TransactionModel.find({ status: "pending" })
      .sort({ createdAt: 1 })
      .limit(normalizedLimit);
    let recovered = 0;
    let failed = 0;
    for (const transaction of pending) {
      try {
        const result = await resumeStandaloneTransaction(transaction);
        if (result?.ok) recovered += 1;
        else failed += 1;
      } catch (_error) {
        failed += 1;
      }
    }
    return { checked: pending.length, recovered, failed };
  }

  async function reconcileStarBalances({ limit = 1000 } = {}) {
    const normalizedLimit = Math.max(1, Math.min(10000, Math.round(Number(limit) || 1000)));
    await recoverPendingStarTransactions({ limit: Math.min(normalizedLimit, 1000) });
    const ledgerRows = await TransactionModel.aggregate([
      { $match: { status: "applied" } },
      { $group: { _id: "$userId", ledgerBalance: { $sum: "$amount" }, transactions: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: normalizedLimit },
    ]);
    const userIds = ledgerRows.map((row) => row._id);
    const [users, nonzeroWithoutLedger] = await Promise.all([
      UserModel.find({ userId: { $in: userIds } }).select("userId starBalance").lean(),
      UserModel.find({
        userId: { $nin: userIds },
        starBalance: { $ne: 0 },
      }).select("userId starBalance").limit(normalizedLimit).lean(),
    ]);
    const balanceByUser = new Map(users.map((user) => [user.userId, Number(user.starBalance) || 0]));
    const mismatches = ledgerRows
      .map((row) => ({
        userId: row._id,
        ledgerBalance: Number(row.ledgerBalance) || 0,
        cachedBalance: balanceByUser.get(row._id) ?? null,
        transactions: row.transactions,
      }))
      .filter((row) => row.cachedBalance === null || row.cachedBalance !== row.ledgerBalance);
    for (const user of nonzeroWithoutLedger) {
      mismatches.push({
        userId: user.userId,
        ledgerBalance: 0,
        cachedBalance: Number(user.starBalance) || 0,
        transactions: 0,
      });
    }
    return {
      checked: ledgerRows.length + nonzeroWithoutLedger.length,
      mismatchCount: mismatches.length,
      mismatches,
    };
  }

  return {
    earnStars,
    spendStars,
    grantStars,
    refundStars,
    getStarBalance,
    hasStarTransaction,
    recoverPendingStarTransactions,
    reconcileStarBalances,
  };
}

const starsService = createStarsService();

module.exports = {
  StarMutationError,
  createStarsService,
  normalizePositiveAmount,
  sanitizeMetadata,
  ...starsService,
};
