const messages = require("../messages");
const path = require("node:path");
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
  profileRestrictionViewKeyboard,
  savedProfilesListKeyboard,
} = require("../keyboards");
const { callBacks } = require("../constants");
const {
  hasSectionTipBeenShown,
  markSectionTipShownForContext,
  updateProfileField,
  updateUserFields,
} = require("../services/users");
const { EVENT_NAMES, trackEvent } = require("../services/analytics-events");
const { sendBannerPhoto } = require("../services/banner-media");
const {
  buildProfileText,
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
  getPeopleDiscoveryMinSharedItems,
  paginatePeopleDiscovery,
} = require("../services/people-discovery");
const {
  buildPeopleHubText,
  buildPeopleDiscoveryText,
  formatPeopleDiscoveryRequirementText,
} = require("../services/people-discovery-ui");
const { sendNavigationFootprint } = require("../services/navigation-footprints");
const { setNavigationMode, setStableNavigationState } = require("../services/reply-keyboard-navigation");
const {
  parsePublicProfileNavigationMode,
  rememberPublicProfileReturnNavigationMode,
  restorePublicProfileReturnNavigationMode,
} = require("../services/public-profile-navigation");
const { hasPublicMediaFavorites } = require("../services/profile-sharing");
const {
  buildDiscussionListText,
  getDiscussionDisplayTitle,
} = require("../services/discussion-ui");
const {
  clearPeopleListMessage,
  clearSavedProfileDiscussionMessage,
  clearSavedProfileSurfaceMessages,
  clearSavedProfilesListMessage,
  clearViewedPublicProfileMessage,
  forgetPeopleListMessage,
  forgetSavedProfilesListMessage,
  rememberPeopleListMessage,
  rememberSavedProfilesListMessage,
  rememberViewedPublicProfileMessage,
} = require("./saved-profile-message-state");
const {
  buildProfileDiscussionReturnType,
  decorateProfileDiscussions,
  markCurrentProfileDiscussions,
  parseProfileDiscussionRequest,
  profileDiscussionBackKeyboard,
  profileDiscussionsInlineKeyboard,
} = require("../services/saved-profile-discussions-ui");
const { isSavedProfilesCallback } = require("./saved-profiles-routing");

const {
  findVisibleProfileDiscussionUserIds,
  hasVisibleProfileDiscussions,
} = require("../services/profile-discussions");

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

