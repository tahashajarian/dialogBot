const messages = require("../messages");
const { operationalLimits } = require("./operational-limits");
const { formatOperationalLimitsText } = require("./operational-limits-ui");
const {
  DEFAULT_TASTE_LABEL_BY_SECTION,
  getAiListItemsFromUser,
  getAiTasteFromUser,
  inferTasteLabel,
  syncAiTasteForSection,
} = require("./users");
const { localizeInterestChipItem } = require("./interest-chips");

const TASTE_RESPONSE_BLOCK_SEPARATOR = "\n\n\n";
const AI_LIST_ITEM_DIVIDER = "────────";

function localizeAiListItemsForDisplay(items, section, lang) {
  if (section !== "random") return items;
  return items.map((entry) => localizeInterestChipItem(entry, lang));
}
const { getAiTasteItemFeedback } = require("./ai");
const { isSavedOnlyTasteFeedback } = require("./ai-feedback-quality");
const { buildBotBaseLink } = require("./invite-links");
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
    const watchedBadge = includeWatched ? `${entry?.watched ? "✅" : "⏳"} ` : "";
    const topTenBadge = topTenTitleSet.has(String(entry?.title || "").trim().toLowerCase()) ? " 🏆" : "";
    const commentPart = entry?.comment ? ` — ${entry.comment}` : "";
    const itemLine = `${index + 1}. ${watchedBadge}${entry.title}${topTenBadge}${commentPart}`;
    if (!includeActions || !section) return itemLine;

    const number = index + 1;
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

function buildAiAssistantMenuMessage(lang) {
  return `${messages[lang].aiAssistant}\n\n${messages[lang].aiAssistantMenu}`;
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

function buildWatchlistMessage({ ctx, lang, section, includeWatched = true }) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const listLabel = getSectionListLabel(messages, lang, section);
  const entries = localizeAiListItemsForDisplay(getAiListItemsFromUser(ctx.user, section, "watchlist"), section, lang);
  const topTenTitleSet = toTitleSet(localizeAiListItemsForDisplay(getAiListItemsFromUser(ctx.user, section, "topTen"), section, lang));
  const title = messages[lang].aiWatchlistTitle
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);
  const emptyText = messages[lang].aiWatchlistEmpty
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);
  return withAiSectionTitle(
    lang,
    section,
    formatAiItemsList(title, entries, emptyText, {
      topTenTitleSet,
      includeWatched,
      includeActions: true,
      canPromote: getAiListItemsFromUser(ctx.user, section, "topTen").length < operationalLimits.aiTopTenItems,
      lang,
      section,
      listType: "watchlist",
    }),
  );
}

function buildShareListMessage({ ctx, lang, section, listType, botLink = buildBotBaseLink() }) {
  const sectionLabel = listType === "topTen"
    ? getSectionLabelWithEmoji(messages, lang, section)
    : getSectionLabel(messages, lang, section);
  const listLabel = getSectionListLabel(messages, lang, section);
  const entries = localizeAiListItemsForDisplay(getAiListItemsFromUser(ctx.user, section, listType), section, lang);
  const favoritesTitleKey = section === "movies" ? "aiFavoritesTitleMovies"
    : section === "music" ? "aiFavoritesTitleMusic"
      : section === "books" ? "aiFavoritesTitleBooks" : "aiTopTenTitle";
  const title = (listType === "topTen" ? messages[lang][favoritesTitleKey] : messages[lang].aiWatchlistTitle)
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);
  const emptyText = (listType === "topTen" ? messages[lang].aiTopTenEmpty : messages[lang].aiWatchlistEmpty)
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);

  const listText = formatAiItemsList(title, entries, emptyText);
  const cleanBotLink = String(botLink || "").trim();
  if (!cleanBotLink) return listText;
  return `${listText}\n\n${messages[lang].aiListShareFooter.replace("{link}", cleanBotLink)}`;
}

function formatTasteWithStoredEmoji(section, taste, labelTitle) {
  return `${taste?.emoji || getTasteLabelEmoji(section, taste?.labelKey)} ${labelTitle}`;
}

function buildTopTenInsightMessage(lang, section, items) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const goal = operationalLimits.aiTopTenItems;
  if (items.length < goal) {
    return messages[lang].aiTopTenInsightNeedComplete
      .replace("{section}", sectionLabel)
      .replace("{count}", String(items.length))
      .replace("{goal}", String(goal));
  }

  const inferredTaste = inferTasteLabel(section, items.map((entry) => entry.title));
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
  if (isMediaSection && count === 0) {
    return messages[lang].aiFavoritesIntro
      .replace("{goal}", String(goal));
  }
  if (isMediaSection && count < 3) {
    return messages[lang].aiFavoritesEarlyProgress
      .replace("{count}", String(count))
      .replace("{remaining}", String(3 - count));
  }
  if (topTenItems.length < operationalLimits.aiTopTenItems) {
    if (topTenItems.length >= 3) {
      const taste = inferTasteLabel(section, topTenItems.map((entry) => entry.title));
      const labelTitle = getTasteLabelTitle(messages, lang, section, taste.labelKey);
      const label = formatTasteWithStoredEmoji(section, taste, labelTitle);
      return messages[lang].aiFavoritesUnlockedProgress
        .replace("{count}", String(count))
        .replace("{goal}", String(goal))
        .replace("{label}", label);
    }
    return messages[lang].aiTopTenManageInlineEntry;
  }

  let taste = getAiTasteFromUser(ctx.user, section);
  if (!taste.labelKey) {
    const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
    if (syncedTaste.ok) {
      taste = syncedTaste.taste;
    }
  }

  const labelTitle = getTasteLabelTitle(messages, lang, section, taste.labelKey);
  const label = formatTasteWithStoredEmoji(section, taste, labelTitle);
  return messages[lang].aiTopTenManageInlineEntryComplete.replace("{label}", label);
}

