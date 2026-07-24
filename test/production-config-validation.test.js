const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProductionEnvironment } = require("../scripts/validate-production-config");

const base = {
  BOT_TOKEN: "telegram-bot-token",
  MONGO_URI: "mongodb://127.0.0.1:27017/muze",
  ACCOUNT_DELETION_SECRET: "a".repeat(40),
};

test("production validation checks bot configuration without requiring the optional dashboard", () => {
  assert.equal(validateProductionEnvironment(base), true);
});

test("production dashboard validation is explicit and requires its strong token", () => {
  assert.throws(
    () => validateProductionEnvironment(base, { dashboard: true }),
    /ADMIN_DASHBOARD_TOKEN must be at least 32 characters/,
  );
  assert.equal(validateProductionEnvironment({
    ...base,
    ADMIN_DASHBOARD_TOKEN: "d".repeat(40),
  }, { dashboard: true }), true);
});
