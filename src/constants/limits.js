const USER_LIMITS = {
  free: {
    discussionInvitationsPer24h: 3,
  },
};
const DISCUSSION_OWNED_HARD_LIMIT = 10;
const { operationalLimits } = require("../services/operational-limits");

function getUserTier() {
  return "free";
}

function getUserLimits(user = {}) {
  const tier = getUserTier(user);
  return {
    ...(USER_LIMITS[tier] || USER_LIMITS.free),
    discussionInvitationsPer24h: operationalLimits.directInvitationsPerWindow,
    discussionInvitationWindowHours: operationalLimits.directInvitationWindowHours,
  };
}

module.exports = {
  DISCUSSION_OWNED_HARD_LIMIT,
  USER_LIMITS,
  getUserLimits,
};
