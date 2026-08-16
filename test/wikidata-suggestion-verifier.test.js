const test = require("node:test");
const assert = require("node:assert/strict");
const { URL } = require("url");

const {
  addSearchNamesToEntities,
  chooseWikidataEntity,
  getEntityMediaType,
  verifyWikidataBookCandidate,
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

test("Wikidata enforces separate Movie and Series sections", async () => {
  const dark = {
    id: "Q526306",
    labels: { en: { value: "Dark" } },
    aliases: {},
    claims: {
      P31: [claim("P31", "Q5398426")],
      P170: [claim("P170", "QCREATOR")],
    },
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.searchParams.get("action") === "wbsearchentities") {
      const title = parsed.searchParams.get("search");
      return jsonResponse({ search: [{ id: title === "Dark" ? dark.id : perfectDays.id, label: title }] });
    }
    const ids = parsed.searchParams.get("ids");
    const entity = ids === dark.id ? dark : perfectDays;
    return jsonResponse({ entities: { [entity.id]: entity } });
  };

  const seriesAsMovie = await verifyWikidataSuggestion(
    { title: "Dark", metadata: "Creator: Baran bo Odar" },
    { section: "movies", fetchImpl },
  );
  const movieAsSeries = await verifyWikidataSuggestion(
    { title: "Perfect Days", metadata: "Director: Wim Wenders" },
    { section: "series", fetchImpl },
  );
  assert.equal(seriesAsMovie.reason, "catalog_wrong_media_type");
  assert.equal(movieAsSeries.reason, "catalog_wrong_media_type");
});

test("Wikidata verification rejects a movie paired with the wrong creator", async () => {
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

  assert.equal(result.ok, false);
  assert.equal(result.qualityIssue, "catalog_creator_mismatch");
});

test("Wikidata verification preserves a verified creator spelling", async () => {
  const fetchImpl = async (url) => {
    const action = new URL(url).searchParams.get("action");
    if (action === "wbsearchentities") return jsonResponse({ search: [{ id: perfectDays.id }] });
    const ids = new URL(url).searchParams.get("ids");
    if (ids === perfectDays.id) return jsonResponse({ entities: { [perfectDays.id]: perfectDays } });
    return jsonResponse({ entities: { Q554975: {
      id: "Q554975",
      labels: { en: { value: "Wim Wenders" }, fa: { value: "ویم وندرس" } },
      aliases: {},
      claims: {},
    } } });
  };
  const result = await verifyWikidataSuggestion({
    ok: true,
    title: "Perfect Days",
    metadata: "2023 · Director: ویم وندرس",
  }, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.suggestion.metadata, "2023 · Director: ویم وندرس");
});


test("Wikidata verification accepts a real movie when year is unavailable", async () => {
  const noYearMovie = {
    ...perfectDays,
    claims: {
      P31: perfectDays.claims.P31,
      P57: perfectDays.claims.P57,
    },
  };
  const fetchImpl = async (url) => {
    const action = new URL(url).searchParams.get("action");
    if (action === "wbsearchentities") {
      return jsonResponse({ search: [{ id: noYearMovie.id }] });
    }
    const ids = new URL(url).searchParams.get("ids");
    if (ids === noYearMovie.id) {
      return jsonResponse({ entities: { [noYearMovie.id]: noYearMovie } });
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
    metadata: "Director: Wim Wenders",
    reason: "Quiet routines and delicate observation shape its reflective mood.",
  }, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.suggestion.metadata, "Director: Wim Wenders");
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

test("Wikidata book verification requires an exact title and author relationship", async () => {
  const book = {
    id: "QBOOK",
    labels: { en: { value: "The Sound and the Fury" } },
    aliases: { fa: [{ value: "خشم و هیاهو" }] },
    claims: {
      P31: [claim("P31", "Q8261")],
      P50: [claim("P50", "QAUTHOR")],
    },
  };
  const fetchImpl = async (url) => {
    const action = new URL(url).searchParams.get("action");
    if (action === "wbsearchentities") {
      return jsonResponse({ search: [{ id: book.id, label: "The Sound and the Fury" }] });
    }
    const ids = new URL(url).searchParams.get("ids");
    if (ids === book.id) return jsonResponse({ entities: { [book.id]: book } });
    return jsonResponse({ entities: { QAUTHOR: {
      id: "QAUTHOR",
      labels: { en: { value: "William Faulkner" } },
      aliases: {},
      claims: {},
    } } });
  };

  const verified = await verifyWikidataBookCandidate({
    originalTitle: "The Sound and the Fury",
    originalAuthor: "William Faulkner",
  }, { fetchImpl });
  assert.equal(verified.ok, true);
  assert.equal(verified.source, "wikidata");
  assert.ok(verified.aliases.includes("خشم و هیاهو"));

  const mismatch = await verifyWikidataBookCandidate({
    originalTitle: "The Sound and the Fury",
    originalAuthor: "Wrong Author",
  }, { fetchImpl });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.qualityIssue, "catalog_creator_mismatch");
});

test("Wikidata accepts an exact title-author relationship with unusual book classification", async () => {
  const work = {
    id: "QWORK",
    labels: { en: { value: "Exact Work" } },
    aliases: {},
    claims: {
      P31: [claim("P31", "QUNUSUAL")],
      P50: [claim("P50", "QAUTHOR")],
    },
  };
  const fetchImpl = async (url) => {
    const params = new URL(url).searchParams;
    if (params.get("action") === "wbsearchentities") {
      return jsonResponse({ search: [{ id: work.id, label: "Exact Work" }] });
    }
    if (params.get("ids") === work.id) return jsonResponse({ entities: { [work.id]: work } });
    return jsonResponse({ entities: { QAUTHOR: {
      id: "QAUTHOR",
      labels: { en: { value: "Exact Author" } },
      aliases: {},
      claims: {},
    } } });
  };

  const result = await verifyWikidataBookCandidate({
    originalTitle: "Exact Work",
    originalAuthor: "Exact Author",
  }, { fetchImpl });

  assert.equal(result.ok, true);
});

test("Wikidata does not accept a movie as a book even with an author claim", async () => {
  const movie = {
    id: "QMOVIE",
    labels: { en: { value: "Exact Work" } },
    aliases: {},
    claims: {
      P31: [claim("P31", "Q11424")],
      P50: [claim("P50", "QAUTHOR")],
    },
  };
  const result = await verifyWikidataBookCandidate({
    originalTitle: "Exact Work",
    originalAuthor: "Exact Author",
  }, {
    fetchImpl: async (url) => new URL(url).searchParams.get("action") === "wbsearchentities"
      ? jsonResponse({ search: [{ id: movie.id, label: "Exact Work" }] })
      : jsonResponse({ entities: { [movie.id]: movie } }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.qualityIssue, "catalog_title_mismatch");
});
