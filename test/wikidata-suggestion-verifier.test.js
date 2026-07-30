const test = require("node:test");
const assert = require("node:assert/strict");
const { URL } = require("url");

const {
  addSearchNamesToEntities,
  chooseWikidataEntity,
  getEntityMediaType,
  verifyWikidataSuggestion,
} = require("../src/services/wikidata-suggestion-verifier");

function claim(property, value) {
  const isDate = ["P577", "P580", "P571"].includes(property);
  return {
    mainsnak: {
      datavalue: {
        value: isDate ? { time: value } : { id: value },
      },
    },
  };
}

function jsonResponse(data, ok = true) {
  return {
    ok,
    json: async () => data,
  };
}

const perfectDays = {
  id: "Q115097290",
  labels: { en: { value: "Perfect Days" } },
  aliases: {},
  claims: {
    P31: [claim("P31", "Q11424")],
    P577: [claim("P577", "+2023-05-25T00:00:00Z")],
    P57: [claim("P57", "Q554975")],
  },
};

test("Wikidata matching requires an exact media title and recognizes movies and series", () => {
  const dark = {
    id: "Q526306",
    labels: { en: { value: "Dark" } },
    aliases: {},
    claims: {
      P31: [claim("P31", "Q5398426")],
      P580: [claim("P580", "+2017-12-01T00:00:00Z")],
    },
  };
  assert.equal(getEntityMediaType(perfectDays), "movie");
  assert.equal(getEntityMediaType(dark), "tv");
  assert.equal(getEntityMediaType({
    claims: { P31: [claim("P31", "Q21191270")] },
  }), "");
  assert.equal(
    chooseWikidataEntity({ Q115097290: perfectDays }, "Perfect Days", "2023")?.id,
    "Q115097290",
  );
  assert.equal(
    chooseWikidataEntity({ Q115097290: perfectDays }, "Perfect", "2023"),
    null,
  );
  const originalScript = addSearchNamesToEntities(
    { Q115097290: perfectDays },
    [{
      id: "Q115097290",
      label: "Perfect Days",
      match: { text: "パーフェクト・デイズ" },
    }],
  );
  assert.equal(
    chooseWikidataEntity(originalScript, "パーフェクト・デイズ", "2023")?.id,
    "Q115097290",
  );
});

test("Wikidata verification replaces movie metadata with catalogue facts", async () => {
  const fetchImpl = async (url) => {
    const action = new URL(url).searchParams.get("action");
    if (action === "wbsearchentities") {
      return jsonResponse({ search: [{ id: perfectDays.id }] });
    }
    const ids = new URL(url).searchParams.get("ids");
    if (ids === perfectDays.id) {
      return jsonResponse({ entities: { [perfectDays.id]: perfectDays } });
    }
    return jsonResponse({
      entities: {
        Q554975: {
          id: "Q554975",
          labels: { en: { value: "Wim Wenders" } },
          aliases: {},
          claims: {},
        },
      },
    });
  };

  const result = await verifyWikidataSuggestion({
    ok: true,
    title: "Perfect Days",
    metadata: "2023 · Director: Wrong Name",
    reason: "Quiet routines and delicate observation shape its reflective mood.",
  }, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.suggestion.title, "Perfect Days");
  assert.equal(result.suggestion.metadata, "2023 · Director: Wim Wenders");
  assert.equal(result.suggestion.wikidataId, perfectDays.id);
});

test("Wikidata verification rejects missing and incomplete catalogue entries", async () => {
  const missing = await verifyWikidataSuggestion({
    title: "Invented Film",
    metadata: "2020 · Director: Nobody",
  }, {
    fetchImpl: async (url) => {
      const action = new URL(url).searchParams.get("action");
      return action === "wbsearchentities"
        ? jsonResponse({ search: [] })
        : jsonResponse({ entities: {} });
    },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "catalog_unverified");

  const incomplete = {
    ...perfectDays,
    claims: {
      P31: perfectDays.claims.P31,
      P577: perfectDays.claims.P577,
    },
  };
  const incompleteResult = await verifyWikidataSuggestion({
    title: "Perfect Days",
    metadata: "2023 · Director: Wim Wenders",
  }, {
    fetchImpl: async (url) => {
      const action = new URL(url).searchParams.get("action");
      return action === "wbsearchentities"
        ? jsonResponse({ search: [{ id: incomplete.id }] })
        : jsonResponse({ entities: { [incomplete.id]: incomplete } });
    },
  });
  assert.equal(incompleteResult.qualityIssue, "catalog_missing_metadata");
});
