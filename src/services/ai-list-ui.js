const messages = require("../messages");
const { operationalLimits } = require("./operational-limits");
const { formatOperationalLimitsText } = require("./operational-limits-ui");
const {
  getAiListItemsFromUser,
  getAiTasteFromUser,
  syncAiTasteForSection,
} = require("./users");
const { localizeInterestChipItem } = require("./interest-chips");
const { paginateItems } = require("./pagination");

const TASTE_RESPONSE_BLOCK_SEPARATOR = "\n\n\n";
const AI_LIST_ITEM_DIVIDER = "────────────────────────";
const AI_WATCHLIST_PAGE_SIZE = 5;

function localizeAiListItemsForDisplay(items, section, lang) {
  if (section !== "random") return items;
  return items.map((entry) => localizeInterestChipItem(entry, lang));
}
const {
  getSectionEmoji,
  getSectionLabel,
  getSectionListLabel,
  getTasteLabelEmoji,
  getTasteLabelStyleHint,
  getTasteLabelTitle,
} = require("./ai-section");

function toTitleSet(items = []) {
  return new Set(items.map((entry) => String(entry?.title || entry || "").trim().toLowerCase()).filter(Boolean));
}

function getSectionLabelWithEmoji(messages, lang, section) {
  return `${getSectionEmoji(section)} ${getSectionLabel(messages, lang, section)}`;
}

function getAiListCommandSectionToken(section) {
  if (section === "movies") return "mv";
  if (section === "music") return "mu";
  if (section === "books") return "bk";
  if (section === "random") return "in";
  return section;
}

function getStatusActionLabels(lang, section) {
  const copy = messages[lang] || messages.en;
  if (section === "movies") {
    return {
      on: copy.aiListActionMarkWatched,
      off: copy.aiListActionMarkNotWatched,
    };
  }
  if (section === "music") {
    return {
      on: copy.aiListActionMarkListened,
      off: copy.aiListActionMarkNotListened,
    };
  }
  if (section === "books") {
    return {
      on: copy.aiListActionMarkRead,
      off: copy.aiListActionMarkNotRead,
    };
  }
  return {
    on: copy.aiListActionMarkDone,
    off: copy.aiListActionMarkNotDone,
  };
}

function splitLegacyMediaTitle(title, metadata = "") {
  const cleanTitle = String(title || "").trim();
  const cleanMetadata = String(metadata || "").trim();
  if (cleanMetadata) return { title: cleanTitle, metadata: cleanMetadata };
  const legacyMatch = cleanTitle.match(
    /^(.*?)\s*\(([^()]*(?:Dir\.|Director|Creator|Artist|Author|کارگردان|سازنده|هنرمند|نویسنده)[^()]*)\)\s*$/i,
  );
  if (!legacyMatch) return { title: cleanTitle, metadata: "" };
  return {
    title: legacyMatch[1].trim(),
    metadata: legacyMatch[2].trim(),
  };
}

function localizeListItemMetadata(lang, metadata) {
  const value = String(metadata || "").trim();
  if (lang !== "fa") return value;
  return value
    .replace(/\bDir\.\s*/gi, "کارگردان: ")
    .replace(/\bDirector\s*:/gi, "کارگردان:")
    .replace(/\bCreator\s*:/gi, "سازنده:")
    .replace(/\bAuthor\s*:/gi, "نویسنده:")
    .replace(/\bArtist\s*:/gi, "هنرمند:");
}

