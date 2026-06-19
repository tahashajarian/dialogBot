const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isEnabled,
  normalizeLevel,
  serializeError,
} = require("../src/services/logger");

test("logger normalizes known and unknown levels", () => {
  assert.equal(normalizeLevel("debug"), "debug");
  assert.equal(normalizeLevel("WARN"), "warn");
  assert.equal(normalizeLevel("unknown"), "info");
});

test("logger level filtering respects priority", () => {
  assert.equal(isEnabled("error", "warn"), true);
  assert.equal(isEnabled("warn", "warn"), true);
  assert.equal(isEnabled("info", "warn"), false);
  assert.equal(isEnabled("debug", "silent"), false);
});

test("logger serializes errors into stable details", () => {
  const error = new Error("boom");
  error.code = "E_TEST";

  const serialized = serializeError(error);

  assert.equal(serialized.name, "Error");
  assert.equal(serialized.message, "boom");
  assert.equal(serialized.code, "E_TEST");
  assert.equal(typeof serialized.stack, "string");
});
