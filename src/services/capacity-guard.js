class CapacityError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "CapacityError";
    this.reason = reason;
  }
}

function createCapacityGuard({
  concurrency = 1,
  maxQueue = 0,
  maxWaitMs = 1500,
} = {}) {
  const limit = Math.max(1, Math.floor(Number(concurrency)) || 1);
  const queueLimit = Math.max(0, Math.floor(Number(maxQueue)) || 0);
  let active = 0;
  const queue = [];
  const claimedKeys = new Set();

  function releaseKey(key) {
    if (key) claimedKeys.delete(key);
  }

  function drain() {
    while (active < limit && queue.length) {
      const entry = queue.shift();
      clearTimeout(entry.timeoutId);
      active += 1;
      entry.resolve(createLease(entry.key));
    }
  }

  function createLease(key) {
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
        releaseKey(key);
        drain();
      },
    };
  }

  function acquire(key = "") {
    const normalizedKey = String(key || "");
    if (normalizedKey && claimedKeys.has(normalizedKey)) {
      return Promise.reject(new CapacityError("user_busy"));
    }
    if (active < limit) {
      active += 1;
      if (normalizedKey) claimedKeys.add(normalizedKey);
      return Promise.resolve(createLease(normalizedKey));
    }
    if (queue.length >= queueLimit) {
      return Promise.reject(new CapacityError("queue_full"));
    }
    if (normalizedKey) claimedKeys.add(normalizedKey);
    return new Promise((resolve, reject) => {
      const entry = { key: normalizedKey, resolve, reject, timeoutId: null };
      entry.timeoutId = setTimeout(() => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        releaseKey(normalizedKey);
        reject(new CapacityError("queue_timeout"));
      }, maxWaitMs);
      entry.timeoutId.unref?.();
      queue.push(entry);
    });
  }

  async function run(key, operation) {
    const lease = await acquire(key);
    try {
      return await operation();
    } finally {
      lease.release();
    }
  }

  function getState() {
    return {
      active,
      queued: queue.length,
      concurrency: limit,
      maxQueue: queueLimit,
    };
  }

  return { acquire, getState, run };
}

module.exports = {
  CapacityError,
  createCapacityGuard,
};
