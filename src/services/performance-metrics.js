const UPDATE_BASELINE_SAMPLE_DENOMINATOR = 20;

function shouldSampleUpdatePerformance(userId, durationMs, slowThresholdMs = 1500) {
  if (Number(durationMs) >= slowThresholdMs) return true;
  const normalizedUserId = Math.abs(Math.trunc(Number(userId)));
  return Number.isFinite(normalizedUserId) && normalizedUserId > 0
    && normalizedUserId % UPDATE_BASELINE_SAMPLE_DENOMINATOR === 0;
}

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

function estimateDocumentBytes(document) {
  if (!document) return 0;
  try {
    const value = typeof document.toObject === "function"
      ? document.toObject({ depopulate: true, virtuals: false })
      : document;
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
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
  UPDATE_BASELINE_SAMPLE_DENOMINATOR,
  createRuntimeMetricsMonitor,
  createStageTimings,
  estimateDocumentBytes,
  shouldSampleUpdatePerformance,
};
