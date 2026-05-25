const User = require("../models/user");

async function getOrCreateUser(from) {
  if (!from) return null;

  let user = await User.findOne({ userId: from.id });

  if (!user) {
    user = await User.create({
      userId: from.id,
      username: from.username,
      firstName: from.first_name,
      profileName: from.first_name,
      age: null,
      lang: "fa",
    });
  }

  return user;
}

async function updateLanguage(userId, newLang) {
  return await User.findOneAndUpdate(
    { userId },
    { lang: newLang },
    { returnDocument: "after" },
  );
}

async function updateProfileField(userId, field, value) {
  return await User.findOneAndUpdate(
    { userId },
    { [field]: value },
    { returnDocument: "after" },
  );
}

async function updateUserState(userId, state) {
  return await User.findOneAndUpdate(
    { userId },
    { state },
    { returnDocument: "after" },
  );
}

function normalizeAiListItem(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeAiListComment(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeAiListItems(items = []) {
  const unique = new Set();
  const normalized = [];

  for (const item of items) {
    const titleSource = typeof item === "string" ? item : item?.title;
    const commentSource = typeof item === "string" ? "" : item?.comment;
    const watchedSource = typeof item === "string" ? false : Boolean(item?.watched);
    const title = normalizeAiListItem(titleSource);
    const comment = normalizeAiListComment(commentSource);
    if (!title) continue;
    const key = title.toLowerCase();
    if (unique.has(key)) continue;
    unique.add(key);
    normalized.push({ title, comment, watched: watchedSource });
  }

  return normalized;
}

const AI_SECTIONS = ["movies", "music", "books", "random"];
const TASTE_LABELS_BY_SECTION = {
  music: {
    metalhead: ["metallica", "megadeth", "slayer", "iron maiden", "pantera", "slipknot", "system of a down", "black sabbath", "judas priest", "anthrax", "opeth", "gojira"],
    rocker: ["queen", "pink floyd", "nirvana", "radiohead", "led zeppelin", "guns n roses", "foo fighters", "the beatles", "u2", "acdc", "arctic monkeys"],
    pop_lover: ["taylor swift", "dua lipa", "ed sheeran", "justin bieber", "ariana grande", "the weeknd", "katy perry", "rihanna", "billie eilish", "olivia rodrigo"],
    hiphop_head: ["drake", "kendrick lamar", "j cole", "eminem", "travis scott", "kanye west", "future", "cardi b", "nas", "tupac", "snoop dogg"],
    electronic_fan: ["daft punk", "calvin harris", "tiesto", "martin garrix", "deadmau5", "avicii", "skrilllex", "kygo", "swedish house mafia", "alan walker"],
    classical_soul: ["mozart", "beethoven", "bach", "vivaldi", "chopin", "tchaikovsky", "debussy", "handel", "brahms"],
    jazz_vibe: ["miles davis", "john coltrane", "ella fitzgerald", "louis armstrong", "charlie parker", "duke ellington", "bill evans"],
    indie_spirit: ["tame impala", "the strokes", "phoebe bridgers", "bon iver", "the national", "alt-j", "vampire weekend", "mac demarco"],
  },
  movies: {
    sci_fi_explorer: ["interstellar", "inception", "blade runner", "arrival", "the matrix", "dune", "ex machina", "star wars", "alien"],
    action_junkie: ["john wick", "mad max", "mission impossible", "die hard", "the dark knight", "gladiator", "top gun", "fast and furious"],
    drama_seeker: ["the godfather", "shawshank redemption", "parasite", "forrest gump", "a beautiful mind", "spotlight", "moonlight"],
    comedy_chaser: ["superbad", "the hangover", "mean girls", "step brothers", "groundhog day", "anchorman", "deadpool"],
    horror_hunter: ["the conjuring", "hereditary", "the exorcist", "insidious", "it", "the shining", "get out"],
    animation_lover: ["spirited away", "coco", "inside out", "toy story", "up", "zootopia", "finding nemo", "ratatouille"],
    arthouse_curious: ["amelie", "in the mood for love", "the lobster", "the lighthouse", "persona", "8 1/2", "tokyo story"],
    documentary_mind: ["planet earth", "free solo", "the social dilemma", "making a murderer", "blackfish", "icarus"],
  },
  books: {
    fantasy_dreamer: ["harry potter", "lord of the rings", "the hobbit", "wheel of time", "mistborn", "stormlight archive", "game of thrones"],
    sci_fi_reader: ["dune", "foundation", "neuromancer", "ender's game", "the expanse", "snow crash", "the martian"],
    thriller_detective: ["gone girl", "the girl with the dragon tattoo", "da vinci code", "sherlock holmes", "big little lies"],
    classic_reader: ["pride and prejudice", "1984", "to kill a mockingbird", "crime and punishment", "moby dick", "great gatsby"],
    self_growth: ["atomic habits", "deep work", "the power of habit", "thinking fast and slow", "the subtle art of not giving"],
    romance_reader: ["me before you", "the notebook", "normal people", "it ends with us", "outlander"],
    history_buff: ["sapiens", "guns germs and steel", "team of rivals", "the silk roads", "1776"],
    non_fiction_curious: ["educated", "born a crime", "bad blood", "outliers", "factfulness", "quiet"],
  },
  random: {
    explorer: ["travel", "hiking", "camping", "road trip", "adventure", "backpacking", "mountain", "nature"],
    foodie: ["cooking", "baking", "restaurant", "food", "coffee", "tea", "dessert", "pizza", "burger", "sushi"],
    gamer: ["game", "gaming", "xbox", "playstation", "nintendo", "steam", "esports", "dota", "fifa", "valorant"],
    creator: ["drawing", "design", "photography", "video editing", "writing", "painting", "craft", "maker"],
    sporty: ["football", "basketball", "gym", "running", "yoga", "swimming", "cycling", "tennis"],
    mindful: ["meditation", "journal", "mindfulness", "wellness", "calm", "mental health", "therapy"],
    social: ["party", "friends", "community", "event", "festival", "concert", "meetup"],
  },
};
const DEFAULT_TASTE_LABEL_BY_SECTION = {
  movies: "eclectic_watcher",
  music: "eclectic_listener",
  books: "eclectic_reader",
  random: "multi_interest",
};
const LEGACY_FIELDS = {
  movies: { watchlist: "aiWatchlistMovies", topTen: "aiTopTenMovies" },
  music: { watchlist: "aiWatchlistMusic", topTen: "aiTopTenMusic" },
  books: { watchlist: "aiWatchlistBooks", topTen: "aiTopTenBooks" },
  random: { watchlist: "aiWatchlistRandom", topTen: "aiTopTenRandom" },
};

function getLegacyAiListItems(user, section, listType) {
  const field = LEGACY_FIELDS[section]?.[listType];
  if (!field) return [];
  return normalizeAiListItems(user?.[field] || []);
}

function hasStructuredAiList(user, section, listType) {
  return Array.isArray(user?.aiLists?.[section]?.[listType]);
}

function getAiListItemsFromUser(user, section, listType) {
  const legacyItems = getLegacyAiListItems(user, section, listType);

  if (hasStructuredAiList(user, section, listType)) {
    const structuredItems = normalizeAiListItems(user?.aiLists?.[section]?.[listType] || []);
    if (structuredItems.length > 0 || legacyItems.length === 0) {
      return structuredItems;
    }
  }

  return legacyItems;
}

function getAiListTitlesFromUser(user, section, listType) {
  return getAiListItemsFromUser(user, section, listType).map((entry) => entry.title);
}

function normalizeTasteItem(value) {
  return normalizeAiListItem(value).slice(0, 60);
}

function getAiTasteTopTenFromUser(user, section) {
  const topTenItems = getAiListItemsFromUser(user, section, "topTen");
  return topTenItems.map((entry) => normalizeTasteItem(entry?.title)).filter(Boolean);
}

function getAiTasteFromUser(user, section) {
  const sectionTaste = user?.aiTaste?.[section] || {};
  const labelKey = String(sectionTaste?.labelKey || "").trim();
  const sampleCount = Number(sectionTaste?.sampleCount) || 0;
  const confidence = Number(sectionTaste?.confidence) || 0;
  return {
    labelKey,
    sampleCount,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };
}

function getAiTasteKeywordsForSection(section) {
  return TASTE_LABELS_BY_SECTION[section] || {};
}

function inferTasteLabel(section, items = []) {
  const normalizedItems = items
    .map((item) => normalizeTasteItem(item).toLowerCase())
    .filter(Boolean);
  const labels = getAiTasteKeywordsForSection(section);
  const scores = {};
  let totalMatches = 0;

  for (const labelKey of Object.keys(labels)) {
    scores[labelKey] = 0;
  }

  for (const item of normalizedItems) {
    for (const [labelKey, keywords] of Object.entries(labels)) {
      const matched = keywords.some((keyword) => item.includes(String(keyword).toLowerCase()));
      if (!matched) continue;
      scores[labelKey] += 1;
      totalMatches += 1;
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLabel, topScore = 0] = ranked[0] || [];

  if (!topLabel || topScore <= 0) {
    return {
      labelKey: DEFAULT_TASTE_LABEL_BY_SECTION[section] || "eclectic",
      confidence: 0.45,
      sampleCount: normalizedItems.length,
    };
  }

  const confidenceBase = totalMatches > 0 ? topScore / totalMatches : 0;
  const confidenceBySamples = Math.min(1, normalizedItems.length / 10);
  const confidence = Number(
    Math.max(0.5, Math.min(0.95, (confidenceBase * 0.75) + (confidenceBySamples * 0.25))).toFixed(2),
  );

  return {
    labelKey: topLabel,
    confidence,
    sampleCount: normalizedItems.length,
  };
}

function getTasteProgressStatus(section, currentCount) {
  const goal = 10;
  const count = Math.max(0, Math.min(goal, Number(currentCount) || 0));
  const remaining = Math.max(0, goal - count);
  const completed = count >= goal;
  const labelReady = completed;
  return {
    section,
    count,
    goal,
    remaining,
    completed,
    labelReady,
  };
}

async function syncAiTasteForSection(userId, section) {
  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const topTenTitles = getAiTasteTopTenFromUser(user, section);
  const progress = getTasteProgressStatus(section, topTenTitles.length);
  const existingTaste = getAiTasteFromUser(user, section);

  if (!progress.labelReady) {
    const updates = {
      [`aiTaste.${section}.sampleCount`]: progress.count,
      [`aiTaste.${section}.updatedAt`]: new Date(),
    };
    if (existingTaste.labelKey) {
      updates[`aiTaste.${section}.labelKey`] = "";
      updates[`aiTaste.${section}.confidence`] = 0;
    }
    await User.findOneAndUpdate({ userId }, { $set: updates }, { returnDocument: "after" });
    return {
      ok: true,
      taste: {
        labelKey: "",
        confidence: 0,
        sampleCount: progress.count,
      },
      progress,
    };
  }

  const inferred = inferTasteLabel(section, topTenTitles);
  await User.findOneAndUpdate(
    { userId },
    {
      $set: {
        [`aiTaste.${section}.labelKey`]: inferred.labelKey,
        [`aiTaste.${section}.confidence`]: inferred.confidence,
        [`aiTaste.${section}.sampleCount`]: inferred.sampleCount,
        [`aiTaste.${section}.updatedAt`]: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  return {
    ok: true,
    taste: inferred,
    progress,
  };
}

async function addAiListItem(userId, section, listType, item, maxItems) {
  const title = normalizeAiListItem(item?.title || item);
  const comment = normalizeAiListComment(item?.comment);
  if (!title) {
    return { ok: false, reason: "empty" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = getAiListItemsFromUser(user, section, listType);
  const exists = current.some((entry) => entry.title.toLowerCase() === title.toLowerCase());
  if (exists) {
    return { ok: false, reason: "exists", items: current };
  }

  if (current.length >= maxItems) {
    return { ok: false, reason: "limit", items: current };
  }

  const watched = listType === "watchlist" ? Boolean(item?.watched) : false;
  const updated = [...current, { title, comment, watched }];
  await updateProfileField(userId, `aiLists.${section}.${listType}`, updated);
  return { ok: true, items: updated };
}

async function removeAiListItem(userId, section, listType, item) {
  const cleanItem = normalizeAiListItem(item);
  if (!cleanItem) {
    return { ok: false, reason: "empty" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = getAiListItemsFromUser(user, section, listType);
  const updated = current.filter((entry) => entry.title.toLowerCase() !== cleanItem.toLowerCase());
  if (updated.length === current.length) {
    return { ok: false, reason: "not_found", items: current };
  }

  await updateProfileField(userId, `aiLists.${section}.${listType}`, updated);
  return { ok: true, items: updated };
}

function getWatchlistItemsByStatusFromUser(user, section, status = "all") {
  const items = getAiListItemsFromUser(user, section, "watchlist");
  if (status === "watched") {
    return items.filter((entry) => Boolean(entry?.watched));
  }
  if (status === "not_watched") {
    return items.filter((entry) => !entry?.watched);
  }
  return items;
}

async function toggleWatchlistItemWatched(userId, section, item) {
  const cleanItem = normalizeAiListItem(item);
  if (!cleanItem) {
    return { ok: false, reason: "empty" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = getAiListItemsFromUser(user, section, "watchlist");
  let changed = false;
  const updated = current.map((entry) => {
    if (entry.title.toLowerCase() !== cleanItem.toLowerCase()) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      watched: !Boolean(entry?.watched),
    };
  });

  if (!changed) {
    return { ok: false, reason: "not_found", items: current };
  }

  await updateProfileField(userId, `aiLists.${section}.watchlist`, updated);
  const itemUpdated = updated.find((entry) => entry.title.toLowerCase() === cleanItem.toLowerCase());
  return { ok: true, items: updated, item: itemUpdated };
}

async function setAiListItemComment(userId, section, listType, item, comment) {
  const cleanItem = normalizeAiListItem(item);
  const cleanComment = normalizeAiListComment(comment);
  if (!cleanItem) {
    return { ok: false, reason: "empty_item" };
  }

  if (listType !== "watchlist" && listType !== "topTen") {
    return { ok: false, reason: "invalid_list_type" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = getAiListItemsFromUser(user, section, listType);
  let changed = false;
  const updated = current.map((entry) => {
    if (entry.title.toLowerCase() !== cleanItem.toLowerCase()) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      comment: cleanComment,
    };
  });

  if (!changed) {
    return { ok: false, reason: "not_found", items: current };
  }

  await updateProfileField(userId, `aiLists.${section}.${listType}`, updated);
  const itemUpdated = updated.find((entry) => entry.title.toLowerCase() === cleanItem.toLowerCase());
  return { ok: true, items: updated, item: itemUpdated };
}

async function promoteWatchlistItemToTopTen(userId, section, item, maxTopTenItems = 10) {
  const cleanItem = normalizeAiListItem(item);
  if (!cleanItem) {
    return { ok: false, reason: "empty_item" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const watchlistItems = getAiListItemsFromUser(user, section, "watchlist");
  const topTenItems = getAiListItemsFromUser(user, section, "topTen");
  const watchlistItem = watchlistItems.find((entry) => entry.title.toLowerCase() === cleanItem.toLowerCase());
  if (!watchlistItem) {
    return { ok: false, reason: "watchlist_not_found", watchlistItems, topTenItems };
  }

  const topTenHasItem = topTenItems.some((entry) => entry.title.toLowerCase() === cleanItem.toLowerCase());
  if (topTenHasItem) {
    return { ok: false, reason: "exists", watchlistItems, topTenItems };
  }

  if (topTenItems.length >= maxTopTenItems) {
    return { ok: false, reason: "top_ten_limit", watchlistItems, topTenItems };
  }

  const nextWatchlist = watchlistItems.filter((entry) => entry.title.toLowerCase() !== cleanItem.toLowerCase());
  const nextTopTen = [...topTenItems, { title: watchlistItem.title, comment: watchlistItem.comment, watched: false }];

  await updateProfileField(userId, `aiLists.${section}.watchlist`, nextWatchlist);
  await updateProfileField(userId, `aiLists.${section}.topTen`, nextTopTen);

  return {
    ok: true,
    movedItem: { title: watchlistItem.title, comment: watchlistItem.comment },
    watchlistItems: nextWatchlist,
    topTenItems: nextTopTen,
  };
}

module.exports = {
  AI_SECTIONS,
  TASTE_LABELS_BY_SECTION,
  DEFAULT_TASTE_LABEL_BY_SECTION,
  getOrCreateUser,
  updateLanguage,
  updateProfileField,
  updateUserState,
  addAiListItem,
  removeAiListItem,
  normalizeAiListItem,
  normalizeAiListComment,
  normalizeAiListItems,
  getAiListItemsFromUser,
  getAiListTitlesFromUser,
  getWatchlistItemsByStatusFromUser,
  toggleWatchlistItemWatched,
  setAiListItemComment,
  promoteWatchlistItemToTopTen,
  normalizeTasteItem,
  getAiTasteTopTenFromUser,
  getAiTasteFromUser,
  inferTasteLabel,
  getTasteProgressStatus,
  syncAiTasteForSection,
};
