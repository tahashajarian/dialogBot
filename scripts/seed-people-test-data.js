require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/user");
const UserTasteIndex = require("../src/models/user-taste-index");
const { syncUserTasteIndex } = require("../src/services/user-taste-index");
const { getStarSettingsState, updateStarSettings } = require("../src/services/star-settings");

const SEED_USER_ID_START = -900100;
const SEED_ACTOR = "seed-people-test-data";

const clusters = [
  {
    name: "Cinema dreamers",
    movies: ["Interstellar", "Inception", "The Matrix", "Arrival", "Dune", "Blade Runner 2049"],
    music: ["Radiohead", "Daft Punk", "Hans Zimmer"],
    books: ["Dune", "Foundation", "1984"],
    random: ["science fiction", "space", "philosophy", "cinema"],
  },
  {
    name: "Indie mood",
    movies: ["Her", "Before Sunrise", "Lost in Translation", "La La Land", "Amelie"],
    music: ["Lana Del Rey", "Arctic Monkeys", "The Smiths", "Tame Impala"],
    books: ["Norwegian Wood", "The Little Prince", "Normal People"],
    random: ["coffee", "walking", "photography", "slow movies"],
  },
  {
    name: "Fantasy readers",
    movies: ["The Lord of the Rings", "Harry Potter", "Spirited Away", "Princess Mononoke"],
    music: ["Florence and the Machine", "Aurora", "Hozier"],
    books: ["The Hobbit", "Harry Potter", "The Name of the Wind", "Mistborn"],
    random: ["fantasy", "mythology", "storytelling", "board games"],
  },
  {
    name: "Crime and classics",
    movies: ["The Godfather", "Pulp Fiction", "Fight Club", "Se7en", "Taxi Driver"],
    music: ["Nirvana", "Pink Floyd", "The Beatles"],
    books: ["Crime and Punishment", "The Stranger", "Animal Farm", "The Trial"],
    random: ["classic cinema", "psychology", "history", "late night talks"],
  },
  {
    name: "Anime and games",
    movies: ["Your Name", "Spirited Away", "Akira", "Howl's Moving Castle"],
    music: ["Kendrick Lamar", "Joji", "Nujabes", "Linkin Park"],
    books: ["Berserk", "One Piece", "The Alchemist"],
    random: ["anime", "gaming", "manga", "digital art"],
  },
];

const firstNames = [
  "Arman", "Nika", "Raha", "Kian", "Tara", "Sina", "Darya", "Mina",
  "Ryan", "Sara", "Ava", "Shayan", "Lina", "Navid", "Yasmin", "Omid",
  "Maya", "Ramin", "Laleh", "Taha", "Nora", "Sam", "Elina", "Arian",
  "Hana", "Parsa", "Kimia", "Aria", "Saba", "Dena",
];

const emojis = ["🎬", "🎧", "📚", "✨", "🌙", "🎮", "☕", "🎨", "🚀", "🧠"];

function parseArgs(argv) {
  const args = {
    count: 30,
    dryRun: false,
    remove: false,
    enableMatches: false,
    cost: 0,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--remove") args.remove = true;
    else if (arg === "--enable-matches") args.enableMatches = true;
    else if (arg.startsWith("--count=")) args.count = Number(arg.slice("--count=".length));
    else if (arg.startsWith("--cost=")) args.cost = Number(arg.slice("--cost=".length));
  }

  args.count = Math.min(100, Math.max(1, Number.isFinite(args.count) ? Math.round(args.count) : 30));
  args.cost = Math.max(0, Number.isFinite(args.cost) ? Math.round(args.cost) : 0);
  return args;
}

function asItems(values) {
  return values.map((title) => ({ title, comment: "", watched: false }));
}

