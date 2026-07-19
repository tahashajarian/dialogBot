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

function getSectionEmoji(section) {
  if (section === "movies") return "🎬";
  if (section === "music") return "🎵";
  if (section === "books") return "📚";
  if (section === "random") return "🌿";
  return "✨";
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

const SECTION_MESSAGE_SUFFIXES = {
  movies: "Movies",
  music: "Music",
  books: "Books",
  random: "Random",
};

function getSectionMessage(messages, lang, baseKey, section, fallbackKey = "") {
  const suffix = SECTION_MESSAGE_SUFFIXES[section] || SECTION_MESSAGE_SUFFIXES.random;
  const key = `${baseKey}${suffix}`;
  return messages?.[lang]?.[key] || (fallbackKey ? messages?.[lang]?.[fallbackKey] : "");
}

const TASTE_LABEL_EMOJIS = {
  music: {
    metalhead: "🤘",
    rocker: "🎸",
    post_rocker: "🌌",
    punk: "⚡",
    pop_lover: "🎤",
    hiphop_head: "🎧",
    electronic_fan: "🎛️",
    classical_listener: "🎼",
    jazz_head: "🎷",
    indie_spirit: "🌙",
    traditional_fan: "🪕",
    music_buff: "🎧",
  },
  movies: {
    sci_fi_fan: "🚀",
    action_junkie: "💥",
    drama_lover: "🎭",
    mystery_fan: "🔎",
    comedy_fan: "😄",
    horror_fan: "🕯️",
    romance_fan: "💌",
    fantasy_fan: "🐉",
    animation_lover: "✨",
    documentary_viewer: "🎥",
    cinephile: "🎞️",
    movie_buff: "🎬",
  },
  books: {
    novel_reader: "📖",
    old_soul: "📜",
    fantasy_dreamer: "🐉",
    sci_fi_explorer: "🚀",
    born_detective: "🔎",
    hopeless_romantic: "💌",
    midnight_philosopher: "🧠",
    amateur_psychoanalyst: "🪞",
    truth_seeker: "💡",
    poetic_soul: "✒️",
    book_buff: "📚",
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

function getDiscussionTasteLabelOptionText(messages, lang, section, labelKey) {
  return `${getSectionEmoji(section)} ${getSectionLabel(messages, lang, section)} · ${getTasteLabelEmoji(section, labelKey)} ${getTasteLabelTitle(messages, lang, section, labelKey)}`;
}

function getTasteLabelStyleHint(messages, lang, section, labelKey) {
  const key = `aiTasteLabelStyle_${section}_${labelKey}`;
  if (messages?.[lang]?.[key]) {
    return messages[lang][key];
  }
  return messages[lang]?.aiTasteLabelStyleFallback || "";
}

module.exports = {
  getAiSectionFromState,
  getSectionEmoji,
  getSectionLabel,
  getSectionListButtonLabel,
  getSectionListLabel,
  getSectionMessage,
  getTasteLabelEmoji,
  getTasteLabelTitle,
  getDiscussionTasteLabelOptionText,
  getTasteLabelStyleHint,
};