function savedProfilesLimitKeyboard(lang) {
  return inlineKeyboard([[
    { text: messages[lang].acknowledgeButton, callback_data: callBacks.savedProfilesLimitClose },
  ]]);
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
  hasFavorites = false,
  fromDiscussionMembers = false,
  source = "",
  sourcePage = 0,
} = {}) {
  return profilePublicActionsKeyboard(lang, code, {
    isSaved,
    hasDiscussions,
    hasFavorites,
    source: source || (fromDiscussionMembers ? "discussion_members" : fromSavedList ? "saved" : "people"),
    sourcePage,
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
  return inlineKeyboard([
    [{ text: messages[lang].savedProfileRemoveConfirmButton, callback_data: callBacks.profileUnsaveConfirm }],
    [{ text: messages[lang].savedProfileRemoveCancelButton, callback_data: callBacks.profileUnsaveCancel }],
  ]);
}

function parseProfileUnsaveConfirmMode(mode = "") {
  const match = String(mode).match(/^profile_unsave_confirm:(list|saved|people):(u_[A-Z0-9]+):(\d+)$/);
  return match ? { origin: match[1], code: match[2], page: Number(match[3]) || 0 } : null;
}

async function refreshSavedPublicProfileCard(ctx, lang, code, profileContext) {
  if (!profileContext || !["shared", "direct"].includes(profileContext.source)) return false;
  const target = await User.findOne({ publicProfileCode: normalizePublicProfileCode(code) });
  if (!target) return false;
  const keyboard = getPublicProfileActionKeyboard(lang, code, {
    isSaved: true,
    hasDiscussions: profileContext.hasDiscussions,
    hasFavorites: hasPublicMediaFavorites(target),
    source: profileContext.source,
    sourcePage: profileContext.page,
  });
  if (ctx.callbackMessageId && ctx.editMessageReplyMarkup) {
    const edited = await ctx.editMessageReplyMarkup(ctx.callbackMessageId, keyboard.reply_markup);
    if (edited) {
      await setNavigationMode(
        ctx,
        `public_profile:${profileContext.source}:${profileContext.code}:${profileContext.page}:saved:${profileContext.hasDiscussions ? 1 : 0}`,
      );
      return edited;
    }
  }
  return sendPublicProfileByCode(ctx, lang, code, {
    fromSharedLink: profileContext.source === "shared",
    editCurrent: true,
  });
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
  if (profileContext && ctx.callbackMessageId && ctx.editMessageReplyMarkup) {
    const edited = await ctx.editMessageReplyMarkup(
      ctx.callbackMessageId,
      savedProfileRemoveConfirmKeyboard(lang).reply_markup,
    );
    if (edited) return edited;
  }
  return ctx.reply(
    messages[lang].savedProfileRemoveConfirm.replace("{name}", name || normalizedCode),
    savedProfileRemoveConfirmKeyboard(lang),
  );
}

async function editProfileSurfaceCard(ctx, text, keyboard) {
  const messageId = Number(ctx.callbackMessageId);
  if (Number.isInteger(messageId) && messageId > 0) {
    const isMedia = Boolean(ctx.callbackMessage?.photo || ctx.callbackMessage?.document || ctx.callbackMessage?.caption);
    const edited = isMedia && ctx.editMessageCaption
      ? await ctx.editMessageCaption(messageId, text, keyboard)
      : ctx.editMessageText
        ? await ctx.editMessageText(messageId, text, keyboard)
        : false;
    if (edited) return { message_id: messageId };
    await ctx.deleteMessage?.(messageId);
  }
  return ctx.reply(text, keyboard);
}

async function sendSavedProfilesList(ctx, lang, codes = [], page = 0, { send = null } = {}) {
  await forgetPeopleListMessage(ctx);
  if (page === 0) await sendNavigationFootprint(ctx, { lang, destination: "savedProfiles" });
  const items = await buildSavedProfileListItems({
    codes,
    normalizePublicProfileCode,
    findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
      .select("userId publicProfileCode profileName firstName profileEmoji gender age activeDiscussionId showActiveDiscussionOnProfile")
      .lean(),
    findDiscussionUserIds: findVisibleProfileDiscussionUserIds,
  });
  const paged = paginateSavedProfiles(items, page);
  const text = buildSavedProfilesListText(messages, lang, paged.items, {
    startIndex: paged.startIndex,
    totalCount: items.length,
  });
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
  await setStableNavigationState(ctx, "people");
  await forgetSavedProfilesListMessage(ctx);
  await forgetPeopleListMessage(ctx);
  await sendNavigationFootprint(ctx, { lang, destination: "people", removeKeyboard });
  const showFirstVisitTip = !hasSectionTipBeenShown(ctx.user, "people");
  const text = buildPeopleHubText(messages, lang, { showFirstVisitTip });
  const keyboard = peopleHubKeyboard(lang);
  let sent;
  if (send) {
    sent = await send(text, keyboard);
  } else {
    try {
      sent = await sendBannerPhoto(ctx, {
        bannerKey: "people_section_v2",
        localSource: path.join(__dirname, "..", "..", "assets", "people-section-banner.jpg"),
        configuredFileId: process.env.PEOPLE_SECTION_BANNER_FILE_ID,
        extra: { ...keyboard, caption: text },
      });
    } catch {
      sent = await ctx.reply(text, keyboard);
    }
  }
  if (showFirstVisitTip) {
    await markSectionTipShownForContext(ctx, "people", new Date()).catch(() => null);
  }
  return sent;
}

async function buildPeopleDiscoveryPage(ctx, lang, page = 0) {
  const result = await findPeopleBySharedTaste(ctx.user || {});
  const minSharedItems = getPeopleDiscoveryMinSharedItems();
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
        totalCount: result.items.length,
        emptyText: formatPeopleDiscoveryRequirementText(
          messages[lang].peopleDiscoverNoMatches,
          lang,
          minSharedItems,
        ),
        showSharedSections: true,
      })
      : formatPeopleDiscoveryRequirementText(
        messages[lang].peopleDiscoverNeedsLists,
        lang,
        minSharedItems,
      ),
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

async function saveProfileByCode(ctx, lang, code, { fromDiscussionMembers = false, fromPeopleList = false, preserveProfileCard = false } = {}) {
  const currentNavigationMode = String(ctx.user?.navigationMode || "");
  const publicProfileContext = preserveProfileCard
    ? parsePublicProfileNavigationMode(currentNavigationMode)
    : null;
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
      if (publicProfileContext) {
        return refreshSavedPublicProfileCard(ctx, lang, code, publicProfileContext);
      }
      if (shouldRefreshProfileAfterSave(ctx)) {
        return sendPublicProfileByCode(ctx, lang, code, { fromPeopleList: fromPeopleList || hasPeopleSurfaceContext(ctx), fromDiscussionMembers });
      }
      return ctx.reply(messages[lang].savedProfileAlreadySaved);
    }
    if (saved.reason === "saved_profiles_limit") {
      return ctx.reply(formatOperationalLimitsText(messages[lang].savedProfilesLimit, {
        savedProfilesLimit: saved.cap,
      }), savedProfilesLimitKeyboard(lang));
    }
    return ctx.reply(messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", saved.items || []);
  if (ctx.user) ctx.user.savedProfileCodes = saved.items || [];
  if (fromDiscussionMembers) {
    const target = await User.findOne({ publicProfileCode: normalizePublicProfileCode(code) });
    const keyboard = getPublicProfileActionKeyboard(lang, code, {
      isSaved: true,
      fromDiscussionMembers: true,
      hasFavorites: hasPublicMediaFavorites(target),
    });
    if (ctx.callbackMessageId && ctx.editMessageReplyMarkup) {
      await ctx.editMessageReplyMarkup(ctx.callbackMessageId, keyboard.reply_markup);
    }
    return ctx.reply(formatSavedProfileSavedMessage(lang, savedProfileName));
  }
  if (publicProfileContext) {
    return refreshSavedPublicProfileCard(ctx, lang, code, publicProfileContext);
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

async function sendPublicProfileByCode(ctx, lang, rawCode, { fromSavedList = false, fromInvitationList = false, fromPeopleList = false, fromDiscussionMembers = false, fromRestrictionList = false, fromSharedLink = false, editCurrent = false } = {}) {
  const code = normalizePublicProfileCode(rawCode);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);
  const peopleReturnMode = ctx.user?.peopleLastListMode === "taste" ? "taste" : "browse";
  const fromPeopleSurface = !fromSharedLink && !fromSavedList && !fromInvitationList && !fromDiscussionMembers && !fromRestrictionList && (
    fromPeopleList || ["browse", "taste"].includes(String(ctx.user?.peopleLastListMode || ""))
  );
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
  const restrictionPage = Number(
    previousNavigationMode.match(/^profile_invitation_restrictions:(\d+):/)?.[1]
    || previousNavigationMode.match(/^public_profile:restrictions:(\d+)$/)?.[1]
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
  await rememberPublicProfileReturnNavigationMode(ctx, previousNavigationMode);

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
  const hasDiscussions = await hasVisibleProfileDiscussions(target);
  const hasFavorites = hasPublicMediaFavorites(target);
  const source = fromRestrictionList ? "restrictions"
    : fromInvitationList ? "invitations"
      : fromDiscussionMembers ? "discussion_members"
        : fromSavedList ? "saved"
          : fromSharedLink ? "shared"
            : fromPeopleSurface || fromPeopleList ? "people"
              : "direct";
  const sourcePage = source === "saved" ? savedPage
    : source === "people" ? peoplePage
      : source === "restrictions" ? restrictionPage
        : 0;
  const keyboard = fromRestrictionList
    ? profileRestrictionViewKeyboard(lang, { profileCode: code, hasFavorites, hasDiscussions, sourcePage })
    : fromInvitationList
    ? profileInvitationBackKeyboard(lang, target.userId, { profileCode: code, hasFavorites, hasDiscussions, sourcePage })
    : getPublicProfileActionKeyboard(lang, code, {
      fromSavedList,
      peopleReturnMode,
      isSaved: isSavedProfile,
      hasDiscussions,
      hasFavorites,
      fromDiscussionMembers,
      source,
      sourcePage,
    });

  await sendNavigationFootprint(ctx, {
    lang,
    destination: "publicProfile",
    title: target.profileName || target.firstName || "-",
  });

  const footerText = fromDiscussionMembers && isSavedProfile ? messages[lang].profileSavedButton : "";
  const result = editCurrent
    ? await editProfileSurfaceCard(ctx, [
      buildProfileText(target, lang, messages, { isOwnProfile: false }),
      footerText,
    ].filter(Boolean).join("\n\n"), keyboard)
    : await sendProfileMessage({
      ctx,
      user: target,
      lang,
      keyboard,
      messages,
      loadingText: messages[lang].profileLoading,
      isOwnProfile: false,
      footerText,
    });


  await rememberViewedPublicProfileMessage(ctx, result);
  const navigationMode = `public_profile:${source}:${code}:${sourcePage}:${isSavedProfile ? "saved" : "unsaved"}:${hasDiscussions ? 1 : 0}`;
  await setNavigationMode(ctx, navigationMode);
  return result;
}

async function renderSavedProfileDiscussions(ctx, lang, code, options = {}) {
  const profileCode = normalizePublicProfileCode(code);
  if (!profileCode) return ctx.reply(messages[lang].profileCodeNotFound);
  const returnType = buildProfileDiscussionReturnType(profileCode, options);
  const profileMode = String(ctx.user?.navigationMode || "");
  const source = ["saved", "people", "shared", "direct", "discussion_members", "invitations", "restrictions"].includes(options.source)
    ? options.source
    : "saved";
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
  const visibleDiscussions = [];
  let hasAny = false;

  if (target.showActiveDiscussionOnProfile && target.activeDiscussionId) {
    const activeDiscussion = await Discussion.findOne({
      _id: target.activeDiscussionId,
      status: "open",
    }).lean();
    if (activeDiscussion) {
      hasAny = true;
      const decorated = await decorateProfileDiscussions(ctx.user, [activeDiscussion]);
      visibleDiscussions.push(...decorated);
      discussionSections.push(buildDiscussionListText(
        messages,
        lang,
        messages[lang].savedProfileActiveDiscussionTitle,
        decorated,
        { includeActions: false },
      ));
    }
  }

  const createdDiscussions = target.showActiveDiscussionOnProfile
    ? await Discussion.find({
      creatorUserId: target.userId,
      status: "open",
      ...(target.activeDiscussionId ? { _id: { $ne: target.activeDiscussionId } } : {}),
    }).limit(10).lean()
    : [];

  if (createdDiscussions.length > 0) {
    hasAny = true;
    const decorated = await decorateProfileDiscussions(ctx.user, createdDiscussions);
    visibleDiscussions.push(...decorated);
    discussionSections.push(buildDiscussionListText(
      messages,
      lang,
      messages[lang].savedProfileCreatedDiscussionsTitle,
      decorated,
      { includeActions: false },
    ));
  }

  const text = hasAny
    ? buildProfileDiscussionSectionsText(titleText, discussionSections)
    : messages[lang].savedProfileNoDiscussions.replace("{name}", name);
  const keyboard = profileDiscussionsInlineKeyboard(lang, profileCode, visibleDiscussions.map((discussion) => ({
    ...discussion,
    displayTitle: getDiscussionDisplayTitle(messages, lang, discussion),
  })));
  const sent = await editProfileSurfaceCard(ctx, text, keyboard);
  const sentMessageId = getMessageId(sent) || null;
  if (ctx.user) {
    ctx.user.discussionLastListMessageId = sentMessageId;
    ctx.user.discussionLastListType = returnType;
    ctx.user.publicProfileLastMessageId = sentMessageId;
  }
  await updateUserFields(ctx.userId, {
    discussionLastListMessageId: sentMessageId,
    discussionLastListType: returnType,
    publicProfileLastMessageId: sentMessageId,
  });
  const navigationMode = `profile_discussions:${source}:${profileCode}:${sourcePage}`;
  await setNavigationMode(ctx, navigationMode);
  return sent;
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

  if (data === callBacks.peopleListClose) {
    await ctx.answerCb?.();
    return deleteInlineCallbackMessage();
  }

  if (data === callBacks.savedProfilesLimitClose) {
    await ctx.answerCb?.();
    await deleteInlineCallbackMessage();
    return true;
  }

  if (data === callBacks.profileDiscussionsClose) {
    await ctx.answerCb?.();
    await deleteInlineCallbackMessage();
    if (ctx.user) {
      ctx.user.publicProfileLastMessageId = null;
      ctx.user.discussionLastListMessageId = null;
      ctx.user.discussionLastListType = "";
    }
    await updateUserFields(ctx.userId, {
      publicProfileLastMessageId: null,
      discussionLastListMessageId: null,
      discussionLastListType: "",
    });
    await restorePublicProfileReturnNavigationMode(ctx);
    return true;
  }

  if (data.startsWith(callBacks.profileDiscussionsBack)) {
    await ctx.answerCb?.();
    const code = normalizePublicProfileCode(data.replace(callBacks.profileDiscussionsBack, ""));
    const modeMatch = String(ctx.user?.navigationMode || "").match(/^profile_discussions:(saved|people|shared|direct|discussion_members|invitations|restrictions):u_[A-Z0-9]+:(\d+)$/);
    if (!code || !modeMatch) return false;
    const source = modeMatch[1];
    if (ctx.user) {
      ctx.user.discussionLastListMessageId = null;
      ctx.user.discussionLastListType = "";
    }
    await updateUserFields(ctx.userId, {
      discussionLastListMessageId: null,
      discussionLastListType: "",
    });
    return sendPublicProfileByCode(ctx, lang, code, {
      fromSavedList: source === "saved",
      fromPeopleList: source === "people",
      fromSharedLink: source === "shared",
      fromDiscussionMembers: source === "discussion_members",
      fromInvitationList: source === "invitations",
      fromRestrictionList: source === "restrictions",
      editCurrent: true,
    });
  }

  if (data === callBacks.profileUnsaveConfirm || data === callBacks.profileUnsaveCancel) {
    await ctx.answerCb?.();
    const confirmation = parseProfileUnsaveConfirmMode(ctx.user?.navigationMode);
    if (!confirmation) return false;
    if (data === callBacks.profileUnsaveCancel) {
      if (confirmation.origin === "list") {
        await deleteInlineCallbackMessage();
        const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
        return sendSavedProfilesList(ctx, lang, codes, confirmation.page);
      }
      const target = await User.findOne({ publicProfileCode: confirmation.code });
      if (target && ctx.callbackMessageId && ctx.editMessageReplyMarkup) {
        const hasDiscussions = await hasVisibleProfileDiscussions(target);
        const keyboard = getPublicProfileActionKeyboard(lang, confirmation.code, {
          fromSavedList: confirmation.origin === "saved",
          isSaved: true,
          hasDiscussions,
          hasFavorites: hasPublicMediaFavorites(target),
          source: confirmation.origin,
          sourcePage: confirmation.page,
        });
        const restored = await ctx.editMessageReplyMarkup(ctx.callbackMessageId, keyboard.reply_markup);
        if (restored) {
          await setNavigationMode(
            ctx,
            `public_profile:${confirmation.origin}:${confirmation.code}:${confirmation.page}:saved:${hasDiscussions ? 1 : 0}`,
          );
          return restored;
        }
      }
      await deleteInlineCallbackMessage();
      return sendPublicProfileByCode(ctx, lang, confirmation.code, {
        fromSavedList: confirmation.origin === "saved",
        fromPeopleList: confirmation.origin === "people",
      });
    }
    await deleteInlineCallbackMessage();
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
    const profileContext = parsePublicProfileNavigationMode(ctx.user?.navigationMode);
    if (profileContext?.source === "people") {
      await clearViewedPublicProfile(ctx);
      return sendPeopleDiscoveryList(ctx, lang, page);
    }
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
    const profileContext = parsePublicProfileNavigationMode(ctx.user?.navigationMode);
    if (profileContext?.source === "saved") {
      await clearViewedPublicProfile(ctx);
      return sendSavedProfilesList(ctx, lang, codes, page);
    }
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
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList: true });
  }

  if (data.startsWith(callBacks.savedProfilesDiscussions)) {
    await ctx.answerCb?.();
    const request = parseProfileDiscussionRequest(data.replace(callBacks.savedProfilesDiscussions, ""), ctx);
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
  markCurrentProfileDiscussions,
  formatSavedProfileRemovedMessage,
  formatSavedProfileSavedMessage,
  getPeopleListReturnPage,
  profileDiscussionBackKeyboard,
  profileDiscussionsInlineKeyboard,
  parseProfileUnsaveConfirmMode,
  requestUnsaveProfileConfirmation,
  savedProfileRemoveConfirmKeyboard,
  rememberSavedProfilesListMessage,
  renderSavedProfileDiscussions,
  saveProfileByCode,
  saveProfileCommand,
  savedProfilesLimitKeyboard,
  sendPublicProfileByCode,
  sendPeopleDiscoveryList,
  sendPeopleHub,
  sendSavedProfilesList,
  unsaveProfileByCode,
  unsaveProfileCommand,
};
