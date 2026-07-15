const mongoose = require("mongoose");
const OperationalEvent = require("../models/operational-event");
const { logger } = require("./logger");

const BOT_HEARTBEAT_KIND = "bot_heartbeat";
const AI_API_KIND = "ai_api";
const UPDATE_PERFORMANCE_KIND = "update_performance";
const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

function sanitizeReason(reason) {
  return String(reason || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

async function recordOperationalEvent({
  kind,
  ok = true,
  operation = "",
  provider = "",
  reason = "",
  durationMs = 0,
  metadata,
}) {
  try {
    if (!kind || mongoose.connection.readyState !== 1) return null;
    return await OperationalEvent.create({
      kind,
      ok: Boolean(ok),
      operation: String(operation || "").slice(0, 80),
      provider: String(provider || "").slice(0, 80),
      reason: sanitizeReason(reason),
      durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
      metadata,
    });
  } catch (error) {
    logger.debug("Failed to record operational event", error);
    return null;
  }
}

function recordBotHeartbeat(metadata) {
  return recordOperationalEvent({
    kind: BOT_HEARTBEAT_KIND,
    ok: true,
    operation: "polling",
    metadata,
  });
}

function recordAiApiEvent({ ok, operation, provider, reason, durationMs }) {
  return recordOperationalEvent({
    kind: AI_API_KIND,
    ok,
    operation,
    provider,
    reason,
    durationMs,
  });
}

function recordUpdatePerformanceEvent({ route, durationMs, metadata = {} }) {
  return recordOperationalEvent({
    kind: UPDATE_PERFORMANCE_KIND,
    ok: true,
    operation: String(route || "unknown").slice(0, 80),
    durationMs,
    metadata: {
      telegramApiCalls: Math.max(0, Number(metadata.telegramApiCalls) || 0),
      telegramApiTotalMs: Math.max(0, Number(metadata.telegramApiTotalMs) || 0),
      telegramApiMaxMs: Math.max(0, Number(metadata.telegramApiMaxMs) || 0),
      userDocumentBytes: Math.max(0, Number(metadata.userDocumentBytes) || 0),
      stages: metadata.stages && typeof metadata.stages === "object" ? metadata.stages : {},
    },
  });
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] || 0);
}

function summarizeUpdatePerformanceEvents(events = []) {
  const groups = new Map();
  for (const event of events) {
    const route = String(event.operation || "unknown");
    const group = groups.get(route) || [];
    group.push(event);
    groups.set(route, group);
  }
  return [...groups.entries()].map(([route, rows]) => ({
    route,
    count: rows.length,
    p50DurationMs: percentile(rows.map((row) => row.durationMs), 0.5),
    p95DurationMs: percentile(rows.map((row) => row.durationMs), 0.95),
    p95TelegramMs: percentile(rows.map((row) => row.metadata?.telegramApiTotalMs), 0.95),
    p95UserDocumentBytes: percentile(rows.map((row) => row.metadata?.userDocumentBytes), 0.95),
  })).sort((a, b) => b.p95DurationMs - a.p95DurationMs || b.count - a.count);
}

async function summarizeEvents({ kind, since }) {
  const rows = await OperationalEvent.aggregate([
    { $match: { kind, createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        failures: { $sum: { $cond: ["$ok", 0, 1] } },
        avgDurationMs: { $avg: "$durationMs" },
        lastFailureAt: {
          $max: {
            $cond: [
              "$ok",
              null,
              "$createdAt",
            ],
          },
        },
      },
    },
  ]);
  const row = rows[0] || {};
  const total = row.total || 0;
  const failures = row.failures || 0;
  return {
    total,
    successes: total - failures,
    failures,
    failureRate: total ? failures / total : 0,
    avgDurationMs: Math.round(row.avgDurationMs || 0),
    lastFailureAt: row.lastFailureAt ? row.lastFailureAt.toISOString() : null,
  };
}

async function getOperationalHealthSnapshot({ now = new Date() } = {}) {
  const since1h = new Date(now.getTime() - 60 * 60 * 1000);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [latestHeartbeat, aiLastHour, aiLast24h, recentFailures, slowUpdates] = await Promise.all([
    OperationalEvent.findOne({ kind: BOT_HEARTBEAT_KIND }).sort({ createdAt: -1 }).lean(),
    summarizeEvents({ kind: AI_API_KIND, since: since1h }),
    summarizeEvents({ kind: AI_API_KIND, since: since24h }),
    OperationalEvent.find({ kind: AI_API_KIND, ok: false, createdAt: { $gte: since24h } })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("operation provider reason durationMs createdAt")
      .lean(),
    OperationalEvent.find({ kind: UPDATE_PERFORMANCE_KIND, createdAt: { $gte: since24h } })
      .sort({ createdAt: -1 })
      .limit(5000)
      .select("operation durationMs metadata createdAt")
      .lean(),
  ]);

  const heartbeatAt = latestHeartbeat?.createdAt || null;
  const heartbeatAgeMs = heartbeatAt ? now.getTime() - heartbeatAt.getTime() : null;

  return {
    database: {
      connected: mongoose.connection.readyState === 1,
      readyState: mongoose.connection.readyState,
      name: mongoose.connection.name || "",
      host: mongoose.connection.host || "",
    },
    bot: {
      recentlySeen: heartbeatAgeMs !== null && heartbeatAgeMs <= HEARTBEAT_STALE_MS,
      lastHeartbeatAt: heartbeatAt ? heartbeatAt.toISOString() : null,
      heartbeatAgeSeconds: heartbeatAgeMs === null ? null : Math.round(heartbeatAgeMs / 1000),
    },
    aiApi: {
      lastHour: aiLastHour,
      last24h: aiLast24h,
      recentFailures: recentFailures.map((event) => ({
        operation: event.operation || "",
        provider: event.provider || "",
        reason: event.reason || "",
        durationMs: event.durationMs || 0,
        createdAt: event.createdAt.toISOString(),
      })),
    },
    performance: {
      slowThresholdMs: 1500,
      sampledEvents: slowUpdates.length,
      truncated: slowUpdates.length >= 5000,
      routes: summarizeUpdatePerformanceEvents(slowUpdates),
    },
  };
}

module.exports = {
  AI_API_KIND,
  BOT_HEARTBEAT_KIND,
  HEARTBEAT_STALE_MS,
  UPDATE_PERFORMANCE_KIND,
  getOperationalHealthSnapshot,
  recordAiApiEvent,
  recordBotHeartbeat,
  recordOperationalEvent,
  recordUpdatePerformanceEvent,
  summarizeUpdatePerformanceEvents,
};
