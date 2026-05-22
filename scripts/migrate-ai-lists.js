require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/user");
const { normalizeAiListItems } = require("../src/services/users");

const LEGACY_FIELDS = {
  movies: { watchlist: "aiWatchlistMovies", topTen: "aiTopTenMovies" },
  music: { watchlist: "aiWatchlistMusic", topTen: "aiTopTenMusic" },
  books: { watchlist: "aiWatchlistBooks", topTen: "aiTopTenBooks" },
  random: { watchlist: "aiWatchlistRandom", topTen: "aiTopTenRandom" },
};

function getArgFlag(name) {
  return process.argv.includes(name);
}

function buildMergedList(structuredItems, legacyItems, maxItems) {
  const merged = normalizeAiListItems([...(structuredItems || []), ...(legacyItems || [])]);
  return merged.slice(0, maxItems);
}

async function run() {
  const apply = getArgFlag("--apply");
  const clearLegacy = getArgFlag("--clear-legacy");
  const maxItems = 10;

  await mongoose.connect(process.env.MONGO_URI, { dbName: "bot" });

  const users = await User.find({});
  const summary = {
    usersScanned: users.length,
    usersUpdated: 0,
    fieldsUpdated: 0,
    legacyFieldsCleared: 0,
  };

  for (const user of users) {
    const setOps = {};
    const unsetOps = {};
    let changedForUser = false;

    for (const section of Object.keys(LEGACY_FIELDS)) {
      for (const listType of ["watchlist", "topTen"]) {
        const legacyField = LEGACY_FIELDS[section][listType];
        const legacyItems = normalizeAiListItems(user?.[legacyField] || []);
        const structuredItems = normalizeAiListItems(user?.aiLists?.[section]?.[listType] || []);
        const merged = buildMergedList(structuredItems, legacyItems, maxItems);

        const before = JSON.stringify(structuredItems);
        const after = JSON.stringify(merged);
        if (before !== after) {
          setOps[`aiLists.${section}.${listType}`] = merged;
          changedForUser = true;
          summary.fieldsUpdated += 1;
        }

        if (clearLegacy && legacyItems.length) {
          unsetOps[legacyField] = "";
        }
      }
    }

    if (Object.keys(unsetOps).length) {
      summary.legacyFieldsCleared += Object.keys(unsetOps).length;
    }

    if (!changedForUser && !Object.keys(unsetOps).length) {
      continue;
    }

    summary.usersUpdated += 1;

    if (apply) {
      const update = {};
      if (Object.keys(setOps).length) update.$set = setOps;
      if (Object.keys(unsetOps).length) update.$unset = unsetOps;
      await User.updateOne({ _id: user._id }, update);
    }
  }

  console.log("AI list migration summary:");
  console.log(JSON.stringify({
    ...summary,
    mode: apply ? "apply" : "dry-run",
    clearLegacy,
  }, null, 2));

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Migration failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
