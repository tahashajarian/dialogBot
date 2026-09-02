require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/user");
const { backfillMissingMuzeUserIds } = require("../src/services/muze-user-identity");

function parseArgs(argv) {
  const batchArg = argv.find((arg) => arg.startsWith("--batch-size="));
  const parsedBatchSize = Number(batchArg?.slice("--batch-size=".length));
  return {
    apply: argv.includes("--apply"),
    batchSize: Number.isInteger(parsedBatchSize) && parsedBatchSize > 0 ? parsedBatchSize : 200,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "bot",
  });
  try {
    const result = await backfillMissingMuzeUserIds(User, args);
    console.log(JSON.stringify({
      mode: args.apply ? "apply" : "dry-run",
      dbName: mongoose.connection.name,
      batchSize: args.batchSize,
      ...result,
    }, null, 2));
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
