const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeVerdict,
  verifyAiMediaPair,
} = require("../src/services/ai-media-pair-verifier");

test("media pair verifier accepts valid and uncertain without adding metadata", async () => {
  const calls = [];
  const valid = await verifyAiMediaPair({
    userId: 1,
    section: "music",
    title: "Gole Yakh",
    metadata: "Artist: Kourosh Yaghmaei · Album: Back From the Brink · 2011",
  }, {
    client: {},
    requestText: async (_client, request) => {
      calls.push(request);
      return { text: "VALID" };
    },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.verdict, "valid");
  assert.match(calls[0].input, /Creator: Kourosh Yaghmaei/);
  assert.doesNotMatch(calls[0].input, /Back From the Brink/);

  const uncertain = await verifyAiMediaPair({
    userId: 1,
    section: "movies",
    title: "A Separation",
    metadata: "Director: Asghar Farhadi",
  }, {
    client: {},
    requestText: async () => ({ text: "UNSURE" }),
  });
  assert.deepEqual(uncertain, { ok: true, verdict: "uncertain" });
});

test("media pair verifier rejects only an explicit invalid pair and fails open", async () => {
  const invalid = await verifyAiMediaPair({
    userId: 1,
    section: "music",
    title: "Gole Yakh",
    metadata: "Artist: Dua Lipa",
  }, {
    client: {},
    requestText: async () => ({ text: "INVALID" }),
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "invalid_title_creator_pair");

  const unavailable = await verifyAiMediaPair({
    userId: 1,
    section: "movies",
    title: "A Separation",
    metadata: "Director: Asghar Farhadi",
  }, {
    client: {},
    requestText: async () => { throw new Error("provider down"); },
  });
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.verdict, "unavailable");
});


test("strict media pair verification rejects uncertain and unavailable results", async () => {
  const uncertain = await verifyAiMediaPair({
    userId: 1,
    section: "music",
    title: "عشق سرعت",
    metadata: "Artist: کیوسک",
    requireCertain: true,
  }, {
    client: {},
    requestText: async () => ({ text: "UNSURE" }),
  });
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.reason, "uncertain_title_creator_pair");

  const unavailable = await verifyAiMediaPair({
    userId: 1,
    section: "music",
    title: "عشق سرعت",
    metadata: "Artist: کیوسک",
    requireCertain: true,
  }, {
    client: {},
    requestText: async () => { throw new Error("provider down"); },
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.reason, "pair_check_unavailable");
});

test("verdict parsing is deliberately narrow", () => {
  assert.equal(normalizeVerdict("valid"), "valid");
  assert.equal(normalizeVerdict("INVALID"), "invalid");
  assert.equal(normalizeVerdict("probably valid"), "uncertain");
});
