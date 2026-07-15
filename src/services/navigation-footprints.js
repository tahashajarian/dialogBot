const messages = require("../messages");
const { getDiscussionDisplayTitle } = require("./discussion-ui");
const { updateProfileField } = require("./users");

const DESTINATION_KEYS = Object.freeze({
  menu: "navigationFootprintMainMenu",
  profile: "navigationFootprintProfile",
  taste: "navigationFootprintTaste",
  discussions: "navigationFootprintDiscussions",
  people: "navigationFootprintPeople",
  savedProfiles: "navigationFootprintSavedProfiles",
  settings: "navigationFootprintSettings",
  language: "navigationFootprintLanguage",
  help: "navigationFootprintHelp",
  peopleDiscovery: "navigationFootprintPeopleDiscovery",
  activeDiscussions: "navigationFootprintActiveDiscussions",
  myDiscussions: "navigationFootprintMyDiscussions",
});

function getMessageId(message) {
  return Number(message?.message_id || message?.messageId) || null;
}

function canPersistNavigationCard(ctx) {
  return Boolean(ctx?.persistNavigationCards || ctx?.user?._id);
}

async function rememberNavigationCard(ctx, message) {
  const messageId = getMessageId(message);
  if (!messageId) return message;
  if (ctx.user) ctx.user.navigationLastCardMessageId = messageId;
  if (canPersistNavigationCard(ctx) && ctx.userId !== undefined && ctx.userId !== null) {
    await updateProfileField(ctx.userId, "navigationLastCardMessageId", messageId);
  }
  return message;
}

async function clearNavigationCard(ctx) {
  const messageId = Number(ctx.user?.navigationLastCardMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0) return false;
  const retireCard = async () => {
    let deleted = false;
    try {
      deleted = ctx.deleteMessage ? await ctx.deleteMessage(messageId) : false;
    } catch {
      deleted = false;
    }
    if (!deleted && ctx.editMessageReplyMarkup) {
      try {
        await ctx.editMessageReplyMarkup(messageId, { inline_keyboard: [] });
      } catch {
        // The card may already have been retired by its feature-specific cleanup.
      }
    }
  };
  if (ctx.user) ctx.user.navigationLastCardMessageId = null;
  const persistClear = canPersistNavigationCard(ctx) && ctx.userId !== undefined && ctx.userId !== null
    ? updateProfileField(ctx.userId, "navigationLastCardMessageId", null)
    : Promise.resolve();
  await Promise.all([retireCard(), persistClear]);
  return true;
}

async function forgetNavigationCard(ctx) {
  const messageId = Number(ctx.user?.navigationLastCardMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0) return false;
  if (ctx.user) ctx.user.navigationLastCardMessageId = null;
  if (canPersistNavigationCard(ctx) && ctx.userId !== undefined && ctx.userId !== null) {
    await updateProfileField(ctx.userId, "navigationLastCardMessageId", null);
  }
  return true;
}

function resolveNavigationFootprint(lang, destination, { discussion, title } = {}) {
  const safeLang = messages[lang] ? lang : "fa";
  if (destination === "discussion") {
    const title = getDiscussionDisplayTitle(messages, safeLang, discussion) || "-";
    return messages[safeLang].navigationFootprintDiscussion.replace("{title}", title);
  }
  if (destination === "publicProfile") {
    const safeTitle = String(title || "").trim().replace(/\s+/g, " ").slice(0, 80) || "-";
    return messages[safeLang].navigationFootprintPublicProfile.replace("{name}", safeTitle);
  }
  if (destination === "aiSection") {
    return String(title || "").trim().replace(/\s+/g, " ").slice(0, 80) || "-";
  }
  const key = DESTINATION_KEYS[destination];
  if (!key) throw new Error(`Unknown navigation footprint destination: ${destination}`);
  return messages[safeLang][key];
}

async function sendNavigationFootprint(ctx, {
  lang: _lang,
  destination: _destination,
  discussion: _discussion,
  title: _title,
  removeKeyboard: _removeKeyboard = false,
}) {
  // Navigation footprints were retired when stable destinations moved to
  // server-scoped reply keyboards. Forget cards tracked by older deployments
  // without a Telegram delete/edit call; server-side modes reject stale text.
  await forgetNavigationCard(ctx);
  return null;
}

module.exports = {
  clearNavigationCard,
  forgetNavigationCard,
  rememberNavigationCard,
  resolveNavigationFootprint,
  sendNavigationFootprint,
};
