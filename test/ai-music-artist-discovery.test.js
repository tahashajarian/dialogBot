const test = require("node:test");
const assert = require("node:assert/strict");

const {
  discoverAdjacentMusicArtists,
  parseArtistDiscovery,
} = require("../src/services/ai-music-artist-discovery");

test("artist discovery accepts only a bounded JSON list", () => {
  assert.deepEqual(parseArtistDiscovery('["Megadeth","Gojira","Megadeth"]'), ["Megadeth", "Gojira"]);
  assert.deepEqual(parseArtistDiscovery("Megadeth, Gojira"), []);
});

test("artist discovery asks for adjacent creators", async () => {
  let request;
  const result = await discoverAdjacentMusicArtists({
    userId: 1,
    favorites: ["Master of Puppets", "Lateralus", "Slither"],
    recentCreators: ["Metallica"],
  }, {
    client: {},
    config: { timeoutMs: 20000 },
    requestText: async (_client, value) => {
      request = value;
      return { text: '["Gojira","Mastodon","Megadeth"]' };
    },
  });
  assert.deepEqual(result, ["Gojira", "Mastodon", "Megadeth"]);
  assert.match(request.instructions, /Do not return an artist represented by a Favorite/);
  assert.ok(request.config.timeoutMs <= 5500);
});
