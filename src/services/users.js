const User = require("../models/user");
const { operationalLimits } = require("./operational-limits");
const { awardListMilestones } = require("./star-milestones");
const { qualifyReferralForUser } = require("./star-referrals");
const { starEconomy } = require("./star-settings");
const { getAiListDuplicateMatch } = require("./ai-list-duplicates");
const { getTasteLabelEmoji } = require("./ai-section");
const { isLowQualityAiListItem } = require("./ai-input-quality");
const { canonicalizeInterestChipTitle } = require("./interest-chips");
const { isCommandLikeText } = require("./command-like-text");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");
const { syncUserTasteIndex } = require("./user-taste-index");
const {
  SECTION_TIP_KEYS,
  hasSectionTipBeenShown,
  markSectionTipShown,
  markSectionTipShownForContext,
} = require("./user-section-tips");
const {
  getOrCreateUser,
  normalizePlatformUserSource,
  recordRecentJoinedDiscussion,
  removeUserLocation,
  resetDiscussionDraft,
  updateLanguage,
  updateLocationCityForSharedAt,
  updateProfileField,
  updateUserFields,
  updateUserState,
} = require("./user-core");
const {
  TASTE_CLASSIFIER_VERSION,
  buildRankedTasteShortlist,
  buildTasteInputFingerprint,
  classifyMediaTaste,
  isAllowedTasteLabel,
  isMediaTasteSection,
} = require("./taste-label-classifier");

function normalizeAiListItem(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeAiListComment(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeAiListMetadata(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeAiListCommentSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return source === "ai" || source === "user" ? source : "";
}

function normalizeAiListItems(items = []) {
  const unique = new Set();
  const normalized = [];

  for (const item of items) {
    const titleSource = typeof item === "string" ? item : item?.title;
    const metadataSource = typeof item === "string" ? "" : item?.metadata;
    const commentValue = typeof item === "string" ? "" : item?.comment;
    const commentSource = typeof item === "string" ? "" : normalizeAiListCommentSource(item?.commentSource);
    const watchedSource = typeof item === "string" ? false : Boolean(item?.watched);
    const suggestionFeedback = typeof item === "string" || item?.suggestionFeedback !== "liked"
      ? ""
      : "liked";
    const title = normalizeAiListItem(titleSource);
    const metadata = normalizeAiListMetadata(metadataSource);
    const comment = normalizeAiListComment(commentValue);
    if (!title) continue;
    const key = title.toLowerCase();
    if (unique.has(key)) continue;
    unique.add(key);
    const normalizedItem = { title, metadata, comment, watched: watchedSource };
    if (commentSource) normalizedItem.commentSource = commentSource;
    if (suggestionFeedback) normalizedItem.suggestionFeedback = suggestionFeedback;
    normalized.push(normalizedItem);
  }

  return normalized;
}

const AI_SECTIONS = ["movies", "series", "music", "books", "random"];
const AI_SUGGESTION_QUOTA_LIMIT = 10;
const AI_SUGGESTION_QUOTA_WINDOW_MS = 60 * 60 * 1000;
const LEGACY_FIELDS = {
  movies: { watchlist: "aiWatchlistMovies", topTen: "aiTopTenMovies" },
  series: { watchlist: "aiWatchlistSeries", topTen: "aiTopTenSeries" },
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
      return normalizeKnownInterestChipItems(structuredItems, section, listType);
    }
  }

  return normalizeKnownInterestChipItems(legacyItems, section, listType);
}

function normalizeKnownInterestChipItems(items, section, listType) {
  if (section !== "random" || listType !== "topTen") {
    return items;
  }
  return items.map((entry) => ({
    ...entry,
    title: canonicalizeInterestChipTitle(entry.title),
  }));
}

function getAiListTitlesFromUser(user, section, listType) {
  return getAiListItemsFromUser(user, section, listType).map((entry) => entry.title);
}

function getAiRecentSuggestionTitlesFromUser(user, section) {
  return (user?.aiRecentSuggestions?.[section] || [])
    .map((entry) => normalizeAiListItem(entry))
    .filter(Boolean);
}

function getAiRecentSuggestionCreatorsFromUser(user, section) {
  return (user?.aiRecentSuggestionCreators?.[section] || [])
    .map((entry) => normalizeAiListItem(entry))
    .filter(Boolean);
}

