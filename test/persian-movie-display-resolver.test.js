const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePersianMovieDisplay,
  resolvePersianMovieDisplay,
} = require("../src/services/persian-movie-display-resolver");

test("Persian movie display parser accepts only Persian identities", () => {
  assert.deepEqual(parsePersianMovieDisplay('{"localizedTitle":"زندگی‌های گذشته","localizedCreator":"سلین سانگ"}'), {
    localizedTitle: "زندگی‌های گذشته",
    localizedCreator: "سلین سانگ",
  });
  assert.deepEqual(parsePersianMovieDisplay('{"localizedTitle":"Past Lives","localizedCreator":"Celine Song"}'), {
    localizedTitle: "",
    localizedCreator: "",
  });
});

test("Persian movie display resolution uses only verified identity input", async () => {
  let request;
  const result = await resolvePersianMovieDisplay({
    userId: 1,
    title: "Past Lives",
    creator: "Celine Song",
  }, {
    client: {},
    config: {},
    requestText: async (_client, value) => {
      request = value;
      return { text: '{"localizedTitle":"زندگی‌های گذشته","localizedCreator":"سلین سانگ"}' };
    },
  });
  assert.equal(result.localizedTitle, "زندگی‌های گذشته");
  assert.equal(request.input, "Original title: Past Lives\nCreator: Celine Song");
});
