require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/user");
const Discussion = require("../src/models/discussion");
const AiResponseCache = require("../src/models/ai-response-cache");

function getArgFlag(name) {
  return process.argv.includes(name);
}

async function run() {
  const dryRun = getArgFlag("--dry-run");

  await mongoose.connect(process.env.MONGO_URI, { dbName: "bot" });

  if (dryRun) {
    const [usersCount, discussionsCount, aiCacheCount] = await Promise.all([
      User.countDocuments({}),
      Discussion.countDocuments({}),
      AiResponseCache.countDocuments({}),
    ]);

    console.log("Data cleanup dry-run summary:");
    console.log(JSON.stringify({
      mode: "dry-run",
      usersWouldDelete: usersCount,
      discussionsWouldDelete: discussionsCount,
      aiResponseCachesWouldDelete: aiCacheCount,
    }, null, 2));
  } else {
    const [usersResult, discussionsResult, aiCacheResult] = await Promise.all([
      User.deleteMany({}),
      Discussion.deleteMany({}),
      AiResponseCache.deleteMany({}),
    ]);

    console.log("Data cleanup summary:");
    console.log(JSON.stringify({
      mode: "apply",
      usersDeleted: usersResult.deletedCount || 0,
      discussionsDeleted: discussionsResult.deletedCount || 0,
      aiResponseCachesDeleted: aiCacheResult.deletedCount || 0,
    }, null, 2));
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Data cleanup failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
