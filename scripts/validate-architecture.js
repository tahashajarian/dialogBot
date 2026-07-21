const fs = require("node:fs");
const path = require("node:path");
const { callBacks } = require("../src/constants");
const { TELEGRAM_CALLBACK_DATA_MAX_BYTES } = require("../src/services/callback-contracts");

const SOURCE_ROOT = "src";

// These are existing compatibility seams, not preferred dependencies. New direct
// model imports in flows or dispatchers must be added only after moving the rule
// behind its owning service has been considered.
const DIRECT_MODEL_IMPORT_ALLOWLIST = Object.freeze({
  "src/bot.js": [],
  "src/callbacks.js": [],
  "src/flows/discussion-invitations.js": ["../models/user"],
  "src/flows/discussions-text.js": ["../models/user"],
  "src/flows/profile-favorites.js": ["../models/user"],
  "src/flows/saved-profiles.js": ["../models/user", "../models/discussion"],
});

const UI_MODEL_IMPORT_ALLOWLIST = Object.freeze({
  // This renderer performs a read-only member lookup. It should eventually
  // receive prepared data from the discussion service.
  "src/services/discussion-ui.js": ["../models/user"],
});

const STAR_TRANSACTION_IMPORT_ALLOWLIST = new Set([
  "src/services/account-deletion.js",
  "src/services/analytics-dashboard.js",
  "src/services/stars.js",
]);

const ROUTING_IMPORT_ALLOWLIST = Object.freeze({
  "src/flows/ai-callback-routing.js": ["../constants", "../services/callback-contracts"],
  "src/flows/bot-routing.js": ["../messages"],
  "src/flows/saved-profiles-routing.js": ["../constants", "../services/people-discovery-ui"],
});

const DISPATCHER_EXECUTION_IMPORT_DENYLIST = Object.freeze({
  "src/callbacks.js": [
    "./services/discussion-actions",
    "./services/discussion-member-profiles",
    "./services/discussion-room-ui",
    "./services/discussions",
    "./services/public-profile-navigation",
    "./flows/ai-input-prompts",
    "./flows/ai-text",
  ],
});

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function extractRequires(source = "") {
  const imports = [];
  const pattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of String(source).matchAll(pattern)) imports.push(match[1]);
  return imports;
}

function isDirectModelImport(importPath) {
  return /(?:^|\/)models\//.test(importPath);
}

function isFlowOrDispatcher(relativePath) {
  return relativePath === "src/bot.js"
    || relativePath === "src/callbacks.js"
    || relativePath.startsWith("src/flows/");
}

function isUiService(relativePath) {
  return relativePath.startsWith("src/services/") && relativePath.endsWith("-ui.js");
}

function violation(relativePath, rule, detail) {
  return { file: relativePath, rule, detail };
}

function analyzeSource(relativeFilePath, source) {
  const relativePath = normalizePath(relativeFilePath);
  const imports = extractRequires(source);
  const violations = [];

  if (isFlowOrDispatcher(relativePath)) {
    const allowed = new Set(DIRECT_MODEL_IMPORT_ALLOWLIST[relativePath] || []);
    for (const importPath of imports.filter(isDirectModelImport)) {
      if (!allowed.has(importPath)) {
        violations.push(violation(
          relativePath,
          "flow-model-boundary",
          `Move direct model import '${importPath}' behind its owning service.`,
        ));
      }
    }
  }

  if (isUiService(relativePath)) {
    const allowed = new Set(UI_MODEL_IMPORT_ALLOWLIST[relativePath] || []);
    for (const importPath of imports.filter(isDirectModelImport)) {
      if (!allowed.has(importPath)) {
        violations.push(violation(
          relativePath,
          "ui-model-boundary",
          `UI service must receive prepared data instead of importing '${importPath}'.`,
        ));
      }
    }
  }

  if (imports.some((importPath) => importPath.endsWith("models/star-transaction"))
    && !STAR_TRANSACTION_IMPORT_ALLOWLIST.has(relativePath)) {
    violations.push(violation(
      relativePath,
      "star-ledger-boundary",
      "StarTransaction access belongs in the ledger, audit cleanup, or analytics services.",
    ));
  }

  if (relativePath.endsWith("-routing.js")) {
    const allowed = new Set(ROUTING_IMPORT_ALLOWLIST[relativePath] || []);
    for (const importPath of imports) {
      if (!allowed.has(importPath)) {
        violations.push(violation(
          relativePath,
          "routing-purity",
          `Routing contracts must not depend on '${importPath}'. Add execution to a flow handler instead.`,
        ));
      }
    }
  }

  const forbiddenExecutionImports = new Set(DISPATCHER_EXECUTION_IMPORT_DENYLIST[relativePath] || []);
  for (const importPath of imports) {
    if (forbiddenExecutionImports.has(importPath)) {
      violations.push(violation(
        relativePath,
        "dispatcher-execution-boundary",
        `Route '${importPath}' through its focused flow handler.`,
      ));
    }
  }

  return violations;
}

function analyzeCallbackConstants(callbacks = callBacks) {
  const violations = [];
  for (const [name, value] of Object.entries(callbacks)) {
    const byteLength = Buffer.byteLength(String(value || ""), "utf8");
    if (!value || byteLength > TELEGRAM_CALLBACK_DATA_MAX_BYTES) {
      violations.push(violation(
        "src/constants/index.js",
        "callback-data-size",
        `${name} uses ${byteLength} bytes; Telegram permits at most ${TELEGRAM_CALLBACK_DATA_MAX_BYTES}.`,
      ));
    }
  }
  return violations;
}

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(absolutePath));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolutePath);
  }
  return files;
}

function validateArchitecture(projectRoot = path.resolve(__dirname, "..")) {
  const sourceRoot = path.join(projectRoot, SOURCE_ROOT);
  const violations = analyzeCallbackConstants();
  for (const absolutePath of listJavaScriptFiles(sourceRoot)) {
    const relativePath = normalizePath(path.relative(projectRoot, absolutePath));
    violations.push(...analyzeSource(relativePath, fs.readFileSync(absolutePath, "utf8")));
  }
  return violations;
}

function run() {
  const violations = validateArchitecture();
  if (!violations.length) {
    console.log("Architecture boundaries OK.");
    return;
  }
  for (const item of violations) {
    console.error(`${item.file} [${item.rule}] ${item.detail}`);
  }
  process.exitCode = 1;
}

if (require.main === module) run();

module.exports = {
  DIRECT_MODEL_IMPORT_ALLOWLIST,
  DISPATCHER_EXECUTION_IMPORT_DENYLIST,
  ROUTING_IMPORT_ALLOWLIST,
  STAR_TRANSACTION_IMPORT_ALLOWLIST,
  UI_MODEL_IMPORT_ALLOWLIST,
  analyzeCallbackConstants,
  analyzeSource,
  extractRequires,
  validateArchitecture,
};
