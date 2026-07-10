require("dotenv").config();
const mongoose = require("mongoose");
const Discussion = require("../src/models/discussion");
const User = require("../src/models/user");
const { normalizeDiscussionLanguage } = require("../src/services/discussion-language");

async function buildBackfillPlan() {
  const discussions = await Discussion.find({ language: { $nin: ["fa", "en"] } }).select("creatorUserId isBotCreated botSeedKey").lean();
  const creatorIds = [...new Set(discussions.map((d) => Number(d.creatorUserId)).filter(Number.isFinite))];
  const users = await User.find({ userId: { $in: creatorIds } }).select("userId lang").lean();
  const byId = new Map(users.map((u) => [Number(u.userId), u]));
  const report = { total: discussions.length, fa: 0, en: 0, missingCreators: 0, invalidCreatorLanguage: 0, userCreatedRooms: 0, starterRooms: 0 };
  const updates = [];
  for (const discussion of discussions) {
    const creator = byId.get(Number(discussion.creatorUserId));
    if (!creator) report.missingCreators += 1;
    else if (!["fa", "en"].includes(String(creator.lang || "").toLowerCase())) report.invalidCreatorLanguage += 1;
    const language = normalizeDiscussionLanguage(creator?.lang, "fa");
    report[language] += 1;
    report[discussion.isBotCreated ? "starterRooms" : "userCreatedRooms"] += 1;
    updates.push({ updateOne: { filter: { _id: discussion._id, language: { $nin: ["fa", "en"] } }, update: { $set: { language } } } });
  }
  return { report, updates };
}

async function run() {
  const apply = process.argv.includes("--apply");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || "bot" });
  const { report, updates } = await buildBackfillPlan();
  let modified = 0;
  if (apply && updates.length) modified = (await Discussion.bulkWrite(updates)).modifiedCount;
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...report, modified }, null, 2));
  await mongoose.disconnect();
}

if (require.main === module) run().catch(async (error) => { console.error(error.message); try { await mongoose.disconnect(); } catch {} process.exit(1); });
module.exports = { buildBackfillPlan };