async function buildAiListManagerMessage({ ctx, lang, section, listType, prefix = "" }) {
  const listLabel = getSectionListLabel(messages, lang, section);
  const items = getAiListItemsFromUser(ctx.user, section, listType);
  const body = listType === "topTen"
    ? `${buildTopTenListMessage({ ctx, lang, section })}\n\n${await getTopTenManageEntryMessage(ctx, lang, section)}`
    : items.length
      ? buildWatchlistMessage({ ctx, lang, section })
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

function formatSuggestionResultMessage(lang, title, reason) {
  const cleanReason = reason || messages[lang].aiSuggestionFallbackTitle;
  return [
    messages[lang].aiSuggestionResultTitle.replace("{item}", title),
    messages[lang].aiSuggestionResultReason.replace("{reason}", cleanReason),
  ].join("\n\n");
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

function isWeakTasteLabel(section, taste) {
  return (
    !taste?.labelKey ||
    taste.labelKey === DEFAULT_TASTE_LABEL_BY_SECTION[section] ||
    Number(taste.confidence) < 0.55
  );
}

function formatTasteLabelWithEmoji(section, labelKey, labelTitle) {
  return `${getTasteLabelEmoji(section, labelKey)} ${labelTitle}`;
}

function formatAiComplimentFeedback(feedback) {
  return `👩‍🦳 ${feedback}`;
}

async function buildTopTenSavedMessage({
  ctx,
  lang,
  section,
  item,
  items,
  savedMessageKey = "aiTasteItemSaved",
}) {
  const count = items.length;
  const goal = operationalLimits.aiTopTenItems;
  const itemTitles = items.map((entry) => entry.title);
  const inferredTaste = inferTasteLabel(section, itemTitles);
  const rawLabelTitle = getTasteLabelTitle(messages, lang, section, inferredTaste.labelKey);
  const labelTitle = formatTasteLabelWithEmoji(section, inferredTaste.labelKey, rawLabelTitle);
  const feedbackResult = await getAiTasteItemFeedback({
    mode: section,
    lang,
    item,
    labelKey: inferredTaste.labelKey,
    labelTitle: rawLabelTitle,
  });
  const feedback = feedbackResult.ok
    && feedbackResult.text
    && !feedbackResult.fallback
    && feedbackResult.matchType !== "unknown_input"
    && !isSavedOnlyTasteFeedback(feedbackResult.text, lang)
    ? feedbackResult.text
    : "";

  const savedText = messages[lang][savedMessageKey]
    .replace("{item}", item)
    .replace("{count}", String(count))
    .replace("{goal}", String(goal));

  const responseParts = [savedText];

  if (feedback) {
    responseParts.push(formatAiComplimentFeedback(feedback));
  }

  if (count >= 3 && count < goal) {
    const preliminaryText = isWeakTasteLabel(section, inferredTaste)
      ? messages[lang].aiTastePreliminaryWeak
      : messages[lang].aiTastePreliminaryLabel.replace("{label}", labelTitle);
    responseParts.push(
      preliminaryText
        .replace("{count}", String(count))
        .replace("{goal}", String(goal)),
    );
  }

  if (count < goal) {
    responseParts.push(getTopTenNextPrompt(lang, count));
    return responseParts.join(TASTE_RESPONSE_BLOCK_SEPARATOR);
  }

  const syncedTaste = await syncAiTasteForSection(ctx.userId, section);
  const resolvedTaste = syncedTaste.ok ? syncedTaste.taste : inferredTaste;
  const finalLabel = formatTasteWithStoredEmoji(
    section,
    resolvedTaste,
    getTasteLabelTitle(messages, lang, section, resolvedTaste.labelKey),
  );
  const styleHint = getTasteLabelStyleHint(messages, lang, section, resolvedTaste.labelKey);
  const sectionLabel = getSectionLabel(messages, lang, section);
  const unlockedText = (messages[lang].aiTasteLabelUnlockedDetailed || messages[lang].aiTasteLabelUnlocked)
    .replace("{section}", sectionLabel)
    .replace("{label}", finalLabel)
    .replace("{style}", styleHint)
    .replace("{count}", String(count))
    .replace("{goal}", String(goal));

  responseParts.push(unlockedText);
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
  buildShareListMessage,
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
