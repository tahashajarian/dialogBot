const messages = require("../messages");
const {
  AI_TOP_TEN_LIMIT,
} = require("../constants/ai");
const {
  DEFAULT_TASTE_LABEL_BY_SECTION,
  getAiListItemsFromUser,
  getAiTasteFromUser,
  inferTasteLabel,
  syncAiTasteForSection,
} = require("./users");

const TASTE_RESPONSE_BLOCK_SEPARATOR = "\n\n\n";
const { getAiTasteItemFeedback } = require("./ai");
const {
  getSectionLabel,
  getSectionListLabel,
  getTasteLabelEmoji,
  getTasteLabelStyleHint,
  getTasteLabelTitle,
} = require("./ai-section");

function toTitleSet(items = []) {
  return new Set(items.map((entry) => String(entry?.title || entry || "").trim().toLowerCase()).filter(Boolean));
}

function formatAiItemsList(title, items, emptyText, options = {}) {
  if (!items.length) {
    return emptyText;
  }

  const topTenTitleSet = options.topTenTitleSet || new Set();
  const includeWatched = Boolean(options.includeWatched);
  const lines = items.map((entry, index) => {
    const watchedBadge = includeWatched ? `${entry?.watched ? "✅" : "⬜"} ` : "";
    const topTenBadge = topTenTitleSet.has(String(entry?.title || "").trim().toLowerCase()) ? " 🏆" : "";
    const commentPart = entry?.comment ? ` — ${entry.comment}` : "";
    return `${index + 1}. ${watchedBadge}${entry.title}${topTenBadge}${commentPart}`;
  });
  return `${title}\n\n${lines.join("\n")}`;
}

function withAiSectionTitle(lang, section, body) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const heading = messages[lang].aiSectionPinnedTitle.replace("{section}", sectionLabel);
  return `${heading}\n\n${body}`;
}

function buildTopTenListMessage({ ctx, lang, section }) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const topTenEntries = getAiListItemsFromUser(ctx.user, section, "topTen");
  const title = messages[lang].aiTopTenTitle.replace("{section}", sectionLabel);
  const emptyText = messages[lang].aiTopTenEmpty.replace("{section}", sectionLabel);
  return withAiSectionTitle(lang, section, formatAiItemsList(title, topTenEntries, emptyText));
}

function buildWatchlistMessage({ ctx, lang, section, includeWatched = false }) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const listLabel = getSectionListLabel(messages, lang, section);
  const entries = getAiListItemsFromUser(ctx.user, section, "watchlist");
  const topTenTitleSet = toTitleSet(getAiListItemsFromUser(ctx.user, section, "topTen"));
  const title = messages[lang].aiWatchlistTitle
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);
  const emptyText = messages[lang].aiWatchlistEmpty
    .replace("{section}", sectionLabel)
    .replace("{listName}", listLabel);
  return withAiSectionTitle(
    lang,
    section,
    formatAiItemsList(title, entries, emptyText, { topTenTitleSet, includeWatched }),
  );
}

function formatTasteWithStoredEmoji(section, taste, labelTitle) {
  return `${taste?.emoji || getTasteLabelEmoji(section, taste?.labelKey)} ${labelTitle}`;
}

function buildTopTenInsightMessage(lang, section, items) {
  const sectionLabel = getSectionLabel(messages, lang, section);
  const goal = AI_TOP_TEN_LIMIT;
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
  if (topTenItems.length < AI_TOP_TEN_LIMIT) {
    const peopleHint = topTenItems.length <= 3 ? `\n\n${messages[lang].aiTopTenManagePeopleHint}` : "";
    if (topTenItems.length >= 3) {
      const taste = inferTasteLabel(section, topTenItems.map((entry) => entry.title));
      const labelTitle = getTasteLabelTitle(messages, lang, section, taste.labelKey);
      const label = formatTasteWithStoredEmoji(section, taste, labelTitle);
      return `${messages[lang].aiTopTenManageInlineEntryWithLabel.replace("{label}", label)}${peopleHint}`;
    }
    return `${messages[lang].aiTopTenManageInlineEntry}${peopleHint}`;
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

function formatSuggestionLimitMessage(lang, resetAt) {
  const resetTime = resetAt ? new Date(resetAt).getTime() : Date.now();
  const minutes = Math.max(1, Math.ceil((resetTime - Date.now()) / (60 * 1000)));
  return messages[lang].aiSuggestionHourlyLimit.replace("{minutes}", String(minutes));
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
      .replace("{goal}", String(AI_TOP_TEN_LIMIT));
  }

  return messages[lang].aiTasteDuplicateMatch
    .replace("{item}", duplicateTitle)
    .replace("{count}", String(count))
    .replace("{goal}", String(AI_TOP_TEN_LIMIT));
}

function getTopTenNextPrompt(lang, count) {
  const key = `aiTasteAskNext_${count}`;
  return messages[lang][key] || messages[lang].aiTasteAskNext;
}

function isWeakTasteLabel(section, taste) {
  return (
    !taste?.labelKey ||
    taste.labelKey === DEFAULT_TASTE_LABEL_BY_SECTION[section] ||
    Number(taste.confidence) < 0.55
  );
}

function buildTasteItemFeedbackFallback(lang, item, labelTitle) {
  return messages[lang].aiTasteItemFeedbackFallback
    .replace("{item}", item)
    .replace("{label}", labelTitle || messages[lang].aiTasteLabelTitleFallback);
}

function formatTasteLabelWithEmoji(section, labelKey, labelTitle) {
  return `${getTasteLabelEmoji(section, labelKey)} ${labelTitle}`;
}

function formatAiComplimentFeedback(feedback) {
  return `🤖 ${feedback}`;
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
  const goal = AI_TOP_TEN_LIMIT;
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
  const feedback = feedbackResult.ok && feedbackResult.text
    ? feedbackResult.text
    : buildTasteItemFeedbackFallback(lang, item, labelTitle);

  const savedText = messages[lang][savedMessageKey]
    .replace("{item}", item)
    .replace("{count}", String(count))
    .replace("{goal}", String(goal));

  const responseParts = [formatAiComplimentFeedback(feedback)];

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

  responseParts.push(savedText);

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
  buildTopTenInsightMessage,
  buildTopTenListMessage,
  buildTopTenSavedMessage,
  buildWatchlistMessage,
  formatAiItemsList,
  formatSuggestionLimitMessage,
  formatSuggestionResultMessage,
  getDuplicateItemTitle,
  getDuplicateListMessage,
  getDuplicateTopTenMessage,
  getNeedTopTenMessage,
  getTopTenManageEntryMessage,
  toTitleSet,
  withAiSectionTitle,
};
