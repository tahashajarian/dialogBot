const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chooseMostCertainRealMusicCandidate,
  parseChosenIndex,
} = require("../src/services/ai-music-candidate-chooser");

test("music chooser parses only a valid candidate number or NONE", () => {
  assert.equal(parseChosenIndex("5", 6), 4);
  assert.equal(parseChosenIndex("CANDIDATE 2", 6), 1);
  assert.equal(parseChosenIndex("NONE", 6), -1);
  assert.equal(parseChosenIndex("7", 6), -1);
  assert.equal(parseChosenIndex("probably 2", 6), -1);
});

test("music chooser sends at most six exact pairs and returns the selected index", async () => {
  const requests = [];
  const result = await chooseMostCertainRealMusicCandidate({
    userId: 42,
    candidates: Array.from({ length: 7 }, (_, index) => ({
      title: `Song ${index + 1}`,
      metadata: `Artist: Artist ${index + 1}`,
    })),
  }, {
    config: {},
    client: {},
    requestText: async (_client, request) => {
      requests.push(request);
      return { text: "6" };
    },
  });

  assert.deepEqual(result, { ok: true, index: 5 });
  assert.equal(requests.length, 1);
  assert.match(requests[0].input, /1\. Song 1 — Artist 1/);
  assert.match(requests[0].input, /6\. Song 6 — Artist 6/);
  assert.doesNotMatch(requests[0].input, /Song 7/);
});