function getAiRejectedSuggestionTitlesFromUser(user, section) {
  return (user?.aiRejectedSuggestions?.[section] || [])
    .map((entry) => normalizeAiListItem(entry))
    .filter(Boolean);
}

function getAiLikedSuggestionTitlesFromUser(user, section) {
  return getAiListItemsFromUser(user, section, "watchlist")
    .filter((entry) => entry?.suggestionFeedback === "liked")
    .map((entry) => entry.title);
}

async function addAiRecentSuggestion(
  userId,
  section,
  title,
  maxItems = 20,
  { creator = "", maxCreatorItems = 5 } = {},
) {
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
  const cleanCreator = normalizeAiListItem(creator);
  let updatedCreators = getAiRecentSuggestionCreatorsFromUser(user, section);
  if (cleanCreator && ["movies", "series", "music", "books"].includes(section)) {
    updatedCreators = [
      ...updatedCreators.filter((entry) => entry.toLowerCase() !== cleanCreator.toLowerCase()),
      cleanCreator,
    ].slice(-maxCreatorItems);
  }
  await updateUserFields(userId, {
    [`aiRecentSuggestions.${section}`]: updated,
    ...(cleanCreator && ["movies", "series", "music", "books"].includes(section)
      ? { [`aiRecentSuggestionCreators.${section}`]: updatedCreators }
      : {}),
  });
  void trackEvent({
    name: EVENT_NAMES.suggestionSaved,
    userId,
    section,
    metadata: {
      count: updated.length,
      goal: maxItems,
    },
  });
  return { ok: true, items: updated, creators: updatedCreators };
}

async function addAiRejectedSuggestion(
  userId,
  section,
  title,
  maxItems = 20,
  { aliases = [] } = {},
) {
  const rejectedTitles = [title, ...aliases]
    .map((entry) => normalizeAiListItem(entry))
    .filter(Boolean);
  if (!rejectedTitles.length) {
    return { ok: false, reason: "empty" };
  }

  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const current = getAiRejectedSuggestionTitlesFromUser(user, section);
  const merged = [...current];
  for (const rejectedTitle of rejectedTitles) {
    const key = rejectedTitle.toLowerCase();
    const duplicateIndex = merged.findIndex((entry) => entry.toLowerCase() === key);
    if (duplicateIndex >= 0) merged.splice(duplicateIndex, 1);
    merged.push(rejectedTitle);
  }
  const updated = merged.slice(-maxItems);
  await updateProfileField(userId, `aiRejectedSuggestions.${section}`, updated);
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
  limit = operationalLimits.aiSuggestionsPerWindow,
  windowMs = operationalLimits.aiSuggestionWindowMinutes * 60 * 1000,
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
  void trackEvent({
    name: EVENT_NAMES.suggestionRequested,
    userId,
    section,
    metadata: {
      count: updatedUsage.length,
      goal: limit,
    },
  });
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
  const suggestedLabelKeys = Array.isArray(sectionTaste?.suggestedLabelKeys)
    ? sectionTaste.suggestedLabelKeys.map((key) => String(key || "").trim()).filter(Boolean)
    : [];
  const suggestionInsight = String(sectionTaste?.suggestionInsight || "").trim().slice(0, 120);
  const emoji = String(sectionTaste?.emoji || "").trim() || (labelKey ? getTasteLabelEmoji(section, labelKey) : "");
  const sampleCount = Number(sectionTaste?.sampleCount) || 0;
  const confidence = Number(sectionTaste?.confidence) || 0;
  return {
    labelKey,
    suggestedLabelKeys,
    suggestionInsight,
    emoji,
    sampleCount,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    source: String(sectionTaste?.source || "").trim(),
    classifierVersion: Number(sectionTaste?.classifierVersion) || 0,
    inputFingerprint: String(sectionTaste?.inputFingerprint || "").trim(),
    classificationStatus: String(sectionTaste?.classificationStatus || "").trim(),
    freeClassificationAutoAttemptedAt: sectionTaste?.freeClassificationAutoAttemptedAt || null,
    freeClassificationUsedAt: sectionTaste?.freeClassificationUsedAt || null,
  };
}

