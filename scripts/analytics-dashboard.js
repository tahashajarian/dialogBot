require("dotenv").config();

const http = require("http");
const { URL, URLSearchParams } = require("url");
const connectDB = require("../src/db");
const { disconnectDB } = require("../src/db");
const { getRuntimeConfig } = require("../src/config");
const { getAnalyticsSnapshot } = require("../src/services/analytics-dashboard");
const { logger } = require("../src/services/logger");
const {
  LIMIT_DEFINITIONS,
  updateOperationalLimits,
} = require("../src/services/operational-limits");
const {
  STAR_SETTING_DEFINITIONS,
  updateStarSettings,
} = require("../src/services/star-settings");
const {
  updateBotAppearance,
} = require("../src/services/bot-appearance");

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

function renderStarTransactionTable(rows = []) {
  if (!rows.length) return `<p class="muted">No Star transactions yet</p>`;
  return `<table>
    <thead><tr><th>Type</th><th>Transactions</th><th>Net amount</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td>${escapeHtml(row.key)}</td>
      <td>${formatNumber(row.count)}</td>
      <td>${formatNumber(row.amount)}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderEventTable(rows = [], emptyText = "No events yet") {
  if (!rows.length) return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  return `<table>
    <thead><tr><th>Event</th><th>Events</th><th>Users</th></tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>
        <td>${escapeHtml(row.key)}</td>
        <td>${formatNumber(row.count)}</td>
        <td>${formatNumber(row.users)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function sectionKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function collapsibleSection(title, body, { open = false, note = "" } = {}) {
  return `<details class="section" data-section="${escapeHtml(sectionKey(title))}" ${open ? "open" : ""}>
    <summary>
      <span>${escapeHtml(title)}</span>
      ${note ? `<small>${escapeHtml(note)}</small>` : ""}
    </summary>
    <div class="section-body">${body}</div>
  </details>`;
}

function renderLimitsForm(values = {}, action = "/limits", { updatedAt = null, saved = false } = {}) {
  const groups = {};
  for (const [key, definition] of Object.entries(LIMIT_DEFINITIONS)) {
    if (!groups[definition.group]) groups[definition.group] = [];
    groups[definition.group].push({ key, ...definition, value: values[key] ?? definition.default });
  }
  return `${saved ? `<div class="notice success">Limits saved. Restart the bot to activate them.</div>` : ""}
  <form method="post" action="${escapeHtml(action)}" class="limits-form">
    ${Object.entries(groups).map(([group, fields]) => `<fieldset>
      <legend>${escapeHtml(group)}</legend>
      <div class="limit-grid">${fields.map((field) => `<label class="setting-field">
        <span class="setting-label">${escapeHtml(field.label)}</span>
        ${field.description ? `<small>${escapeHtml(field.description)}</small>` : ""}
        <input type="number" name="${escapeHtml(field.key)}" value="${escapeHtml(field.value)}"
          min="${field.min}" max="${field.max}" step="1" required />
        <small class="setting-range">Range ${formatNumber(field.min)}-${formatNumber(field.max)}</small>
      </label>`).join("")}</div>
    </fieldset>`).join("")}
    <div class="form-actions"><button type="submit">Save limits</button><span class="muted">Restart the bot to activate saved changes.</span></div>
    <div class="muted limit-updated">${updatedAt ? `Last changed ${escapeHtml(new Date(updatedAt).toLocaleString())}` : "Using defaults; no admin changes saved yet."}</div>
  </form>`;
}

function renderStarSettingsForm(values = {}, action = "/star-settings", {
  updatedAt = null,
  saved = false,
  cacheTtlSeconds = 60,
} = {}) {
  const groups = {};
  for (const [key, definition] of Object.entries(STAR_SETTING_DEFINITIONS)) {
    if (!groups[definition.group]) groups[definition.group] = [];
    groups[definition.group].push({ key, ...definition, value: values[key] ?? definition.default });
  }
  return `${saved ? `<div class="notice success">Star economy settings saved. Bot processes refresh them within about ${formatNumber(cacheTtlSeconds)} seconds.</div>` : ""}
  <form method="post" action="${escapeHtml(action)}" class="limits-form star-settings-form">
    ${Object.entries(groups).map(([group, fields]) => `<fieldset>
      <legend>${escapeHtml(group)}</legend>
      <div class="limit-grid">${fields.map((field) => {
    if (field.type === "boolean") {
      return `<label class="setting-field">
        <span class="setting-label">${escapeHtml(field.label)}</span>
        <small>${escapeHtml(field.description || "")}</small>
        <input type="hidden" name="${escapeHtml(field.key)}" value="false" />
        <input type="checkbox" name="${escapeHtml(field.key)}" value="true" ${field.value ? "checked" : ""} />
      </label>`;
    }
    return `<label class="setting-field">
      <span class="setting-label">${escapeHtml(field.label)}${field.unit ? ` (${escapeHtml(field.unit)})` : ""}</span>
      <small>${escapeHtml(field.description || "")}</small>
      <input type="number" name="${escapeHtml(field.key)}" value="${escapeHtml(field.value)}"
        min="${field.min}" max="${field.max}" step="1" required />
      <small class="setting-range">Range ${formatNumber(field.min)}-${formatNumber(field.max)}</small>
    </label>`;
  }).join("")}</div>
    </fieldset>`).join("")}
    <div class="form-actions"><button type="submit">Save Star settings</button><span class="muted">Changes affect future transactions only.</span></div>
    <div class="muted limit-updated">${updatedAt ? `Last changed ${escapeHtml(new Date(updatedAt).toLocaleString())}` : "Using defaults; no admin changes saved yet."}</div>
  </form>`;
}

function renderBotAppearanceForm(values = {}, action = "/bot-appearance", {
  updatedAt = null,
  saved = false,
  cacheTtlSeconds = 60,
} = {}) {
  return `${saved ? `<div class="notice success">Bot appearance saved. Bot processes refresh it within about ${formatNumber(cacheTtlSeconds)} seconds.</div>` : ""}
  <form method="post" action="${escapeHtml(action)}" class="limits-form">
    <fieldset>
      <legend>Bot messages</legend>
      <div class="limit-grid">
        <label class="setting-field">
          <span class="setting-label">Bot message emoji</span>
          <small>Used where bot-authored guidance currently starts with the Muze marker. This emoji is reserved from profile emoji choices.</small>
          <input type="text" name="botEmoji" value="${escapeHtml(values.botEmoji || "👩‍🦳")}" maxlength="16" required />
        </label>
      </div>
    </fieldset>
    <div class="form-actions"><button type="submit">Save bot appearance</button><span class="muted">Changes affect newly sent/edited messages.</span></div>
    <div class="muted limit-updated">${updatedAt ? `Last changed ${escapeHtml(new Date(updatedAt).toLocaleString())}` : "Using defaults; no admin changes saved yet."}</div>
  </form>`;
}

function renderDashboard(snapshot, { actionSuffix = "" } = {}) {
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
      --soft-line: #edf0f5;
      --accent: #16836b;
      --ok: #16836b;
      --bad: #b42318;
      --shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101418;
        --panel: #171d23;
        --text: #edf2f7;
        --muted: #9aa7b7;
        --line: #2a3542;
        --soft-line: #222b35;
        --accent: #3fc49f;
        --shadow: none;
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
    .stack {
      display: grid;
      gap: 12px;
      margin-top: 18px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .compact-grid { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
    .card {
      background: var(--panel);
      border: 1px solid var(--soft-line);
      border-radius: 8px;
      padding: 14px 16px;
      box-shadow: var(--shadow);
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
      border: 1px solid var(--soft-line);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: var(--shadow);
    }
    details.section {
      background: var(--panel);
      border: 1px solid var(--soft-line);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: var(--shadow);
    }
    details.section > summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 14px;
      font-weight: 700;
    }
    details.section > summary::-webkit-details-marker { display: none; }
    details.section > summary::after {
      content: "+";
      color: var(--accent);
      font-size: 18px;
      line-height: 1;
    }
    details.section[open] > summary {
      border-bottom: 1px solid var(--soft-line);
    }
    details.section[open] > summary::after { content: "-"; }
    details.section small {
      color: var(--muted);
      font-weight: 500;
      margin-left: auto;
    }
    .section-body { padding: 12px; }
    .section-body > .panel,
    .section-body > .grid { margin: 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; }
    th { color: var(--muted); font-weight: 600; font-size: 12px; }
    tbody tr + tr td { border-top: 1px solid var(--soft-line); }
    a { color: var(--accent); }
    .footer { margin-top: 24px; font-size: 13px; color: var(--muted); }
    .limits-form { display: grid; gap: 18px; }
    fieldset { border: 0; padding: 0; margin: 0; }
    legend { font-weight: 700; margin-bottom: 8px; }
    .limit-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .setting-field {
      display: grid;
      gap: 7px;
      color: var(--muted);
      font-size: 13px;
      border: 1px solid var(--soft-line);
      border-radius: 8px;
      padding: 12px;
      background: color-mix(in srgb, var(--panel) 92%, var(--bg));
    }
    .setting-label { color: var(--text); font-weight: 700; }
    .setting-range { font-size: 12px; }
    input { width: 100%; padding: 10px 11px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); }
    input[type="checkbox"] { width: 22px; height: 22px; }
    .form-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    button { border: 0; border-radius: 6px; padding: 10px 16px; background: var(--accent); color: white; font-weight: 700; cursor: pointer; }
    .notice { padding: 10px 12px; margin-bottom: 14px; border-radius: 6px; }
    .notice.success { color: var(--ok); border: 1px solid color-mix(in srgb, var(--ok) 45%, var(--line)); background: color-mix(in srgb, var(--ok) 8%, var(--panel)); }
    .limit-updated { font-size: 12px; }
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

    <div class="stack">
      ${collapsibleSection("Bot Limits", renderLimitsForm(snapshot.limits, `/limits${actionSuffix}`, {
    updatedAt: snapshot.limitsUpdatedAt,
    saved: new URLSearchParams(actionSuffix).get("saved") === "1",
  }), { open: true, note: "editable product quotas" })}
      ${collapsibleSection("Star Economy", renderStarSettingsForm(snapshot.starSettings, `/star-settings${actionSuffix}`, {
    updatedAt: snapshot.starSettingsUpdatedAt,
    saved: new URLSearchParams(actionSuffix).get("saved") === "stars",
    cacheTtlSeconds: snapshot.starSettingsCacheTtlSeconds,
  }), { open: false, note: "rewards, costs, safeguards, rollout" })}
      ${collapsibleSection("Bot Appearance", renderBotAppearanceForm(snapshot.botAppearance, `/bot-appearance${actionSuffix}`, {
    updatedAt: snapshot.botAppearanceUpdatedAt,
    saved: new URLSearchParams(actionSuffix).get("saved") === "appearance",
    cacheTtlSeconds: snapshot.botAppearanceCacheTtlSeconds,
  }), { open: false, note: "bot-authored message marker" })}
      ${collapsibleSection("Stars Health", `<div class="grid compact-grid">
      ${card("Outstanding Stars", snapshot.stars?.outstanding || 0)}
      ${card("Unique Earners", snapshot.stars?.earners || 0)}
      ${card("Unique Spenders", snapshot.stars?.spenders || 0)}
      ${card("Active Boosts", snapshot.stars?.activeBoosts || 0)}
      ${card("Qualified Referrals", snapshot.stars?.qualifiedReferrals || 0)}
      ${statusCard(
        "Balance Reconciliation",
        snapshot.stars?.reconciliationMismatches === 0,
        snapshot.stars?.reconciliationMismatches === null
          ? "Reconciliation unavailable"
          : `${formatNumber(snapshot.stars?.reconciliationMismatches || 0)} mismatches across ${formatNumber(snapshot.stars?.reconciliationChecked || 0)} checked wallets`,
      )}
    </div><div class="panel">${renderStarTransactionTable(snapshot.stars?.transactions || [])}</div>`, { note: "ledger and effects" })}
      ${collapsibleSection("Health", `<div class="grid compact-grid">
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
    </div>`, { open: true, note: "server, db, bot, AI" })}

      ${collapsibleSection("Recent AI Failures", `<div class="panel">${renderKeyCountTable(
    (health?.aiApi?.recentFailures || []).map((event) => ({
      key: `${event.operation || "ai"} / ${event.provider || "provider"}: ${event.reason || "failed"}`,
      count: event.durationMs || 0,
    })),
    "No AI failures in the last 24 hours",
  )}</div>`, { note: "last 24h" })}

      ${collapsibleSection("Users", `<div class="grid compact-grid">
      ${card("Total Users", users.total)}
      ${card("New 24h", users.new24h)}
      ${card("New 7d", users.new7d)}
      ${card("Onboarding Complete", users.onboardingCompleted)}
      ${card("Onboarding Skipped", users.onboardingSkipped)}
      ${card("Named Profiles", users.namedProfiles)}
      ${card("Active In Discussion", users.activeDiscussionUsers)}
      ${card("Saved Profile Users", users.savedProfileUsers)}
      ${card("Banned", users.banned)}
    </div>`, { open: true, note: "growth and profile state" })}

      ${collapsibleSection("Product Funnel", `<div class="panel">${renderEventTable(snapshot.events?.funnel7d || [], "No funnel events yet")}</div>`, { open: true, note: "last 7 days" })}

      ${collapsibleSection("Events, Last 24 Hours", `<div class="panel">${renderEventTable(snapshot.events?.last24h || [])}</div>`, { note: "detailed" })}

      ${collapsibleSection("Events, Last 7 Days", `<div class="panel">${renderEventTable(snapshot.events?.last7d || [])}</div>`, { note: "detailed" })}

      ${collapsibleSection("Top 10 Adds By Section", `<div class="panel">${renderEventTable(snapshot.events?.topTenBySection7d || [])}</div>`, { note: "last 7 days" })}

      ${collapsibleSection("Suggestion Requests By Section", `<div class="panel">${renderEventTable(snapshot.events?.suggestionsBySection7d || [])}</div>`, { note: "last 7 days" })}

      ${collapsibleSection("Lists And Taste", `<div class="panel">${renderSectionTable(snapshot.lists)}</div>`, { note: "all sections" })}

      ${collapsibleSection("Discussions", `<div class="grid compact-grid">
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
    </div>`, { open: true, note: "rooms and activity" })}

      ${collapsibleSection("Invitations", `<div class="panel">${renderKeyCountTable(snapshot.invitations)}</div>`, { note: "by status" })}

      ${collapsibleSection("AI Cache", `<div class="grid compact-grid">
      ${card("Cached Responses", aiCache.total)}
      ${card("Used Entries", aiCache.usedEntries)}
      ${card("Cache Hits", aiCache.totalHits)}
    </div>`, { note: "reuse stats" })}
    </div>

    <p class="footer">This dashboard updates every 30 seconds and remembers collapsed sections.</p>
  </main>
  <script>
    const sectionStateKey = "dialogbot.dashboard.sections";
    const loadSectionState = () => {
      try {
        return JSON.parse(localStorage.getItem(sectionStateKey) || "{}");
      } catch {
        return {};
      }
    };
    const saveSectionState = () => {
      const state = {};
      document.querySelectorAll("details.section").forEach((section) => {
        state[section.dataset.section] = section.open;
      });
      localStorage.setItem(sectionStateKey, JSON.stringify(state));
    };
    const state = loadSectionState();
    document.querySelectorAll("details.section").forEach((section) => {
      if (Object.prototype.hasOwnProperty.call(state, section.dataset.section)) {
        section.open = Boolean(state[section.dataset.section]);
      }
      section.addEventListener("toggle", saveSectionState);
    });
    let formDirty = false;
    document.querySelectorAll(".limits-form").forEach((form) => {
      form.addEventListener("input", () => { formDirty = true; });
    });
    setTimeout(() => {
      saveSectionState();
      if (!formDirty) window.location.reload();
    }, 30000);
  </script>
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

async function readFormBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100000) throw new Error("Request body too large");
  }
  return Object.fromEntries(new URLSearchParams(body));
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

  if (url.pathname === "/limits" && req.method === "POST") {
    await updateOperationalLimits(await readFormBody(req));
    const redirectParams = new URLSearchParams(url.searchParams);
    redirectParams.set("saved", "1");
    res.writeHead(303, { location: `/?${redirectParams.toString()}`, "cache-control": "no-store" });
    return res.end();
  }

  if (url.pathname === "/star-settings" && req.method === "POST") {
    await updateStarSettings(await readFormBody(req), { actor: "analytics-dashboard" });
    const redirectParams = new URLSearchParams(url.searchParams);
    redirectParams.set("saved", "stars");
    res.writeHead(303, { location: `/?${redirectParams.toString()}`, "cache-control": "no-store" });
    return res.end();
  }

  if (url.pathname === "/bot-appearance" && req.method === "POST") {
    await updateBotAppearance(await readFormBody(req), { actor: "analytics-dashboard" });
    const redirectParams = new URLSearchParams(url.searchParams);
    redirectParams.set("saved", "appearance");
    res.writeHead(303, { location: `/?${redirectParams.toString()}`, "cache-control": "no-store" });
    return res.end();
  }

  if (url.pathname === "/") {
    const snapshot = await getAnalyticsSnapshot();
    return writeResponse(res, 200, "text/html; charset=utf-8", renderDashboard(snapshot, { actionSuffix: url.search }));
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
