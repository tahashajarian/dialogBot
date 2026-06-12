const User = require("../models/user");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");
const { getTasteLabelEmoji } = require("./ai-section");
const { isLowQualityAiListItem } = require("./ai-input-quality");

async function getOrCreateUser(from) {
  if (!from) return null;

  return await User.findOneAndUpdate(
    { userId: from.id },
    {
      $set: {
        username: from.username,
        firstName: from.first_name,
      },
      $setOnInsert: {
        userId: from.id,
        profileName: from.first_name,
        age: null,
        lang: "fa",
      },
    },
    {
      upsert: true,
      returnDocument: "after",
    },
  );
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
const AI_SUGGESTION_QUOTA_LIMIT = 10;
const AI_SUGGESTION_QUOTA_WINDOW_MS = 60 * 60 * 1000;
const TASTE_LABELS_BY_SECTION = {
  music: {
    metalhead: ["metallica", "enter sandman", "master of puppets", "nothing else matters", "megadeth", "symphony of destruction", "slayer", "raining blood", "iron maiden", "pantera", "walk", "slipknot", "system of a down", "toxicity", "black sabbath", "judas priest", "anthrax", "opeth", "gojira"],
    rocker: ["queen", "bohemian rhapsody", "pink floyd", "comfortably numb", "nirvana", "smells like teen spirit", "radiohead", "creep", "led zeppelin", "stairway to heaven", "guns n roses", "sweet child o mine", "foo fighters", "the beatles", "u2", "acdc", "back in black", "arctic monkeys"],
    pop_lover: ["taylor swift", "blank space", "dua lipa", "levitating", "ed sheeran", "shape of you", "justin bieber", "ariana grande", "the weeknd", "blinding lights", "katy perry", "rihanna", "billie eilish", "bad guy", "olivia rodrigo"],
    hiphop_head: ["drake", "kendrick lamar", "humble", "j cole", "eminem", "lose yourself", "travis scott", "kanye west", "future", "cardi b", "nas", "tupac", "snoop dogg"],
    electronic_fan: ["daft punk", "get lucky", "one more time", "calvin harris", "tiesto", "martin garrix", "animals", "deadmau5", "avicii", "levels", "skrilllex", "kygo", "swedish house mafia", "alan walker", "faded"],
    classical_soul: ["mozart", "beethoven", "fur elise", "moonlight sonata", "bach", "vivaldi", "four seasons", "chopin", "nocturne", "tchaikovsky", "debussy", "clair de lune", "handel", "brahms"],
    jazz_vibe: ["miles davis", "kind of blue", "john coltrane", "ella fitzgerald", "louis armstrong", "charlie parker", "duke ellington", "bill evans", "take five", "dave brubeck"],
    indie_spirit: ["tame impala", "the less i know the better", "the strokes", "phoebe bridgers", "bon iver", "skinny love", "the national", "alt-j", "vampire weekend", "mac demarco"],
  },
  movies: {
    sci_fi_explorer: ["interstellar", "inception", "blade runner", "arrival", "the matrix", "dune", "ex machina", "star wars", "alien", "2001", "minority report", "edge of tomorrow"],
    action_junkie: ["john wick", "mad max", "mission impossible", "die hard", "the dark knight", "gladiator", "top gun", "fast and furious", "the raid", "terminator", "casino royale", "kill bill"],
    drama_seeker: ["the godfather", "shawshank redemption", "parasite", "forrest gump", "forest gump", "a beautiful mind", "spotlight", "moonlight", "fight club", "green mile", "whiplash", "pianist", "schindler"],
    comedy_chaser: ["superbad", "the hangover", "mean girls", "step brothers", "groundhog day", "anchorman", "deadpool", "bridesmaids", "borat", "office space"],
    horror_hunter: ["the conjuring", "hereditary", "the exorcist", "insidious", "it", "the shining", "get out", "scream", "midsommar", "a quiet place", "sinister"],
    animation_lover: ["spirited away", "coco", "inside out", "toy story", "up", "zootopia", "finding nemo", "ratatouille", "wall-e", "shrek", "your name"],
    arthouse_curious: ["amelie", "in the mood for love", "the lobster", "the lighthouse", "persona", "8 1/2", "tokyo story", "stalker", "mulholland drive", "tree of life"],
    documentary_mind: ["planet earth", "free solo", "the social dilemma", "making a murderer", "blackfish", "icarus", "13th", "inside job", "won't you be my neighbor"],
  },
  books: {
    fantasy_dreamer: ["harry potter", "lord of the rings", "the hobbit", "wheel of time", "mistborn", "stormlight archive", "game of thrones", "name of the wind", "earthsea", "narnia"],
    sci_fi_reader: ["dune", "foundation", "neuromancer", "ender's game", "the expanse", "snow crash", "the martian", "three body problem", "hitchhiker", "fahrenheit 451"],
    thriller_detective: ["gone girl", "the girl with the dragon tattoo", "da vinci code", "sherlock holmes", "big little lies", "silent patient", "agatha christie", "murder on the orient express"],
    classic_reader: ["pride and prejudice", "1984", "to kill a mockingbird", "crime and punishment", "moby dick", "great gatsby", "anna karenina", "war and peace", "catcher in the rye"],
    self_growth: ["atomic habits", "deep work", "the power of habit", "thinking fast and slow", "the subtle art of not giving", "7 habits", "mans search for meaning", "rich dad poor dad"],
    romance_reader: ["me before you", "the notebook", "normal people", "it ends with us", "outlander", "red white royal blue", "beach read", "love hypothesis"],
    history_buff: ["sapiens", "guns germs and steel", "team of rivals", "the silk roads", "1776", "a people's history", "chernobyl", "emperor of all maladies"],
    non_fiction_curious: ["educated", "born a crime", "bad blood", "outliers", "factfulness", "quiet", "freakonomics", "into thin air", "when breath becomes air"],
  },
  random: {
    strategy_mind: ["chess", "شطرنج", "board game", "board games", "strategy", "puzzle", "sudoku", "go game", "ذهنی", "استراتژی", "بازی فکری"],
    tech_minded: ["coding", "programming", "code", "technology", "tech", "software", "developer", "ai", "gadgets", "کدنویسی", "برنامه نویسی", "برنامه‌نویسی", "تکنولوژی", "فناوری"],
    cafe_lover: ["cafe", "coffee", "espresso", "latte", "tea", "کافه", "قهوه", "اسپرسو", "لاته", "چای", "کافه گردی", "کافه‌گردی"],
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

function getAiRecentSuggestionTitlesFromUser(user, section) {
  return (user?.aiRecentSuggestions?.[section] || [])
    .map((entry) => normalizeAiListItem(entry))
    .filter(Boolean);
}

async function addAiRecentSuggestion(userId, section, title, maxItems = 20) {
  const cleanTitle = normalizeAiListItem(title);
  if (!cleanTitle) {
    return { ok: false, reason: "empty" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = getAiRecentSuggestionTitlesFromUser(user, section);
  const withoutDuplicate = current.filter((entry) => entry.toLowerCase() !== cleanTitle.toLowerCase());
  const updated = [...withoutDuplicate, cleanTitle].slice(-maxItems);
  await updateProfileField(userId, `aiRecentSuggestions.${section}`, updated);
  return { ok: true, items: updated };
}

function getRecentSuggestionUsageFromUser(user, section, now = new Date(), windowMs = AI_SUGGESTION_QUOTA_WINDOW_MS) {
  const cutoff = now.getTime() - windowMs;
  return (user?.aiSuggestionUsage?.[section] || [])
    .map((entry) => new Date(entry))
    .filter((entry) => Number.isFinite(entry.getTime()) && entry.getTime() > cutoff);
}

async function consumeAiSuggestionQuota(
  userId,
  section,
  limit = AI_SUGGESTION_QUOTA_LIMIT,
  windowMs = AI_SUGGESTION_QUOTA_WINDOW_MS,
) {
  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const now = new Date();
  const recentUsage = getRecentSuggestionUsageFromUser(user, section, now, windowMs);
  if (recentUsage.length >= limit) {
    const oldest = recentUsage.sort((a, b) => a.getTime() - b.getTime())[0];
    return {
      ok: false,
      reason: "limit",
      count: recentUsage.length,
      limit,
      resetAt: new Date(oldest.getTime() + windowMs),
    };
  }

  const updatedUsage = [...recentUsage, now];
  await updateProfileField(userId, `aiSuggestionUsage.${section}`, updatedUsage);
  return {
    ok: true,
    count: updatedUsage.length,
    limit,
    resetAt: updatedUsage.length >= limit
      ? new Date(updatedUsage[0].getTime() + windowMs)
      : null,
    consumedAt: now,
  };
}

async function refundAiSuggestionQuota(userId, section, consumedAt) {
  if (!consumedAt) {
    return { ok: false, reason: "missing_consumed_at" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const consumedTime = new Date(consumedAt).getTime();
  let removed = false;
  const updatedUsage = (user?.aiSuggestionUsage?.[section] || []).filter((entry) => {
    if (!removed && new Date(entry).getTime() === consumedTime) {
      removed = true;
      return false;
    }
    return true;
  });

  if (!removed) {
    return { ok: false, reason: "not_found" };
  }

  await updateProfileField(userId, `aiSuggestionUsage.${section}`, updatedUsage);
  return { ok: true, items: updatedUsage };
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
  const emoji = String(sectionTaste?.emoji || "").trim() || (labelKey ? getTasteLabelEmoji(section, labelKey) : "");
  const sampleCount = Number(sectionTaste?.sampleCount) || 0;
  const confidence = Number(sectionTaste?.confidence) || 0;
  return {
    labelKey,
    emoji,
    sampleCount,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };
}

function getAiTasteKeywordsForSection(section) {
  return TASTE_LABELS_BY_SECTION[section] || {};
}

function matchesTasteKeyword(item, keyword) {
  const normalizedKeyword = String(keyword || "").toLowerCase().trim();
  if (!normalizedKeyword) return false;

  if (normalizedKeyword.length <= 2) {
    return item.split(/\s+/).includes(normalizedKeyword);
  }

  return item.includes(normalizedKeyword);
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
      const matched = keywords.some((keyword) => matchesTasteKeyword(item, keyword));
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
      emoji: getTasteLabelEmoji(section, DEFAULT_TASTE_LABEL_BY_SECTION[section] || "eclectic"),
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
    emoji: getTasteLabelEmoji(section, topLabel),
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
      updates[`aiTaste.${section}.emoji`] = "";
      updates[`aiTaste.${section}.confidence`] = 0;
    }
    await User.findOneAndUpdate({ userId }, { $set: updates }, { returnDocument: "after" });
    return {
      ok: true,
      taste: {
        labelKey: "",
        emoji: "",
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
        [`aiTaste.${section}.emoji`]: inferred.emoji,
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
  if (listType === "topTen" && isLowQualityAiListItem(title)) {
    return { ok: false, reason: "invalid_item_quality" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = getAiListItemsFromUser(user, section, listType);
  const duplicateMatch = getAiListDuplicateMatch(title, current);
  if (duplicateMatch) {
    return {
      ok: false,
      reason: "exists",
      items: current,
      duplicate: duplicateMatch.item,
      duplicateScore: duplicateMatch.score,
      duplicateType: duplicateMatch.type,
    };
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
    return {
      ok: false,
      reason: "exists",
      duplicate: topTenItems.find((entry) => entry.title.toLowerCase() === cleanItem.toLowerCase()),
      watchlistItems,
      topTenItems,
    };
  }

  if (topTenItems.length >= maxTopTenItems) {
    return { ok: false, reason: "top_ten_limit", watchlistItems, topTenItems };
  }

  const nextTopTen = [...topTenItems, { title: watchlistItem.title, comment: watchlistItem.comment, watched: false }];

  await updateProfileField(userId, `aiLists.${section}.topTen`, nextTopTen);

  return {
    ok: true,
    movedItem: { title: watchlistItem.title, comment: watchlistItem.comment },
    watchlistItems,
    topTenItems: nextTopTen,
  };
}

module.exports = {
  AI_SECTIONS,
  AI_SUGGESTION_QUOTA_LIMIT,
  AI_SUGGESTION_QUOTA_WINDOW_MS,
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
  getAiListDuplicateMatch,
  getAiListItemsFromUser,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  addAiRecentSuggestion,
  getRecentSuggestionUsageFromUser,
  consumeAiSuggestionQuota,
  refundAiSuggestionQuota,
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
