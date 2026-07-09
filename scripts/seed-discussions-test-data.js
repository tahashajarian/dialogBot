require("dotenv").config();

const mongoose = require("mongoose");
const Discussion = require("../src/models/discussion");
const User = require("../src/models/user");

const SEED_DISCUSSION_PREFIX = "people-test-";
const SEED_USER_ID_START = -900100;

const discussionSeeds = [
  {
    key: "cinema-night",
    code: "d_SEED001",
    title: "Cinema night",
    description: "Talk about sci-fi movies, endings, and the scenes that stayed with you.",
    creatorIndex: 0,
    memberIndexes: [0, 4, 5, 10, 15, 20],
    joinRule: {
      type: "top_ten_item",
      section: "movies",
      itemTitle: "Interstellar",
      itemAliases: ["Interstellar", "میان‌ستاره‌ای"],
    },
    messages: [
      "The docking scene still feels unreal.",
      "Arrival belongs in this conversation too.",
      "I want a room just for confusing endings.",
    ],
  },
  {
    key: "indie-music",
    code: "d_SEED002",
    title: "Indie music corner",
    description: "Soft albums, late-night playlists, and artists with a very specific mood.",
    creatorIndex: 1,
    memberIndexes: [1, 6, 11, 16, 21, 26],
    joinRule: {
      type: "top_ten_item",
      section: "music",
      itemTitle: "Arctic Monkeys",
      itemAliases: ["Arctic Monkeys"],
    },
    messages: [
      "Tame Impala feels like summer at 2 AM.",
      "Which album is your comfort listen?",
      "The Smiths fans, defend yourselves politely.",
    ],
  },
  {
    key: "fantasy-books",
    code: "d_SEED003",
    title: "Fantasy book club",
    description: "Magic systems, long series, favorite characters, and book hangovers.",
    creatorIndex: 2,
    memberIndexes: [2, 7, 12, 17, 22, 27],
    joinRule: {
      type: "top_ten_item",
      section: "books",
      itemTitle: "Harry Potter",
      itemAliases: ["Harry Potter", "هری پاتر"],
    },
    messages: [
      "Mistborn has one of the cleanest magic systems.",
      "The Hobbit is still cozy.",
      "What fantasy book should become a good series?",
    ],
  },
  {
    key: "open-cafe",
    code: "d_SEED004",
    title: "Open cafe",
    description: "No strict topic. Say hi, share what you watched, read, or listened to today.",
    creatorIndex: 3,
    memberIndexes: [3, 8, 13, 18, 23, 28],
    joinRule: { type: "open" },
    messages: [
      "Today I only had energy for music.",
      "Someone recommend a short movie.",
      "Open rooms feel better when people actually say hi.",
    ],
  },
  {
    key: "anime-games",
    code: "d_SEED005",
    title: "Anime and games",
    description: "Anime, manga, games, soundtracks, and the stuff everyone says they will finish later.",
    creatorIndex: 4,
    memberIndexes: [4, 9, 14, 19, 24, 29],
    joinRule: {
      type: "top_ten_item",
      section: "random",
      itemTitle: "Gaming",
      itemAliases: ["Gaming", "Games", "Game", "گیم", "بازی"],
    },
    messages: [
      "Nujabes changed anime soundtracks forever.",
      "Which game has the best world design?",
      "Spirited Away is always welcome here.",
    ],
  },
  {
    key: "classic-crime",
    code: "d_SEED006",
    title: "Crime and classics",
    description: "Crime films, classic books, antiheroes, and stories with sharp edges.",
    creatorIndex: 5,
    memberIndexes: [5, 10, 15, 20, 25],
    joinRule: {
      type: "top_ten_item",
      section: "movies",
      itemTitle: "The Godfather",
      itemAliases: ["The Godfather", "پدرخوانده"],
    },
    messages: [
      "Taxi Driver is uncomfortable in exactly the right way.",
      "Crime and Punishment still hits hard.",
      "What makes an antihero interesting instead of annoying?",
    ],
  },
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    remove: argv.includes("--remove"),
  };
}

