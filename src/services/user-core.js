const User = require("../models/user");
const { sanitizeProfileNameCandidate } = require("./profile");

const PROFILE_NAME_MAX_LENGTH = 30;
const RECENT_JOINED_DISCUSSION_LIMIT = 3;

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function normalizePlatformUserSource(from = {}) {
  const rawId = firstPresent(from.id, from.user_id, from.userId);
  const userId = Number(rawId);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  return {
    id: userId,
    username: firstPresent(from.username, from.user_name, from.userName) || "",
    firstName: firstPresent(from.first_name, from.firstName, from.name, from.full_name, from.fullName) || "",
    languageCode: firstPresent(from.language_code, from.languageCode, from.lang) || "",
  };
}

async function getOrCreateUser(from) {
  const source = normalizePlatformUserSource(from);
  if (!source) return null;
  const safeFirstName = sanitizeProfileNameCandidate(source.firstName, PROFILE_NAME_MAX_LENGTH);
  const setFields = { username: source.username };
  if (safeFirstName) setFields.firstName = safeFirstName;

  return User.findOneAndUpdate(
    { userId: source.id },
    {
      $set: setFields,
      $setOnInsert: {
        userId: source.id,
        profileName: "",
        profileNameConfirmedAt: null,
        age: null,
        lang: "fa",
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      maxTimeMS: 2500,
    },
  );
}

async function updateLanguage(userId, newLang) {
  return await User.findOneAndUpdate(
    { userId },
    { lang: newLang },
    { returnDocument: "after" },
  );
}

async function updateProfileField(userId, field, value) {
  return await User.findOneAndUpdate(
    { userId },
    { [field]: value },
    { returnDocument: "after" },
  );
}

async function recordRecentJoinedDiscussion(userId, discussionId) {
  if (!discussionId) return null;
  return await User.findOneAndUpdate(
    { userId },
    [{
      $set: {
        recentJoinedDiscussionIds: {
          $slice: [
            {
              $concatArrays: [
                [discussionId],
                {
                  $filter: {
                    input: { $ifNull: ["$recentJoinedDiscussionIds", []] },
                    as: "recentDiscussionId",
                    cond: { $ne: ["$$recentDiscussionId", discussionId] },
                  },
                },
              ],
            },
            RECENT_JOINED_DISCUSSION_LIMIT,
          ],
        },
      },
    }],
    { returnDocument: "after", updatePipeline: true },
  );
}

async function updateLocationCityForSharedAt(userId, sharedAt, city, attemptedAt = new Date()) {
  return await User.findOneAndUpdate(
    { userId, "location.sharedAt": sharedAt },
    {
      $set: {
        "location.city": city,
        "location.cityLookupAttemptedAt": attemptedAt,
      },
    },
    { returnDocument: "after" },
  );
}

async function updateUserFields(userId, fields = {}) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return await User.findOne({ userId });

  return await User.findOneAndUpdate(
    { userId },
    { $set: Object.fromEntries(entries) },
    { returnDocument: "after" },
  );
}

async function updateUserState(userId, state) {
  return await User.findOneAndUpdate(
    { userId },
    { state },
    { returnDocument: "after" },
  );
}

async function resetDiscussionDraft(userId) {
  return await updateUserFields(userId, {
    discussionDraftTitle: "",
    discussionDraftDescription: "",
    discussionDraftJoinRule: null,
    discussionDraftMaxMembers: 20,
    navigationMode: "discussions",
    discussionDraftLanguage: "",
    discussionDraftPaidOwnedSlotTransactionId: null,
    discussionDraftPaidOwnedSlotAuthorized: false,
    discussionDraftPaidOwnedSlotCap: 0,
    discussionDraftPaidOwnedSlotCost: 0,
  });
}

module.exports = {
  getOrCreateUser,
  normalizePlatformUserSource,
  recordRecentJoinedDiscussion,
  resetDiscussionDraft,
  updateLanguage,
  updateLocationCityForSharedAt,
  updateProfileField,
  updateUserFields,
  updateUserState,
};
