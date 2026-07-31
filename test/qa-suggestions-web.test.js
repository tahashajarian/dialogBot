const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createQaWebServer,
  parseWebArgs,
  serializePresets,
} = require("../scripts/qa-suggestions-web");

async function withServer(runtimeFactory, callback) {
  const server = createQaWebServer({ runtimeFactory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("QA web arguments support local port and no-open mode", () => {
  assert.deepEqual(parseWebArgs(["--port=4400", "--host=127.0.0.1", "--no-open"]), {
    host: "127.0.0.1",
    port: 4400,
    open: false,
  });
});

test("QA web dashboard exposes diverse editable starter profiles", () => {
  const presets = serializePresets();
  assert.equal(presets.length, 22);
  assert.equal(presets.filter((preset) => preset.lang === "fa").length, 13);
  assert.equal(presets.filter((preset) => preset.lang === "en").length, 9);
  assert.ok(presets.every((preset) => preset.favorites.length >= 3));
});

test("QA web server serves the dashboard and preset API", async () => {
  await withServer(() => ({}), async (baseUrl) => {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Muze Suggestion Lab/);

    const response = await fetch(`${baseUrl}/api/presets`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.presets.length, 22);
  });
});

test("QA web server streams suggestion results without persistence", async () => {
  let calls = 0;
  const runtimeFactory = () => ({
    getAiConfig: () => ({ apiKey: "test-key" }),
    generateUsableSuggestion: async () => {
      calls += 1;
      return {
        ok: true,
        title: `Result ${calls}`,
        metadata: "Author: Test Author",
        reason: "Precise detail and humane tension; quiet and strong.",
      };
    },
    extractSuggestionCreator: () => "Test Author",
    formatSuggestionResultMessage: (_lang, title) => `My suggestion: ${title}`,
  });

  await withServer(runtimeFactory, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count: 2,
        scenario: {
          id: "web-test",
          label: "Web test",
          section: "books",
          lang: "en",
          favorites: ["Favorite — Author"],
        },
      }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row));
    assert.equal(events[0].type, "start");
    assert.equal(events.filter((event) => event.type === "result").length, 2);
    assert.equal(events.at(-1).type, "complete");
    assert.equal(calls, 2);
  });
});
