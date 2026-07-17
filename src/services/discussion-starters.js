const Discussion = require("../models/discussion");
const { ensurePublicDiscussionCode } = require("./public-codes");

const BOT_STARTER_DISCUSSION_MEMBER_CAP = 100;
const BOT_STARTER_DEFINITIONS = [
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
  {
    botSeedKey: "metalheads",
    title: "Metalheads",
    description: "Heavy riffs, loud albums, and metal recommendations.",
    joinRule: {
      type: "taste_label",
      section: "music",
      tasteLabelKey: "metalhead",
    },
  },
];
const BOT_STARTER_INSTANCES = BOT_STARTER_DEFINITIONS.flatMap((starter) => ["fa", "en"].map((language) => ({
  ...starter,
  language,
  botSeedKey: `${starter.botSeedKey}:${language}`,
})));
const BOT_STARTER_INSTANCE_KEYS = new Set(
  BOT_STARTER_INSTANCES.map((starter) => starter.botSeedKey),
);
const BOT_STARTER_DISCUSSION_ORDER = new Map(
  BOT_STARTER_DEFINITIONS.map((starter, index) => [starter.botSeedKey, index]),
);

function getBotStarterDiscussionOrder(discussion = {}) {
  const seedKey = String(discussion.botSeedKey || "").replace(/:(fa|en)$/, "");
  return BOT_STARTER_DISCUSSION_ORDER.has(seedKey)
    ? BOT_STARTER_DISCUSSION_ORDER.get(seedKey)
    : BOT_STARTER_DEFINITIONS.length;
}

function isBotStarterDiscussion(discussion = {}) {
  return discussion.isBotCreated === true && BOT_STARTER_INSTANCE_KEYS.has(
    String(discussion.botSeedKey || ""),
  );
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
  for (const starter of BOT_STARTER_INSTANCES) {
    const now = new Date();
    const discussion = await Discussion.findOneAndUpdate(
      { botSeedKey: starter.botSeedKey },
      {
        $set: {
          title: starter.title,
          description: starter.description,
          creatorUserId,
          isBotCreated: true,
          language: starter.language,
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
  BOT_STARTER_DISCUSSIONS: BOT_STARTER_DEFINITIONS,
  BOT_STARTER_INSTANCES,
  isBotStarterDiscussion,
  seedBotDiscussions,
  sortBotStarterDiscussionsFirst,
};
