const { createHash, timingSafeEqual } = require("crypto");
const messages = require("../messages");
const { addAiListItem, normalizeAiListItem } = require("../services/users");
const { getInlineListUser } = require("../services/inline-list-users");
const { stagePendingInlineListItem } = require("../services/pending-inline-lists");
const { operationalLimits } = require("../services/operational-limits");

const INLINE_QUERY_WINDOW_MS = 30 * 1000;
const INLINE_QUERY_LIMIT = 45;
const INLINE_QUERY_RATE_CACHE_LIMIT = 5000;
const INLINE_RESULT_TITLE_LIMIT = 48;
const inlineQueryUsage = new Map();

const INLINE_SECTIONS = Object.freeze([
  { section: "movies", token: "m" },
  { section: "music", token: "u" },
  { section: "books", token: "b" },
]);
const SECTION_BY_TOKEN = new Map(INLINE_SECTIONS.map(({ section, token }) => [token, section]));

function getInlineQueryLanguage(from = {}, user = null) {
  if (user?.lang === "fa" || user?.lang === "en") return user.lang;
  return String(from?.language_code || "").toLowerCase().startsWith("en") ? "en" : "fa";
}

function parseInlineListTitle(value = "") {
  return normalizeAiListItem(value);
}

function trimInlineResultTitle(title = "") {
  const normalized = String(title || "");
  if (normalized.length <= INLINE_RESULT_TITLE_LIMIT) return normalized;
  return `${normalized.slice(0, INLINE_RESULT_TITLE_LIMIT - 1).trimEnd()}…`;
}

function normalizeBotUsername(value = "") {
  const username = String(value || "").trim().replace(/^@/, "");
  return /^[a-z0-9_]{5,32}$/i.test(username) ? username : "";
}

function buildInlineConfirmationContent({ text, lang, botUsername = "" }) {
  const username = normalizeBotUsername(botUsername);
  if (!username) return { message_text: text };
  const linkText = messages[lang].inlineCaptureOpenBot;
  const messageText = `${text}\n\n${linkText}`;
  return {
    message_text: messageText,
    entities: [{
      type: "text_link",
      offset: text.length + 2,
      length: linkText.length,
      url: `https://t.me/${username}`,
    }],
    link_preview_options: { is_disabled: true },
  };
}

function inlineResultFingerprint(userId, section, title) {
  return createHash("sha256")
    .update(`${Number(userId)}\0${section}\0${title}`)
    .digest("hex")
    .slice(0, 16);
}

function buildInlineResultId(userId, section, title) {
  const sectionEntry = INLINE_SECTIONS.find((entry) => entry.section === section);
  if (!sectionEntry) return "";
  return `ils:${sectionEntry.token}:${inlineResultFingerprint(userId, section, title)}`;
}

function parseChosenInlineSelection(resultId, userId, query) {
  const matched = String(resultId || "").match(/^ils:([mub]):([a-f0-9]{16})$/);
  if (!matched) return { ok: false, reason: "invalid_result" };
  const section = SECTION_BY_TOKEN.get(matched[1]);
  const title = parseInlineListTitle(query);
  if (!section || !title) return { ok: false, reason: "invalid_result" };
  const expected = Buffer.from(inlineResultFingerprint(userId, section, title));
  const received = Buffer.from(matched[2]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "result_mismatch" };
  }
  return { ok: true, section, title };
}

function allowInlineQuery(userId, now = Date.now()) {
  const key = Number(userId);
  if (!Number.isInteger(key) || key <= 0) return false;
  const recent = (inlineQueryUsage.get(key) || []).filter((timestamp) => now - timestamp < INLINE_QUERY_WINDOW_MS);
  if (recent.length >= INLINE_QUERY_LIMIT) {
    inlineQueryUsage.set(key, recent);
    return false;
  }
  recent.push(now);
  inlineQueryUsage.delete(key);
  inlineQueryUsage.set(key, recent);
  if (inlineQueryUsage.size > INLINE_QUERY_RATE_CACHE_LIMIT) {
    inlineQueryUsage.delete(inlineQueryUsage.keys().next().value);
  }
  return true;
}