function getTasteProgressStatus(section, currentCount) {
  const goal = 10;
  const count = Math.max(0, Math.min(goal, Number(currentCount) || 0));
  const remaining = Math.max(0, goal - count);
  const completed = count >= goal;
  const labelReady = isMediaTasteSection(section) && completed;
  return {
    section,
    count,
    goal,
    remaining,
    completed,
    labelReady,
  };
}

async function markAiTasteAutomaticCheckAttempted(userId, section) {
  if (!isMediaTasteSection(section)) return { ok: false, reason: "invalid_section" };
  const attemptedAt = new Date();
  const updated = await User.findOneAndUpdate(
    {
      userId: Number(userId),
      [`aiTaste.${section}.freeClassificationAutoAttemptedAt`]: null,
      [`aiTaste.${section}.freeClassificationUsedAt`]: null,
    },
    { $set: { [`aiTaste.${section}.freeClassificationAutoAttemptedAt`]: attemptedAt } },
    { returnDocument: "after" },
  );
  return updated ? { ok: true, attemptedAt } : { ok: false, reason: "already_attempted" };
}

async function syncAiTasteForSection(userId, section, {
  retryFailed = false,
  allowClassification = false,
} = {}) {
  const user = await User.findOne({ userId });
  if (!user) {
    return { ok: false, reason: "missing_user" };
  }

  const topTenTitles = getAiTasteTopTenFromUser(user, section);
  const progress = getTasteProgressStatus(section, topTenTitles.length);
  const existingTaste = getAiTasteFromUser(user, section);

  if (!isMediaTasteSection(section)) {
    return {
      ok: true,
      taste: { labelKey: "", emoji: "", confidence: 0, sampleCount: progress.count },
      progress,
    };
  }

  if (
    isMediaTasteSection(section) &&
    ["confirmed", "confirmed_review"].includes(existingTaste.classificationStatus) &&
    existingTaste.labelKey
  ) {
    const currentItems = getAiListItemsFromUser(user, section, "topTen");
    const currentFingerprint = buildTasteInputFingerprint(section, currentItems);
    if (
      existingTaste.classificationStatus === "confirmed_review" &&
      existingTaste.inputFingerprint !== currentFingerprint
    ) {
      const updatedAt = new Date();
      await User.findOneAndUpdate(
        { userId },
        { $set: {
          [`aiTaste.${section}.suggestedLabelKeys`]: [],
          [`aiTaste.${section}.suggestionInsight`]: "",
          [`aiTaste.${section}.sampleCount`]: progress.count,
          [`aiTaste.${section}.inputFingerprint`]: currentFingerprint,
          [`aiTaste.${section}.classificationStatus`]: "confirmed",
          [`aiTaste.${section}.updatedAt`]: updatedAt,
        } },
        { returnDocument: "after" },
      );
      return {
        ok: true,
        taste: {
          ...existingTaste,
          suggestedLabelKeys: [],
          suggestionInsight: "",
          sampleCount: progress.count,
          inputFingerprint: currentFingerprint,
          classificationStatus: "confirmed",
          updatedAt,
        },
        progress,
      };
    }
    if (existingTaste.sampleCount !== progress.count) {
      await User.findOneAndUpdate(
        { userId },
        { $set: {
          [`aiTaste.${section}.sampleCount`]: progress.count,
          [`aiTaste.${section}.updatedAt`]: new Date(),
        } },
        { returnDocument: "after" },
      );
    }
    return {
      ok: true,
      taste: { ...existingTaste, sampleCount: progress.count },
      progress,
    };
  }

  const keepSavedTasteWhileIncomplete = (
    existingTaste.freeClassificationUsedAt &&
    ["suggested", "skipped"].includes(existingTaste.classificationStatus) &&
    existingTaste.suggestedLabelKeys.length
  ) || (
    existingTaste.freeClassificationAutoAttemptedAt &&
    !existingTaste.freeClassificationUsedAt &&
    existingTaste.classificationStatus === "needs_choice"
  );
  if (!progress.labelReady && keepSavedTasteWhileIncomplete) {
    if (existingTaste.sampleCount !== progress.count) {
      await User.findOneAndUpdate(
        { userId },
        { $set: {
          [`aiTaste.${section}.sampleCount`]: progress.count,
          [`aiTaste.${section}.updatedAt`]: new Date(),
        } },
        { returnDocument: "after" },
      );
    }
    return {
      ok: true,
      taste: { ...existingTaste, sampleCount: progress.count },
      progress,
    };
  }

  if (!progress.labelReady) {
    const updates = {
      [`aiTaste.${section}.labelKey`]: "",
      [`aiTaste.${section}.sampleCount`]: progress.count,
      [`aiTaste.${section}.updatedAt`]: new Date(),
      [`aiTaste.${section}.suggestedLabelKeys`]: [],
      [`aiTaste.${section}.suggestionInsight`]: "",
      [`aiTaste.${section}.emoji`]: "",
      [`aiTaste.${section}.confidence`]: 0,
      [`aiTaste.${section}.source`]: "",
      [`aiTaste.${section}.inputFingerprint`]: "",
      [`aiTaste.${section}.classificationStatus`]: "",
      [`aiTaste.${section}.confirmedAt`]: null,
    };
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

  if (isMediaTasteSection(section)) {
    const topTenItems = getAiListItemsFromUser(user, section, "topTen");
    const inputFingerprint = buildTasteInputFingerprint(section, topTenItems);
    const cacheIsCurrent = (
      existingTaste.inputFingerprint === inputFingerprint &&
      existingTaste.classifierVersion === TASTE_CLASSIFIER_VERSION &&
      ["confirmed", "suggested", "needs_choice", "skipped"].includes(existingTaste.classificationStatus) &&
      !(retryFailed && existingTaste.classificationStatus === "needs_choice")
    );
    if (cacheIsCurrent) {
      return {
        ok: true,
        taste: existingTaste,
        progress,
        needsConfirmation: existingTaste.classificationStatus === "suggested",
        needsManualSelection: existingTaste.classificationStatus === "needs_choice",
      };
    }

    if (existingTaste.freeClassificationUsedAt) {
      return {
        ok: true,
        taste: existingTaste,
        progress,
        needsConfirmation: existingTaste.classificationStatus === "suggested",
        classificationReason: "saved_result",
      };
    }

    if (!allowClassification) {
      return {
        ok: true,
        taste: existingTaste,
        progress,
        needsManualSelection: existingTaste.classificationStatus === "needs_choice",
        classificationReason: "manual_check_required",
      };
    }

    const classification = await classifyMediaTaste(section, topTenItems, {
      language: user.lang === "fa" ? "fa" : "en",
      userId: user.userId,
    });
    const hasReliableSuggestion = classification.ok;
    const suggestedLabelKeys = hasReliableSuggestion
      ? buildRankedTasteShortlist(section, classification.labelKeys)
      : [];
    const suggestionInsight = hasReliableSuggestion ? String(classification.insight || "").trim().slice(0, 120) : "";
    const confidence = 0;
    const classificationStatus = hasReliableSuggestion ? "suggested" : "needs_choice";
    const freeClassificationUsedAt = hasReliableSuggestion ? new Date() : null;
    const updates = {
      [`aiTaste.${section}.labelKey`]: "",
      [`aiTaste.${section}.suggestedLabelKeys`]: suggestedLabelKeys,
      [`aiTaste.${section}.suggestionInsight`]: suggestionInsight,
      [`aiTaste.${section}.emoji`]: "",
      [`aiTaste.${section}.confidence`]: confidence,
      [`aiTaste.${section}.sampleCount`]: progress.count,
      [`aiTaste.${section}.source`]: hasReliableSuggestion ? "ai" : "",
      [`aiTaste.${section}.classifierVersion`]: TASTE_CLASSIFIER_VERSION,
      [`aiTaste.${section}.inputFingerprint`]: inputFingerprint,
      [`aiTaste.${section}.classificationStatus`]: classificationStatus,
      ...(freeClassificationUsedAt
        ? { [`aiTaste.${section}.freeClassificationUsedAt`]: freeClassificationUsedAt }
        : {}),
      [`aiTaste.${section}.confirmedAt`]: null,
      [`aiTaste.${section}.updatedAt`]: new Date(),
    };
    await User.findOneAndUpdate({ userId }, { $set: updates }, { returnDocument: "after" });
    const taste = {
      labelKey: "",
      suggestedLabelKeys,
      suggestionInsight,
      emoji: updates[`aiTaste.${section}.emoji`],
      confidence,
      sampleCount: progress.count,
      source: updates[`aiTaste.${section}.source`],
      classifierVersion: TASTE_CLASSIFIER_VERSION,
      inputFingerprint,
      classificationStatus,
      freeClassificationAutoAttemptedAt: existingTaste.freeClassificationAutoAttemptedAt,
      freeClassificationUsedAt: freeClassificationUsedAt || existingTaste.freeClassificationUsedAt,
    };
    return {
      ok: true,
      taste,
      progress,
      needsConfirmation: hasReliableSuggestion,
      needsManualSelection: !hasReliableSuggestion,
      classificationReason: hasReliableSuggestion ? "" : (classification.reason || "low_certainty"),
    };
  }

}

async function confirmAiTasteLabel(userId, section, labelKey) {
  if (!isMediaTasteSection(section) || !isAllowedTasteLabel(section, labelKey)) {
    return { ok: false, reason: "invalid_label" };
  }
  const user = await User.findOne({ userId });
  if (!user) return { ok: false, reason: "missing_user" };
  const items = getAiListItemsFromUser(user, section, "topTen");
  const progress = getTasteProgressStatus(section, items.length);
  const currentTaste = getAiTasteFromUser(user, section);
  const hasEarnedLabel = ["confirmed", "confirmed_review"].includes(currentTaste.classificationStatus) && currentTaste.labelKey;
  const hasSavedChoice = currentTaste.freeClassificationUsedAt &&
    ["suggested", "skipped"].includes(currentTaste.classificationStatus) &&
    currentTaste.suggestedLabelKeys.length;
  if (!progress.labelReady && !hasEarnedLabel && !hasSavedChoice) return { ok: false, reason: "incomplete_list" };
  const inputFingerprint = buildTasteInputFingerprint(section, items);
  const canUseSavedShortlist = ["confirmed", "skipped"].includes(currentTaste.classificationStatus) ||
    (currentTaste.classificationStatus === "suggested" && currentTaste.freeClassificationUsedAt);
  if (
    !currentTaste.suggestedLabelKeys.includes(labelKey) ||
    !["suggested", "confirmed_review", "confirmed", "skipped"].includes(currentTaste.classificationStatus) ||
    (!canUseSavedShortlist && currentTaste.inputFingerprint !== inputFingerprint)
  ) {
    return { ok: false, reason: "stale_suggestion" };
  }
  if (
    currentTaste.classificationStatus === "confirmed" &&
    currentTaste.labelKey === labelKey &&
    currentTaste.inputFingerprint === inputFingerprint
  ) {
    return { ok: true, taste: currentTaste, progress };
  }
  const now = new Date();
  const taste = {
    labelKey,
    suggestedLabelKeys: currentTaste.suggestedLabelKeys,
    suggestionInsight: currentTaste.suggestionInsight,
    emoji: getTasteLabelEmoji(section, labelKey),
    confidence: 1,
    sampleCount: progress.count,
    source: "ai_confirmed",
    classifierVersion: TASTE_CLASSIFIER_VERSION,
    inputFingerprint,
    classificationStatus: "confirmed",
    freeClassificationAutoAttemptedAt: currentTaste.freeClassificationAutoAttemptedAt,
    freeClassificationUsedAt: currentTaste.freeClassificationUsedAt,
  };
  await User.findOneAndUpdate(
    { userId },
    { $set: {
      [`aiTaste.${section}.labelKey`]: taste.labelKey,
      [`aiTaste.${section}.suggestedLabelKeys`]: taste.suggestedLabelKeys,
      [`aiTaste.${section}.suggestionInsight`]: taste.suggestionInsight,
      [`aiTaste.${section}.emoji`]: taste.emoji,
      [`aiTaste.${section}.confidence`]: taste.confidence,
      [`aiTaste.${section}.sampleCount`]: taste.sampleCount,
      [`aiTaste.${section}.source`]: taste.source,
      [`aiTaste.${section}.classifierVersion`]: taste.classifierVersion,
      [`aiTaste.${section}.inputFingerprint`]: taste.inputFingerprint,
      [`aiTaste.${section}.classificationStatus`]: taste.classificationStatus,
      [`aiTaste.${section}.confirmedAt`]: now,
      [`aiTaste.${section}.updatedAt`]: now,
    } },
    { returnDocument: "after" },
  );
  void trackEvent({
    name: EVENT_NAMES.tasteLabelUnlocked,
    userId,
    section,
    metadata: { labelKey, count: progress.count, goal: progress.goal, source: taste.source },
  });
  return { ok: true, taste, progress };
}

async function skipAiTasteLabel(userId, section) {
  if (!isMediaTasteSection(section)) return { ok: false, reason: "invalid_section" };
  const user = await User.findOne({ userId });
  if (!user) return { ok: false, reason: "missing_user" };
  const items = getAiListItemsFromUser(user, section, "topTen");
  const progress = getTasteProgressStatus(section, items.length);
  const currentTaste = getAiTasteFromUser(user, section);
  const hasEarnedLabel = ["confirmed", "confirmed_review"].includes(currentTaste.classificationStatus) && currentTaste.labelKey;
  const hasSavedChoice = currentTaste.freeClassificationUsedAt &&
    ["suggested", "skipped"].includes(currentTaste.classificationStatus) &&
    currentTaste.suggestedLabelKeys.length;
  if (!progress.labelReady && !hasEarnedLabel && !hasSavedChoice) return { ok: false, reason: "incomplete_list" };
  if (!["suggested", "confirmed_review", "confirmed", "skipped"].includes(currentTaste.classificationStatus)) {
    return { ok: false, reason: "stale_suggestion" };
  }
  const inputFingerprint = buildTasteInputFingerprint(section, items);
  if (
    currentTaste.classificationStatus === "suggested" &&
    !currentTaste.freeClassificationUsedAt &&
    currentTaste.inputFingerprint !== inputFingerprint
  ) {
    return { ok: false, reason: "stale_suggestion" };
  }
  const suggestedLabelKeys = (
    currentTaste.classificationStatus === "confirmed_review" &&
    currentTaste.inputFingerprint !== inputFingerprint
  ) ? [] : currentTaste.suggestedLabelKeys;
  const suggestionInsight = suggestedLabelKeys.length ? currentTaste.suggestionInsight : "";
  const now = new Date();
  await User.findOneAndUpdate({ userId }, { $set: {
    [`aiTaste.${section}.labelKey`]: "",
    [`aiTaste.${section}.suggestedLabelKeys`]: suggestedLabelKeys,
    [`aiTaste.${section}.suggestionInsight`]: suggestionInsight,
    [`aiTaste.${section}.emoji`]: "",
    [`aiTaste.${section}.confidence`]: 0,
    [`aiTaste.${section}.sampleCount`]: progress.count,
    [`aiTaste.${section}.source`]: "user",
    [`aiTaste.${section}.classifierVersion`]: TASTE_CLASSIFIER_VERSION,
    [`aiTaste.${section}.inputFingerprint`]: inputFingerprint,
    [`aiTaste.${section}.classificationStatus`]: "skipped",
    [`aiTaste.${section}.confirmedAt`]: now,
    [`aiTaste.${section}.updatedAt`]: now,
  } }, { returnDocument: "after" });
  return { ok: true, progress, suggestedLabelKeys, suggestionInsight };
}

async function recalculateAiTasteForSection(userId, section) {
  if (!isMediaTasteSection(section)) return { ok: false, reason: "invalid_section" };
  const user = await User.findOne({ userId: Number(userId) });
  if (!user) return { ok: false, reason: "missing_user" };
  const items = getAiListItemsFromUser(user, section, "topTen");
  const progress = getTasteProgressStatus(section, items.length);
  if (items.length !== operationalLimits.aiTopTenItems) return { ok: false, reason: "incomplete_list" };
  const currentTaste = getAiTasteFromUser(user, section);
  const hadActiveLabel = Boolean(currentTaste.labelKey) && ["confirmed", "confirmed_review"].includes(currentTaste.classificationStatus);
  const hadNoLabel = !currentTaste.labelKey && currentTaste.classificationStatus === "skipped" && currentTaste.freeClassificationUsedAt;
  if (!hadActiveLabel && !hadNoLabel) {
    return { ok: false, reason: "missing_confirmed_label" };
  }
  const classification = await classifyMediaTaste(section, items, {
    language: user.lang === "fa" ? "fa" : "en",
    userId: user.userId,
  });
  if (!classification.ok) return classification;
  const suggestedLabelKeys = buildRankedTasteShortlist(section, classification.labelKeys);
  const suggestionInsight = String(classification.insight || "").trim().slice(0, 120);
  const inputFingerprint = buildTasteInputFingerprint(section, items);
  const isSameLabel = hadActiveLabel && suggestedLabelKeys[0] === currentTaste.labelKey;
  // A recheck only replaces the shortlist. Keep the user's current choice active
  // until they explicitly select one of the new suggestions.
  const nextStatus = hadActiveLabel ? "confirmed_review" : "skipped";
  const now = new Date();
  await User.findOneAndUpdate({ userId: Number(userId) }, { $set: {
    [`aiTaste.${section}.suggestedLabelKeys`]: suggestedLabelKeys,
    [`aiTaste.${section}.suggestionInsight`]: suggestionInsight,
    [`aiTaste.${section}.classifierVersion`]: TASTE_CLASSIFIER_VERSION,
    [`aiTaste.${section}.inputFingerprint`]: inputFingerprint,
    [`aiTaste.${section}.classificationStatus`]: nextStatus,
    [`aiTaste.${section}.updatedAt`]: now,
  } }, { returnDocument: "after" });
  return {
    ok: true,
    hadActiveLabel,
    sameLabel: isSameLabel,
    suggestedLabelKeys,
    suggestionInsight,
    taste: {
      ...currentTaste,
      suggestedLabelKeys,
      suggestionInsight,
      classifierVersion: TASTE_CLASSIFIER_VERSION,
      inputFingerprint,
      classificationStatus: nextStatus,
    },
    progress,
  };
}

async function addAiListItem(userId, section, listType, item, maxItems, { awardStars = true } = {}) {
  const itemLimit = maxItems ?? (
    listType === "topTen"
      ? operationalLimits.aiTopTenItems
      : operationalLimits.aiWatchlistItems
  );
  let title = normalizeAiListItem(item?.title || item);
  if (section === "random" && listType === "topTen") {
    title = canonicalizeInterestChipTitle(title);
  }
  const comment = normalizeAiListComment(item?.comment);
  const metadata = normalizeAiListMetadata(item?.metadata);
  const commentSource = normalizeAiListCommentSource(item?.commentSource);
  if (!title) {
    return { ok: false, reason: "empty" };
  }
  if (isCommandLikeText(title)) {
    return { ok: false, reason: "invalid_item_quality" };
  }
  if (listType === "topTen" && isLowQualityAiListItem(title)) {
    return { ok: false, reason: "invalid_item_quality" };
  }

  const watched = listType === "watchlist" ? Boolean(item?.watched) : false;
  const newItem = { title, metadata, comment, watched };
  if (comment && commentSource) newItem.commentSource = commentSource;
  if (listType === "watchlist" && item?.suggestionFeedback === "liked") {
    newItem.suggestionFeedback = "liked";
  }
  const listPath = `aiLists.${section}.${listType}`;
  let updated = null;

  // Compare the stored array when writing so concurrent additions cannot both
  // claim the final slot or overwrite one another. A retry re-runs duplicate
  // and capacity checks against the winning write.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const user = await User.findOne({ userId });
    if (!user) return { ok: false, reason: "missing_user" };

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
    if (current.length >= itemLimit) {
      return { ok: false, reason: "limit", items: current };
    }

    const candidate = [...current, newItem];
    const version = Number(user.__v) || 0;
    const saved = await User.findOneAndUpdate(
      { userId, __v: version },
      {
        $set: { [listPath]: candidate },
        $inc: { __v: 1 },
      },
      { returnDocument: "after" },
    );
    if (saved) {
      updated = candidate;
      break;
    }
  }
  if (!updated) return { ok: false, reason: "concurrent_update" };

  void syncUserTasteIndex(userId, { sections: [section] }).catch(() => null);
  const starMilestone = awardStars
    ? await awardListMilestones({
      userId,
      section,
      listType,
      count: updated.length,
    })
    : { rewards: [], progress: null };
  const externalReferralReward = (
    section === "random" &&
    listType === "topTen" &&
    updated.length >= starEconomy.firstTopTenMilestoneItems
  ) ? await qualifyReferralForUser(userId) : null;
  void trackEvent({
    name: listType === "topTen" ? EVENT_NAMES.topTenItemAdded : EVENT_NAMES.watchlistItemAdded,
    userId,
    section,
    metadata: {
      listType,
      count: updated.length,
      goal: maxItems,
    },
  });
  return {
    ok: true,
    items: updated,
    starRewards: starMilestone.rewards,
    starProgress: starMilestone.progress,
    externalReferralReward,
  };
}

