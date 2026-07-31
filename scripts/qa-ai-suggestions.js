#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { getPreset, listPresets } = require("./qa-suggestion-presets");

const MAX_RUN_COUNT = 20;

function getRuntimeDependencies() {
  return {
    getAiConfig: require("../src/config").getAiConfig,
    generateUsableSuggestion: require("../src/services/ai-suggestion-generation").generateUsableSuggestion,
    formatSuggestionResultMessage: require("../src/services/ai-list-ui").formatSuggestionResultMessage,
    extractSuggestionCreator: require("../src/services/ai-suggestion-quality").extractSuggestionCreator,
  };
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
  const positional = [];
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [rawKey, ...valueParts] = arg.slice(2).split("=");
    const key = rawKey.trim();
    options[key] = valueParts.length ? valueParts.join("=") : true;
  }
  return { positional, options };
}

function splitPipeList(value) {
  return String(value || "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeScenario(raw, sourceLabel = "custom") {
  const section = String(raw?.section || "").trim();
  const lang = String(raw?.lang || "").trim();
  const favorites = Array.isArray(raw?.favorites)
    ? raw.favorites.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  if (!["books", "movies", "music"].includes(section)) {
    throw new Error(`${sourceLabel}: section must be books, movies, or music.`);
  }
  if (!["fa", "en"].includes(lang)) {
    throw new Error(`${sourceLabel}: lang must be fa or en.`);
  }
  if (!favorites.length) {
    throw new Error(`${sourceLabel}: favorites must contain at least one item.`);
  }
  return {
    id: String(raw?.id || sourceLabel),
    label: String(raw?.label || sourceLabel),
    section,
    lang,
    userText: String(raw?.userText || "").trim(),
    favorites,
    watchlist: Array.isArray(raw?.watchlist) ? raw.watchlist : [],
    rejected: Array.isArray(raw?.rejected) ? raw.rejected : [],
    liked: Array.isArray(raw?.liked) ? raw.liked : [],
  };
}

function loadScenarioFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  return normalizeScenario(parsed, absolutePath);
}

