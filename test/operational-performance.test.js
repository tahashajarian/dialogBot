const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeUpdatePerformanceEvents } = require("../src/services/operational-health");

test("slow update performance aggregates route percentiles without user content", () => {
  const rows = summarizeUpdatePerformanceEvents([
    { operation: "callback:people:list", durationMs: 1600, metadata: { telegramApiTotalMs: 500, userDocumentBytes: 1000 } },
    { operation: "callback:people:list", durationMs: 2200, metadata: { telegramApiTotalMs: 900, userDocumentBytes: 1400 } },
    { operation: "text:active_discussion_message", durationMs: 1800, metadata: { telegramApiTotalMs: 1200, userDocumentBytes: 800 } },
  ]);

  assert.deepEqual(rows, [
    {
      route: "callback:people:list",
      count: 2,
      p50DurationMs: 1600,
      p95DurationMs: 2200,
      p95TelegramMs: 900,
      p95UserDocumentBytes: 1400,
    },
    {
      route: "text:active_discussion_message",
      count: 1,
      p50DurationMs: 1800,
      p95DurationMs: 1800,
      p95TelegramMs: 1200,
      p95UserDocumentBytes: 800,
    },
  ]);
  assert.equal(JSON.stringify(rows).includes("message text"), false);
});
