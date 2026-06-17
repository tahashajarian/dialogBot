const path = require("path");
const messages = require("../messages");
const User = require("../models/user");
const Discussion = require("../models/discussion");
const {
  inlineKeyboard,
  profileViewBackKeyboard,
  savedProfilesListKeyboard,
} = require("../keyboards");
const { callBacks } = require("../constants");
const { updateProfileField } = require("../services/users");
const {
  sendProfileMessage,
} = require("../services/profile");
const {
  addSavedProfileCode,
  removeSavedProfileCode,
  normalizePublicProfileCode,
} = require("../services/discussions");
const {
  isCodeSaved,
  buildSavedProfileListItems,
  paginateSavedProfiles,
  buildSavedProfilesListText,
  buildProfileSavedFooter,
} = require("../services/saved-profiles-ui");
const {
  decorateDiscussionsForList,
  buildDiscussionListText,
} = require("../services/discussion-ui");

const DEFAULT_PROFILE_PHOTO = path.join(__dirname, "..", "..", "assets", "default_profile.png");

function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function canPersistUserMessageState(ctx) {
  return Boolean(ctx.user && typeof ctx.user.toObject === "function");
}

function normalizeProfileCodeFromActionCommand(value) {
  const raw = String(value || "").trim().replace(/^\/?(remove|report|save|unsave)_/i, "");
  return normalizePublicProfileCode(raw.startsWith("u_") ? raw : `u_${raw}`);
}

async function rememberSavedProfilesListMessage(ctx, messageOrId) {
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
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || !ctx.deleteMessage) return false;
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    if (ctx.user) ctx.user.savedProfilesLastListMessageId = null;
    if (canPersistUserMessageState(ctx)) {
      await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
    }
  }
  return deleted;
}

async function forgetSavedProfilesListMessage(ctx) {
  if (ctx.user?.savedProfilesLastListMessageId) {
    ctx.user.savedProfilesLastListMessageId = null;
    if (canPersistUserMessageState(ctx)) {
      await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
    }
  }
}

async function clearViewedPublicProfileMessage(ctx, exceptMessageIds = []) {
  const keep = new Set((exceptMessageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const messageId = Number(ctx.user?.publicProfileLastMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0 || keep.has(messageId) || !ctx.deleteMessage) return false;
  const deleted = await ctx.deleteMessage(messageId);
  if (deleted) {
    if (ctx.user) ctx.user.publicProfileLastMessageId = null;
    if (canPersistUserMessageState(ctx)) {
      await updateProfileField(ctx.userId, "publicProfileLastMessageId", null);
    }
  }
  return deleted;
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
  const items = await buildSavedProfileListItems({
    codes,
    normalizePublicProfileCode,
    findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
      .select("publicProfileCode profileName firstName")
      .lean(),
  });
  const paged = paginateSavedProfiles(items, page);
  const text = buildSavedProfilesListText(messages, lang, paged.items, { startIndex: paged.startIndex });
  const keyboard = savedProfilesListKeyboard(lang, {
    page: paged.page,
    totalPages: paged.totalPages,
  });
  const sent = send ? await send(text, keyboard) : await ctx.reply(text, keyboard);
  await rememberSavedProfilesListMessage(ctx, sent);
  return sent;
}

async function buildSavedProfilePage(codes = [], page = 0) {
  const items = await buildSavedProfileListItems({
    codes,
    normalizePublicProfileCode,
    findUsersByCodes: (normalizedCodes) => User.find({ publicProfileCode: { $in: normalizedCodes } })
      .select("publicProfileCode profileName firstName")
      .lean(),
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
    if (saved.reason === "exists") return ctx.reply(messages[lang].savedProfileAlreadySaved);
    if (saved.reason === "saved_profiles_limit") return ctx.reply(messages[lang].savedProfilesLimit);
    return ctx.reply(messages[lang].unknownAction);
  }
  await updateProfileField(ctx.userId, "savedProfileCodes", saved.items || []);
  if (ctx.user) ctx.user.savedProfileCodes = saved.items || [];
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
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList: true });
  }
  if (!returnToList) {
    return true;
  }
  return sendSavedProfilesList(ctx, lang, removed.items || []);
}