async function connect() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required. Add it to .env or pass it in the environment.");
  }
  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "bot",
  });
}

async function loadSeedUsers() {
  return User.find({
    userId: { $lte: SEED_USER_ID_START },
    publicProfileCode: /^u_seed\d+$/i,
  })
    .select("userId profileName firstName profileEmoji publicProfileCode")
    .sort({ userId: -1 })
    .lean();
}

function buildRecentMessages(users, seed, now) {
  const members = seed.memberIndexes
    .map((index) => users[index])
    .filter(Boolean);

  return seed.messages.map((text, index) => {
    const sender = members[index % members.length] || users[seed.creatorIndex] || users[0];
    return {
      senderUserId: Number(sender.userId),
      senderDisplayName: [sender.profileName || sender.firstName || "Seed user", sender.profileEmoji].filter(Boolean).join(" "),
      text,
      sentAt: new Date(now.getTime() - (seed.messages.length - index) * 8 * 60 * 1000),
    };
  });
}

function buildDiscussion(users, seed, index) {
  const now = new Date();
  const creator = users[seed.creatorIndex] || users[0];
  const memberUserIds = [...new Set(seed.memberIndexes
    .map((memberIndex) => users[memberIndex]?.userId)
    .filter((userId) => Number.isInteger(Number(userId)))
    .map(Number))];

  return {
    title: seed.title,
    description: seed.description,
    publicDiscussionCode: seed.code,
    creatorUserId: Number(creator.userId),
    isBotCreated: false,
    botSeedKey: `${SEED_DISCUSSION_PREFIX}${seed.key}`,
    status: "open",
    joinRule: seed.joinRule,
    memberUserIds,
    removedUserIds: [],
    maxMembers: 20,
    recentMessages: buildRecentMessages(users, seed, now),
    reports: [],
    replyCount: 8 + index * 3,
    lastActivityAt: new Date(now.getTime() - index * 45 * 60 * 1000),
    createdAt: new Date(now.getTime() - (index + 1) * 24 * 60 * 60 * 1000),
    updatedAt: new Date(now.getTime() - index * 45 * 60 * 1000),
    closedAt: null,
  };
}

async function removeSeedDiscussions({ dryRun }) {
  const query = { botSeedKey: new RegExp(`^${SEED_DISCUSSION_PREFIX}`) };
  const discussions = await Discussion.find(query)
    .select("title publicDiscussionCode botSeedKey memberUserIds")
    .lean();
  if (dryRun) return { matched: discussions.length, removed: 0, sample: discussions.slice(0, 5) };

  const result = await Discussion.deleteMany(query);
  return { matched: discussions.length, removed: result.deletedCount || 0, sample: discussions.slice(0, 5) };
}

async function seedDiscussions({ dryRun }) {
  const users = await loadSeedUsers();
  if (users.length < 10) {
    return {
      ok: false,
      reason: "not_enough_seed_users",
      message: "Run npm.cmd run seed:people -- --count=30 --enable-matches --cost=0 first.",
      seedUsersFound: users.length,
    };
  }

  const discussions = discussionSeeds.map((seed, index) => buildDiscussion(users, seed, index));
  if (dryRun) return { ok: true, planned: discussions.length, upserted: 0, sample: discussions.slice(0, 5) };

  let upserted = 0;
  for (const discussion of discussions) {
    await Discussion.findOneAndUpdate(
      { botSeedKey: discussion.botSeedKey },
      { $set: discussion },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, runValidators: true },
    );
    upserted += 1;
  }

  return { ok: true, planned: discussions.length, upserted, sample: discussions.slice(0, 5) };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await connect();
  const discussions = args.remove
    ? await removeSeedDiscussions(args)
    : await seedDiscussions(args);

  console.log(JSON.stringify({
    mode: args.remove ? "remove" : "seed",
    discussions,
    dbName: mongoose.connection.name,
    dryRun: args.dryRun,
  }, null, 2));
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Discussion test data seed failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
