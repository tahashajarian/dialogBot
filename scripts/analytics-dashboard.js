require("dotenv").config();

const http = require("http");
const { URL } = require("url");
const connectDB = require("../src/db");
const { disconnectDB } = require("../src/db");
const { getRuntimeConfig } = require("../src/config");
const { getAnalyticsSnapshot } = require("../src/services/analytics-dashboard");
const { logger } = require("../src/services/logger");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function getAuthTokenFromRequest(req, url) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return String(req.headers["x-dashboard-token"] || url.searchParams.get("token") || "").trim();
}

function isAuthorized(req, url, expectedToken) {
  if (!expectedToken) return true;
  return getAuthTokenFromRequest(req, url) === expectedToken;
}

function card(title, value, note = "") {
  return `<section class="card">
    <div class="card-title">${escapeHtml(title)}</div>
    <div class="card-value">${formatNumber(value)}</div>
    ${note ? `<div class="card-note">${escapeHtml(note)}</div>` : ""}
  </section>`;
}

function statusCard(title, ok, note = "") {
  return `<section class="card ${ok ? "ok" : "bad"}">
    <div class="card-title">${escapeHtml(title)}</div>
    <div class="card-value status">${ok ? "OK" : "Check"}</div>
    ${note ? `<div class="card-note">${escapeHtml(note)}</div>` : ""}
  </section>`;
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function renderSectionTable(rows = []) {
  return `<table>
    <thead>
      <tr>
        <th>Section</th>
        <th>Top 10 Items</th>
        <th>Watchlist Items</th>
        <th>Any Top 10</th>
        <th>3+ Top 10</th>
        <th>Full Top 10</th>
        <th>Taste Labels</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${formatNumber(row.topTenItems)}</td>
        <td>${formatNumber(row.watchlistItems)}</td>
        <td>${formatNumber(row.usersWithTopTenItem)}</td>
        <td>${formatNumber(row.usersWithThreeTopTen)}</td>
        <td>${formatNumber(row.usersWithFullTopTen)}</td>
        <td>${formatNumber(row.usersWithTasteLabel)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function renderKeyCountTable(rows = [], emptyText = "No data yet") {
  if (!rows.length) return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  return `<table>
    <thead><tr><th>Status</th><th>Count</th></tr></thead>
    <tbody>
      ${rows.map((row) => `<tr><td>${escapeHtml(row.key)}</td><td>${formatNumber(row.count)}</td></tr>`).join("")}
    </tbody>
  </table>`;
}

function renderDashboard(snapshot) {
  const { users, discussions, aiCache, health } = snapshot;
  const aiHour = health?.aiApi?.lastHour || {};
  const aiDay = health?.aiApi?.last24h || {};
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DialogBot Analytics</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #64748b;
      --line: #d8dee8;
      --accent: #16836b;
      --ok: #16836b;
      --bad: #b42318;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101418;
        --panel: #171d23;
        --text: #edf2f7;
        --muted: #9aa7b7;
        --line: #2a3542;
        --accent: #3fc49f;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
      margin-bottom: 24px;
    }
    h1 { margin: 0; font-size: 28px; }
    h2 { margin: 28px 0 12px; font-size: 18px; }
    .muted { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px 16px;
    }
    .card.ok { border-color: color-mix(in srgb, var(--ok) 45%, var(--line)); }
    .card.bad { border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); }
    .card-title { color: var(--muted); font-size: 13px; }
    .card-value { font-size: 30px; font-weight: 700; margin-top: 4px; }
    .card-value.status { color: var(--accent); }
    .card.bad .card-value.status { color: var(--bad); }
    .card-note { color: var(--muted); font-size: 12px; margin-top: 6px; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; }
    th { color: var(--muted); font-weight: 600; font-size: 12px; }
    tr:last-child td { border-bottom: 0; }
    a { color: var(--accent); }
    .footer { margin-top: 24px; font-size: 13px; color: var(--muted); }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>DialogBot Analytics</h1>
        <div class="muted">Generated ${escapeHtml(new Date(snapshot.generatedAt).toLocaleString())}</div>
      </div>
      <a href="/api/snapshot">JSON</a>
    </header>

    <h2>Health</h2>
    <div class="grid">
      ${statusCard("Dashboard Server", true, `Up for ${formatNumber(Math.round(process.uptime()))}s`)}
      ${statusCard(
        "Database",
        Boolean(health?.database?.connected),
        health?.database?.connected
          ? `${health.database.name || "MongoDB"} on ${health.database.host || "connected"}`
          : `readyState ${health?.database?.readyState ?? "unknown"}`,
      )}
      ${statusCard(
        "Bot Heartbeat",
        Boolean(health?.bot?.recentlySeen),
        health?.bot?.lastHeartbeatAt
          ? `Last seen ${formatNumber(health.bot.heartbeatAgeSeconds)}s ago`
          : "No heartbeat yet; start the bot to enable this",
      )}
      ${statusCard(
        "AI Last Hour",
        (aiHour.failureRate || 0) < 0.25,
        `${formatNumber(aiHour.total)} calls, ${formatNumber(aiHour.failures)} failed (${percent(aiHour.failureRate)})`,
      )}
      ${card("AI Avg Latency 1h", aiHour.avgDurationMs || 0, "Milliseconds")}
      ${card("AI Calls 24h", aiDay.total || 0, `${formatNumber(aiDay.failures || 0)} failed (${percent(aiDay.failureRate)})`)}
    </div>

    <h2>Recent AI Failures</h2>
    <div class="panel">${renderKeyCountTable(
    (health?.aiApi?.recentFailures || []).map((event) => ({
      key: `${event.operation || "ai"} / ${event.provider || "provider"}: ${event.reason || "failed"}`,
      count: event.durationMs || 0,
    })),
    "No AI failures in the last 24 hours",
  )}</div>

    <h2>Users</h2>
    <div class="grid">
      ${card("Total Users", users.total)}
      ${card("New 24h", users.new24h)}
      ${card("New 7d", users.new7d)}
      ${card("Onboarding Complete", users.onboardingCompleted)}
      ${card("Onboarding Skipped", users.onboardingSkipped)}
      ${card("Named Profiles", users.namedProfiles)}
      ${card("Active In Discussion", users.activeDiscussionUsers)}
      ${card("Saved Profile Users", users.savedProfileUsers)}
      ${card("Banned", users.banned)}
    </div>

    <h2>Lists And Taste</h2>
    <div class="panel">${renderSectionTable(snapshot.lists)}</div>

    <h2>Discussions</h2>
    <div class="grid">
      ${card("Total Discussions", discussions.total)}
      ${card("Open", discussions.open)}
      ${card("Closed", discussions.closed)}
      ${card("Bot Starter Rooms", discussions.botCreated)}
      ${card("Created 24h", discussions.created24h)}
      ${card("Created 7d", discussions.created7d)}
      ${card("Active 7d", discussions.active7d)}
      ${card("Total Members", discussions.totalMembers, "Sum across rooms")}
      ${card("Messages", discussions.totalMessages)}
      ${card("Reports", discussions.totalReports)}
    </div>

    <h2>Invitations</h2>
    <div class="panel">${renderKeyCountTable(snapshot.invitations)}</div>

    <h2>AI Cache</h2>
    <div class="grid">
      ${card("Cached Responses", aiCache.total)}
      ${card("Used Entries", aiCache.usedEntries)}
      ${card("Cache Hits", aiCache.totalHits)}
    </div>

    <p class="footer">This dashboard is read-only and uses existing product data. Event-based analytics should be added next.</p>
  </main>
</body>
</html>`;
}

async function writeResponse(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

async function handleRequest(req, res, { token }) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!isAuthorized(req, url, token)) {
    return writeResponse(res, 401, "text/plain; charset=utf-8", "Unauthorized");
  }

  if (url.pathname === "/health") {
    return writeResponse(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true }));
  }

  if (url.pathname === "/api/snapshot") {
    const snapshot = await getAnalyticsSnapshot();
    return writeResponse(res, 200, "application/json; charset=utf-8", JSON.stringify(snapshot, null, 2));
  }

  if (url.pathname === "/") {
    const snapshot = await getAnalyticsSnapshot();
    return writeResponse(res, 200, "text/html; charset=utf-8", renderDashboard(snapshot));
  }

  return writeResponse(res, 404, "text/plain; charset=utf-8", "Not found");
}

