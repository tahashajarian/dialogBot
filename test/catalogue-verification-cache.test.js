const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearCatalogueVerificationCache,
  readCatalogueVerification,
  writeCatalogueVerification,
} = require("../src/services/catalogue-verification-cache");

test("catalogue cache reuses verified metadata but keeps the current reason", () => {
  clearCatalogueVerificationCache();
  const first = { title: "Dark", metadata: "AI metadata", reason: "First reason." };
  writeCatalogueVerification("movies", first, {
    ok: true,
    suggestion: {
      ...first,
      metadata: "2017 · Creator: Baran bo Odar",
      wikidataId: "Q564976",
    },
  });

  const current = { ...first, reason: "Current personalized reason." };
  const cached = readCatalogueVerification("movies", current);
  assert.equal(cached.suggestion.metadata, "2017 · Creator: Baran bo Odar");
  assert.equal(cached.suggestion.reason, "Current personalized reason.");
  assert.equal(cached.suggestion.wikidataId, "Q564976");
});

test("catalogue cache stores mismatches but not outages", () => {
  clearCatalogueVerificationCache();
  const suggestion = { title: "Invented", metadata: "Nobody", reason: "Reason." };
  writeCatalogueVerification("books", suggestion, {
    ok: false,
    reason: "catalog_unverified",
    qualityIssue: "catalog_title_mismatch",
  });
  assert.equal(readCatalogueVerification("books", suggestion).reason, "catalog_unverified");

  const outage = { title: "Unavailable", metadata: "Nobody", reason: "Reason." };
  writeCatalogueVerification("books", outage, { ok: false, reason: "catalog_unavailable" });
  assert.equal(readCatalogueVerification("books", outage), null);
});
