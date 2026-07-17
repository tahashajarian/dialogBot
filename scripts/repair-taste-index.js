require("dotenv").config();

const mongoose = require("mongoose");
const {
  getTasteIndexHealth,
  rebuildAllUserTasteIndexes,
} = require("../src/services/user-taste-index");

function parseArgs(argv) {
  const readNumber = (name, fallback) => {
    const prefix = `--${name}=`;
    const value = Number(argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  };
  return {
    apply: argv.includes("--apply"),
    maxUsers: readNumber("max-users", 1000),
    batchSize: readNumber("batch-size", 200),
    concurrency: readNumber("concurrency", 5),
    staleHours: readNumber("stale-hours", 24),
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "bot",
  });
  try {
    const healthOptions = {
      maxUsers: args.maxUsers,
      agedAfterMs: args.staleHours * 60 * 60 * 1000,
    };
    const before = await getTasteIndexHealth(healthOptions);
    const output = {
      mode: args.apply ? "apply" : "dry-run",
      dbName: mongoose.connection.name,
      limits: {
        maxUsers: args.maxUsers,
        batchSize: args.batchSize,
        concurrency: args.concurrency,
        staleHours: args.staleHours,
      },
      before,
    };

    if (args.apply) {
      output.repair = await rebuildAllUserTasteIndexes({
        maxUsers: args.maxUsers,
        batchSize: args.batchSize,
        concurrency: args.concurrency,
      });
      output.after = await getTasteIndexHealth(healthOptions);
    }
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error?.message || error);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { parseArgs };