async function main() {
  const config = getRuntimeConfig();
  const host = process.env.ADMIN_DASHBOARD_HOST || DEFAULT_HOST;
  const port = Number(process.env.ADMIN_DASHBOARD_PORT || DEFAULT_PORT);
  const token = String(process.env.ADMIN_DASHBOARD_TOKEN || "").trim();

  if (!token && !LOCAL_HOSTS.has(host)) {
    throw new Error("ADMIN_DASHBOARD_TOKEN is required when dashboard host is not localhost.");
  }

  if (!token) {
    logger.warn("ADMIN_DASHBOARD_TOKEN is not set; dashboard is local-only.");
  }

  await connectDB(config);
  const server = http.createServer((req, res) => {
    handleRequest(req, res, { token }).catch((error) => {
      logger.error("Analytics dashboard request failed", error);
      void writeResponse(res, 500, "text/plain; charset=utf-8", "Internal server error");
    });
  });

  server.listen(port, host, () => {
    logger.info("Analytics dashboard started", { host, port });
  });

  async function shutdown(reason) {
    logger.info("Stopping analytics dashboard", { reason });
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await disconnectDB();
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => {
      process.exitCode = 0;
    });
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => {
      process.exitCode = 0;
    });
  });
}

main().catch((error) => {
  logger.error("Analytics dashboard failed to start", error);
  process.exitCode = 1;
});
