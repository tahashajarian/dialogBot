const User = require("../models/user");
const { normalizePublicProfileCode } = require("./public-codes");
const { EVENT_NAMES, trackEvent } = require("./analytics-events");

const SAVED_PROFILE_CAP = 50;

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function addSavedProfileCode(userId, profileCode) {
  const cleanCode = normalizePublicProfileCode(profileCode);
  if (!cleanCode) return { ok: false, reason: "empty_code" };

  const codePattern = new RegExp(`^${escapeRegExp(cleanCode)}$`, "i");
  const updated = await User.findOneAndUpdate(
    {
      userId,
      savedProfileCodes: { $not: codePattern },
      $expr: {
        $lt: [
          { $size: { $ifNull: ["$savedProfileCodes", []] } },
          SAVED_PROFILE_CAP,
        ],
      },
    },
    { $push: { savedProfileCodes: cleanCode } },
    { returnDocument: "after" },
  ).lean();

  if (updated) {
    void trackEvent({
      name: EVENT_NAMES.profileSaved,
      userId,
      metadata: {
        count: (updated.savedProfileCodes || []).length,
      },
    });
    return { ok: true, items: updated.savedProfileCodes || [] };
  }

  const user = await User.findOne({ userId }).select("savedProfileCodes").lean();
  if (!user) return { ok: false, reason: "missing_user" };
  const current = Array.isArray(user.savedProfileCodes) ? user.savedProfileCodes : [];
  if (current.some((entry) => codePattern.test(String(entry)))) {
    return { ok: false, reason: "exists", items: current };
  }
  return { ok: false, reason: "saved_profiles_limit", cap: SAVED_PROFILE_CAP };
}

async function removeSavedProfileCode(userId, profileCode) {
  const cleanCode = normalizePublicProfileCode(profileCode);
  if (!cleanCode) return { ok: false, reason: "empty_code" };

  const codePattern = new RegExp(`^${escapeRegExp(cleanCode)}$`, "i");
  const updated = await User.findOneAndUpdate(
    { userId, savedProfileCodes: codePattern },
    { $pull: { savedProfileCodes: codePattern } },
    { returnDocument: "after" },
  ).lean();

  if (updated) return { ok: true, items: updated.savedProfileCodes || [] };

  const user = await User.findOne({ userId }).select("savedProfileCodes").lean();
  if (!user) return { ok: false, reason: "missing_user" };
  const current = Array.isArray(user.savedProfileCodes) ? user.savedProfileCodes : [];
  return { ok: false, reason: "not_found", items: current };
}

module.exports = {
  SAVED_PROFILE_CAP,
  addSavedProfileCode,
  removeSavedProfileCode,
};
