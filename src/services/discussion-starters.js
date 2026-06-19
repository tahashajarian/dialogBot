const Discussion = require("../models/discussion");
const { ensurePublicDiscussionCode } = require("./public-codes");

const BOT_STARTER_DISCUSSION_MEMBER_CAP = 20;
const BOT_STARTER_DISCUSSIONS = [
  {
    botSeedKey: "free-discussion",
    title: "Free Discussion",
    description: "A simple place to start chatting.",
  },
  {
    botSeedKey: "whats-up",
    title: "Gaming Hangout",
    description: "A room for players, favorite games, and what everyone is playing.",
    joinRule: {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Gaming",
      itemAliases: ["Gaming", "Games", "Game", "گیم", "بازی"],
    },
  },
  {
    botSeedKey: "lets-talk",
    title: "Movie Chat",
    description: "Chat about movies, scenes, and recent favorites.",
    joinRule: {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Movies",
      itemAliases: ["Movies", "Movie", "Film", "Films", "فیلم", "فیلم‌ها"],
    },
  },
];
const BOT_STARTER_DISCUSSION_ORDER = new Map(
  BOT_STARTER_DISCUSSIONS.map((starter, index) => [starter.botSeedKey, index]),
);

function getBotStarterDiscussionOrder(discussion = {}) {
  const seedKey = String(discussion.botSeedKey || "");
  return BOT_STARTER_DISCUSSION_ORDER.has(seedKey)
    ? BOT_STARTER_DISCUSSION_ORDER.get(seedKey)
    : BOT_STARTER_DISCUSSIONS.length;
}

function sortBotStarterDiscussionsFirst(discussions = []) {
  return [...discussions].sort((left, right) => (
    getBotStarterDiscussionOrder(left) - getBotStarterDiscussionOrder(right)
  ));
}

async function seedBotDiscussions(botUserId) {
  const creatorUserId = Number(botUserId);
  if (!Number.isInteger(creatorUserId) || creatorUserId <= 0) {
    return { ok: false, reason: "invalid_bot_user_id" };
  }

  const discussions = [];
  for (const starter of BOT_STARTER_DISCUSSIONS) {
    const now = new Date();
    const discussion = await Discussion.findOneAndUpdate(
      { botSeedKey: starter.botSeedKey },
      {
        $set: {
          title: starter.title,
          description: starter.description,
          creatorUserId,
          isBotCreated: true,
          joinRule: starter.joinRule || { type: "open" },
          maxMembers: BOT_STARTER_DISCUSSION_MEMBER_CAP,
        },
        $setOnInsert: {
          botSeedKey: starter.botSeedKey,
          status: "open",
          memberUserIds: [],
          removedUserIds: [],
          recentMessages: [],
          reports: [],
          replyCount: 0,
          lastActivityAt: now,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    await ensurePublicDiscussionCode(discussion);
    discussions.push(discussion);
  }

  return { ok: true, discussions };
}

module.exports = {
  BOT_STARTER_DISCUSSION_MEMBER_CAP,
  BOT_STARTER_DISCUSSIONS,
  seedBotDiscussions,
  sortBotStarterDiscussionsFirst,
};
