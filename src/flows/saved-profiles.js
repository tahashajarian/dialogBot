const messages = require("../messages");
const User = require("../models/user");
const Discussion = require("../models/discussion");
const { formatOperationalLimitsText } = require("../services/operational-limits-ui");
const {
  inlineKeyboard,
  advancedSearchPreviewKeyboard,
  peopleDiscoverListKeyboard,
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
} = {}) {
  return profilePublicActionsKeyboard(lang, code, {
    isSaved,
    hasDiscussions,
    source: fromSavedList ? "saved" : "people",
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

function profileDiscussionBackKeyboard(lang, profileCode) {
  return inlineKeyboard([[
    {
      text: messages[lang].aiBack,
      callback_data: `${callBacks.profileViewByCode}${profileCode}`,
    },
  ]]);
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
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || (!ctx.deleteMessage && !ctx.editMessageText)) return false;
  const deleted = ctx.deleteMessage ? await ctx.deleteMessage(messageId) : false;
  const edited = !deleted && ctx.editMessageText
    ? await ctx.editMessageText(messageId, " ", { reply_markup: { inline_keyboard: [] } })
    : false;
  if (edited || deleted) {
    if (ctx.user) ctx.user.savedProfilesLastListMessageId = null;
    if (canPersistUserMessageState(ctx)) {
      await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
    }
  }
  return Boolean(edited || deleted);
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
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || (!ctx.deleteMessage && !ctx.editMessageText)) return false;
  const deleted = ctx.deleteMessage ? await ctx.deleteMessage(messageId) : false;
  const edited = !deleted && ctx.editMessageText
    ? await ctx.editMessageText(messageId, " ", { reply_markup: { inline_keyboard: [] } })
    : false;
  if (edited || deleted) {
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
  return Boolean(edited || deleted);
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
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || (!ctx.deleteMessage && !ctx.editMessageReplyMarkup)) return false;
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
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || (!ctx.deleteMessage && !ctx.editMessageReplyMarkup)) return false;
  const deleted = ctx.deleteMessage ? await ctx.deleteMessage(messageId) : false;
  const retired = deleted || (
    ctx.editMessageReplyMarkup
      ? await ctx.editMessageReplyMarkup(messageId, { inline_keyboard: [] })
      : false
  );
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
  return retired;
}

