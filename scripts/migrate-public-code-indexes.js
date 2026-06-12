require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/user");
const Discussion = require("../src/models/discussion");

const USER_INDEX = "publicProfileCode_unique_nonempty";
const DISCUSSION_INDEX = "publicDiscussionCode_unique_nonempty";
const LEGACY_USER_INDEX = "publicProfileCode_1";
const LEGACY_DISCUSSION_INDEX = "publicDiscussionCode_1";

async function findDuplicateCodes(model, field) {
  return model.aggregate([
    {
      $match: {
        [field]: { $type: "string", $ne: "" },
      },
    },
    {
      $group: {
        _id: `$${field}`,
        count: { $sum: 1 },
        ids: { $push: "$_id" },
      },
    },
    {
      $match: {
        count: { $gt: 1 },
      },
    },
  ]);
}

async function dropIndexIfExists(collection, name) {
  const indexes = await collection.indexes();
  if (!indexes.some((index) => index.name === name)) {
    return false;
  }
  await collection.dropIndex(name);
  return true;
}

async function recreateUniqueCodeIndex({ model, field, legacyName, nextName }) {
  const duplicates = await findDuplicateCodes(model, field);
  if (duplicates.length) {
    throw new Error(`${field} has duplicate values: ${duplicates.map((entry) => entry._id).join(", ")}`);
  }

  await dropIndexIfExists(model.collection, legacyName);
  await dropIndexIfExists(model.collection, nextName);

  await model.collection.createIndex(
    { [field]: 1 },
    {
      name: nextName,
      unique: true,
      partialFilterExpression: {
        [field]: { $type: "string", $ne: "" },
      },
    },
  );
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: "bot" });

  await recreateUniqueCodeIndex({
    model: User,
    field: "publicProfileCode",
    legacyName: LEGACY_USER_INDEX,
    nextName: USER_INDEX,
  });
  await recreateUniqueCodeIndex({
    model: Discussion,
    field: "publicDiscussionCode",
    legacyName: LEGACY_DISCUSSION_INDEX,
    nextName: DISCUSSION_INDEX,
  });

  console.log("Public code indexes migrated.");
}

main()
  .catch((error) => {
    console.error("Public code index migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