function formatAiItemsList(title, items, emptyText, options = {}) {
  if (!items.length) {
    return emptyText;
  }

  const topTenTitleSet = options.topTenTitleSet || new Set();
  const includeWatched = Boolean(options.includeWatched);
  const includeActions = Boolean(options.includeActions);
  const section = String(options.section || "");
  const listType = options.listType === "topTen" ? "top" : "list";
  const sectionToken = getAiListCommandSectionToken(section);
  const listToken = listType === "top" ? "t" : "l";
  const canPromote = Boolean(options.canPromote);
  const displayStartIndex = Math.max(0, Number(options.displayStartIndex) || 0);
  const pointer = options.lang === "fa" ? "👈" : "👉";
  const statusLabels = getStatusActionLabels(options.lang, section);
  const actionLabels = {
    done: statusLabels.on,
    undone: statusLabels.off,
    top10: options.lang === "fa" ? "افزودن به محبوب‌ها" : "Add to favorites",
    addComment: messages[options.lang]?.aiListActionAddComment || "Add comment",
    updateComment: messages[options.lang]?.aiListActionUpdateComment || "Update comment",
    remove: options.lang === "fa" ? "حذف" : "Remove",
  };
  const actionLine = (label, command) => `${label} ${pointer} ${command}`;
  const lines = items.map((entry, index) => {
    const displayItem = splitLegacyMediaTitle(entry?.title, entry?.metadata);
    const watchedBadge = includeWatched ? `${entry?.watched ? "✔️" : "○"} ` : "";
    const topTenBadge = topTenTitleSet.has(String(entry?.title || "").trim().toLowerCase()) ? " 🏆" : "";
    const localizedMetadata = displayItem.metadata
      ? localizeListItemMetadata(options.lang, displayItem.metadata)
      : "";
    const itemLine = [
      `${displayStartIndex + index + 1}. ${watchedBadge}${displayItem.title}${topTenBadge}${localizedMetadata ? ` — ${localizedMetadata}` : ""}`,
      entry?.comment
        ? `${entry?.commentSource === "user" ? "📝" : "✨"} ${entry.comment}`
        : "",
    ].filter(Boolean).join("\n");
    if (!includeActions || !section) return itemLine;

    const number = Number.isInteger(entry?.commandIndex) && entry.commandIndex > 0
      ? entry.commandIndex
      : index + 1;
    const actions = [];
    if (listType === "list") {
      actions.push(entry?.watched
        ? actionLine(actionLabels.undone, `/un_${sectionToken}_${listToken}_${number}`)
        : actionLine(actionLabels.done, `/dn_${sectionToken}_${listToken}_${number}`));
      if (entry?.watched && canPromote && !topTenTitleSet.has(String(entry?.title || "").trim().toLowerCase())) {
        actions.push(actionLine(actionLabels.top10, `/tt_${sectionToken}_${listToken}_${number}`));
      }
    }
    actions.push(actionLine(
      entry?.comment ? actionLabels.updateComment : actionLabels.addComment,
      `/cm_${sectionToken}_${listToken}_${number}`,
    ));
    actions.push(actionLine(actionLabels.remove, `/rm_${sectionToken}_${listToken}_${number}`));

    return `${itemLine}\n${actions.join("\n")}`;
  });
  return `${title}\n\n${lines.join(`\n${AI_LIST_ITEM_DIVIDER}\n`)}`;
}

function withAiSectionTitle(lang, section, body) {
  const sectionLabel = getSectionLabelWithEmoji(messages, lang, section);
  const heading = messages[lang].aiSectionTitle.replace("{section}", sectionLabel);
  return `${heading}\n\n${body}`;
}

function buildAiAssistantMenuMessage(lang, { showFirstVisitTip = false } = {}) {
  return [
    messages[lang].aiAssistantTitle,
    showFirstVisitTip ? messages[lang].favoritesFirstVisitTip : "",
    messages[lang].aiAssistantMenu,
  ].filter(Boolean).join("\n\n");
}

function buildTopTenListMessage({ ctx, lang, section }) {
  const sectionLabel = getSectionLabelWithEmoji(messages, lang, section);
  const topTenEntries = localizeAiListItemsForDisplay(getAiListItemsFromUser(ctx.user, section, "topTen"), section, lang);
  const favoritesTitleKey = section === "movies" ? "aiFavoritesTitleMovies"
    : section === "music" ? "aiFavoritesTitleMusic"
      : section === "books" ? "aiFavoritesTitleBooks" : "aiTopTenTitle";
  const title = messages[lang][favoritesTitleKey].replace("{section}", sectionLabel);
  const emptyText = messages[lang].aiTopTenEmpty.replace("{section}", sectionLabel);
  return withAiSectionTitle(lang, section, formatAiItemsList(title, topTenEntries, emptyText, {
    includeActions: true,
    lang,
    section,
    listType: "topTen",
  }));
}

