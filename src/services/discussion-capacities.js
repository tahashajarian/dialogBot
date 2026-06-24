const { starEconomy } = require("./star-settings");

const FREE_DISCUSSION_CAPACITIES = Object.freeze([3, 4, 5, 10, 15, 20]);

function canSpendStars(settings = starEconomy) {
  return Boolean(settings.economyEnabled && settings.spendingEnabled);
}

function getPaidDiscussionCapacity(capacity, settings = starEconomy) {
  const normalizedCapacity = Number(capacity) || 0;
  if (normalizedCapacity === 2) {
    return {
      capacity: 2,
      cost: Number(settings.paidTwoPersonDiscussionCost) || 0,
      kind: "two_person",
      available: Boolean(settings.paidTwoPersonDiscussionsEnabled && canSpendStars(settings)),
    };
  }

  const largeCapacity = Number(settings.paidLargeDiscussionCapacity) || 50;
  if (normalizedCapacity === largeCapacity) {
    return {
      capacity: largeCapacity,
      cost: Number(settings.paidLargeDiscussionCost) || 0,
      kind: "large",
      available: Boolean(settings.paidLargeDiscussionsEnabled && canSpendStars(settings)),
    };
  }
  if (normalizedCapacity > 20) {
    return {
      capacity: normalizedCapacity,
      cost: Number(settings.paidLargeDiscussionCost) || 0,
      kind: "large",
      available: false,
    };
  }

  return null;
}

function isPaidDiscussionCapacity(capacity, settings = starEconomy) {
  return Boolean(getPaidDiscussionCapacity(capacity, settings));
}

function getSelectableDiscussionCapacities(settings = starEconomy) {
  const capacities = [...FREE_DISCUSSION_CAPACITIES];
  if (settings.paidTwoPersonDiscussionsEnabled && canSpendStars(settings)) {
    capacities.push(2);
  }
  if (settings.paidLargeDiscussionsEnabled && canSpendStars(settings)) {
    capacities.push(Number(settings.paidLargeDiscussionCapacity) || 50);
  }
  return [...new Set(capacities)]
    .filter((capacity) => Number.isInteger(capacity) && capacity >= 2)
    .sort((a, b) => a - b);
}

function getConfiguredDiscussionCapacities(settings = starEconomy) {
  const capacities = [...FREE_DISCUSSION_CAPACITIES, 2, Number(settings.paidLargeDiscussionCapacity) || 50];
  return [...new Set(capacities)]
    .filter((capacity) => Number.isInteger(capacity) && capacity >= 2)
    .sort((a, b) => a - b);
}

function isAllowedDiscussionCapacity(capacity, settings = starEconomy) {
  const normalizedCapacity = Number(capacity) || 0;
  if (FREE_DISCUSSION_CAPACITIES.includes(normalizedCapacity)) return true;
  const paid = getPaidDiscussionCapacity(normalizedCapacity, settings);
  return Boolean(paid?.available);
}

function formatCapacityOptionLabel(capacity, lang, settings = starEconomy) {
  const paid = getPaidDiscussionCapacity(capacity, settings);
  const value = lang === "fa"
    ? String(capacity).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)])
    : String(capacity);
  return paid ? `${value} ⭐` : value;
}

module.exports = {
  FREE_DISCUSSION_CAPACITIES,
  canSpendStars,
  formatCapacityOptionLabel,
  getConfiguredDiscussionCapacities,
  getPaidDiscussionCapacity,
  getSelectableDiscussionCapacities,
  isAllowedDiscussionCapacity,
  isPaidDiscussionCapacity,
};
