const messages = require("../messages");
const User = require("../models/user");
const Discussion = require("../models/discussion");
const { formatOperationalLimitsText } = require("../services/operational-limits-ui");
const {
  inlineKeyboard,
  advancedSearchPreviewKeyboard,
  peopleDiscoverListKeyboard,
  peopleDiscoverEmptyKeyboard,
  peopleHubKeyboard,
  profilePublicActionsKeyboard,
  profileInvitationBackKeyboard,
  savedProfilesListKeyboard,
} = require("../keyboards");
const { callBacks } = require("../constants");
const { updateProfileField, updateUserFields } = require("../services/users");
const { EVENT_NAMES, trackEvent } = require("../services/analytics-events");
const {
  getBasicProfileMissingFields,
  sendProfileMessage,
} = require("../services/profile");
const {
  normalizePublicProfileCode,
} = require("../services/public-codes");
const {
  addSavedProfileCode,
  removeSavedProfileCode,
} = require("../services/saved-profiles");
const {
  isCodeSaved,
  buildSavedProfileListItems,
  paginateSavedProfiles,
  buildSavedProfilesListText,
  buildProfileDiscussionSectionsText,
} = require("../services/saved-profiles-ui");
const {
  ensurePeopleDiscoveryCodes,
  findPeopleBySharedTaste,
  paginatePeopleDiscovery,
} = require("../services/people-discovery");
const {
  buildPeopleDiscoveryText,
  isPeopleCallback,
} = require("../services/people-discovery-ui");
const { sendNavigationFootprint } = require("../services/navigation-footprints");
const { setNavigationMode } = require("../services/reply-keyboard-navigation");
const {
  decorateDiscussionsForList,
  buildDiscussionListText,
} = require("../services/discussion-ui");

const defaultDiscussionFind = Discussion.find;
const defaultDiscussionFindOne = Discussion.findOne;

function getProfileCompletionFieldLine(messages, lang, field) {
  if (field === "name") return `👤 ${messages[lang].profileCompletenessFieldName}`;
  if (field === "age") return `🎂 ${messages[lang].profileCompletenessFieldAge}`;
  return `• ${field}`;
}

function profileViewGateKeyboard(lang, missingFields = []) {
  const buttons = [];
  if (missingFields.includes("name")) {
    buttons.push({ text: messages[lang].profileEditName, callback_data: callBacks.profileEditName });
  }
  if (missingFields.includes("age")) {
    buttons.push({ text: messages[lang].profileEditAge, callback_data: callBacks.profileEditAge });
  }
  return inlineKeyboard(buttons.map((button) => [button]));
}

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function canPersistUserMessageState(ctx) {
  return Boolean(ctx.user && typeof ctx.user.toObject === "function");
}

function normalizeProfileCodeFromActionCommand(value) {
  const raw = String(value || "").trim().replace(/^\/?(remove|report|save|unsave|rm)_/i, "");
  return normalizePublicProfileCode(raw.startsWith("u_") ? raw : `u_${raw}`);
}

function hasPeopleSurfaceContext(ctx) {
  return Number(ctx.user?.peopleLastListMessageId) > 0 ||
    ["browse", "taste"].includes(String(ctx.user?.peopleLastListMode || ""));
}

function shouldRefreshProfileAfterSave(ctx) {
  return Number(ctx.user?.publicProfileLastMessageId) > 0 || hasPeopleSurfaceContext(ctx);
}

function getPublicProfileActionKeyboard(lang, code, {
  fromSavedList = false,
  peopleReturnMode = "browse",
  isSaved = false,
  hasDiscussions = false,
  fromDiscussionMembers = false,
} = {}) {
  return profilePublicActionsKeyboard(lang, code, {
    isSaved,
    hasDiscussions,
    source: fromDiscussionMembers ? "discussion_members" : fromSavedList ? "saved" : "people",
    peopleMode: peopleReturnMode,
  });
}

async function runLeanQuery(query, select = "") {
  if (!query) return query;
  if (query.select) {
    const selected = select ? query.select(select) : query;
    return selected.lean ? selected.lean() : selected;
  }
  if (query.lean) return query.lean();
  return query;
}

async function hasVisibleProfileDiscussions(target) {
  if (!target || !target.userId) return false;
  const discussionQueryAvailable = Discussion.db?.readyState === 1 ||
    Discussion.find !== defaultDiscussionFind ||
    Discussion.findOne !== defaultDiscussionFindOne;
  if (!discussionQueryAvailable) return false;

  if (target.activeDiscussionId && target.showActiveDiscussionOnProfile) {
    const activeQuery = Discussion.findOne({
      _id: target.activeDiscussionId,
      status: "open",
    });
    const activeDiscussion = await runLeanQuery(activeQuery, "_id");
    if (activeDiscussion) return true;
  }

  const createdQuery = Discussion.findOne({
    creatorUserId: target.userId,
    status: "open",
    ...(target.activeDiscussionId ? { _id: { $ne: target.activeDiscussionId } } : {}),
  });
  const createdDiscussion = await runLeanQuery(createdQuery, "_id");
  return Boolean(createdDiscussion);
}

async function getSavedProfileDisplayName(code) {
  const target = await runLeanQuery(
    User.findOne({ publicProfileCode: normalizePublicProfileCode(code) }),
    "profileName firstName",
  );
  return String(target?.profileName || target?.firstName || "").trim();
}

