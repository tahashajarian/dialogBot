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
  const counts = await findVisibleProfileDiscussionCounts(users);
  return new Set(counts.keys());
}

async function findVisibleProfileDiscussionCounts(users = []) {
  const normalizedUsers = (users || []).filter((user) => Number.isFinite(Number(user?.userId)));
  if (!normalizedUsers.length || !isDiscussionQueryAvailable()) return new Map();

  const discussionIdsByUserId = new Map();
  const activeById = new Map();
  for (const user of normalizedUsers) {
    if (user.activeDiscussionId && user.showActiveDiscussionOnProfile) {
      const discussionId = String(user.activeDiscussionId);
      const userIds = activeById.get(discussionId) || [];
      userIds.push(Number(user.userId));
      activeById.set(discussionId, userIds);
    }
  }

  const userIds = normalizedUsers
    .filter((user) => user.showActiveDiscussionOnProfile)
    .map((user) => Number(user.userId));
  if (!userIds.length) return new Map();
  const clauses = [{ creatorUserId: { $in: userIds } }];
  if (activeById.size) clauses.push({ _id: { $in: [...activeById.keys()] } });
  const visibleDiscussions = await runLeanQuery(Discussion.find({
    status: "open",
    $or: clauses,
  }), "_id creatorUserId") || [];
  for (const [index, discussion] of visibleDiscussions.entries()) {
    const discussionId = String(discussion?._id || `visible:${index}`);
    for (const userId of activeById.get(discussionId) || []) {
      const discussionIds = discussionIdsByUserId.get(userId) || new Set();
      discussionIds.add(discussionId);
      discussionIdsByUserId.set(userId, discussionIds);
    }
    const userId = Number(discussion?.creatorUserId);
    if (!Number.isFinite(userId) || !userIds.includes(userId)) continue;
    const discussionIds = discussionIdsByUserId.get(userId) || new Set();
    discussionIds.add(discussionId);
    discussionIdsByUserId.set(userId, discussionIds);
  }
  return new Map(
    [...discussionIdsByUserId.entries()]
      .map(([userId, discussionIds]) => [userId, discussionIds.size])
      .filter(([, count]) => count > 0),
  );
}

module.exports = {
  findVisibleProfileDiscussionCounts,
  findVisibleProfileDiscussionUserIds,
  hasVisibleProfileDiscussions,
};
