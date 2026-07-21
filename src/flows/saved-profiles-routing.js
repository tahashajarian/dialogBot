const { callBacks } = require("../constants");
const { isPeopleCallback } = require("../services/people-discovery-ui");

const EXACT_SAVED_PROFILE_CALLBACKS = new Set([
  callBacks.savedProfiles,
  callBacks.profileUnsaveConfirm,
  callBacks.profileUnsaveCancel,
  callBacks.savedProfilesLimitClose,
  callBacks.profileDiscussionsClose,
  "saved:back",
]);

const SAVED_PROFILE_CALLBACK_PREFIXES = Object.freeze([
  callBacks.savedProfilesPage,
  callBacks.savedProfilesOpen,
  callBacks.savedProfilesDiscussions,
  callBacks.savedProfilesRemove,
  callBacks.profileDiscussionsBack,
]);

function isSavedProfilesCallback(data = "") {
  const value = String(data || "");
  return isPeopleCallback(value)
    || EXACT_SAVED_PROFILE_CALLBACKS.has(value)
    || SAVED_PROFILE_CALLBACK_PREFIXES.some((prefix) => value.startsWith(prefix));
}

module.exports = { isSavedProfilesCallback };
