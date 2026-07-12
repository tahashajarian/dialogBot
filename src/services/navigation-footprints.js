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

const SENT_FOOTPRINTS = Symbol("sentNavigationFootprints");

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

async function sendNavigationFootprint(ctx, { lang, destination, discussion, title, removeKeyboard = false }) {
  if (typeof ctx?.reply !== "function") return null;
  const dedupeKey = `${destination}:${String(title || discussion?._id || "")}`;
  if (!ctx[SENT_FOOTPRINTS]) ctx[SENT_FOOTPRINTS] = new Set();
  if (ctx[SENT_FOOTPRINTS].has(dedupeKey)) return null;
  ctx[SENT_FOOTPRINTS].add(dedupeKey);
  await clearNavigationCard(ctx);
  const text = resolveNavigationFootprint(lang, destination, { discussion, title });
  const extra = removeKeyboard ? { reply_markup: { remove_keyboard: true } } : undefined;
  return ctx.reply(text, extra);
}

module.exports = {
  clearNavigationCard,
  rememberNavigationCard,
  resolveNavigationFootprint,
  sendNavigationFootprint,
};