function getWatchlistPage({ ctx, section, filter = "all", page = 0 }) {
  const allEntries = getAiListItemsFromUser(ctx.user, section, "watchlist");
  const filteredEntries = allEntries
    .map((entry, index) => ({ ...entry, commandIndex: index + 1 }))
    .reverse()
    .filter((entry) => (
      filter === "watched"
        ? entry?.watched === true
        : filter === "not_watched"
          ? entry?.watched !== true
          : true
    ));
  return {
    allEntries,
    filteredEntries,
    ...paginateItems(filteredEntries, page, AI_WATCHLIST_PAGE_SIZE),
  };
}

function buildWatchlistMessage({ ctx, lang, section, includeWatched = true, filter = "all", page = 0 }) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const listLabel = getSectionListLabel(messages, lang, section);
  const watchlistPage = getWatchlistPage({ ctx, section, filter, page });
  const entries = localizeAiListItemsForDisplay(watchlistPage.items, section, lang);
  const topTenTitleSet = toTitleSet(localizeAiListItemsForDisplay(getAiListItemsFromUser(ctx.user, section, "topTen"), section, lang));
  const title = messages[lang].aiWatchlistTitle
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel)
    .replace("{count}", watchlistPage.allEntries.length.toLocaleString(lang === "fa" ? "fa-IR" : "en-US"));
  const emptyText = filter === "all"
    ? messages[lang].aiWatchlistEmpty
      .replace("{section}", sectionLabel)
      .replace("{listName}", listLabel)
    : messages[lang].aiWatchlistFilterEmpty;
  return withAiSectionTitle(
    lang,
    section,
    formatAiItemsList(title, entries, emptyText, {
      topTenTitleSet,
      includeWatched,
      includeActions: true,
      displayStartIndex: watchlistPage.startIndex,
      canPromote: getAiListItemsFromUser(ctx.user, section, "topTen").length < operationalLimits.aiTopTenItems,
      lang,
      section,
      listType: "watchlist",
    }),
  );
}

function formatTasteWithStoredEmoji(section, taste, labelTitle) {
  return `${taste?.emoji || getTasteLabelEmoji(section, taste?.labelKey)} ${labelTitle}`;
}

function buildTopTenInsightMessage(lang, section, items, storedTaste = null) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const goal = operationalLimits.aiTopTenItems;
  if (items.length < goal) {
    return messages[lang].aiTopTenInsightNeedComplete
      .replace("{section}", sectionLabel)
      .replace("{count}", String(items.length))
      .replace("{goal}", String(goal));
  }

  if (!storedTaste?.labelKey) {
    return messages[lang].aiTopTenInsightNeedLabel;
  }
  const inferredTaste = storedTaste;
  const labelTitle = getTasteLabelTitle(messages, lang, section, inferredTaste.labelKey);
  const label = formatTasteWithStoredEmoji(section, inferredTaste, labelTitle);
  const style = getTasteLabelStyleHint(messages, lang, section, inferredTaste.labelKey);
  return messages[lang].aiTopTenInsightText
    .replace("{section}", sectionLabel)
    .replace("{label}", label)
    .replace("{style}", style || messages[lang].aiTasteLabelStyleFallback);
}

