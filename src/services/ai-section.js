function getAiSectionFromState(state) {
  if (
    state === "ai_chat_movies" ||
    state === "ai_manage_movies_watchlist" ||
    state === "ai_manage_movies_top_ten" ||
    state === "ai_manage_movies_watchlist_add_input" ||
    state === "ai_manage_movies_top_ten_add_input" ||
    state === "ai_manage_movies_watchlist_comment_input" ||
    state === "ai_manage_movies_top_ten_comment_input"
  ) {
    return "movies";
  }

  if (
    state === "ai_chat_music" ||
    state === "ai_manage_music_watchlist" ||
    state === "ai_manage_music_top_ten" ||
    state === "ai_manage_music_watchlist_add_input" ||
    state === "ai_manage_music_top_ten_add_input" ||
    state === "ai_manage_music_watchlist_comment_input" ||
    state === "ai_manage_music_top_ten_comment_input"
  ) {
    return "music";
  }

  if (
    state === "ai_chat_books" ||
    state === "ai_manage_books_watchlist" ||
    state === "ai_manage_books_top_ten" ||
    state === "ai_manage_books_watchlist_add_input" ||
    state === "ai_manage_books_top_ten_add_input" ||
    state === "ai_manage_books_watchlist_comment_input" ||
    state === "ai_manage_books_top_ten_comment_input"
  ) {
    return "books";
  }

  if (
    state === "ai_chat_random" ||
    state === "ai_manage_random_watchlist" ||
    state === "ai_manage_random_top_ten" ||
    state === "ai_manage_random_watchlist_add_input" ||
    state === "ai_manage_random_top_ten_add_input" ||
    state === "ai_manage_random_watchlist_comment_input" ||
    state === "ai_manage_random_top_ten_comment_input"
  ) {
    return "random";
  }

  return null;
}

function getSectionLabel(messages, lang, section) {
  if (section === "movies") return messages[lang].aiSectionNameMovies;
  if (section === "music") return messages[lang].aiSectionNameMusic;
  if (section === "books") return messages[lang].aiSectionNameBooks;
  return messages[lang].aiSectionNameRandom;
}

function getSectionListButtonLabel(messages, lang, section) {
  if (section === "movies") return messages[lang].aiSectionListButtonMovies;
  if (section === "music") return messages[lang].aiSectionListButtonMusic;
  if (section === "books") return messages[lang].aiSectionListButtonBooks;
  return messages[lang].aiSectionListButtonRandom;
}

function getSectionListLabel(messages, lang, section) {
  if (section === "movies") return messages[lang].aiSectionListLabelMovies;
  if (section === "music") return messages[lang].aiSectionListLabelMusic;
  if (section === "books") return messages[lang].aiSectionListLabelBooks;
  return messages[lang].aiSectionListLabelRandom;
}

const TASTE_LABEL_EMOJIS = {
  music: {
    metalhead: "🤘",
    rocker: "🎸",
    pop_lover: "🎤",
    hiphop_head: "🎧",
    electronic_fan: "🎛️",
    classical_soul: "🎼",
    jazz_vibe: "🎷",
    indie_spirit: "🌙",
    eclectic_listener: "🎵",
  },
  movies: {
    sci_fi_explorer: "🚀",
    action_junkie: "💥",
    drama_seeker: "🎭",
    comedy_chaser: "😄",
    horror_hunter: "🕯️",
    animation_lover: "✨",
    arthouse_curious: "🎞️",
    documentary_mind: "🧠",
    eclectic_watcher: "🎬",
  },
  books: {
    fantasy_dreamer: "🐉",
    sci_fi_reader: "🪐",
    thriller_detective: "🔎",
    classic_reader: "📜",
    self_growth: "🌱",
    romance_reader: "💌",
    history_buff: "🏛️",
    non_fiction_curious: "💡",
    eclectic_reader: "📚",
  },
  random: {
    strategy_mind: "♟",
    tech_minded: "💻",
    cafe_lover: "☕",
    explorer: "🧭",
    foodie: "🍜",
    gamer: "🎮",
    creator: "🎨",
    sporty: "🏃",
    mindful: "🧘",
    social: "🎉",
    multi_interest: "🧩",
  },
};

function getTasteLabelEmoji(section, labelKey) {
  return TASTE_LABEL_EMOJIS[section]?.[labelKey] || "🏷";
}

function getTasteLabelTitle(messages, lang, section, labelKey) {
  const key = `aiTasteLabelTitle_${section}_${labelKey}`;
  if (messages?.[lang]?.[key]) {
    return messages[lang][key];
  }
  return messages[lang]?.aiTasteLabelTitleFallback || "Taste Explorer";
}

function getTasteLabelStyleHint(messages, lang, section, labelKey) {
  const key = `aiTasteLabelStyle_${section}_${labelKey}`;
  if (messages?.[lang]?.[key]) {
    return messages[lang][key];
  }
  return messages[lang]?.aiTasteLabelStyleFallback || "";
}

async function clearAiSectionPin({ ctx, updateProfileField }) {
  const pinnedMessageId = Number(ctx.user?.aiSectionPinnedMessageId);

  if (pinnedMessageId && ctx.unpinMessage) {
    try {
      await ctx.unpinMessage(pinnedMessageId);
    } catch {}
  }

  await updateProfileField(ctx.userId, "aiSectionPinnedMessageId", null);
  await updateProfileField(ctx.userId, "aiSectionPinnedSection", null);
}

async function pinAiSectionTitle({
  ctx,
  lang,
  section,
  messages,
  updateProfileField,
}) {
  await clearAiSectionPin({ ctx, updateProfileField });

  const sectionLabel = getSectionLabel(messages, lang, section);
  const titleText = messages[lang].aiSectionPinnedTitle.replace("{section}", sectionLabel);
  const sentMessage = await ctx.reply(titleText);
  const messageId = sentMessage?.message_id || sentMessage?.messageId;

  let pinned = false;
  if (messageId && ctx.pinMessage) {
    try {
      pinned = await ctx.pinMessage(messageId);
    } catch {}
  }

  if (messageId && pinned) {
    await updateProfileField(ctx.userId, "aiSectionPinnedMessageId", Number(messageId));
    await updateProfileField(ctx.userId, "aiSectionPinnedSection", section);
  }
}

module.exports = {
  getAiSectionFromState,
  getSectionLabel,
  getSectionListButtonLabel,
  getSectionListLabel,
  getTasteLabelEmoji,
  getTasteLabelTitle,
  getTasteLabelStyleHint,
  clearAiSectionPin,
  pinAiSectionTitle,
};