async function removeAiListItem(userId, section, listType, item) {
  let cleanItem = normalizeAiListItem(item);
  if (section === "random" && listType === "topTen") {
    cleanItem = canonicalizeInterestChipTitle(cleanItem);
  }
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
  await syncUserTasteIndex(userId, { sections: [section] }).catch(() => null);
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
      commentSource: cleanComment ? "user" : "",
    };
  });

  if (!changed) {
    return { ok: false, reason: "not_found", items: current };
  }

  await updateProfileField(userId, `aiLists.${section}.${listType}`, updated);
  const itemUpdated = updated.find((entry) => entry.title.toLowerCase() === cleanItem.toLowerCase());
  return { ok: true, items: updated, item: itemUpdated };
}

async function promoteWatchlistItemToTopTen(
  userId,
  section,
  item,
  maxTopTenItems = operationalLimits.aiTopTenItems,
) {
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

  const movedItem = {
    ...watchlistItem,
    watched: false,
  };
  const nextTopTen = [...topTenItems, movedItem];
  const nextWatchlist = watchlistItems.filter(
    (entry) => entry.title.toLowerCase() !== cleanItem.toLowerCase(),
  );

  const moved = await User.findOneAndUpdate(
    { userId },
    {
      $set: {
        [`aiLists.${section}.topTen`]: nextTopTen,
        [`aiLists.${section}.watchlist`]: nextWatchlist,
      },
    },
    { returnDocument: "after" },
  );
  if (!moved) {
    return { ok: false, reason: "missing_user", watchlistItems, topTenItems };
  }
  await syncUserTasteIndex(userId, { sections: [section] }).catch(() => null);
  const starMilestone = await awardListMilestones({
    userId,
    section,
    listType: "topTen",
    count: nextTopTen.length,
  });
  const externalReferralReward = (
    section === "random" &&
    nextTopTen.length >= starEconomy.firstTopTenMilestoneItems
  ) ? await qualifyReferralForUser(userId) : null;

  return {
    ok: true,
    movedItem,
    watchlistItems: nextWatchlist,
    topTenItems: nextTopTen,
    starRewards: starMilestone.rewards,
    starProgress: starMilestone.progress,
    externalReferralReward,
  };
}