async function clearSavedProfileSurfaceMessages(ctx, exceptMessageIds = []) {
  await clearSavedProfilesListMessage(ctx, exceptMessageIds);
  await clearPeopleListMessage(ctx, exceptMessageIds);
  await clearViewedPublicProfileMessage(ctx, exceptMessageIds);
  await clearSavedProfileDiscussionMessage(ctx, exceptMessageIds);
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

async function sendPeopleHub(ctx, lang, { send = null } = {}) {
  await forgetSavedProfilesListMessage(ctx);
  await forgetPeopleListMessage(ctx);
  const sent = send
    ? await send(messages[lang].peopleMenu, peopleHubKeyboard(lang))
    : await ctx.reply(messages[lang].peopleMenu, peopleHubKeyboard(lang));
  return sent;
}

async function buildPeopleDiscoveryPage(ctx, lang, page = 0) {
  const result = await findPeopleBySharedTaste(ctx.user || {});
  const paged = paginatePeopleDiscovery(result.items || [], page);
  const pageItems = await ensurePeopleDiscoveryCodes(paged.items);
  return {
    page: paged.page,
    text: result.ok
      ? buildPeopleDiscoveryText(messages, lang, pageItems, {
        startIndex: paged.startIndex,
        emptyText: messages[lang].peopleDiscoverNoMatches,
        showSharedSections: true,
      })
      : messages[lang].peopleDiscoverNeedsLists,
    keyboard: peopleDiscoverListKeyboard(lang, {
      page: paged.page,
      totalPages: paged.totalPages,
      showLists: !result.ok || pageItems.length === 0,
    }),
  };
}

async function sendPeopleDiscoveryList(ctx, lang, page = 0, { send = null } = {}) {
  await forgetSavedProfilesListMessage(ctx);
  const discoveryPage = await buildPeopleDiscoveryPage(ctx, lang, page);
  const sent = send
    ? await send(discoveryPage.text, discoveryPage.keyboard)
    : await ctx.reply(discoveryPage.text, discoveryPage.keyboard);
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

async function saveProfileByCode(ctx, lang, code) {
  const saved = await addSavedProfileCode(ctx.userId, code);
  if (!saved.ok) {
    if (saved.reason === "exists") {
      if (shouldRefreshProfileAfterSave(ctx)) {
        return sendPublicProfileByCode(ctx, lang, code, { fromPeopleList: hasPeopleSurfaceContext(ctx) });
      }
      return ctx.reply(messages[lang].savedProfileAlreadySaved);
    }
    if (saved.reason === "saved_profiles_limit") return ctx.reply(formatOperationalLimitsText(messages[lang].savedProfilesLimit));
    return ctx.reply(messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", saved.items || []);
  if (ctx.user) ctx.user.savedProfileCodes = saved.items || [];
  if (shouldRefreshProfileAfterSave(ctx)) {
    return sendPublicProfileByCode(ctx, lang, code, { fromPeopleList: hasPeopleSurfaceContext(ctx) });
  }
  await clearViewedPublicProfileMessage(ctx);
  return ctx.reply(messages[lang].savedProfileSaved);
}

async function unsaveProfileCommand(ctx, lang, text) {
  const code = normalizeProfileCodeFromActionCommand(text);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  return unsaveProfileByCode(ctx, lang, code, { returnToList: true });
}

async function unsaveProfileByCode(ctx, lang, code, { returnToList = false, refreshProfile = false, notify = true } = {}) {
  const removed = await removeSavedProfileCode(ctx.userId, code);
  if (!removed.ok) {
    return ctx.reply(removed.reason === "not_found" ? messages[lang].savedProfilesEmpty : messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", removed.items || []);
  if (ctx.user) ctx.user.savedProfileCodes = removed.items || [];
  await clearSavedProfilesListMessage(ctx);
  await clearViewedPublicProfileMessage(ctx);
  if (notify) {
    await ctx.reply(messages[lang].savedProfileRemoved);
  }
  if (refreshProfile) {
    return sendPublicProfileByCode(ctx, lang, code, {
      fromPeopleList: hasPeopleSurfaceContext(ctx),
      fromSavedList: !hasPeopleSurfaceContext(ctx),
    });
  }
  if (!returnToList) {
    return true;
  }
  return sendSavedProfilesList(ctx, lang, removed.items || []);
}

async function sendPublicProfileByCode(ctx, lang, rawCode, { fromSavedList = false, fromInvitationList = false, fromPeopleList = false } = {}) {
  const code = normalizePublicProfileCode(rawCode);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  const peopleReturnMode = ctx.user?.peopleLastListMode === "taste" ? "taste" : "browse";
  const fromPeopleSurface = fromPeopleList || ["browse", "taste"].includes(String(ctx.user?.peopleLastListMode || ""));

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
  const isSavedProfile = fromSavedList || isCodeSaved(currentSavedCodes, code);
  const hasDiscussions = isSavedProfile ? await hasVisibleProfileDiscussions(target) : false;
  const keyboard = fromInvitationList
    ? profileInvitationBackKeyboard(lang, target.userId)
    : getPublicProfileActionKeyboard(lang, code, {
      fromSavedList,
      peopleReturnMode,
      isSaved: isSavedProfile,
      hasDiscussions,
    });

  const result = await sendProfileMessage({
    ctx,
    user: target,
    lang,
    keyboard,
    messages,
    loadingText: messages[lang].profileLoading,
    isOwnProfile: false,
    footerText: "",
  });

  await rememberViewedPublicProfileMessage(ctx, result);
  return result;
}

async function renderSavedProfileDiscussions(ctx, lang, code, options = {}) {
  const profileCode = normalizePublicProfileCode(code);
  if (!profileCode) return ctx.reply(messages[lang].profileCodeNotFound);
  const returnType = buildProfileDiscussionReturnType(profileCode, options);

  await clearSavedProfileSurfaceMessages(ctx, [ctx.callbackMessageId]);

  const target = await User.findOne({ publicProfileCode: profileCode });
  if (!target) return ctx.reply(messages[lang].profileCodeNotFound);

  const name = target.profileName || target.firstName || "کاربر";
  const titleText = messages[lang].savedProfileDiscussionsTitle.replace("{name}", name);

  const textParts = [titleText, ""];
  let hasAny = false;

  if (target.activeDiscussionId && target.showActiveDiscussionOnProfile) {
    const activeDiscussion = await Discussion.findOne({
      _id: target.activeDiscussionId,
      status: "open",
    }).lean();
    if (activeDiscussion) {
      hasAny = true;
      const decorated = await decorateDiscussionsForList(ctx.user, [activeDiscussion]);
      textParts.push(buildDiscussionListText(messages, lang, messages[lang].savedProfileActiveDiscussionTitle, decorated));
      textParts.push("");
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
    textParts.push(buildDiscussionListText(messages, lang, messages[lang].savedProfileCreatedDiscussionsTitle, decorated));
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
    return sentEmpty;
  }

  const keyboard = profileDiscussionBackKeyboard(lang, profileCode);
  const sent = await ctx.reply(textParts.join("\n"), keyboard);
  if (ctx.user) {
    ctx.user.discussionLastListMessageId = getMessageId(sent) || null;
    ctx.user.discussionLastListType = returnType;
  }
  await updateUserFields(ctx.userId, {
    discussionLastListMessageId: getMessageId(sent) || null,
    discussionLastListType: returnType,
  });
  return sent;
}

function isSavedProfilesCallback(data = "") {
  return isPeopleCallback(data) ||
    data === callBacks.savedProfiles ||
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
  replyWithRemovedKeyboardThenInline,
} = {}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.people) {
    await ctx.answerCb?.();
    const shouldClearKeyboard = hasTemporaryReplyKeyboard(ctx);
    await leaveDiscussionAndClearKeyboardForNavigation?.(ctx, { clearKeyboard: false });
    await clearRememberedAiListMessage?.(ctx);
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    if (shouldClearKeyboard) {
      await deleteCallbackMessageIfPossible?.(ctx);
    }
    return sendPeopleHub(ctx, lang, {
      send: shouldClearKeyboard && replyWithRemovedKeyboardThenInline
        ? (text, keyboard) => replyWithRemovedKeyboardThenInline(ctx, text, keyboard)
        : editCallbackMessageOrReply
          ? (text, keyboard) => editCallbackMessageOrReply(ctx, text, keyboard)
        : null,
    });
  }

  if (data === callBacks.peopleDiscover) {
    await ctx.answerCb?.();
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible?.(ctx);
    const page = ctx.user?.peopleLastListMode === "browse" ? Number(ctx.user?.peopleLastListPage) || 0 : 0;
    return sendPeopleDiscoveryList(ctx, lang, page);
  }

  if (data === callBacks.peopleTasteMatches) {
    await ctx.answerCb?.();
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible?.(ctx);
    const page = ["browse", "taste"].includes(String(ctx.user?.peopleLastListMode || ""))
      ? Number(ctx.user?.peopleLastListPage) || 0
      : 0;
    return sendPeopleDiscoveryList(ctx, lang, page);
  }

  if (data.startsWith(callBacks.peopleTasteMatchesConfirm)) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible?.(ctx);
    return sendPeopleDiscoveryList(ctx, lang, 0);
  }

  if (data === callBacks.peopleTasteMatchesCancel) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible?.(ctx);
    return sendPeopleHub(ctx, lang);
  }

  if (data === callBacks.peopleAdvancedSearch) {
    await ctx.answerCb?.();
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible?.(ctx);
    void trackEvent({
      name: EVENT_NAMES.advancedSearchPreviewViewed,
      userId: ctx.userId,
      source: "people_hub",
    });
    return ctx.reply(
      messages[lang].advancedSearchPreviewText,
      advancedSearchPreviewKeyboard(lang, {
        notified: Boolean(ctx.user?.advancedSearchNotifyRequestedAt),
      }),
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
    await deleteCallbackMessageIfPossible?.(ctx);
    return sendPeopleHub(ctx, lang);
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
      if (!cleared) await deleteCallbackMessageIfPossible?.(ctx);
    } else {
      await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
      if (shouldClearKeyboard) {
        await deleteCallbackMessageIfPossible?.(ctx);
      }
    }
    await forgetSavedProfilesList(ctx);
    await forgetPeopleListMessage(ctx);
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    return sendSavedProfilesList(ctx, lang, codes, 0, {
      send: isProfileCallbackMessage?.(ctx)
        ? null
        : shouldClearKeyboard && replyWithRemovedKeyboardThenInline
          ? (text, keyboard) => replyWithRemovedKeyboardThenInline(ctx, text, keyboard)
          : editCallbackMessageOrReply
            ? (text, keyboard) => editCallbackMessageOrReply(ctx, text, keyboard)
          : null,
    });
  }

  if (data === "saved:back") {
    await ctx.answerCb?.();
    await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
    await deleteCallbackMessageIfPossible?.(ctx);
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
    await rememberSavedProfilesListMessage(ctx, ctx.callbackMessageId || listMessage);
    return listMessage;
  }

  if (data.startsWith(callBacks.savedProfilesOpen)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesOpen, "");
    await deleteCallbackMessageIfPossible?.(ctx);
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList: true });
  }

  if (data.startsWith(callBacks.savedProfilesDiscussions)) {
    await ctx.answerCb?.();
    const request = parseProfileDiscussionRequest(data.replace(callBacks.savedProfilesDiscussions, ""), ctx);
    await deleteCallbackMessageIfPossible?.(ctx);
    return renderSavedProfileDiscussions(ctx, lang, request.code, {
      source: request.source,
      peopleMode: request.peopleMode,
    });
  }

  if (data.startsWith(callBacks.savedProfilesRemove)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesRemove, "");
    const removed = await unsaveProfileByCode(ctx, lang, code, { notify: false });
    if (removed !== true) return removed;
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const paged = await buildSavedProfilePage(codes, 0);
    const listMessage = await editCallbackMessageOrReply(
      ctx,
      paged.items.length
        ? `${messages[lang].savedProfileRemoved}\n\n${renderSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex })}`
        : messages[lang].savedProfileRemoved,
      savedProfilesListKeyboard(lang, {
        page: paged.page,
        totalPages: paged.totalPages,
      }),
    );
    await rememberSavedProfilesListMessage(ctx, ctx.callbackMessageId || listMessage);
    return listMessage;
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
