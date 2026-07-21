const { callBacks } = require("../constants");
const { updateProfileField, updateUserFields } = require("../services/users");
const {
  parsePublicProfileNavigationMode,
  restorePublicProfileReturnNavigationMode,
} = require("../services/public-profile-navigation");
const { clearDiscussionMembersMessage } = require("./discussions-callbacks");
const {
  requestUnsaveProfileConfirmation,
  saveProfileByCode,
  sendPublicProfileByCode,
} = require("./saved-profiles");

function isPublicProfileCallback(data = "") {
  const value = String(data || "");
  return value.startsWith(callBacks.profileViewByCode)
    || value.startsWith(callBacks.profileSaveByCode)
    || value.startsWith(callBacks.profileUnsaveByCode)
    || value === callBacks.profileCloseDiscussionMember;
}

function getPublicProfileReturnContext(ctx) {
  const [source = "", mode = ""] = String(ctx.user?.discussionLastListType || "").split(":");
  if (source === "saved") {
    return { fromSavedList: true, fromPeopleList: false, fromProfileDiscussion: true };
  }
  if (source === "people") {
    const peopleMode = mode === "taste" ? "taste" : "browse";
    if (ctx.user) ctx.user.peopleLastListMode = peopleMode;
    return { fromSavedList: false, fromPeopleList: true, fromProfileDiscussion: true };
  }
  return { fromSavedList: false, fromPeopleList: false, fromProfileDiscussion: false };
}

async function handlePublicProfileCallback(ctx, lang, { deleteCallbackMessageIfPossible }) {
  const data = ctx.callbackData || "";

  if (data.startsWith(callBacks.profileViewByCode)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.profileViewByCode, "");
    const returnContext = getPublicProfileReturnContext(ctx);
    await deleteCallbackMessageIfPossible(ctx);
    if (returnContext.fromProfileDiscussion) {
      if (ctx.user) {
        ctx.user.discussionLastListMessageId = null;
        ctx.user.discussionLastListType = "";
      }
      await updateUserFields(ctx.userId, {
        discussionLastListMessageId: null,
        discussionLastListType: "",
      });
    }
    await clearDiscussionMembersMessage(ctx);
    return sendPublicProfileByCode(ctx, lang, code, returnContext);
  }

  if (data.startsWith(callBacks.profileSaveByCode)) {
    const raw = data.replace(callBacks.profileSaveByCode, "");
    const fromDiscussionMembers = raw.endsWith(":members");
    const code = raw.replace(/:members$/, "");
    const publicProfileContext = parsePublicProfileNavigationMode(ctx.user?.navigationMode);
    const preserveProfileCard = ["shared", "direct"].includes(publicProfileContext?.source);
    if (!fromDiscussionMembers && !preserveProfileCard && !ctx.isReplyKeyboardAction) {
      await deleteCallbackMessageIfPossible(ctx);
    }
    await ctx.answerCb?.();
    const fromPeopleList = String(ctx.user?.navigationMode || "").startsWith("public_profile:people:");
    return saveProfileByCode(ctx, lang, code, {
      fromDiscussionMembers,
      fromPeopleList,
      preserveProfileCard,
    });
  }

  if (data.startsWith(callBacks.profileUnsaveByCode)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.profileUnsaveByCode, "");
    return requestUnsaveProfileConfirmation(ctx, lang, code);
  }

  if (data === callBacks.profileCloseDiscussionMember) {
    await ctx.answerCb?.();
    if (!ctx.isReplyKeyboardAction) await deleteCallbackMessageIfPossible(ctx);
    await updateProfileField(ctx.userId, "publicProfileLastMessageId", null);
    if (ctx.user) ctx.user.publicProfileLastMessageId = null;
    await restorePublicProfileReturnNavigationMode(ctx);
    return true;
  }

  return null;
}

module.exports = {
  getPublicProfileReturnContext,
  handlePublicProfileCallback,
  isPublicProfileCallback,
};
