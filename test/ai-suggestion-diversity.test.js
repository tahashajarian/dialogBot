const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getCreatorDiversityIssue,
} = require("../src/services/ai-suggestion-diversity");
const {
  filterDiverseCandidates,
} = require("../src/services/music-candidate-retriever");

test("creator diversity blocks recent and saturated artists unless explicitly requested", () => {
  assert.equal(getCreatorDiversityIssue({
    creator: "Metallica",
    recentCreators: ["Metallica"],
  }), "recent_creator");
  assert.equal(getCreatorDiversityIssue({
    creator: "Metallica",
    savedCreators: ["Metallica", "metallica"],
  }), "saved_creator_saturation");
  assert.equal(getCreatorDiversityIssue({
    creator: "Metallica",
    requestText: "give me another Metallica track",
    recentCreators: ["Metallica"],
    savedCreators: ["Metallica", "Metallica"],
  }), "");
});

test("music discovery prefers adjacent artists over seed and repeated artists", () => {
  const candidates = [
    { title: "Orion", artist: "Metallica" },
    { title: "Holy Wars", artist: "Megadeth" },
    { title: "Schism", artist: "Tool" },
    { title: "Flying Whales", artist: "Gojira" },
    { title: "Blood and Thunder", artist: "Mastodon" },
    { title: "Walk", artist: "Pantera" },
    { title: "Would?", artist: "Alice in Chains" },
    { title: "Chop Suey!", artist: "System of a Down" },
    { title: "The Trooper", artist: "Iron Maiden" },
  ];
  const result = filterDiverseCandidates(candidates, {
    seedArtists: ["Metallica", "Tool"],
    recentCreators: ["Megadeth"],
    savedCreators: ["Metallica", "Metallica"],
  });
  assert.equal(result.some((candidate) => candidate.artist === "Metallica"), false);
  assert.equal(result.some((candidate) => candidate.artist === "Tool"), false);
  assert.equal(result.some((candidate) => candidate.artist === "Megadeth"), false);
  assert.equal(result.length, 6);
});