function formatSavedProfileRemovedMessage(lang, name = "") {
  const displayName = String(name || "").trim();
  return displayName
    ? messages[lang].savedProfileRemoved.replace("{name}", displayName)
    : messages[lang].savedProfileRemovedUnknown;
}

function formatSavedProfileSavedMessage(lang, name = "") {
  const displayName = String(name || "").trim();
  return displayName
    ? messages[lang].savedProfileSaved.replace("{name}", displayName)
    : messages[lang].savedProfileSavedUnknown;
}

function savedProfileRemoveConfirmKeyboard(lang) {
  return {
    reply_markup: {
      keyboard: [
        [{ text: messages[lang].savedProfileRemoveConfirmButton }],
        [{ text: messages[lang].savedProfileRemoveCancelButton }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  };
}

function parseProfileUnsaveConfirmMode(mode = "") {
  const match = String(mode).match(/^profile_unsave_confirm:(list|saved|people):(u_[A-Z0-9]+):(\d+)$/);
  return match ? { origin: match[1], code: match[2], page: Number(match[3]) || 0 } : null;
}

function parsePublicProfileNavigationMode(mode = "") {
  const match = String(mode).match(/^public_profile:(saved|people):(u_[A-Z0-9]+):(\d+):(saved|unsaved):(0|1)$/);
  return match ? {
    source: match[1],
    code: match[2],
    page: Number(match[3]) || 0,
    isSaved: match[4] === "saved",
    hasDiscussions: match[5] === "1",
  } : null;
}

function getPeopleListReturnPage(mode = "", user = null) {
  const profileContext = parsePublicProfileNavigationMode(mode);
  if (profileContext?.source === "people") return profileContext.page;
  const resultsMatch = String(mode).match(/^people_discovery_results:(\d+):\d+$/);
  if (resultsMatch) return Number(resultsMatch[1]) || 0;
  if (Number(user?.peopleLastListMessageId) > 0 || ["browse", "taste"].includes(String(user?.peopleLastListMode || ""))) {
    return Math.max(0, Number(user?.peopleLastListPage) || 0);
  }
  return null;
}

async function requestUnsaveProfileConfirmation(ctx, lang, code) {
  const normalizedCode = normalizePublicProfileCode(code);
  if (!normalizedCode) return ctx.reply(messages[lang].profileCodeNotFound);
  const currentMode = String(ctx.user?.navigationMode || "");
  const profileContext = parsePublicProfileNavigationMode(currentMode);
  const listMatch = currentMode.match(/^saved_profiles:(\d+):\d+$/);
  const origin = profileContext?.source || "list";
  const page = Number(profileContext?.page || listMatch?.[1] || 0);
  const name = await getSavedProfileDisplayName(normalizedCode);
  const navigationMode = `profile_unsave_confirm:${origin}:${normalizedCode}:${page}`;
  await setNavigationMode(ctx, navigationMode);
  return ctx.reply(
    messages[lang].savedProfileRemoveConfirm.replace("{name}", name || normalizedCode),
    savedProfileRemoveConfirmKeyboard(lang),
  );
}

async function findVisibleProfileDiscussionUserIds(users = []) {
  const normalizedUsers = (users || []).filter((user) => Number.isFinite(Number(user?.userId)));
  if (!normalizedUsers.length) return new Set();
  const discussionQueryAvailable = Discussion.db?.readyState === 1 ||
    Discussion.find !== defaultDiscussionFind ||
    Discussion.findOne !== defaultDiscussionFindOne;
  if (!discussionQueryAvailable) return new Set();

  const result = new Set();
  const activeById = new Map();
  for (const user of normalizedUsers) {
    if (user.activeDiscussionId && user.showActiveDiscussionOnProfile) {
      activeById.set(String(user.activeDiscussionId), Number(user.userId));
    }
  }

  if (activeById.size) {
    const activeQuery = Discussion.find({
      _id: { $in: [...activeById.keys()] },
      status: "open",
    });
    const activeDiscussions = await runLeanQuery(activeQuery, "_id") || [];
    for (const discussion of activeDiscussions) {
      const userId = activeById.get(String(discussion?._id));
      if (userId) result.add(userId);
    }
  }

  const userIds = normalizedUsers.map((user) => Number(user.userId));
  const createdQuery = Discussion.find({
    creatorUserId: { $in: userIds },
    status: "open",
  });
  const createdDiscussions = await runLeanQuery(createdQuery, "creatorUserId") || [];
  for (const discussion of createdDiscussions) {
    const userId = Number(discussion?.creatorUserId);
    if (Number.isFinite(userId)) result.add(userId);
  }

  return result;
}

function parseProfileDiscussionRequest(raw = "", ctx = {}) {
  const value = String(raw || "");
  const parts = value.split(":");
  const knownSources = new Set(["saved", "browse", "taste"]);
  if (parts.length >= 2 && knownSources.has(parts[0])) {
    return {
      source: parts[0] === "saved" ? "saved" : "people",
      peopleMode: parts[0] === "taste" ? "taste" : "browse",
      code: normalizePublicProfileCode(parts.slice(1).join(":")),
    };
  }
  const peopleMode = String(ctx.user?.peopleLastListMode || "") === "taste" ? "taste" : "browse";
  return {
    source: hasPeopleSurfaceContext(ctx) ? "people" : "saved",
    peopleMode,
    code: normalizePublicProfileCode(value),
  };
}

function buildProfileDiscussionReturnType(profileCode, { source = "saved", peopleMode = "browse" } = {}) {
  const code = normalizePublicProfileCode(profileCode);
  if (!code) return "";
  return source === "people" ? `people:${peopleMode === "taste" ? "taste" : "browse"}:${code}` : `saved:${code}`;
}

function isProfileDiscussionListType(value = "") {
  const type = String(value || "");
  return type.startsWith("saved:") || type.startsWith("people:");
}

function profileDiscussionBackKeyboard(lang, _profileCode) {
  return {
    reply_markup: {
      keyboard: [[{ text: messages[lang].aiBack }]],
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: true,
    },
  };
}

async function rememberSavedProfilesListMessage(ctx, messageOrId) {
  if (typeof messageOrId === "boolean") return;
  const messageId = Number(getMessageId(messageOrId) || messageOrId);
  if (!Number.isInteger(messageId) || messageId <= 0) return;
  if (ctx.user) ctx.user.savedProfilesLastListMessageId = messageId;
  if (canPersistUserMessageState(ctx)) {
    await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", messageId);
  }
}

async function clearSavedProfilesListMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.savedProfilesLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId)) return false;
  if (ctx.user) ctx.user.savedProfilesLastListMessageId = null;
  if (canPersistUserMessageState(ctx)) {
    await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
  }
  return true;
}

