const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");

test("update hot path never awaits a bot appearance database refresh", () => {
  const processStart = source.indexOf("async function processUpdate(ctx)");
  const processEnd = source.indexOf("\nfunction finishTrackedUpdate", processStart);
  const processSource = source.slice(processStart, processEnd);

  assert.equal(processSource.includes("refreshBotAppearance"), false);
  assert.equal(processSource.includes("appearanceRefreshMs"), false);
  assert.equal(processSource.includes("formatBotText"), true);
});

test("runtime settings load concurrently and appearance refreshes in the background", () => {
  assert.match(source, /Promise\.allSettled\(\[\s*refreshOperationalLimits/);
  assert.match(source, /appearanceRefreshLoop\.start\(\)/);
  assert.match(source, /appearanceRefreshLoop\.stop\(\)/);
});

test("indexed outer user lookup has a bounded execution time", () => {
  assert.match(
    source,
    /User\.findOne\(\{ userId: normalizedSource\.id \}\)\.maxTimeMS\(HOT_PATH_QUERY_TIMEOUT_MS\)/,
  );
});