function getBlockedItems({ favorites, watchlist, rejected, seen }) {
  return [...favorites, ...watchlist, ...rejected, ...seen]
    .map((entry) => ({
      title: typeof entry === "string" ? entry : String(entry?.title || "").trim(),
    }))
    .filter((entry) => entry.title);
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildJsonResult({ scenario, iteration, elapsedMs, result, displayMessage = "" }) {
  return {
    preset: scenario.id,
    section: scenario.section,
    lang: scenario.lang,
    iteration,
    elapsedMs,
    ok: Boolean(result?.ok && result?.title),
    title: result?.title || "",
    metadata: result?.metadata || "",
    mood: result?.mood || "",
    reason: result?.reason || "",
    sourceTitle: result?.sourceTitle || "",
    sourceArtist: result?.sourceArtist || "",
    localizedTitle: result?.localizedTitle || "",
    localizedCreator: result?.localizedCreator || "",
    originalTitle: result?.originalTitle || "",
    qualityIssue: result?.qualityIssue || "",
    displayMessage,
  };
}

async function runScenario(scenarioInput, options = {}, runtime = getRuntimeDependencies()) {
  const scenario = normalizeScenario(scenarioInput, scenarioInput.id || "preset");
  const count = Math.min(MAX_RUN_COUNT, Math.max(1, parseInteger(options.count, 3)));
  const userText = String(options.mood || scenario.userText || "").trim();
  const rejected = [...scenario.rejected, ...splitPipeList(options.reject)];
  const liked = [...scenario.liked, ...splitPipeList(options.like)];
  const seen = [];
  const recentCreators = [];
  const results = [];

  if (!options.json && !options.silent) {
    console.log(`\n=== ${scenario.id}: ${scenario.label} ===`);
    console.log(`Section: ${scenario.section} | Language: ${scenario.lang} | Runs: ${count}`);
    console.log(`Favorites: ${scenario.favorites.length}${userText ? ` | Request: ${userText}` : ""}`);
    console.log("No database, quota, stars, or Telegram state will be changed.\n");
  }

  for (let index = 0; index < count; index += 1) {
    if (typeof options.isCancelled === "function" && options.isCancelled()) break;

    const startedAt = Date.now();
    const result = await runtime.generateUsableSuggestion({
      userId: `qa-${scenario.id}`,
      section: scenario.section,
      lang: scenario.lang,
      userText,
      topTenItems: [...scenario.favorites],
      watchlistItems: [...scenario.watchlist],
      recentSuggestionItems: [...seen],
      rejectedSuggestionItems: [...rejected],
      likedSuggestionItems: [...liked],
      recentSuggestionCreators: [...recentCreators],
      blockedSuggestionItems: getBlockedItems({
        favorites: scenario.favorites,
        watchlist: scenario.watchlist,
        rejected,
        seen,
      }),
      tasteStyleHint: "",
    });
    const elapsedMs = Date.now() - startedAt;
    const displayMessage = result?.ok && result?.title
      ? runtime.formatSuggestionResultMessage(
        scenario.lang,
        result.title,
        result.reason,
        userText,
        result.metadata,
        {
          localizedTitle: result.localizedTitle,
          localizedCreator: result.localizedCreator,
          originalTitle: result.originalTitle,
          section: scenario.section,
        },
      )
      : "";
    const record = buildJsonResult({
      scenario,
      iteration: index + 1,
      elapsedMs,
      result,
      displayMessage,
    });
    results.push(record);

    if (result?.ok && result?.title) {
      seen.push(result.title);
      if (result.sourceTitle) seen.push(result.sourceTitle);
      const creator = runtime.extractSuggestionCreator(result.metadata);
      if (creator) recentCreators.push(creator);
    }

    if (!options.json && !options.silent) {
      console.log(`--- Run ${index + 1}/${count} (${formatDuration(elapsedMs)}) ---`);
      if (!result?.ok || !result?.title) {
        console.log(`FAILED: ${result?.reason || "missing_result"}${result?.qualityIssue ? ` / ${result.qualityIssue}` : ""}\n`);
      } else {
        console.log(displayMessage);
        if (options.verbose && (result.sourceTitle || result.sourceArtist)) {
          console.log(`\n[source] ${result.sourceTitle || result.title}${result.sourceArtist ? ` — ${result.sourceArtist}` : ""}`);
        }
        console.log("");
      }
    }

    if (typeof options.onResult === "function") {
      await options.onResult(record, result);
    }
  }

  if (options.json && !options.silent) console.log(JSON.stringify(results, null, 2));
  return results;
}

function printPresets() {
  console.log("Available QA suggestion presets:\n");
  for (const preset of listPresets()) {
    console.log(`${preset.id.padEnd(22)} ${preset.section.padEnd(6)} ${preset.lang}  ${preset.label} (${preset.favorites})`);
  }
}

function printHelp() {
  console.log(`Usage:
  npm run qa:suggestions -- list
  npm run qa:suggestions -- run <preset> [--count=5] [--mood="..."] [--reject="a|b"] [--verbose]
  npm run qa:suggestions -- all [--count=2]
  npm run qa:suggestions -- file <scenario.json> [--count=5]

Examples:
  npm run qa:suggestions -- run fa-iranian-music --count=10
  npm run qa:suggestions -- run fa-iranian-movies --count=5 --mood="تلخ و اجتماعی"
  npm run qa:suggestions -- run en-literary-books --count=5 --json

This runner uses the real AI/catalogue logic and real API credentials from .env,
but never writes to MongoDB or Telegram and never consumes user quotas or stars.`);
}

async function main() {
  const { positional, options } = parseArgs();
  const command = positional[0] || "help";

  if (["help", "--help", "-h"].includes(command)) {
    printHelp();
    return;
  }
  if (command === "list") {
    printPresets();
    return;
  }

  require("dotenv").config({ quiet: true });
  const runtime = getRuntimeDependencies();
  const aiConfig = runtime.getAiConfig();
  if (!aiConfig.apiKey) {
    throw new Error("OPENAI_API_KEY or API_KEY is required in .env for live QA suggestions.");
  }

  if (command === "run") {
    const presetId = positional[1];
    const preset = getPreset(presetId);
    if (!preset) throw new Error(`Unknown preset: ${presetId || "(missing)"}. Run 'npm run qa:suggestions -- list'.`);
    await runScenario({ ...preset, id: presetId }, options, runtime);
    return;
  }

  if (command === "all") {
    for (const item of listPresets()) {
      const preset = getPreset(item.id);
      await runScenario({ ...preset, id: item.id }, options, runtime);
    }
    return;
  }

  if (command === "file") {
    const filePath = positional[1];
    if (!filePath) throw new Error("A JSON scenario file path is required.");
    await runScenario(loadScenarioFile(filePath), options, runtime);
    return;
  }

  const directPreset = getPreset(command);
  if (directPreset) {
    await runScenario({ ...directPreset, id: command }, options, runtime);
    return;
  }

  throw new Error(`Unknown command: ${command}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`QA suggestion runner failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildJsonResult,
  getBlockedItems,
  getRuntimeDependencies,
  loadScenarioFile,
  normalizeScenario,
  parseArgs,
  runScenario,
  splitPipeList,
};
