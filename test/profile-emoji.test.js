const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PROFILE_EMOJI_CATALOG } = require("../src/services/profile-emoji");

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

test("profile emoji catalog does not reuse emojis from the codebase", () => {
  const files = ["src", "test", "docs", "scripts"]
    .flatMap(listFiles)
    .filter((file) => file.replace(/\\/g, "/") !== "src/services/profile-emoji.js");
  const collisions = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const emoji of PROFILE_EMOJI_CATALOG) {
      if (content.includes(emoji)) collisions.push({ emoji, file });
    }
  }

  assert.deepEqual(collisions, []);
});
