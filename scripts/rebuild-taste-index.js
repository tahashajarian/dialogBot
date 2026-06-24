require("dotenv").config();

const mongoose = require("mongoose");
const { rebuildAllUserTasteIndexes } = require("../src/services/user-taste-index");

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI is required");
  const dbName = process.env.MONGO_DB_NAME || "bot";
  const batchSize = Number(process.env.TASTE_INDEX_BATCH_SIZE) || 200;

  await mongoose.connect(mongoUri, { dbName });
  const result = await rebuildAllUserTasteIndexes({ batchSize });
  console.log("Taste index rebuild summary:");
  console.log(JSON.stringify({ ...result, dbName, batchSize }, null, 2));
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Taste index rebuild failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
