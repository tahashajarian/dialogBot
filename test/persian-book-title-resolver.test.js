const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearPersianBookTitleCache,
  normalizeResolvedPersianTitle,
  resolvePersianBookTitle,
} = require("../src/services/persian-book-title-resolver");

test("Persian book title resolver accepts only concise Persian titles", () => {
  assert.equal(normalizeResolvedPersianTitle("«آسمان سرپناه»"), "آسمان سرپناه");
  assert.equal(normalizeResolvedPersianTitle("UNSURE"), "");
  assert.equal(normalizeResolvedPersianTitle("The Sheltering Sky"), "");
});

test("Persian book title resolver is cached and uses only title and author input", async () => {
  clearPersianBookTitleCache();
  const requests = [];
  const options = {
    client: {},
    config: { timeoutMs: 1000 },
    requestText: async (_client, request) => {
      requests.push(request);
      return { text: "آسمان سرپناه" };
    },
  };
  const input = {
    userId: 42,
    title: "The Sheltering Sky",
    metadata: "Author: Paul Bowles · 1949",
  };

  assert.equal(await resolvePersianBookTitle(input, options), "آسمان سرپناه");
  assert.equal(await resolvePersianBookTitle(input, options), "آسمان سرپناه");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, "Original title: The Sheltering Sky\nAuthor: Paul Bowles");
  assert.equal(requests[0].maxOutputTokens, 40);
});

test("uncertain Persian book titles fall back without throwing", async () => {
  clearPersianBookTitleCache();
  const result = await resolvePersianBookTitle({
    userId: 42,
    title: "Unknown Book",
    metadata: "Author: Known Writer · 2000",
  }, {
    client: {},
    config: {},
    requestText: async () => ({ text: "UNSURE" }),
  });
  assert.equal(result, "");
});
