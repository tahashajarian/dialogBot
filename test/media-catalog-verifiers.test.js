const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chooseMusicBrainzResult,
  verifyMusicBrainzSuggestion,
} = require("../src/services/musicbrainz-suggestion-verifier");
const {
  chooseOpenLibraryResult,
  verifyOpenLibrarySuggestion,
} = require("../src/services/open-library-suggestion-verifier");

function jsonResponse(data, ok = true) {
  return {
    ok,
    json: async () => data,
  };
}

test("MusicBrainz matching requires the exact title and artist", () => {
  const recordings = [{
    id: "recording-1",
    title: "Yuve Yuve Yu",
    "artist-credit": [{ name: "The HU" }],
  }];
  assert.equal(
    chooseMusicBrainzResult(recordings, "Yuve Yuve Yu", "The Hu")?.id,
    "recording-1",
  );
  assert.equal(
    chooseMusicBrainzResult(recordings, "Yuve Yuve Yu", "Hanggai"),
    null,
  );
  assert.equal(
    chooseMusicBrainzResult(recordings, "Yuve", "The HU"),
    null,
  );
  assert.equal(
    chooseMusicBrainzResult(recordings, "Yuve Yuve Yu", "The HU", "Wrong Album"),
    null,
  );
});

test("MusicBrainz verification replaces track metadata with catalogue data", async () => {
  const result = await verifyMusicBrainzSuggestion({
    ok: true,
    title: "Yuve Yuve Yu",
    metadata: "Artist: The Hu · Album: The Gereg · 2010",
    reason: "Throat singing and forceful riffs carry the same ceremonial energy.",
  }, {
    minRequestIntervalMs: 0,
    fetchImpl: async () => jsonResponse({
      recordings: [{
        id: "recording-1",
        title: "Yuve Yuve Yu",
        "artist-credit": [{ name: "The HU" }],
        releases: [
          { title: "Later Compilation", date: "2024-01-01" },
          { title: "The Gereg", date: "2019-09-13" },
        ],
      }],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.suggestion.title, "Yuve Yuve Yu");
  assert.equal(result.suggestion.metadata, "Artist: The HU · Album: The Gereg");
});

test("MusicBrainz verification rejects a track attached to the wrong album", async () => {
  const result = await verifyMusicBrainzSuggestion({
    ok: true,
    title: "Yuve Yuve Yu",
    metadata: "Artist: The Hu · Album: Wrong Album · 2019",
    reason: "Throat singing and forceful riffs carry ceremonial energy.",
  }, {
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => (
      String(url).includes("/recording/")
        ? jsonResponse({
          recordings: [{
            id: "recording-1",
            title: "Yuve Yuve Yu",
            "artist-credit": [{ name: "The HU" }],
            releases: [{ title: "The Gereg", date: "2019-09-13" }],
          }],
        })
        : jsonResponse({ "release-groups": [] })
    ),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "catalog_unverified");
});

test("MusicBrainz verification rejects a real title attached to the wrong artist", async () => {
  let calls = 0;
  const result = await verifyMusicBrainzSuggestion({
    ok: true,
    title: "Yuve Yuve Yu",
    metadata: "Artist: Hanggai · Album: Introducing Hanggai · 2010",
    reason: "Throat singing and forceful riffs carry ceremonial energy.",
  }, {
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      calls += 1;
      if (String(url).includes("/recording/")) {
        return jsonResponse({
          recordings: [{
            id: "recording-1",
            title: "Yuve Yuve Yu",
            "artist-credit": [{ name: "The HU" }],
          }],
        });
      }
      return jsonResponse({ "release-groups": [] });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "catalog_unverified");
});

test("Open Library matching and verification require an exact title and author", async () => {
  const docs = [{
    key: "/works/OL102749W",
    title: "The Remains of the Day",
    author_name: ["Kazuo Ishiguro", "Second Contributor"],
    first_publish_year: 1989,
  }];
  assert.equal(
    chooseOpenLibraryResult(docs, "The Remains of the Day", "Kazuo Ishiguro")?.key,
    "/works/OL102749W",
  );
  assert.equal(
    chooseOpenLibraryResult(docs, "The Remains of the Day", "Another Author"),
    null,
  );

  const result = await verifyOpenLibrarySuggestion({
    ok: true,
    title: "The Remains of the Day",
    metadata: "Author: Kazuo Ishiguro · 1990",
    reason: "Restrained emotion and unreliable memory shape its quiet tension.",
  }, {
    fetchImpl: async () => jsonResponse({ docs }),
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.suggestion.metadata,
    "Author: Kazuo Ishiguro, Second Contributor · 1989",
  );
});

test("Open Library removes punctuation-only duplicate author variants", async () => {
  const result = await verifyOpenLibrarySuggestion({
    ok: true,
    title: "Last Exit to Brooklyn",
    metadata: "Author: Hubert Selby Jr. · 1964",
    reason: "زبان بی‌پرده و فرودستان زخمی؛ خشن و تکان‌دهنده.",
  }, {
    fetchImpl: async () => jsonResponse({
      docs: [{
        key: "/works/OL123W",
        title: "Last Exit to Brooklyn",
        author_name: ["Hubert Selby, Jr.", "Hubert Selby Jr."],
        first_publish_year: 1964,
      }],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.suggestion.metadata, "Author: Hubert Selby, Jr. · 1964");
});

test("Open Library mismatch includes safe candidate diagnostics", async () => {
  const result = await verifyOpenLibrarySuggestion({
    ok: true,
    title: "همه چیز فرو می‌پاشد",
    metadata: "Author: Chinua Achebe · 1958",
    reason: "A reason.",
  }, {
    fetchImpl: async () => jsonResponse({
      docs: [{
        key: "/works/OL1W",
        title: "Things Fall Apart",
        author_name: ["Chinua Achebe"],
        first_publish_year: 1958,
      }],
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.qualityIssue, "catalog_title_creator_mismatch");
  assert.equal(result.diagnostics.requestedTitle, "همه چیز فرو می‌پاشد");
  assert.equal(result.diagnostics.requestedCreator, "Chinua Achebe");
  assert.deepEqual(result.diagnostics.catalogCandidates, [{
    title: "Things Fall Apart",
    creators: ["Chinua Achebe"],
    year: "1958",
  }]);
});

test("Open Library accepts safe author transliteration differences", async () => {
  const result = await verifyOpenLibrarySuggestion({
    ok: true,
    title: "My Uncle Napoleon",
    metadata: "Author: Iraj Pezeshkzad · 1973",
    reason: "A reason.",
  }, {
    fetchImpl: async () => jsonResponse({
      docs: [{
        key: "/works/OL1W",
        title: "My Uncle Napoleon",
        author_name: ["Īraj Pizishkzād"],
        first_publish_year: 2006,
      }],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.suggestion.title, "My Uncle Napoleon");
});

test("Open Library accepts a requested title contained in a catalogue title", async () => {
  const result = await verifyOpenLibrarySuggestion({
    ok: true,
    title: "Season of Migration to the North",
    metadata: "Author: Tayeb Salih · 1966",
    reason: "A reason.",
  }, {
    fetchImpl: async () => jsonResponse({
      docs: [{
        key: "/works/OL2W",
        title: "Tayeb Salih's Season of Migration to the North",
        author_name: ["Tayeb Salih"],
        first_publish_year: 1986,
      }],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.suggestion.title, "Tayeb Salih's Season of Migration to the North");
});

test("Open Library still rejects a different book by the same author", async () => {
  const result = await verifyOpenLibrarySuggestion({
    ok: true,
    title: "Season of Migration to the North",
    metadata: "Author: Tayeb Salih · 1966",
    reason: "A reason.",
  }, {
    fetchImpl: async () => jsonResponse({
      docs: [{
        key: "/works/OL3W",
        title: "The Wedding of Zein",
        author_name: ["Tayeb Salih"],
        first_publish_year: 1969,
      }],
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.qualityIssue, "catalog_title_creator_mismatch");
});
