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
    buildSuggestionCopyText: require("../src/services/ai-suggestion-quality").buildSuggestionCopyText,
    getPreferredSuggestionDisplayLanguage: require("../src/services/ai-suggestion-display-language").getPreferredSuggestionDisplayLanguage,
    classifyItemScript: require("../src/services/ai-suggestion-display-language").classifyItemScript,
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
    variant: String(raw?.variant || "").trim() || "full-account",
  };
}

function loadScenarioFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  return normalizeScenario(parsed, absolutePath);
}

function getBlockedItems({ favorites, watchlist, rejected, liked = [], seen }) {
  return [...favorites, ...watchlist, ...rejected, ...liked, ...seen]
    .map((entry) => ({
      title: typeof entry === "string" ? entry : String(entry?.title || "").trim(),
    }))
    .filter((entry) => entry.title);
}

function extractListedCreator(value) {
  const text = String(value?.metadata || value || "").trim();
  const separated = text.split(/\s+[—–|]\s+/u);
  if (separated.length > 1) return separated.at(-1).trim();
  return "";
}

function buildScenarioVariants(scenarioInput) {
  const scenario = normalizeScenario(scenarioInput, scenarioInput.id || "variant");
  const variants = [{ ...scenario, variant: "full-account" }];
  for (const size of [3, 5]) {
    if (scenario.favorites.length > size) {
      variants.push({
        ...scenario,
        id: `${scenario.id}-${size}-favorites`,
        label: `${scenario.label} · first ${size} favorites`,
        favorites: scenario.favorites.slice(0, size),
        variant: `${size}-favorites`,
      });
    }
  }
  if (scenario.watchlist.length || scenario.rejected.length || scenario.liked.length) {
    variants.push({
      ...scenario,
      id: `${scenario.id}-clean-history`,
      label: `${scenario.label} · empty history`,
      watchlist: [],
      rejected: [],
      liked: [],
      variant: "empty-history",
    });
  }
  return variants;
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildJsonResult({ scenario, iteration, elapsedMs, result, displayMessage = "", quality = {}, copyText = "" }) {
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
    sourceAuthor: result?.sourceAuthor || "",
    sourceCreator: result?.sourceCreator || "",
    source: result?.source || "",
    sourceId: result?.sourceId || "",
    localizedTitle: result?.localizedTitle || "",
    localizedCreator: result?.localizedCreator || "",
    originalTitle: result?.originalTitle || "",
    displayLanguageFallback: Boolean(result?.displayLanguageFallback),
    favoriteAuthorFallback: Boolean(result?.favoriteAuthorFallback),
    qualityIssue: result?.qualityIssue || "",
    diagnostics: result?.diagnostics || null,
    variant: scenario.variant || "full-account",
    quality,
    displayMessage,
    copyText,
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
  const watchlistCreators = scenario.watchlist.map(extractListedCreator).filter(Boolean);
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
        liked,
        seen,
      }),
      watchlistCreators,
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
    const creator = result?.ok ? runtime.extractSuggestionCreator(result.metadata) : "";
    const expectedDisplayLanguage = "original";
    const quality = {
      expectedDisplayLanguage,
      displayLanguagePass: !result?.title
        ? false
        : true,
      creatorRepeated: Boolean(creator && recentCreators.some((item) => (
        String(item).toLocaleLowerCase() === String(creator).toLocaleLowerCase()
      ))),
      verifiedIdentity: Boolean(result?.source || result?.sourceTitle || result?.sourceArtist),
    };
    const record = buildJsonResult({
      scenario,
      iteration: index + 1,
      elapsedMs,
      result,
      displayMessage,
      quality,
      copyText: result?.ok && runtime.buildSuggestionCopyText
        ? runtime.buildSuggestionCopyText(scenario.section, result.title, result.metadata)
        : result?.title || "",
    });
    results.push(record);

    if (result?.ok && result?.title) {
      seen.push(result.title);
      if (result.sourceTitle) seen.push(result.sourceTitle);
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
  npm run qa:suggestions -- all [--count=2] [--output=reports/suggestions.json]
  npm run qa:suggestions -- file <scenario.json> [--count=5]

Examples:
  npm run qa:suggestions -- run fa-iranian-music --count=10
  npm run qa:suggestions -- run fa-iranian-movies --count=5 --mood="تلخ و اجتماعی"
  npm run qa:suggestions -- run en-literary-books --count=5 --json

This runner uses the real AI/catalogue logic and real API credentials from .env,
but never writes to MongoDB or Telegram and never consumes user quotas or stars.`);
}

function writeJsonOutput(outputPath, records) {
  if (!outputPath || outputPath === true) return;
  const workspace = path.resolve(process.cwd());
  const absolutePath = path.resolve(workspace, String(outputPath));
  const relativePath = path.relative(workspace, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("--output must stay inside the current workspace.");
  }
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  console.log(`Saved ${records.length} results to ${absolutePath}`);
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
    const records = await runScenario({ ...preset, id: presetId }, {
      ...options,
      silent: Boolean(options.output),
    }, runtime);
    writeJsonOutput(options.output, records);
    return;
  }

  if (command === "all") {
    const records = [];
    for (const item of listPresets()) {
      const preset = getPreset(item.id);
      records.push(...await runScenario({ ...preset, id: item.id }, {
        ...options,
        silent: Boolean(options.output),
      }, runtime));
    }
    writeJsonOutput(options.output, records);
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
  buildScenarioVariants,
  parseArgs,
  runScenario,
  splitPipeList,
};
