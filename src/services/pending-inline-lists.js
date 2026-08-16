const { createHash } = require("crypto");
const PendingInlineList = require("../models/pending-inline-list");
const { addAiListItem, normalizeAiListItem } = require("./users");
const { operationalLimits } = require("./operational-limits");

const PENDING_INLINE_ITEM_LIMIT = 10;
const PENDING_INLINE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INLINE_LIST_SECTIONS = new Set(["movies", "series", "music", "books"]);

function normalizePendingSelection({ userId, section, title } = {}) {
  const normalizedUserId = Number(userId);
  const normalizedTitle = normalizeAiListItem(title);
  if (
    !Number.isInteger(normalizedUserId)
    || normalizedUserId <= 0
    || !INLINE_LIST_SECTIONS.has(section)
    || !normalizedTitle
  ) {
    return null;
  }
  return {
    userId: normalizedUserId,
    section,
    title: normalizedTitle,
    key: createHash("sha256")
      .update(`${section}\0${normalizedTitle.toLowerCase()}`)
      .digest("hex"),
  };
}

async function stagePendingInlineListItem(selection, {
  model = PendingInlineList,
  now = new Date(),
} = {}) {
  const normalized = normalizePendingSelection(selection);
  if (!normalized) return { ok: false, reason: "invalid_selection" };

  const expiresAt = new Date(now.getTime() + PENDING_INLINE_TTL_MS);
  const item = {
    section: normalized.section,
    title: normalized.title,
    key: normalized.key,
    createdAt: now,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const added = await model.updateOne(
      { userId: normalized.userId, "items.key": { $ne: normalized.key } },
      {
        $push: { items: { $each: [item], $slice: -PENDING_INLINE_ITEM_LIMIT } },
        $set: { expiresAt, updatedAt: now },
        $inc: { revision: 1 },
      },
    );
    if (Number(added.matchedCount) > 0) {
      return { ok: true, status: "staged" };
    }

    const duplicate = await model.updateOne(
      { userId: normalized.userId, "items.key": normalized.key },
      { $set: { expiresAt, updatedAt: now } },
    );
    if (Number(duplicate.matchedCount) > 0) {
      return { ok: true, status: "already_staged" };
    }

    try {
      await model.create({
        userId: normalized.userId,
        items: [item],
        revision: 1,
        expiresAt,
      });
      return { ok: true, status: "staged" };
    } catch (error) {
      if (error?.code !== 11000 || attempt === 1) throw error;
    }
  }
  return { ok: false, reason: "stage_failed" };
}

async function importPendingInlineListItems(userId, {
  model = PendingInlineList,
  addListItem = addAiListItem,
} = {}) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return { ok: false, reason: "invalid_user" };
  }
  if (model.db && model.db.readyState !== 1) {
    return { ok: false, reason: "database_unavailable" };
  }

  const pending = await model.findOne({ userId: normalizedUserId }).lean();
  if (!pending?.items?.length) return { ok: true, imported: 0 };

  let imported = 0;
  let skippedAtCapacity = 0;
  for (const item of pending.items) {
    const result = await addListItem(
      normalizedUserId,
      item.section,
      "watchlist",
      { title: item.title, comment: "" },
      operationalLimits.aiWatchlistItems,
    );
    if (!result.ok && result.reason === "limit") {
      skippedAtCapacity += 1;
      continue;
    }
    if (!result.ok && result.reason !== "exists") {
      return {
        ok: false,
        reason: result.reason || "import_failed",
        imported,
      };
    }
    imported += result.ok ? 1 : 0;
  }

  const removed = await model.deleteOne({
    _id: pending._id,
    revision: pending.revision,
  });
  return {
    ok: true,
    imported,
    skippedAtCapacity,
    pendingChanged: Number(removed.deletedCount) === 0,
  };
}

module.exports = {
  PENDING_INLINE_ITEM_LIMIT,
  PENDING_INLINE_TTL_MS,
  importPendingInlineListItems,
  normalizePendingSelection,
  stagePendingInlineListItem,
};
