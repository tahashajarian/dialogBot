const test = require("node:test");
const assert = require("node:assert/strict");

const { createStarsService } = require("../src/services/stars");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function query(value) {
  const promise = Promise.resolve(value);
  return {
    session() {
      return promise;
    },
    select() {
      return this;
    },
    lean() {
      return promise;
    },
    limit() {
      return this;
    },
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
}

function matchesTransaction(transaction, filter = {}) {
  if (filter.$or) return filter.$or.some((clause) => matchesTransaction(transaction, clause));
  return Object.entries(filter).every(([key, value]) => String(transaction[key] ?? "") === String(value ?? ""));
}

function createFakeStore(initialUsers = []) {
  const users = new Map(initialUsers.map((user) => [user.userId, { starBalance: 0, ...clone(user) }]));
  const transactions = [];
  let nextId = 1;
  let queue = Promise.resolve();

  const connection = {
    transaction(work) {
      const run = queue.then(async () => {
        const userSnapshot = clone(Array.from(users.entries()));
        const transactionSnapshot = clone(transactions);
        try {
          return await work({ fake: true });
        } catch (error) {
          users.clear();
          for (const [key, value] of userSnapshot) users.set(key, value);
          transactions.splice(0, transactions.length, ...transactionSnapshot);
          throw error;
        }
      });
      queue = run.catch(() => {});
      return run;
    },
  };

  const TransactionModel = {
    exists(filter) {
      return Promise.resolve(transactions.some((transaction) => matchesTransaction(transaction, filter)));
    },
    findOne(filter) {
      return query(transactions.find((transaction) => matchesTransaction(transaction, filter)) || null);
    },
    async create(rows) {
      const row = clone(rows[0]);
      if (transactions.some((transaction) => transaction.idempotencyKey === row.idempotencyKey)) {
        const error = new Error("duplicate idempotency key");
        error.code = 11000;
        throw error;
      }
      if (row.reversesTransactionId && transactions.some(
        (transaction) => String(transaction.reversesTransactionId || "") === String(row.reversesTransactionId),
      )) {
        const error = new Error("duplicate refund");
        error.code = 11000;
        throw error;
      }
      const stored = {
        ...row,
        _id: String(nextId++),
        createdAt: new Date(),
        async save() {
          const target = transactions.find((transaction) => transaction._id === this._id);
          Object.assign(target, clone({ ...this, save: undefined }));
          return this;
        },
      };
      transactions.push(clone({ ...stored, save: undefined }));
      return [stored];
    },
    findById(id) {
      return Promise.resolve(transactions.find((transaction) => String(transaction._id) === String(id)) || null);
    },
    aggregate(pipeline = []) {
      const match = pipeline.find((stage) => stage.$match)?.$match;
      if (match?.reason) {
        const total = transactions
          .filter((transaction) => (
            transaction.userId === match.userId &&
            transaction.type === match.type &&
            transaction.reason === match.reason &&
            new Date(transaction.createdAt) >= new Date(match.createdAt.$gte)
          ))
          .reduce((sum, transaction) => sum + transaction.amount, 0);
        return query(total ? [{ _id: null, total }] : []);
      }
      const grouped = new Map();
      for (const transaction of transactions) {
        const current = grouped.get(transaction.userId) || { _id: transaction.userId, ledgerBalance: 0, transactions: 0 };
        current.ledgerBalance += transaction.amount;
        current.transactions += 1;
        grouped.set(transaction.userId, current);
      }
      return query(Array.from(grouped.values()));
    },
  };

  const UserModel = {
    async findOneAndUpdate(filter, update) {
      const user = users.get(filter.userId);
      if (!user) return null;
      const required = filter.starBalance?.$gte;
      if (required !== undefined && user.starBalance < required) return null;
      user.starBalance += update.$inc.starBalance;
      return clone(user);
    },
    exists(filter) {
      return query(users.has(filter.userId));
    },
    findOne(filter) {
      return query(users.has(filter.userId) ? clone(users.get(filter.userId)) : null);
    },
    find(filter) {
      const includedIds = filter.userId?.$in ? new Set(filter.userId.$in) : null;
      const excludedIds = filter.userId?.$nin ? new Set(filter.userId.$nin) : null;
      return query(Array.from(users.values()).filter((user) => (
        (!includedIds || includedIds.has(user.userId)) &&
        (!excludedIds || !excludedIds.has(user.userId)) &&
        (filter.starBalance?.$ne === undefined || user.starBalance !== filter.starBalance.$ne)
      )).map(clone));
    },
  };

  return { connection, TransactionModel, UserModel, users, transactions };
}

function createService(store, overrides = {}) {
  return createStarsService({
    ...store,
    settings: {
      economyEnabled: true,
      earningEnabled: true,
      spendingEnabled: true,
      ...overrides,
    },
  });
}

test("concurrent duplicate earning applies exactly once", async () => {
  const store = createFakeStore([{ userId: 11 }]);
  const service = createService(store);
  const request = {
    userId: 11,
    amount: 3,
    reason: "topten_first_milestone",
    idempotencyKey: "topten:first:11:music",
  };
  const [first, second] = await Promise.all([
    service.earnStars(request),
    service.earnStars(request),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal([first.applied, second.applied].filter(Boolean).length, 1);
  assert.equal(store.users.get(11).starBalance, 3);
  assert.equal(store.transactions.length, 1);
});

test("insufficient spending leaves balance and ledger unchanged", async () => {
  const store = createFakeStore([{ userId: 12, starBalance: 4 }]);
  const service = createService(store);
  const result = await service.spendStars({
    userId: 12,
    amount: 5,
    reason: "discussion_boost",
    idempotencyKey: "boost:12:first",
  });
  assert.deepEqual(result, { ok: false, reason: "insufficient_balance", amount: 5, balance: 4 });
  assert.equal(store.users.get(12).starBalance, 4);
  assert.equal(store.transactions.length, 0);
});

test("refund reverses one spend exactly once", async () => {
  const store = createFakeStore([{ userId: 13, starBalance: 20 }]);
  const service = createService(store);
  const spend = await service.spendStars({
    userId: 13,
    amount: 10,
    reason: "discussion_boost",
    idempotencyKey: "boost:13:first",
  });
  const [firstRefund, secondRefund] = await Promise.all([
    service.refundStars({ transactionId: spend.transaction._id, idempotencyKey: "refund:boost:13:first" }),
    service.refundStars({ transactionId: spend.transaction._id, idempotencyKey: "refund:boost:13:retry" }),
  ]);
  assert.equal(firstRefund.ok, true);
  assert.equal(secondRefund.ok, true);
  assert.equal([firstRefund.applied, secondRefund.applied].filter(Boolean).length, 1);
  assert.equal(store.users.get(13).starBalance, 20);
  assert.equal(store.transactions.length, 2);
});

test("earning window caps are enforced inside the mutation", async () => {
  const store = createFakeStore([{ userId: 16 }]);
  const service = createService(store);
  const windowLimit = { cap: 1, since: new Date(Date.now() - 60000), windowHours: 24 };
  const first = await service.earnStars({
    userId: 16,
    amount: 1,
    reason: "invite_pair_reward",
    idempotencyKey: "invite:16:20",
    windowLimit,
  });
  const second = await service.earnStars({
    userId: 16,
    amount: 1,
    reason: "invite_pair_reward",
    idempotencyKey: "invite:16:21",
    windowLimit,
  });
  assert.equal(first.ok, true);
  assert.deepEqual(second, {
    ok: false,
    reason: "earning_window_cap",
    cap: 1,
    used: 1,
    windowHours: 24,
  });
  assert.equal(store.users.get(16).starBalance, 1);
  assert.equal(store.transactions.length, 1);
});

test("rollout switches fail closed without writing", async () => {
  const store = createFakeStore([{ userId: 14 }]);
  const service = createService(store, { earningEnabled: false, spendingEnabled: false });
  assert.deepEqual(await service.earnStars({}), { ok: false, reason: "earning_disabled" });
  assert.deepEqual(await service.spendStars({}), { ok: false, reason: "spending_disabled" });
  assert.equal(store.transactions.length, 0);
});

test("reconciliation reports cached balance mismatches", async () => {
  const store = createFakeStore([{ userId: 15 }]);
  const service = createService(store);
  await service.earnStars({
    userId: 15,
    amount: 7,
    reason: "profile_completed",
    idempotencyKey: "profile:15",
  });
  store.users.get(15).starBalance = 9;
  const result = await service.reconcileStarBalances();
  assert.equal(result.checked, 1);
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.mismatches[0].ledgerBalance, 7);
  assert.equal(result.mismatches[0].cachedBalance, 9);
});

test("reconciliation detects a nonzero wallet with no ledger history", async () => {
  const store = createFakeStore([{ userId: 17, starBalance: 4 }]);
  const service = createService(store);
  const result = await service.reconcileStarBalances();
  assert.equal(result.checked, 1);
  assert.equal(result.mismatchCount, 1);
  assert.deepEqual(result.mismatches[0], {
    userId: 17,
    ledgerBalance: 0,
    cachedBalance: 4,
    transactions: 0,
  });
});