async function forgetSavedProfilesListMessage(ctx) {
  if (ctx.user?.savedProfilesLastListMessageId) {
    if (ctx.user) ctx.user.savedProfilesLastListMessageId = null;
    if (canPersistUserMessageState(ctx)) {
      await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
    }
  }
}

async function rememberPeopleListMessage(ctx, messageOrId, page = 0) {
  if (typeof messageOrId === "boolean") return;
  const messageId = Number(getMessageId(messageOrId) || messageOrId);
  if (!Number.isInteger(messageId) || messageId <= 0) return;
  const normalizedPage = Math.max(0, Number(page) || 0);
  if (ctx.user) {
    ctx.user.peopleLastListMessageId = messageId;
    ctx.user.peopleLastListPage = normalizedPage;
    ctx.user.peopleLastListMode = "browse";
  }
  if (canPersistUserMessageState(ctx)) {
    await updateUserFields(ctx.userId, {
      peopleLastListMessageId: messageId,
      peopleLastListPage: normalizedPage,
      peopleLastListMode: "browse",
    });
  }
}

async function clearPeopleListMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.peopleLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId)) return false;
  if (ctx.user) {
    ctx.user.peopleLastListMessageId = null;
    ctx.user.peopleLastListMode = "";
  }
  if (canPersistUserMessageState(ctx)) {
    await updateUserFields(ctx.userId, {
      peopleLastListMessageId: null,
      peopleLastListMode: "",
    });
  }
  return true;
}

async function forgetPeopleListMessage(ctx) {
  if (ctx.user?.peopleLastListMessageId || ctx.user?.peopleLastListMode) {
    if (ctx.user) {
      ctx.user.peopleLastListMessageId = null;
      ctx.user.peopleLastListMode = "";
    }
    if (canPersistUserMessageState(ctx)) {
      await updateUserFields(ctx.userId, {
        peopleLastListMessageId: null,
        peopleLastListMode: "",
      });
    }
  }
}

async function clearViewedPublicProfileMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.publicProfileLastMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId)) return false;
  const navigationMode = String(ctx.user?.navigationMode || "");
  const canLeaveSafeProfileCard = /^(?:public_profile:|profile_discussions:|profile_unsave_confirm:)/.test(navigationMode);
  if (canLeaveSafeProfileCard) {
    if (ctx.user) ctx.user.publicProfileLastMessageId = null;
    if (canPersistUserMessageState(ctx)) {
      await updateProfileField(ctx.userId, "publicProfileLastMessageId", null);
    }
    return true;
  }
  if (!ctx.deleteMessage && !ctx.editMessageReplyMarkup) return false;
  const deleted = ctx.deleteMessage ? await ctx.deleteMessage(messageId) : false;
  const retired = deleted || (
    ctx.editMessageReplyMarkup
      ? await ctx.editMessageReplyMarkup(messageId, { inline_keyboard: [] })
      : false
  );
  if (ctx.user) ctx.user.publicProfileLastMessageId = null;
  if (canPersistUserMessageState(ctx)) {
    await updateProfileField(ctx.userId, "publicProfileLastMessageId", null);
  }
  return retired;
}

async function clearSavedProfileDiscussionMessage(ctx, exceptMessageIds = []) {
  if (!isProfileDiscussionListType(ctx.user?.discussionLastListType)) return false;
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.discussionLastListMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId)) return false;
  if (ctx.user) {
    ctx.user.discussionLastListMessageId = null;
    ctx.user.discussionLastListType = "";
  }
  if (canPersistUserMessageState(ctx)) {
    await updateUserFields(ctx.userId, {
      discussionLastListMessageId: null,
      discussionLastListType: "",
    });
  }
  return true;
}

async function clearSavedProfileSurfaceMessages(ctx, exceptMessageIds = []) {
  await Promise.all([
    clearSavedProfilesListMessage(ctx, exceptMessageIds),
    clearPeopleListMessage(ctx, exceptMessageIds),
    clearViewedPublicProfileMessage(ctx, exceptMessageIds),
    clearSavedProfileDiscussionMessage(ctx, exceptMessageIds),
  ]);
}

async function rememberViewedPublicProfileMessage(ctx, message) {
  const messageId = getMessageId(message);
  if (!messageId) return;
  if (ctx.user) ctx.user.publicProfileLastMessageId = messageId;
  if (canPersistUserMessageState(ctx)) {
    await updateProfileField(ctx.userId, "publicProfileLastMessageId", messageId);
  }
}