async function getTopTenManageEntryMessage(ctx, lang, section, topTenItemsOverride = null) {
  const topTenItems = Array.isArray(topTenItemsOverride)
    ? topTenItemsOverride
    : getAiListItemsFromUser(ctx.user, section, "topTen");
  const count = topTenItems.length;
  const goal = operationalLimits.aiTopTenItems;
  const isMediaSection = ["movies", "music", "books"].includes(section);
  const earnedTaste = getAiTasteFromUser(ctx.user, section);
  const withEarnedTaste = (text) => {
    if (!["confirmed", "confirmed_review"].includes(earnedTaste.classificationStatus) || !earnedTaste.labelKey) return text;
    const label = `${earnedTaste.emoji || getTasteLabelEmoji(section, earnedTaste.labelKey)} ${getTasteLabelTitle(messages, lang, section, earnedTaste.labelKey)}`;
    return `${text}\n\n${messages[lang].aiTasteEarnedLabelLine.replace("{label}", label)}`;
  };
  if (!isMediaSection) {
    return messages[lang].profileInterestsEditPrompt
      .replace("{count}", String(count))
      .replace("{limit}", String(operationalLimits.profileInterestItems));
  }
  if (isMediaSection && count === 0) {
    return withEarnedTaste(messages[lang].aiFavoritesIntro
      .replace("{goal}", String(goal)));
  }
  if (isMediaSection && count < 3) {
    const suggestionTargetKey = section === "books"
      ? "aiSuggestionTargetBooks"
      : section === "music"
        ? "aiSuggestionTargetMusic"
        : "aiSuggestionTargetMovies";
    return withEarnedTaste(messages[lang].aiFavoritesEarlyProgress
      .replace("{count}", String(count))
      .replace("{remaining}", String(3 - count))
      .replace("{section}", messages[lang][suggestionTargetKey]));
  }
  if (topTenItems.length < operationalLimits.aiTopTenItems) {
    if (topTenItems.length >= 3) {
      return withEarnedTaste(messages[lang].aiFavoritesUnlockedProgress
        .replace("{count}", String(count))
        .replace("{goal}", String(goal)));
    }
    return messages[lang].aiTopTenManageInlineEntry;
  }

  let taste = getAiTasteFromUser(ctx.user, section);
  const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
  if (syncedTaste.ok) taste = syncedTaste.taste;
  if (["confirmed", "confirmed_review"].includes(taste.classificationStatus) && taste.labelKey) {
    const labelTitle = getTasteLabelTitle(messages, lang, section, taste.labelKey);
    const label = formatTasteWithStoredEmoji(section, taste, labelTitle);
    return messages[lang].aiTopTenManageInlineEntryComplete.replace("{label}", label);
  }
  if (taste.classificationStatus === "suggested" && taste.suggestedLabelKeys?.length) {
    return messages[lang].aiTopTenManageInlineEntryCompleteSuggested;
  }
  return messages[lang].aiTopTenManageInlineEntryCompleteNoLabel;
}

async function buildAiListManagerMessage({ ctx, lang, section, listType, prefix = "", filter = "all", page = 0 }) {
  const listLabel = getSectionListLabel(messages, lang, section);
  const items = getAiListItemsFromUser(ctx.user, section, listType);
  const body = listType === "topTen"
    ? `${buildTopTenListMessage({ ctx, lang, section })}\n\n${await getTopTenManageEntryMessage(ctx, lang, section)}`
    : items.length
      ? buildWatchlistMessage({ ctx, lang, section, filter, page })
      : messages[lang].aiListManageEmptyEntry.replace("{listName}", listLabel);
  return [prefix, body].filter(Boolean).join("\n\n");
}

function formatSuggestionLimitMessage(lang, resetAt) {
  const resetTime = resetAt ? new Date(resetAt).getTime() : Date.now();
  const minutes = Math.max(1, Math.ceil((resetTime - Date.now()) / (60 * 1000)));
  return formatOperationalLimitsText(messages[lang].aiSuggestionHourlyLimit, { minutes });
}

function formatAiLimitMessage(lang, key) {
  return formatOperationalLimitsText(messages[lang][key]);
}

function localizeSuggestionMetadata(lang, metadata) {
  const value = String(metadata || "").trim();
  if (lang !== "fa") return value;
  return value
    .replace(/\bDirector\s*:/gi, "کارگردان:")
    .replace(/\bCreator\s*:/gi, "سازنده:")
    .replace(/\bAuthor\s*:/gi, "نویسنده:")
    .replace(/\bArtist\s*:/gi, "هنرمند:");
}