module.exports = {
  AI_SECTIONS,
  AI_SUGGESTION_QUOTA_LIMIT,
  AI_SUGGESTION_QUOTA_WINDOW_MS,
  SECTION_TIP_KEYS,
  getOrCreateUser,
  updateLanguage,
  updateProfileField,
  recordRecentJoinedDiscussion,
  removeUserLocation,
  updateLocationCityForSharedAt,
  updateUserFields,
  normalizePlatformUserSource,
  updateUserState,
  hasSectionTipBeenShown,
  markSectionTipShown,
  markSectionTipShownForContext,
  resetDiscussionDraft,
  addAiListItem,
  removeAiListItem,
  normalizeAiListItem,
  normalizeAiListComment,
  normalizeAiListItems,
  getAiListDuplicateMatch,
  getAiListItemsFromUser,
  getAiListTitlesFromUser,
  getAiRecentSuggestionTitlesFromUser,
  getAiRecentSuggestionCreatorsFromUser,
  getAiRejectedSuggestionTitlesFromUser,
  getAiLikedSuggestionTitlesFromUser,
  addAiRecentSuggestion,
  addAiRejectedSuggestion,
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
  getTasteProgressStatus,
  syncAiTasteForSection,
  markAiTasteAutomaticCheckAttempted,
  confirmAiTasteLabel,
  skipAiTasteLabel,
  recalculateAiTasteForSection,
};