async function sendSavedProfilesList(ctx, lang, codes = [], page = 0, { send = null } = {}) {
  await forgetPeopleListMessage(ctx);
  if (page === 0) await sendNavigationFootprint(ctx, { lang, destination: "savedProfiles" });
  const items = await buildSavedProfileListItems({
    codes,
    normalizePublicProfileCode,
    findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
      .select("userId publicProfileCode profileName firstName profileEmoji activeDiscussionId showActiveDiscussionOnProfile")
      .lean(),
    findDiscussionUserIds: findVisibleProfileDiscussionUserIds,
  });
  const paged = paginateSavedProfiles(items, page);
  const text = buildSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex });
  const keyboard = savedProfilesListKeyboard(lang, {
    page: paged.page,
    totalPages: paged.totalPages,
  });
  const sent = send ? await send(text, keyboard) : await ctx.reply(text, keyboard);
  const navigationMode = `saved_profiles:${paged.page}:${paged.totalPages}`;
  await setNavigationMode(ctx, navigationMode);
  await rememberSavedProfilesListMessage(ctx, sent);
  if (ctx.user) {
    ctx.user.discussionLastListMessageId = null;
    ctx.user.discussionLastListType = "";
  }
  if (canPersistUserMessageState(ctx)) {
    await updateProfileField(ctx.userId, "discussionLastListMessageId", null);
    await updateProfileField(ctx.userId, "discussionLastListType", "");
  }
  return sent;
}

async function sendPeopleHub(ctx, lang, { send = null, removeKeyboard = false } = {}) {
  await forgetSavedProfilesListMessage(ctx);
  await forgetPeopleListMessage(ctx);
  await sendNavigationFootprint(ctx, { lang, destination: "people", removeKeyboard });
  const sent = send
    ? await send(messages[lang].peopleMenu, peopleHubKeyboard(lang))
    : await ctx.reply(messages[lang].peopleMenu, peopleHubKeyboard(lang));
  await setNavigationMode(ctx, "people");
  return sent;
}

async function buildPeopleDiscoveryPage(ctx, lang, page = 0) {
  const result = await findPeopleBySharedTaste(ctx.user || {});
  const paged = paginatePeopleDiscovery(result.items || [], page);
  const pageItems = await ensurePeopleDiscoveryCodes(paged.items);
  const isEmpty = !result.ok || pageItems.length === 0;
  return {
    page: paged.page,
    totalPages: paged.totalPages,
    isEmpty,
    text: result.ok
      ? buildPeopleDiscoveryText(messages, lang, pageItems, {
        startIndex: paged.startIndex,
        emptyText: messages[lang].peopleDiscoverNoMatches,
        showSharedSections: true,
      })
      : messages[lang].peopleDiscoverNeedsLists,
    keyboard: isEmpty
      ? peopleDiscoverEmptyKeyboard(lang)
      : peopleDiscoverListKeyboard(lang, {
        page: paged.page,
        totalPages: paged.totalPages,
        showLists: false,
      }),
  };
}

async function sendPeopleDiscoveryList(ctx, lang, page = 0, { send = null } = {}) {
  await forgetSavedProfilesListMessage(ctx);
  const discoveryPage = await buildPeopleDiscoveryPage(ctx, lang, page);
  if (page === 0) await sendNavigationFootprint(ctx, { lang, destination: "peopleDiscovery" });
  const sent = send
    ? await send(discoveryPage.text, discoveryPage.keyboard)
    : await ctx.reply(discoveryPage.text, discoveryPage.keyboard);
  const navigationMode = discoveryPage.isEmpty
    ? "people_discovery_empty"
    : `people_discovery_results:${discoveryPage.page}:${discoveryPage.totalPages}`;
  await setNavigationMode(ctx, navigationMode);
  await rememberPeopleListMessage(ctx, sent, discoveryPage.page);
  return sent;
}

async function buildSavedProfilePage(codes = [], page = 0) {
  const items = await buildSavedProfileListItems({
    codes,
    normalizePublicProfileCode,
    findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
      .select("userId publicProfileCode profileName firstName profileEmoji activeDiscussionId showActiveDiscussionOnProfile")
      .lean(),
    findDiscussionUserIds: findVisibleProfileDiscussionUserIds,
  });
  return paginateSavedProfiles(items, page);
}

async function saveProfileCommand(ctx, lang, text) {
  const code = normalizeProfileCodeFromActionCommand(text);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  return saveProfileByCode(ctx, lang, code);
}