function formatSuggestionResultMessage(lang, title, reason, mood = "", metadata = "") {
  const cleanReason = reason || messages[lang].aiSuggestionFallbackTitle;
  return [
    messages[lang].aiSuggestionResultTitle.replace("{item}", title),
    localizeSuggestionMetadata(lang, metadata),
    mood ? messages[lang].aiSuggestionResultMood.replace("{mood}", mood) : "",
    messages[lang].aiSuggestionResultReason.replace("{reason}", cleanReason),
  ].filter(Boolean).join("\n\n");
}

function getNeedTopTenMessage(lang, section) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  return messages[lang].aiSectionSuggestNeedTopTenItem.replace("{section}", sectionLabel);
}

function getDuplicateItemTitle(result) {
  return result?.duplicate?.title || result?.duplicate || "";
}

function getDuplicateListMessage(lang, result) {
  const duplicateTitle = getDuplicateItemTitle(result);
  if (!duplicateTitle) {
    return messages[lang].aiListAlreadyExists;
  }

  return messages[lang].aiListDuplicateMatch.replace("{item}", duplicateTitle);
}

function getDuplicateTopTenMessage(lang, result, count) {
  const duplicateTitle = getDuplicateItemTitle(result);
  if (!duplicateTitle) {
    return messages[lang].aiTasteItemAlreadySent
      .replace("{count}", String(count))
      .replace("{goal}", String(operationalLimits.aiTopTenItems));
  }

  return messages[lang].aiTasteDuplicateMatch
    .replace("{item}", duplicateTitle)
    .replace("{count}", String(count))
    .replace("{goal}", String(operationalLimits.aiTopTenItems));
}

function getTopTenNextPrompt(lang, count) {
  const key = `aiTasteAskNext_${count}`;
  const text = messages[lang][key] || messages[lang].aiTasteAskNext;
  return text.startsWith("👩‍🦳") ? text : `👩‍🦳 ${text}`;
}

async function buildTopTenSavedMessage({
  ctx: _ctx,
  lang,
  section,
  item,
  items,
  savedMessageKey = "aiTasteItemSaved",
  includeNextPrompt = true,
  includeCompletionPrompt = true,
}) {
  const count = items.length;
  const goal = operationalLimits.aiTopTenItems;
  const savedText = messages[lang][savedMessageKey]
    .replace("{item}", item)
    .replace("{count}", String(count))
    .replace("{goal}", String(goal));

  const responseParts = [savedText];

  if (["movies", "music", "books"].includes(section) && count === 3) {
    responseParts.push(
      messages[lang].aiFavoritesUnlockedProgress
        .replace("{count}", String(count))
        .replace("{goal}", String(goal)),
    );
  }

  if (count < goal) {
    if (includeNextPrompt) responseParts.push(getTopTenNextPrompt(lang, count));
    return responseParts.join(TASTE_RESPONSE_BLOCK_SEPARATOR);
  }

  if (["movies", "music", "books"].includes(section) && includeCompletionPrompt) {
    responseParts.push(messages[lang].aiTasteCompletionReady);
    return responseParts.join(TASTE_RESPONSE_BLOCK_SEPARATOR);
  }

  return responseParts.join(TASTE_RESPONSE_BLOCK_SEPARATOR);
}

module.exports = {
  formatAiLimitMessage,
  buildAiListManagerMessage,
  buildAiAssistantMenuMessage,
  buildTopTenInsightMessage,
  buildTopTenListMessage,
  buildTopTenSavedMessage,
  buildWatchlistMessage,
  getWatchlistPage,
  AI_WATCHLIST_PAGE_SIZE,
  getAiListCommandSectionToken,
  formatAiItemsList,
  formatSuggestionLimitMessage,
  formatSuggestionResultMessage,
  getDuplicateItemTitle,
  getDuplicateListMessage,
  getDuplicateTopTenMessage,
  getNeedTopTenMessage,
  getSectionLabelWithEmoji,
  getTopTenManageEntryMessage,
  toTitleSet,
  withAiSectionTitle,
};
