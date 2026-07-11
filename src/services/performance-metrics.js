function createStageTimings(now = Date.now) {
  const stages = {};

  async function measure(name, operation) {
    const startedAt = now();
    try {
      return await operation();
    } finally {
      stages[name] = (stages[name] || 0) + Math.max(0, now() - startedAt);
    }
  }

  return {
    measure,
    snapshot: () => ({ ...stages }),
  };
}

function createRuntimeMetricsMonitor({
  now = Date.now,
  memoryUsage = process.memoryUsage,
  intervalMs = 0,
} = {}) {
  let expectedAt = now() + Math.max(0, Number(intervalMs) || 0);
  let eventLoopLagMs = 0;

  function sample(nextIntervalMs = intervalMs) {
    const sampledAt = now();
    eventLoopLagMs = Math.max(0, sampledAt - expectedAt);
    expectedAt = sampledAt + Math.max(0, Number(nextIntervalMs) || 0);
  }

  function snapshot() {
    const memory = memoryUsage();
    return {
      eventLoopLagMs: Math.round(eventLoopLagMs),
      rssMb: Math.round((Number(memory.rss) || 0) / 1024 / 1024),
      heapUsedMb: Math.round((Number(memory.heapUsed) || 0) / 1024 / 1024),
      heapTotalMb: Math.round((Number(memory.heapTotal) || 0) / 1024 / 1024),
    };
  }

  return { sample, snapshot };
}

module.exports = {
  createRuntimeMetricsMonitor,
  createStageTimings,
};
