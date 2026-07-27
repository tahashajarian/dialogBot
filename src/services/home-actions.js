const messages = require("../messages");
const { callBacks } = require("../constants");

const DESTINATIONS = Object.freeze({
  discussion_invitations: { callbackData: callBacks.discussionInvitations, labelKey: "discussionInvitations" },
  discussions: { callbackData: callBacks.discussions, labelKey: "discussions" },
  favorites: { callbackData: callBacks.aiAssistant, labelKey: "aiAssistant" },
  people: { callbackData: callBacks.people, labelKey: "people" },
  profile: { callbackData: callBacks.profile, labelKey: "mainMenuMe" },
  guide: { callbackData: callBacks.help, labelKey: "help" },
});

function resolveHomeDestination(destination, lang = "fa") {
  const entry = DESTINATIONS[String(destination || "")];
  if (!entry) return null;
  return {
    destination: String(destination),
    text: messages[lang]?.[entry.labelKey] || messages.en[entry.labelKey],
    callback_data: entry.callbackData,
  };
}

module.exports = { DESTINATIONS, resolveHomeDestination };