function rotate(values, index) {
  const offset = index % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function buildSeedUser(index) {
  const cluster = clusters[index % clusters.length];
  const secondary = clusters[(index + 1) % clusters.length];
  const name = firstNames[index % firstNames.length];
  const code = `u_SEED${String(index + 1).padStart(3, "0")}`;
  const movies = rotate([...cluster.movies, ...secondary.movies.slice(0, 2)], index).slice(0, 8);
  const music = rotate([...cluster.music, ...secondary.music.slice(0, 2)], index).slice(0, 6);
  const books = rotate([...cluster.books, ...secondary.books.slice(0, 2)], index).slice(0, 6);
  const random = rotate([...cluster.random, ...secondary.random.slice(0, 2)], index).slice(0, 6);

  return {
    userId: SEED_USER_ID_START - index,
    username: `muze_seed_${String(index + 1).padStart(3, "0")}`,
    firstName: name,
    profileName: `${name} (${cluster.name})`,
    profileNameConfirmedAt: new Date(),
    profileEmoji: emojis[index % emojis.length],
    city: ["Tehran", "Shiraz", "Isfahan", "Rasht", "Tabriz"][index % 5],
    age: 20 + (index % 15),
    gender: ["", "female", "male", "other"][index % 4],
    bio: `Test profile for ${cluster.name.toLowerCase()} taste discovery.`,
    publicProfileCode: code,
    showActiveDiscussionOnProfile: index % 4 === 0,
    bannedAt: null,
    lang: index % 3 === 0 ? "en" : "fa",
    state: "idle",
    onboardingCompletedAt: new Date(),
    aiLists: {
      movies: { topTen: asItems(movies.slice(0, 5)), watchlist: asItems(movies.slice(5)) },
      music: { topTen: asItems(music.slice(0, 4)), watchlist: asItems(music.slice(4)) },
      books: { topTen: asItems(books.slice(0, 4)), watchlist: asItems(books.slice(4)) },
      random: { topTen: asItems(random.slice(0, 4)), watchlist: asItems(random.slice(4)) },
    },
    aiTopTenMovies: movies.slice(0, 5),
    aiWatchlistMovies: movies.slice(5),
    aiTopTenMusic: music.slice(0, 4),
    aiWatchlistMusic: music.slice(4),
    aiTopTenBooks: books.slice(0, 4),
    aiWatchlistBooks: books.slice(4),
    aiTopTenRandom: random.slice(0, 4),
    aiWatchlistRandom: random.slice(4),
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

async function removeSeedUsers({ dryRun }) {
  const query = {
    userId: { $lte: SEED_USER_ID_START },
    publicProfileCode: /^u_seed\d+$/i,
  };
  const users = await User.find(query).select("userId publicProfileCode profileName").lean();
  if (dryRun) return { matched: users.length, removedUsers: 0, removedIndexRows: 0, sample: users.slice(0, 5) };

  const ids = users.map((user) => Number(user.userId));
  const userResult = await User.deleteMany(query);
  const indexResult = ids.length ? await UserTasteIndex.deleteMany({ userId: { $in: ids } }) : { deletedCount: 0 };
  return {
    matched: users.length,
    removedUsers: userResult.deletedCount || 0,
    removedIndexRows: indexResult.deletedCount || 0,
    sample: users.slice(0, 5),
  };
}

async function seedUsers({ count, dryRun }) {
  const users = Array.from({ length: count }, (_, index) => buildSeedUser(index));
  if (dryRun) return { planned: users.length, upserted: 0, tasteIndexesSynced: 0, sample: users.slice(0, 5) };

  let upserted = 0;
  let tasteIndexesSynced = 0;
  for (const seedUser of users) {
    const user = await User.findOneAndUpdate(
      { userId: seedUser.userId },
      { $set: seedUser },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, runValidators: true },
    ).lean();
    upserted += 1;
    const indexResult = await syncUserTasteIndex(user);
    if (indexResult.ok) tasteIndexesSynced += indexResult.sections.length;
  }

  return { planned: users.length, upserted, tasteIndexesSynced, sample: users.slice(0, 5) };
}

async function enablePeopleMatches({ dryRun, cost }) {
  const current = getStarSettingsState().values;
  const next = {
    ...current,
    economyEnabled: true,
    spendingEnabled: true,
    peopleTasteMatchesEnabled: true,
    peopleTasteMatchesCost: cost,
  };
  if (dryRun) return { changed: false, values: next };
  const values = await updateStarSettings(next, { actor: SEED_ACTOR });
  return { changed: true, values };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await connect();

  const result = args.remove
    ? { mode: "remove", users: await removeSeedUsers(args) }
    : { mode: "seed", users: await seedUsers(args) };

  if (args.enableMatches) {
    result.peopleMatches = await enablePeopleMatches(args);
  }

  result.dbName = mongoose.connection.name;
  result.dryRun = args.dryRun;
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("People test data seed failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
