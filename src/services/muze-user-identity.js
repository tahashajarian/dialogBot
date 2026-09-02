const crypto = require("crypto");

function generateMuzeUserId() {
  return crypto.randomUUID();
}

async function backfillMissingMuzeUserIds(User, { apply = false, batchSize = 200 } = {}) {
  const missingFilter = { muzeUserId: { $exists: false } };
  const missing = await User.countDocuments(missingFilter);
  if (!apply || missing === 0) return { missing, updated: 0 };

  let updated = 0;
  while (updated < missing) {
    const users = await User.find(missingFilter).select("_id").limit(batchSize).lean();
    if (!users.length) break;

    for (const user of users) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const result = await User.updateOne(
            { _id: user._id, muzeUserId: { $exists: false } },
            { $set: { muzeUserId: generateMuzeUserId() } },
            { strict: false },
          );
          updated += Number(result.modifiedCount) || 0;
          break;
        } catch (error) {
          if (error?.code !== 11000 || attempt === 4) throw error;
        }
      }
    }
  }

  return { missing, updated };
}

module.exports = {
  backfillMissingMuzeUserIds,
  generateMuzeUserId,
};
