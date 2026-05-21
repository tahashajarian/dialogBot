function getAiSectionFromState(state) {
  if (
    state === "ai_chat_movies" ||
    state === "ai_manage_movies_watchlist" ||
    state === "ai_manage_movies_top_ten"
  ) {
    return "movies";
  }

  if (
    state === "ai_chat_music" ||
    state === "ai_manage_music_watchlist" ||
    state === "ai_manage_music_top_ten"
  ) {
    return "music";
  }

  if (
    state === "ai_chat_books" ||
    state === "ai_manage_books_watchlist" ||
    state === "ai_manage_books_top_ten"
  ) {
    return "books";
  }

  if (
    state === "ai_chat_random" ||
    state === "ai_manage_random_watchlist" ||
    state === "ai_manage_random_top_ten"
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
  clearAiSectionPin,
  pinAiSectionTitle,
};
