const User = require("../models/user");
const messages = require("../messages");
const { callBacks } = require("../constants");
const { inlineKeyboard } = require("../keyboards");
const { getSectionEmoji, getSectionLabel } = require("../services/ai-section");
const {
  buildPublicFavoritesHubText,
  buildPublicFavoritesSectionText,
  formatPublicFavoritesTelegramText,
  getPublicFavoriteSections,
} = require("../services/profile-favorites-ui");
const { normalizePublicProfileCode } = require("../services/public-codes");
const { setNavigationMode } = require("../services/reply-keyboard-navigation");
const { restorePublicProfileReturnNavigationMode } = require("../services/public-profile-navigation");
const { sendPublicProfileByCode } = require("./saved-profiles");

const PROFILE_FAVORITE_SOURCES = new Set([
  "saved",
  "people",
  "discussion_members",
  "invitations",
  "restrictions",
  "shared",
  "direct",
]);
const PROFILE_FAVORITE_SECTIONS = new Set(["movies", "series", "music", "books"]);

function isProfileFavoritesCallback(data = "") {
  return data === callBacks.profileFavoritesClose
    || data.startsWith(callBacks.profileFavoritesOpen)
    || data.startsWith(callBacks.profileFavoritesSection)
    || data.startsWith(callBacks.profileFavoritesBack);
}

function parseProfileFavoritesContext(value = "") {
  const [source = "", pageValue = "0", rawCode = ""] = String(value).split(":");
  const code = normalizePublicProfileCode(rawCode);
  if (!PROFILE_FAVORITE_SOURCES.has(source) || !code) return null;
  return { source, page: Math.max(0, Number(pageValue) || 0), code };
}

function buildContextPayload(context) {
  return `${context.source}:${context.page}:${context.code}`;
}

function favoritesHubKeyboard(lang, sections, context) {
  const payload = buildContextPayload(context);
  const rows = sections.map(({ section }) => [{
    text: `${getSectionEmoji(section)} ${getSectionLabel(messages, lang, section)}`,
    callback_data: `${callBacks.profileFavoritesSection}${section}:${payload}`,
  }]);
  rows.push([{
    text: messages[lang].profileFavoritesBackButton,
    callback_data: `${callBacks.profileFavoritesBack}${payload}`,
  }]);
  rows.push([{
    text: messages[lang].discussionShareClose,
    callback_data: callBacks.profileFavoritesClose,
  }]);
  return inlineKeyboard(rows);
}

function favoritesSectionKeyboard(lang, context) {
  const payload = buildContextPayload(context);
  return inlineKeyboard([
    [{ text: messages[lang].profileFavoritesBackToHubButton, callback_data: `${callBacks.profileFavoritesOpen}${payload}` }],
    [{ text: messages[lang].profileFavoritesBackButton, callback_data: `${callBacks.profileFavoritesBack}${payload}` }],
    [{ text: messages[lang].discussionShareClose, callback_data: callBacks.profileFavoritesClose }],
  ]);
}

async function editFavoritesCard(ctx, text, keyboard, { useHtml = false } = {}) {
  const renderedText = useHtml ? formatPublicFavoritesTelegramText(text) : text;
  const extra = useHtml ? { ...keyboard, parse_mode: "HTML" } : keyboard;
  const isMedia = Boolean(ctx.callbackMessage?.photo || ctx.callbackMessage?.document || ctx.callbackMessage?.caption);
  if (isMedia && text.length <= 1024 && ctx.editMessageCaption) {
    const edited = await ctx.editMessageCaption(ctx.callbackMessageId, renderedText, extra);
    if (edited) return edited;
  }
  if (!isMedia && ctx.editMessageText) {
    const edited = await ctx.editMessageText(ctx.callbackMessageId, renderedText, extra);
    if (edited) return edited;
  }
  if (ctx.deleteMessage && ctx.callbackMessageId) {
    try { await ctx.deleteMessage(ctx.callbackMessageId); } catch {}
  }
  return ctx.reply(renderedText, extra);
}

function getProfileReturnOptions(context) {
  return {
    fromSavedList: context.source === "saved",
    fromPeopleList: context.source === "people",
    fromDiscussionMembers: context.source === "discussion_members",
    fromInvitationList: context.source === "invitations",
    fromRestrictionList: context.source === "restrictions",
    fromSharedLink: context.source === "shared",
  };
}

async function handleProfileFavoritesCallback(ctx, lang) {
  const data = ctx.callbackData || "";
  await ctx.answerCb?.();
  if (data === callBacks.profileFavoritesClose) {
    if (ctx.deleteMessage && ctx.callbackMessageId) {
      try { await ctx.deleteMessage(ctx.callbackMessageId); } catch {}
    }
    await restorePublicProfileReturnNavigationMode(ctx);
    return true;
  }

  if (data.startsWith(callBacks.profileFavoritesBack)) {
    const context = parseProfileFavoritesContext(data.replace(callBacks.profileFavoritesBack, ""));
    if (!context) return ctx.reply(messages[lang].profileCodeNotFound);
    return sendPublicProfileByCode(ctx, lang, context.code, {
      ...getProfileReturnOptions(context),
      editCurrent: true,
    });
  }

  let section = "";
  let context;
  if (data.startsWith(callBacks.profileFavoritesSection)) {
    const payload = data.replace(callBacks.profileFavoritesSection, "");
    const [candidateSection = "", ...contextParts] = payload.split(":");
    if (!PROFILE_FAVORITE_SECTIONS.has(candidateSection)) return ctx.reply(messages[lang].profileFavoritesEmpty);
    section = candidateSection;
    context = parseProfileFavoritesContext(contextParts.join(":"));
  } else {
    context = parseProfileFavoritesContext(data.replace(callBacks.profileFavoritesOpen, ""));
  }
  if (!context) return ctx.reply(messages[lang].profileCodeNotFound);

  const target = await User.findOne({ publicProfileCode: context.code });
  if (!target) return ctx.reply(messages[lang].profileCodeNotFound);
  const sections = getPublicFavoriteSections(target);
  if (!sections.length) return ctx.reply(messages[lang].profileFavoritesEmpty);
  const text = section
    ? buildPublicFavoritesSectionText(target, lang, section)
    : buildPublicFavoritesHubText(target, lang);
  const keyboard = section
    ? favoritesSectionKeyboard(lang, context)
    : favoritesHubKeyboard(lang, sections, context);
  const result = await editFavoritesCard(ctx, text, keyboard, { useHtml: Boolean(section) });
  await setNavigationMode(ctx, `profile_favorites:${context.source}:${context.page}:${context.code}:${section || "hub"}`);
  return result;
}

module.exports = {
  PROFILE_FAVORITE_SECTIONS,
  favoritesHubKeyboard,
  favoritesSectionKeyboard,
  handleProfileFavoritesCallback,
  isProfileFavoritesCallback,
  parseProfileFavoritesContext,
};
