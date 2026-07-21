const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeCallbackConstants,
  analyzeSource,
  extractRequires,
  validateArchitecture,
} = require("../scripts/validate-architecture");

test("architecture analyzer extracts static CommonJS imports", () => {
  assert.deepEqual(
    extractRequires('const User = require("../models/user");\nrequire("./flow");'),
    ["../models/user", "./flow"],
  );
});

test("new flow and UI model imports fail with actionable rules", () => {
  const flow = analyzeSource("src/flows/example.js", 'require("../models/user");');
  const ui = analyzeSource("src/services/example-ui.js", 'require("../models/discussion");');
  assert.equal(flow[0].rule, "flow-model-boundary");
  assert.match(flow[0].detail, /owning service/);
  assert.equal(ui[0].rule, "ui-model-boundary");
});

test("central callback dispatcher cannot regain direct model access", () => {
  const violations = analyzeSource("src/callbacks.js", 'require("./models/user");');
  assert.equal(violations[0].rule, "flow-model-boundary");
});

test("central callback dispatcher cannot regain discussion room execution dependencies", () => {
  const source = [
    'const actions = require("./services/discussion-actions");',
    'const roomUi = require("./services/discussion-room-ui");',
  ].join("\n");
  const violations = analyzeSource("src/callbacks.js", source);
  assert.deepEqual(
    violations.map((item) => item.rule),
    ["dispatcher-execution-boundary", "dispatcher-execution-boundary"],
  );
});

test("central callback dispatcher cannot regain public-profile navigation execution", () => {
  const violations = analyzeSource(
    "src/callbacks.js",
    'const navigation = require("./services/public-profile-navigation");',
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "dispatcher-execution-boundary");
});

test("central callback dispatcher cannot regain callback lifecycle dependencies", () => {
  const source = [
    'const prompts = require("./flows/ai-input-prompts");',
    'const aiText = require("./flows/ai-text");',
  ].join("\n");
  const violations = analyzeSource("src/callbacks.js", source);
  assert.deepEqual(
    violations.map((item) => item.rule),
    ["dispatcher-execution-boundary", "dispatcher-execution-boundary"],
  );
});

test("existing compatibility seams and service-owned models remain accepted", () => {
  assert.deepEqual(
    analyzeSource("src/flows/saved-profiles.js", 'require("../models/user");\nrequire("../models/discussion");'),
    [],
  );
  assert.deepEqual(analyzeSource("src/services/discussions.js", 'require("../models/discussion");'), []);
});

test("Star ledger model access is restricted to designated services", () => {
  const violations = analyzeSource(
    "src/services/example.js",
    'require("../models/star-transaction");',
  );
  assert.equal(violations[0].rule, "star-ledger-boundary");
});

test("routing contracts cannot acquire execution dependencies", () => {
  const violations = analyzeSource(
    "src/flows/example-routing.js",
    'require("../services/stars");',
  );
  assert.equal(violations[0].rule, "routing-purity");
  assert.match(violations[0].detail, /flow handler/);
});

test("callback constants must fit Telegram callback_data", () => {
  assert.deepEqual(analyzeCallbackConstants({ valid: "profile:edit:name" }), []);
  assert.equal(analyzeCallbackConstants({ oversized: "x".repeat(65) })[0].rule, "callback-data-size");
});

test("the current project satisfies its architecture boundaries", () => {
  assert.deepEqual(validateArchitecture(), []);
});
