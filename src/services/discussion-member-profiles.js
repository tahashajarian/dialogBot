const User = require("../models/user");

function findDiscussionMemberProfiles(userIds = []) {
  return User.find({ userId: { $in: userIds } })
    .select("userId profileName firstName publicProfileCode")
    .lean();
}

async function findUserIdByPublicProfileCode(publicProfileCode) {
  if (!publicProfileCode) return null;
  const user = await User.findOne({ publicProfileCode }).select("userId").lean();
  const userId = Number(user?.userId);
  return Number.isInteger(userId) ? userId : null;
}

module.exports = {
  findDiscussionMemberProfiles,
  findUserIdByPublicProfileCode,
};
