#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { PRESETS } = require("./qa-suggestion-presets");
const {
  getRuntimeDependencies,
  normalizeScenario,
  runScenario,
} = require("./qa-ai-suggestions");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const MAX_BODY_BYTES = 512 * 1024;
const STATIC_ROOT = path.join(__dirname, "qa-ui");

function parseWebArgs(argv = process.argv.slice(2)) {
  const options = { host: DEFAULT_HOST, port: DEFAULT_PORT, open: true };
  for (const arg of argv) {
    if (arg === "--no-open") options.open = false;
    else if (arg.startsWith("--host=")) options.host = arg.slice("--host=".length).trim() || DEFAULT_HOST;
    else if (arg.startsWith("--port=")) {
      const value = Number.parseInt(arg.slice("--port=".length), 10);
      if (Number.isInteger(value) && value > 0 && value < 65536) options.port = value;
    }
  }
  return options;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "application/javascript; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function writeEvent(response, type, payload) {
  if (response.destroyed || response.writableEnded) return;
  response.write(`${JSON.stringify({ type, ...payload })}\n`);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function serializePresets() {
  return Object.entries(PRESETS).map(([id, preset]) => ({
    id,
    label: preset.label,
    section: preset.section,
    lang: preset.lang,
    userText: preset.userText || "",
    favorites: [...preset.favorites],
    watchlist: [...(preset.watchlist || [])],
    rejected: [...(preset.rejected || [])],
    liked: [...(preset.liked || [])],
  }));
}

function safeStaticPath(urlPath) {
  const requested = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(STATIC_ROOT, requested);
  if (!absolutePath.startsWith(`${STATIC_ROOT}${path.sep}`) && absolutePath !== path.join(STATIC_ROOT, "index.html")) {
    return null;
  }
  return absolutePath;
}

function openBrowser(url) {
  const command = process.platform === "win32"
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    const child = childProcess.spawn(command[0], command[1], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // The URL is printed even when automatic browser opening is unavailable.
  }
}

function createQaWebServer({ runtimeFactory = getRuntimeDependencies } = {}) {
  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && requestUrl.pathname === "/api/presets") {
      sendJson(response, 200, { presets: serializePresets() });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        apiConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.API_KEY),
        mode: "local-read-only-qa",
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/run") {
      let disconnected = false;
      request.on("aborted", () => {
        disconnected = true;
      });
      response.on("close", () => {
        if (!response.writableEnded) disconnected = true;
      });

      try {
        const body = await readJsonBody(request);
        const scenario = normalizeScenario(body.scenario, body.scenario?.id || "web-custom");
        const count = Math.min(20, Math.max(1, Number.parseInt(body.count, 10) || 1));
        const runtime = runtimeFactory();
        const aiConfig = runtime.getAiConfig();
        if (!aiConfig.apiKey) {
          sendJson(response, 400, {
            error: "OPENAI_API_KEY or API_KEY is required in .env for live QA suggestions.",
          });
          return;
        }

        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Connection": "keep-alive",
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        writeEvent(response, "start", {
          count,
          profile: scenario.id,
          startedAt: new Date().toISOString(),
        });

        const results = await runScenario(scenario, {
          count,
          mood: body.mood,
          reject: Array.isArray(body.rejected) ? body.rejected.join("|") : "",
          like: Array.isArray(body.liked) ? body.liked.join("|") : "",
          silent: true,
          verbose: Boolean(body.verbose),
          isCancelled: () => disconnected,
          onResult: async (result) => {
            writeEvent(response, "result", { result });
          },
        }, runtime);

        writeEvent(response, "complete", {
          completed: results.length,
          cancelled: disconnected,
        });
        if (!response.writableEnded) response.end();
      } catch (error) {
        if (response.headersSent) {
          writeEvent(response, "error", { error: error?.message || String(error) });
          if (!response.writableEnded) response.end();
        } else {
          sendJson(response, 400, { error: error?.message || String(error) });
        }
      }
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const filePath = safeStaticPath(requestUrl.pathname);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentType(filePath),
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

async function main() {
  require("dotenv").config({ quiet: true });
  const options = parseWebArgs();
  const server = createQaWebServer();
  server.listen(options.port, options.host, () => {
    const url = `http://${options.host}:${options.port}`;
    console.log(`Muze Suggestion Lab is running at ${url}`);
    console.log("This local QA page does not write to MongoDB, Telegram, quotas, or Stars.");
    console.log("Press Ctrl+C to stop it.");
    if (options.open) openBrowser(url);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Suggestion Lab failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createQaWebServer,
  parseWebArgs,
  serializePresets,
};
