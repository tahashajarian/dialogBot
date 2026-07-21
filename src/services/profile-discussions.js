const Discussion = require("../models/discussion");

const defaultDiscussionFind = Discussion.find;
const defaultDiscussionFindOne = Discussion.findOne;

async function runLeanQuery(query, select = "") {
  if (!query) return query;
  if (query.select) {
    const selected = select ? query.select(select) : query;
    return selected.lean ? selected.lean() : selected;
  }
  if (query.lean) return query.lean();
  return query;
}

function isDiscussionQueryAvailable() {
  return Discussion.db?.readyState === 1
    || Discussion.find !== defaultDiscussionFind
    || Discussion.findOne !== defaultDiscussionFindOne;
}

async function hasVisibleProfileDiscussions(target) {
  if (!target?.userId || !target.showActiveDiscussionOnProfile || !isDiscussionQueryAvailable()) return false;

  if (target.activeDiscussionId) {
    const activeDiscussion = await runLeanQuery(Discussion.findOne({
      _id: target.activeDiscussionId,
      status: "open",
    }), "_id");
    if (activeDiscussion) return true;
  }

  const createdDiscussion = await runLeanQuery(Discussion.findOne({
    creatorUserId: target.userId,
    status: "open",
    ...(target.activeDiscussionId ? { _id: { $ne: target.activeDiscussionId } } : {}),
  }), "_id");
  return Boolean(createdDiscussion);
}

async function findVisibleProfileDiscussionUserIds(users = []) {
  const normalizedUsers = (users || []).filter((user) => Number.isFinite(Number(user?.userId)));
  if (!normalizedUsers.length || !isDiscussionQueryAvailable()) return new Set();

  const result = new Set();
  const activeById = new Map();
  for (const user of normalizedUsers) {
    if (user.activeDiscussionId && user.showActiveDiscussionOnProfile) {
      activeById.set(String(user.activeDiscussionId), Number(user.userId));
    }
  }

  if (activeById.size) {
    const activeDiscussions = await runLeanQuery(Discussion.find({
      _id: { $in: [...activeById.keys()] },
      status: "open",
    }), "_id") || [];
    for (const discussion of activeDiscussions) {
      const userId = activeById.get(String(discussion?._id));
      if (userId) result.add(userId);
    }
  }

  const userIds = normalizedUsers
    .filter((user) => user.showActiveDiscussionOnProfile)
    .map((user) => Number(user.userId));
  if (!userIds.length) return result;
  const createdDiscussions = await runLeanQuery(Discussion.find({
    creatorUserId: { $in: userIds },
    status: "open",
  }), "creatorUserId") || [];
  for (const discussion of createdDiscussions) {
    const userId = Number(discussion?.creatorUserId);
    if (Number.isFinite(userId)) result.add(userId);
  }
  return result;
}

module.exports = {
  findVisibleProfileDiscussionUserIds,
  hasVisibleProfileDiscussions,
};
