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

function toLegacyStrings(items) {
  return normalizeAiListItems(items).map((item) => {
    if (item?.comment) {
      return `${item.title} - ${item.comment}`;
    }
    return item.title;
  });
}

async function run() {
  const apply = getArgFlag("--apply");
  const maxItems = 10;

  await mongoose.connect(process.env.MONGO_URI, { dbName: "bot" });

  const users = await User.find({});
  const summary = {
    usersScanned: users.length,
    usersUpdated: 0,
    fieldsUpdated: 0,
  };

  for (const user of users) {
    const setOps = {};
    let changedForUser = false;

    for (const section of Object.keys(LEGACY_FIELDS)) {
      for (const listType of ["watchlist", "topTen"]) {
        const legacyField = LEGACY_FIELDS[section][listType];
        const structuredItems = normalizeAiListItems(user?.aiLists?.[section]?.[listType] || []);
        const legacyItems = toLegacyStrings(structuredItems).slice(0, maxItems);
        const currentLegacy = normalizeAiListItems(user?.[legacyField] || []).map((item) => item.title);
        const nextLegacy = legacyItems;

        if (JSON.stringify(currentLegacy) !== JSON.stringify(nextLegacy)) {
          setOps[legacyField] = nextLegacy;
          changedForUser = true;
          summary.fieldsUpdated += 1;
        }
      }
    }

    if (!changedForUser) {
      continue;
    }

    summary.usersUpdated += 1;

    if (apply) {
      await User.updateOne({ _id: user._id }, { $set: setOps });
    }
  }

  console.log("AI list rollback summary:");
  console.log(JSON.stringify({
    ...summary,
    mode: apply ? "apply" : "dry-run",
  }, null, 2));

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Rollback failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
