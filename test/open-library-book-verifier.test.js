const test = require("node:test");
const assert = require("node:assert/strict");

const {
  verifyOpenLibraryBookCandidate,
} = require("../src/services/open-library-book-verifier");

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

test("Open Library verifies canonical identity and uses a verified Persian edition title", async () => {
  const calls = [];
  const candidate = {
    originalTitle: "The Catcher in the Rye",
    originalAuthor: "J. D. Salinger",
    reason: "روایت اول‌شخص و بی‌پرده؛ شهری و ناآرام.",
  };
  const result = await verifyOpenLibraryBookCandidate(candidate, {
    displayLanguage: "fa",
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/editions.json")) {
        return response({
          entries: [
            { title: "The Catcher in the Rye" },
            { title: "ناطور دشت" },
            { title: "ناتور دشت" },
          ],
        });
      }
      return response({
        docs: [{
          key: "/works/OL1W",
          title: "The Catcher in the Rye",
          author_name: ["J. D. Salinger"],
          author_alternative_name: ["Jerome David Salinger", "جی. دی. سلینجر"],
          editions: { docs: [{ title: "ناطور دشت", language: ["per"] }] },
        }],
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.candidate, candidate);
  assert.equal(result.sourceId, "/works/OL1W");
  assert.equal(result.canonicalTitle, "The Catcher in the Rye");
  assert.equal(result.displayTitle, "ناطور دشت");
  assert.equal(result.displayAuthor, "جی. دی. سلینجر");
  assert.ok(result.aliases.includes("ناتور دشت"));
  assert.match(calls[0], /title=The\+Catcher\+in\+the\+Rye/);
  assert.match(calls[0], /author=J\.\+D\.\+Salinger/);
  assert.match(calls[0], /lang=fa/);
  assert.match(calls[1], /\/works\/OL1W\/editions\.json/);
});

test("Open Library falls back to verified canonical title instead of AI localization", async () => {
  const result = await verifyOpenLibraryBookCandidate({
    originalTitle: "Ask the Dust",
    originalAuthor: "John Fante",
  }, {
    displayLanguage: "fa",
    fetchImpl: async (url) => {
      if (String(url).includes("/editions.json")) {
        return response({ entries: [{ title: "Ask the Dust" }] });
      }
      return response({
        docs: [{
          key: "/works/OL2W",
          title: "Ask the Dust",
          author_name: ["John Fante"],
        }],
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.displayTitle, "Ask the Dust");
  assert.equal(result.displayAuthor, "John Fante");
});

test("Open Library rejects a real title paired with the wrong author", async () => {
  const result = await verifyOpenLibraryBookCandidate({
    originalTitle: "The Man Without Qualities",
    originalAuthor: "Robert Walser",
  }, {
    fetchImpl: async () => response({
      docs: [{
        key: "/works/OL3W",
        title: "The Man Without Qualities",
        author_name: ["Robert Musil"],
      }],
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "catalog_unverified");
});

test("Open Library HTTP failures are reported as catalogue unavailability", async () => {
  const result = await verifyOpenLibraryBookCandidate({
    originalTitle: "The Grapes of Wrath",
    originalAuthor: "John Steinbeck",
  }, {
    fetchImpl: async () => response({}, { ok: false, status: 429 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "catalog_unavailable");
  assert.equal(result.diagnostics.status, 429);
});