async function sendPublicProfileByCode(ctx, lang, rawCode, { fromSavedList = false } = {}) {
  const code = normalizePublicProfileCode(rawCode);
  if (!code) return ctx.reply(messages[lang].profileCodeNotFound);

  await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);

  const target = await User.findOne({ publicProfileCode: code });
  if (!target) return ctx.reply(messages[lang].profileCodeNotFound);

  let footerText = "";
  if (!fromSavedList && ctx.user?.activeDiscussionId) {
    const current = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    const saved = isCodeSaved(current, code);
    footerText = buildProfileSavedFooter(messages, lang, code, saved);
  }

  const result = await sendProfileMessage({
    ctx,
    user: target,
    lang,
    keyboard: fromSavedList ? profileViewBackKeyboard(lang) : undefined,
    messages,
    defaultProfilePhoto: DEFAULT_PROFILE_PHOTO,
    loadingText: messages[lang].profileLoading,
    isOwnProfile: false,
    footerText,
  });

  await rememberViewedPublicProfileMessage(ctx, result);
  return result;
}

async function renderSavedProfileDiscussions(ctx, lang, code) {
  await clearViewedPublicProfileMessage(ctx, [ctx.callbackMessageId]);

  const profileCode = normalizePublicProfileCode(code);
  if (!profileCode) return ctx.reply(messages[lang].profileCodeNotFound);

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
  }).limit(10).lean();

  if (createdDiscussions.length > 0) {
    hasAny = true;
    const decorated = await decorateDiscussionsForList(ctx.user, createdDiscussions);
    textParts.push(buildDiscussionListText(messages, lang, messages[lang].savedProfileCreatedDiscussionsTitle, decorated));
  }

  if (!hasAny) {
    const noDiscussionsText = messages[lang].savedProfileNoDiscussions.replace("{name}", name);
    const keyboard = inlineKeyboard([[{ text: messages[lang].acknowledgeButton, callback_data: "saved:back" }]]);
    const sentEmpty = await ctx.reply(noDiscussionsText, keyboard);
    await updateProfileField(ctx.userId, "discussionLastListMessageId", getMessageId(sentEmpty) || null);
    await updateProfileField(ctx.userId, "discussionLastListType", `saved:${profileCode}`);
    return sentEmpty;
  }

  const keyboard = inlineKeyboard([[{ text: messages[lang].profileBackToSaved, callback_data: callBacks.savedProfiles }]]);
  const sent = await ctx.reply(textParts.join("\n"), keyboard);
  await updateProfileField(ctx.userId, "discussionLastListMessageId", getMessageId(sent) || null);
  await updateProfileField(ctx.userId, "discussionLastListType", `saved:${profileCode}`);
  return sent;
}

function isSavedProfilesCallback(data = "") {
  return data === callBacks.savedProfiles ||
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
  leaveDiscussionAndClearKeyboardForNavigation,
  replyWithRemovedKeyboardThenInline,
} = {}) {
  const data = ctx.callbackData || "";

  if (data === callBacks.savedProfiles) {
    await ctx.answerCb?.();
    await leaveDiscussionAndClearKeyboardForNavigation?.(ctx);
    await clearRememberedAiListMessage?.(ctx);
    if (isProfileCallbackMessage?.(ctx)) {
      const cleared = await clearViewedPublicProfile(ctx);
      if (!cleared) await deleteCallbackMessageIfPossible?.(ctx);
    } else {
      await clearViewedPublicProfile(ctx, [ctx.callbackMessageId]);
      await deleteCallbackMessageIfPossible?.(ctx);
    }
    await forgetSavedProfilesList(ctx);
    const codes = Array.isArray(ctx.user?.savedProfileCodes) ? ctx.user.savedProfileCodes : [];
    return sendSavedProfilesList(ctx, lang, codes, 0, {
      send: isProfileCallbackMessage?.(ctx)
        ? null
        : replyWithRemovedKeyboardThenInline
          ? (text, keyboard) => replyWithRemovedKeyboardThenInline(ctx, text, keyboard)
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
    await updateProfileField(ctx.userId, "savedProfilesLastListMessageId", null);
    return sendPublicProfileByCode(ctx, lang, code, { fromSavedList: true });
  }

  if (data.startsWith(callBacks.savedProfilesDiscussions)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.savedProfilesDiscussions, "");
    return renderSavedProfileDiscussions(ctx, lang, code);
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
  clearViewedPublicProfileMessage,
  forgetSavedProfilesListMessage,
  handleSavedProfilesCallback,
  isSavedProfilesCallback,
  normalizeProfileCodeFromActionCommand,
  rememberSavedProfilesListMessage,
  renderSavedProfileDiscussions,
  saveProfileByCode,
  saveProfileCommand,
  sendPublicProfileByCode,
  sendSavedProfilesList,
  unsaveProfileByCode,
  unsaveProfileCommand,
};