async function saveProfileByCode(ctx, lang, code, { fromDiscussionMembers = false, fromPeopleList = false } = {}) {
  const currentNavigationMode = String(ctx.user?.navigationMode || "");
  const modePeoplePage = getPeopleListReturnPage(currentNavigationMode, ctx.user);
  const shouldReturnToPeopleList = fromPeopleList || modePeoplePage !== null;
  const peopleSourcePage = modePeoplePage ?? 0;
  const savedProfileName = await getSavedProfileDisplayName(code);
  const saved = await addSavedProfileCode(ctx.userId, code);
  if (!saved.ok) {
    if (saved.reason === "exists") {
      if (fromDiscussionMembers) return ctx.reply(messages[lang].savedProfileAlreadySaved);
      if (shouldReturnToPeopleList) {
        await ctx.reply(messages[lang].savedProfileAlreadySaved);
        return sendPeopleDiscoveryList(ctx, lang, peopleSourcePage);
      }
      if (shouldRefreshProfileAfterSave(ctx)) {
        return sendPublicProfileByCode(ctx, lang, code, { fromPeopleList: fromPeopleList || hasPeopleSurfaceContext(ctx), fromDiscussionMembers });
      }
      return ctx.reply(messages[lang].savedProfileAlreadySaved);
    }
    if (saved.reason === "saved_profiles_limit") {
      return ctx.reply(formatOperationalLimitsText(messages[lang].savedProfilesLimit, {
        savedProfilesLimit: saved.cap,
      }));
    }
    return ctx.reply(messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", saved.items || []);
  if (ctx.user) ctx.user.savedProfileCodes = saved.items || [];
  if (fromDiscussionMembers) {
    const keyboard = getPublicProfileActionKeyboard(lang, code, {
      isSaved: true,
      fromDiscussionMembers: true,
    });
    if (ctx.callbackMessageId && ctx.editMessageReplyMarkup) {
      await ctx.editMessageReplyMarkup(ctx.callbackMessageId, keyboard.reply_markup);
    }
    return ctx.reply(formatSavedProfileSavedMessage(lang, savedProfileName));
  }
  if (shouldReturnToPeopleList) {
    await clearViewedPublicProfileMessage(ctx);
    await ctx.reply(formatSavedProfileSavedMessage(lang, savedProfileName));
    return sendPeopleDiscoveryList(ctx, lang, peopleSourcePage);
  }
  if (shouldRefreshProfileAfterSave(ctx)) {
    return sendPublicProfileByCode(ctx, lang, code, { fromPeopleList: shouldReturnToPeopleList || hasPeopleSurfaceContext(ctx), fromDiscussionMembers });
  }
  await clearViewedPublicProfileMessage(ctx);
  return ctx.reply(formatSavedProfileSavedMessage(lang, savedProfileName));
}

async function unsaveProfileCommand(ctx, lang, text) {
  const code = normalizeProfileCodeFromActionCommand(text);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  return requestUnsaveProfileConfirmation(ctx, lang, code);
}

async function unsaveProfileByCode(ctx, lang, code, { returnToList = false, refreshProfile = false, notify = true, fromDiscussionMembers = false, fromPeopleList = false, fromSavedList = false } = {}) {
  const removedProfileName = notify ? await getSavedProfileDisplayName(code) : "";
  const removed = await removeSavedProfileCode(ctx.userId, code);
  if (!removed.ok) {
    return ctx.reply(removed.reason === "not_found" ? messages[lang].savedProfilesEmpty : messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", removed.items || []);
  if (ctx.user) ctx.user.savedProfileCodes = removed.items || [];
  await clearSavedProfilesListMessage(ctx);
  await clearViewedPublicProfileMessage(ctx);
  if (notify) {
    await ctx.reply(formatSavedProfileRemovedMessage(lang, removedProfileName));
  }
  if (refreshProfile) {
    return sendPublicProfileByCode(ctx, lang, code, {
      fromPeopleList: fromPeopleList || hasPeopleSurfaceContext(ctx),
      fromSavedList: fromSavedList || (!fromDiscussionMembers && !fromPeopleList && !hasPeopleSurfaceContext(ctx)),
      fromDiscussionMembers,
    });
  }
  if (!returnToList) {
    return true;
  }
  return sendSavedProfilesList(ctx, lang, removed.items || []);
}

async function sendPublicProfileByCode(ctx, lang, rawCode, { fromSavedList = false, fromInvitationList = false, fromPeopleList = false, fromDiscussionMembers = false } = {}) {
  const code = normalizePublicProfileCode(rawCode);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  const peopleReturnMode = ctx.user?.peopleLastListMode === "taste" ? "taste" : "browse";
  const fromPeopleSurface = fromPeopleList || ["browse", "taste"].includes(String(ctx.user?.peopleLastListMode || ""));
  const previousNavigationMode = String(ctx.user?.navigationMode || "");
  const savedPage = Number(
    previousNavigationMode.match(/^saved_profiles:(\d+):/)?.[1]
    || previousNavigationMode.match(/^public_profile:saved:u_[A-Z0-9]+:(\d+):/)?.[1]
    || previousNavigationMode.match(/^profile_discussions:saved:u_[A-Z0-9]+:(\d+)$/)?.[1]
    || previousNavigationMode.match(/^profile_unsave_confirm:saved:u_[A-Z0-9]+:(\d+)$/)?.[1]
    || 0,
  );
  const peoplePage = Number(
    previousNavigationMode.match(/^people_discovery_results:(\d+):\d+$/)?.[1]
    || previousNavigationMode.match(/^public_profile:people:u_[A-Z0-9]+:(\d+):/)?.[1]
    || previousNavigationMode.match(/^profile_discussions:people:u_[A-Z0-9]+:(\d+)$/)?.[1]
    || previousNavigationMode.match(/^profile_unsave_confirm:people:u_[A-Z0-9]+:(\d+)$/)?.[1]
    || 0,
  );

  if (fromPeopleSurface) {
    await clearPeopleListMessage(ctx, [ctx.callbackMessageId]);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await clearSavedProfileDiscussionMessage(ctx, [ctx.callbackMessageId]);
  } else if (fromSavedList) {
    await clearSavedProfilesListMessage(ctx, [ctx.callbackMessageId]);
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
    await clearSavedProfileDiscussionMessage(ctx, [ctx.callbackMessageId]);
  } else {
    await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);
  }

  const target = await User.findOne({ publicProfileCode: code });
  if (!target) return ctx.reply(messages[lang].profileCodeNotFound);

  const isOwnProfile = Number(target.userId) === Number(ctx.userId);
  const missingBasicFields = isOwnProfile ? [] : getBasicProfileMissingFields(ctx.user);
  if (missingBasicFields.length) {
    // Store the intended profile code so we can redirect after completion
    if (ctx.user) {
      ctx.user.pendingProfileViewCode = code;
      await updateProfileField(ctx.userId, "pendingProfileViewCode", code);
    }
    const fields = missingBasicFields
      .map((field) => getProfileCompletionFieldLine(messages, lang, field))
      .join("\n");
    return ctx.reply(
      messages[lang].profileViewGateText.replace("{fields}", fields),
      profileViewGateKeyboard(lang, missingBasicFields),
    );
  }

  const currentSavedCodes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
  const isSavedProfile = isCodeSaved(currentSavedCodes, code);
  const hasDiscussions = isSavedProfile ? await hasVisibleProfileDiscussions(target) : false;
  const keyboard = fromInvitationList
    ? profileInvitationBackKeyboard(lang, target.userId)
    : getPublicProfileActionKeyboard(lang, code, {
      fromSavedList,
      peopleReturnMode,
      isSaved: isSavedProfile,
      hasDiscussions,
      fromDiscussionMembers,
    });

  await sendNavigationFootprint(ctx, {
    lang,
    destination: "publicProfile",
    title: target.profileName || target.firstName || "-",
  });

  const result = await sendProfileMessage({
    ctx,
    user: target,
    lang,
    keyboard,
    messages,
    loadingText: messages[lang].profileLoading,
    isOwnProfile: false,
    footerText: fromDiscussionMembers && isSavedProfile ? messages[lang].profileSavedButton : "",
  });


  await rememberViewedPublicProfileMessage(ctx, result);
  if (!fromInvitationList && !fromDiscussionMembers) {
    const source = fromSavedList ? "saved" : "people";
    const sourcePage = source === "saved" ? savedPage : peoplePage;
    const navigationMode = `public_profile:${source}:${code}:${sourcePage}:${isSavedProfile ? "saved" : "unsaved"}:${hasDiscussions ? 1 : 0}`;
    await setNavigationMode(ctx, navigationMode);
  }
  return result;
}

async function renderSavedProfileDiscussions(ctx, lang, code, options = {}) {
  const profileCode = normalizePublicProfileCode(code);
  if (!profileCode) return ctx.reply(messages[lang].profileCodeNotFound);
  const returnType = buildProfileDiscussionReturnType(profileCode, options);
  const profileMode = String(ctx.user?.navigationMode || "");
  const source = options.source === "people" ? "people" : "saved";
  const sourcePage = Number(
    profileMode.match(new RegExp(`^public_profile:${source}:u_[A-Z0-9]+:(\\d+):`))?.[1]
    || 0,
  );

  await clearSavedProfileSurfaceMessages(ctx, [ctx.callbackMessageId]);

  const target = await User.findOne({ publicProfileCode: profileCode });
  if (!target) return ctx.reply(messages[lang].profileCodeNotFound);

  const name = target.profileName || target.firstName || "کاربر";
  const titleText = messages[lang].savedProfileDiscussionsTitle.replace("{name}", name);

  const discussionSections = [];
  let hasAny = false;

  if (target.activeDiscussionId && target.showActiveDiscussionOnProfile) {
    const activeDiscussion = await Discussion.findOne({
      _id: target.activeDiscussionId,
      status: "open",
    }).lean();
    if (activeDiscussion) {
      hasAny = true;
      const decorated = await decorateDiscussionsForList(ctx.user, [activeDiscussion]);
      discussionSections.push(buildDiscussionListText(messages, lang, messages[lang].savedProfileActiveDiscussionTitle, decorated));
    }
  }

  const createdDiscussions = await Discussion.find({
    creatorUserId: target.userId,
    status: "open",
    ...(target.activeDiscussionId ? { _id: { $ne: target.activeDiscussionId } } : {}),
  }).limit(10).lean();

  if (createdDiscussions.length > 0) {
    hasAny = true;
    const decorated = await decorateDiscussionsForList(ctx.user, createdDiscussions);
    discussionSections.push(buildDiscussionListText(messages, lang, messages[lang].savedProfileCreatedDiscussionsTitle, decorated));
  }

  if (!hasAny) {
    const noDiscussionsText = messages[lang].savedProfileNoDiscussions.replace("{name}", name);
    const keyboard = profileDiscussionBackKeyboard(lang, profileCode);
    const sentEmpty = await ctx.reply(noDiscussionsText, keyboard);
    if (ctx.user) {
      ctx.user.discussionLastListMessageId = getMessageId(sentEmpty) || null;
      ctx.user.discussionLastListType = returnType;
    }
    await updateUserFields(ctx.userId, {
      discussionLastListMessageId: getMessageId(sentEmpty) || null,
      discussionLastListType: returnType,
    });
    const navigationMode = `profile_discussions:${source}:${profileCode}:${sourcePage}`;
    await setNavigationMode(ctx, navigationMode);
    return sentEmpty;
  }

  const keyboard = profileDiscussionBackKeyboard(lang, profileCode);
  const sent = await ctx.reply(buildProfileDiscussionSectionsText(titleText, discussionSections), keyboard);
  if (ctx.user) {
    ctx.user.discussionLastListMessageId = getMessageId(sent) || null;
    ctx.user.discussionLastListType = returnType;
  }
  await updateUserFields(ctx.userId, {
    discussionLastListMessageId: getMessageId(sent) || null,
    discussionLastListType: returnType,
  });
  const navigationMode = `profile_discussions:${source}:${profileCode}:${sourcePage}`;
  await setNavigationMode(ctx, navigationMode);
  return sent;
}

function isSavedProfilesCallback(data = "") {
  return isPeopleCallback(data) ||
    data === callBacks.savedProfiles ||
    data === callBacks.profileUnsaveConfirm ||
    data === callBacks.profileUnsaveCancel ||
    data === "saved:back" ||
    data.startsWith(callBacks.savedProfilesPage) ||
    data.startsWith(callBacks.savedProfilesOpen) ||
    data.startsWith(callBacks.savedProfilesDiscussions) ||
    data.startsWith(callBacks.savedProfilesRemove);
}

async function handleSavedProfilesCallback(ctx, lang, {
  buildSavedProfilesListText: renderSavedProfilesListText = buildSavedProfilesListText,
  clearRememberedAiListMessage,
  clearViewedPublicProfileMessage: clearViewedPublicProfile = clearViewedPublicProfileMessage,
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
  forgetSavedProfilesListMessage: forgetSavedProfilesList = forgetSavedProfilesListMessage,
  isProfileCallbackMessage,
  hasTemporaryReplyKeyboard = () => false,
  leaveDiscussionAndClearKeyboardForNavigation,
} = {}) {
  const data = ctx.callbackData || "";
  const deleteInlineCallbackMessage = () => ctx.isReplyKeyboardAction
    ? false
    : deleteCallbackMessageIfPossible?.(ctx);

  if (data === callBacks.profileUnsaveConfirm || data === callBacks.profileUnsaveCancel) {
    await ctx.answerCb?.();
    const confirmation = parseProfileUnsaveConfirmMode(ctx.user?.navigationMode);
    if (!confirmation) return false;
    if (data === callBacks.profileUnsaveCancel) {
      if (confirmation.origin === "list") {
        const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
        return sendSavedProfilesList(ctx, lang, codes, confirmation.page);
      }
      return sendPublicProfileByCode(ctx, lang, confirmation.code, {
        fromSavedList: confirmation.origin === "saved",
        fromPeopleList: confirmation.origin === "people",
      });
    }
    const removed = await unsaveProfileByCode(ctx, lang, confirmation.code);
    if (removed !== true) return removed;
    if (confirmation.origin === "people") {
      return sendPeopleDiscoveryList(ctx, lang, confirmation.page);
    }
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    return sendSavedProfilesList(ctx, lang, codes, confirmation.page);
  }

  if (data === callBacks.people) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation?.(ctx, { clearKeyboard: false });
    await clearRememberedAiListMessage?.(ctx);
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    await deleteInlineCallbackMessage();
    return sendPeopleHub(ctx, lang, { removeKeyboard: shouldClearKeyboard });
  }

  if (data === callBacks.peopleDiscover) {
    await ctx.answerCb?.();
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    await deleteInlineCallbackMessage();
    const page = ctx.user?.peopleLastListMode === "browse" ? Number(ctx.user?.peopleLastListPage) || 0 : 0;
    return sendPeopleDiscoveryList(ctx, lang, page);
  }

  if (data === callBacks.peopleTasteMatches) {
    await ctx.answerCb?.();
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    await deleteInlineCallbackMessage();
    const page = ["browse", "taste"].includes(String(ctx.user?.peopleLastListMode || ""))
      ? Number(ctx.user?.peopleLastListPage) || 0
      : 0;
    return sendPeopleDiscoveryList(ctx, lang, page);
  }

  if (data.startsWith(callBacks.peopleTasteMatchesConfirm)) {
    await ctx.answerCb?.();
    await deleteInlineCallbackMessage();
    return sendPeopleDiscoveryList(ctx, lang, 0);
  }

  if (data === callBacks.peopleTasteMatchesCancel) {
    await ctx.answerCb?.();
    await deleteInlineCallbackMessage();
    return sendPeopleHub(ctx, lang);
  }

  if (data === callBacks.peopleAdvancedSearch) {
    await ctx.answerCb?.();
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    await deleteInlineCallbackMessage();
    void trackEvent({
      name: EVENT_NAMES.advancedSearchPreviewViewed,
      userId: ctx.userId,
      source: "people_hub",
    });
    return ctx.reply(
      messages[lang].advancedSearchPreviewText,
      advancedSearchPreviewKeyboard(lang),
    );
  }

  if (data === callBacks.peopleAdvancedSearchNotify) {
    const requestedAt = ctx.user?.advancedSearchNotifyRequestedAt || new Date();
    if (!ctx.user?.advancedSearchNotifyRequestedAt) {
      await User.findOneAndUpdate(
        { userId: ctx.userId, advancedSearchNotifyRequestedAt: null },
        { $set: { advancedSearchNotifyRequestedAt: requestedAt } },
      );
      if (ctx.user) ctx.user.advancedSearchNotifyRequestedAt = requestedAt;
      void trackEvent({
        name: EVENT_NAMES.advancedSearchNotifyRequested,
        userId: ctx.userId,
        source: "advanced_search_preview",
      });
    }
    await ctx.answerCb?.(messages[lang].advancedSearchNotifyAck);
    return editCallbackMessageOrReply(
      ctx,
      `${messages[lang].advancedSearchPreviewText}\n\n${messages[lang].advancedSearchNotifyAck}`,
      advancedSearchPreviewKeyboard(lang, { notified: true }),
    );
  }

  if (data === callBacks.peopleAdvancedSearchBack) {
    await ctx.answerCb?.();
    return deleteInlineCallbackMessage();
  }

  if (data.startsWith(callBacks.peopleDiscoverPage)) {
    await ctx.answerCb?.();
    const pageRaw = data.replace(callBacks.peopleDiscoverPage, "");
    const page = Number(pageRaw);
    const discoveryPage = await buildPeopleDiscoveryPage(ctx, lang, page);
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      discoveryPage.text,
      discoveryPage.keyboard,
    );
    const navigationMode = discoveryPage.isEmpty
      ? "people_discovery_empty"
      : `people_discovery_results:${discoveryPage.page}:${discoveryPage.totalPages}`;
    await setNavigationMode(ctx, navigationMode);
    await rememberPeopleListMessage(ctx, ctx.callbackMessageId || listMessage, discoveryPage.page);
    return listMessage;
  }

  if (data.startsWith(callBacks.peopleTasteMatchesPage)) {
    await ctx.answerCb?.();
    const pageRaw = data.replace(callBacks.peopleTasteMatchesPage, "");
    const page = Number(pageRaw);
    const tastePage = await buildPeopleDiscoveryPage(ctx, lang, page);
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      tastePage.text,
      tastePage.keyboard,
    );
    const navigationMode = tastePage.isEmpty
      ? "people_discovery_empty"
      : `people_discovery_results:${tastePage.page}:${tastePage.totalPages}`;
    await setNavigationMode(ctx, navigationMode);
    await rememberPeopleListMessage(ctx, ctx.callbackMessageId || listMessage, tastePage.page);
    return listMessage;
  }

  if (data === callBacks.savedProfiles) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation?.(ctx, { clearKeyboard: false });
    await clearRememberedAiListMessage?.(ctx);
    if (isProfileCallbackMessage?.(ctx)) {
      const cleared = await clearViewedPublicProfile(ctx);
      if (!cleared) await deleteInlineCallbackMessage();
    } else {
      await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
      if (shouldClearKeyboard) {
        await deleteInlineCallbackMessage();
      }
    }
    if (!isProfileCallbackMessage?.(ctx) && !shouldClearKeyboard) {
      await deleteInlineCallbackMessage();
    }
    await forgetSavedProfilesList(ctx);
    await forgetPeopleListMessage(ctx);
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    if (shouldClearKeyboard) {
      await sendNavigationFootprint(ctx, { lang, destination: "savedProfiles", removeKeyboard: true });
    }
    return sendSavedProfilesList(ctx, lang, codes, 0, {
      send: null,
    });
  }

  if (data === "saved:back") {
    await ctx.answerCb?.();
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    await deleteInlineCallbackMessage();
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    return sendSavedProfilesList(ctx, lang, codes, 0);
  }

  if (data.startsWith(callBacks.savedProfilesPage)) {
    await ctx.answerCb?.();
    const pageRaw = data.replace(callBacks.savedProfilesPage, "");
    const page = Number(pageRaw);
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const paged = await buildSavedProfilePage(codes, page);
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      renderSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex }),
      savedProfilesListKeyboard(lang, {
        page: paged.page,
        totalPages: paged.totalPages,
      }),
    );
    const navigationMode = `saved_profiles:${paged.page}:${paged.totalPages}`;
    await setNavigationMode(ctx, navigationMode);
    await rememberSavedProfilesListMessage(ctx, ctx.callbackMessageId || listMessage);
    return listMessage;
  }

  if (data.startsWith(callBacks.savedProfilesOpen)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesOpen, "");
    await deleteInlineCallbackMessage();
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList: true });
  }

  if (data.startsWith(callBacks.savedProfilesDiscussions)) {
    await ctx.answerCb?.();
    const request = parseProfileDiscussionRequest(data.replace(callBacks.savedProfilesDiscussions, ""), ctx);
    await deleteInlineCallbackMessage();
    return renderSavedProfileDiscussions(ctx, lang, request.code, {
      source: request.source,
      peopleMode: request.peopleMode,
    });
  }

  if (data.startsWith(callBacks.savedProfilesRemove)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesRemove, "");
    return requestUnsaveProfileConfirmation(ctx, lang, code);
  }

  return false;
}

module.exports = {
  buildSavedProfilePage,
  clearSavedProfilesListMessage,
  clearPeopleListMessage,
  clearSavedProfileDiscussionMessage,
  clearSavedProfileSurfaceMessages,
  clearViewedPublicProfileMessage,
  forgetSavedProfilesListMessage,
  forgetPeopleListMessage,
  handleSavedProfilesCallback,
  isSavedProfilesCallback,
  normalizeProfileCodeFromActionCommand,
  formatSavedProfileRemovedMessage,
  formatSavedProfileSavedMessage,
  getPeopleListReturnPage,
  profileDiscussionBackKeyboard,
  parseProfileUnsaveConfirmMode,
  parsePublicProfileNavigationMode,
  requestUnsaveProfileConfirmation,
  savedProfileRemoveConfirmKeyboard,
  rememberSavedProfilesListMessage,
  renderSavedProfileDiscussions,
  saveProfileByCode,
  saveProfileCommand,
  sendPublicProfileByCode,
  sendPeopleDiscoveryList,
  sendPeopleHub,
  sendSavedProfilesList,
  unsaveProfileByCode,
  unsaveProfileCommand,
};