async function answerInlineQuery(ctx, results, extra) {
  if (typeof ctx.answerInlineQuery === "function") {
    return ctx.answerInlineQuery(results, extra);
  }
  return ctx.telegram.callApi("answerInlineQuery", {
    inline_query_id: ctx.inlineQuery?.id,
    results,
    ...extra,
  });
}

function buildInlineSaveResults({
  userId,
  lang,
  title,
  botUsername = "",
}) {
  const visibleTitle = trimInlineResultTitle(title);
  return INLINE_SECTIONS.map(({ section }) => ({
    type: "article",
    id: buildInlineResultId(userId, section, title),
    title: messages[lang][`inlineCaptureResult_${section}`].replace("{item}", visibleTitle),
    description: messages[lang].inlineCaptureResultDescription,
    input_message_content: buildInlineConfirmationContent({
      text: messages[lang][`inlineCaptureConfirmation_${section}`].replace("{item}", title),
      lang,
      botUsername,
    }),
  }));
}

async function handleInlineListQuery(ctx, {
  getUser = getInlineListUser,
  allowQuery = allowInlineQuery,
} = {}) {
  const title = parseInlineListTitle(ctx.inlineQuery?.query);
  const userId = Number(ctx.inlineQuery?.from?.id || ctx.from?.id);
  const emptyAnswer = { cache_time: 1, is_personal: true };
  if (!title || !allowQuery(userId)) return answerInlineQuery(ctx, [], emptyAnswer);

  const user = await getUser(userId);
  if (user?.bannedAt) return answerInlineQuery(ctx, [], emptyAnswer);
  const lang = getInlineQueryLanguage(ctx.inlineQuery?.from || ctx.from, user);
  return answerInlineQuery(ctx, buildInlineSaveResults({
    userId,
    lang,
    title,
    botUsername: ctx.botInfo?.username,
  }), {
    cache_time: 0,
    is_personal: true,
  });
}

async function handleChosenInlineListResult(ctx, {
  getUser = getInlineListUser,
  addListItem = addAiListItem,
  stagePendingItem = stagePendingInlineListItem,
} = {}) {
  const chosen = ctx.chosenInlineResult || ctx.update?.chosen_inline_result;
  const userId = Number(chosen?.from?.id || ctx.from?.id);
  const selection = parseChosenInlineSelection(chosen?.result_id, userId, chosen?.query);
  if (!selection.ok) return selection;

  const user = await getUser(userId, { force: true });
  if (user?.bannedAt) return { ok: false, reason: "banned_user" };
  if (!user) {
    const staged = await stagePendingItem({
      userId,
      section: selection.section,
      title: selection.title,
    });
    if (!staged.ok) return staged;
    return {
      ok: true,
      status: staged.status,
      section: selection.section,
      title: selection.title,
    };
  }
  const result = await addListItem(
    userId,
    selection.section,
    "watchlist",
    { title: selection.title, comment: "" },
    operationalLimits.aiWatchlistItems,
  );
  if (result.ok || result.reason === "exists") {
    return {
      ok: true,
      status: result.ok ? "saved" : "already_saved",
      section: selection.section,
      title: selection.title,
    };
  }
  return { ok: false, reason: result.reason || "save_failed" };
}

module.exports = {
  allowInlineQuery,
  buildInlineConfirmationContent,
  buildInlineResultId,
  buildInlineSaveResults,
  getInlineQueryLanguage,
  handleChosenInlineListResult,
  handleInlineListQuery,
  inlineResultFingerprint,
  normalizeBotUsername,
  parseChosenInlineSelection,
  parseInlineListTitle,
  trimInlineResultTitle,
};
