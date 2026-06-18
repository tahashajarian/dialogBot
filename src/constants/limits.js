const USER_LIMITS = {
  free: {
    discussionInvitationsPer24h: 3,
  },
};

function getUserTier() {
  return "free";
}

function getUserLimits(user = {}) {
  const tier = getUserTier(user);
  return USER_LIMITS[tier] || USER_LIMITS.free;
}

module.exports = {
  USER_LIMITS,
  getUserLimits,
};
