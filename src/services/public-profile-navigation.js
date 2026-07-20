const { MODES, setNavigationMode } = require("./reply-keyboard-navigation");
const { updateProfileField } = require("./users");

const PUBLIC_PROFILE_SOURCES = "saved|people|shared|direct|discussion_members|invitations|restrictions";
const PUBLIC_PROFILE_MODE_PATTERN = new RegExp(
  `^public_profile:(${PUBLIC_PROFILE_SOURCES}):(u_[A-Z0-9]+):(\\d+):(saved|unsaved):(0|1)$`,
);

function parsePublicProfileNavigationMode(mode = "") {
  const match = String(mode).match(PUBLIC_PROFILE_MODE_PATTERN);
  return match ? {
    source: match[1],
    code: match[2],
    page: Number(match[3]) || 0,
    isSaved: match[4] === "saved",
    hasDiscussions: match[5] === "1",
  } : null;
}

function isPublicProfileSurfaceNavigationMode(mode = "") {
  return /^(?:public_profile:|profile_favorites:|profile_discussions:|profile_unsave_confirm:)/.test(String(mode));
}

function canPersistNavigationState(ctx) {
  return Boolean(ctx?.user?._id || ctx?.persistNavigationMode);
}

async function rememberPublicProfileReturnNavigationMode(ctx, mode = "") {
  const currentMode = String(mode || MODES.GLOBAL);
  if (isPublicProfileSurfaceNavigationMode(currentMode)) {
    return String(ctx.user?.publicProfileReturnNavigationMode || "");
  }
  if (ctx.user) ctx.user.publicProfileReturnNavigationMode = currentMode;
  if (canPersistNavigationState(ctx)) {
    await updateProfileField(ctx.userId, "publicProfileReturnNavigationMode", currentMode);
  }
  return currentMode;
}

function getPublicProfileReturnFallback(mode = "") {
  const currentMode = String(mode || "");
  const source = currentMode.match(/^public_profile:([^:]+)/)?.[1]
    || currentMode.match(/^profile_favorites:([^:]+)/)?.[1]
    || currentMode.match(/^profile_discussions:([^:]+)/)?.[1]
    || "";
  if (["saved", "people"].includes(source)) return MODES.PEOPLE;
  if (["invitations", "discussion_members"].includes(source)) return MODES.DISCUSSIONS;
  if (source === "restrictions") return MODES.PROFILE_PRIVACY;
  return MODES.GLOBAL;
}

async function restorePublicProfileReturnNavigationMode(ctx) {
  const fallbackMode = getPublicProfileReturnFallback(ctx.user?.navigationMode);
  const returnMode = String(ctx.user?.publicProfileReturnNavigationMode || fallbackMode);
  if (ctx.user) ctx.user.publicProfileReturnNavigationMode = "";
  if (canPersistNavigationState(ctx)) {
    await updateProfileField(ctx.userId, "publicProfileReturnNavigationMode", "");
  }
  await setNavigationMode(ctx, returnMode);
  return returnMode;
}

module.exports = {
  PUBLIC_PROFILE_SOURCES,
  getPublicProfileReturnFallback,
  isPublicProfileSurfaceNavigationMode,
  parsePublicProfileNavigationMode,
  rememberPublicProfileReturnNavigationMode,
  restorePublicProfileReturnNavigationMode,
};
