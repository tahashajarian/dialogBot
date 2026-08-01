const test = require("node:test");
const assert = require("node:assert/strict");

const { retrieveMusicCandidates } = require("../src/services/music-candidate-retriever");

test("music retrieval searches discovered catalogue artists when Persian seeds do not resolve", async () => {
  const requestedTerms = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const term = parsed.searchParams.get("term") || parsed.searchParams.get("q") || "";
    requestedTerms.push(term);
    if (parsed.hostname === "itunes.apple.com" && /Babak Jahanbakhsh/i.test(term)) {
      return {
        ok: true,
        json: async () => ({
          results: [{ kind: "song", trackName: "Mano Baroon", artistName: "Babak Jahanbakhsh" }],
        }),
      };
    }
    return { ok: true, json: async () => ({ results: [], data: [] }) };
  };

  const result = await retrieveMusicCandidates({
    favorites: ["کجایی — محسن چاوشی"],
    discoveryArtists: ["Babak Jahanbakhsh"],
  }, { fetchImpl, timeoutMs: 1000 });

  assert.ok(requestedTerms.some((term) => /Babak Jahanbakhsh/i.test(term)));
  assert.deepEqual(result.map(({ title, artist }) => ({ title, artist })), [{
    title: "Mano Baroon",
    artist: "Babak Jahanbakhsh",
  }]);
});
