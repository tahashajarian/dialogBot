const path = require("node:path");
const messages = require("../messages");
const { profileQuickActionsKeyboard, profileShareGuidanceKeyboard } = require("../keyboards");
const { sendBannerPhoto } = require("../services/banner-media");
const { buildBotStartLink } = require("../services/invite-links");
const { ensurePublicProfileCode } = require("../services/public-codes");
const {
  buildProfileShareGuidance,
  buildShareableProfileCaption,
  hasCompletedMediaFavorites,
} = require("../services/profile-sharing");
const { buildProfileText } = require("../services/profile");
const { createReferralLink } = require("../services/star-referrals");
const { MODES, setNavigationMode } = require("../services/reply-keyboard-navigation");

const SHARED_PROFILE_BANNER_PATH = path.join(__dirname, "../../assets/shared-profile-banner.jpg");

async function createShareableProfileCard(ctx, lang) {
  const codeResult = await ensurePublicProfileCode(ctx.userId);
  if (!codeResult.ok) return ctx.reply(messages[lang].profileShareUnavailable);
  const user = codeResult.user || ctx.user;
  if (!hasCompletedMediaFavorites(user)) {
    return ctx.reply(messages[lang].profileShareNeedsCompletedFavorites);
  }
  const referral = await createReferralLink({
    inviterUserId: ctx.userId,
    profilePublicCode: codeResult.code,
    source: "profile_share",
  });
  if (!referral.ok) return ctx.reply(messages[lang].profileShareUnavailable);
  const link = buildBotStartLink(`ref_${referral.link.publicCode}`);
  if (!link) return ctx.reply(messages[lang].profileShareUnavailable);

  const caption = buildShareableProfileCaption({ user, lang, link });
  let shareCard;
  try {
    shareCard = await sendBannerPhoto(ctx, {
      bannerKey: "shared_profile_v1",
      localSource: SHARED_PROFILE_BANNER_PATH,
      configuredFileId: process.env.SHARED_PROFILE_BANNER_FILE_ID,
      extra: { caption },
    });
  } catch {
    shareCard = await ctx.reply(caption);
  }

  const guidance = await ctx.reply(
    buildProfileShareGuidance(lang, undefined, {
      showsFavorites: user?.showFavoritesOnProfile !== false,
    }),
    profileShareGuidanceKeyboard(lang),
  );
  await setNavigationMode(ctx, MODES.PROFILE);
  return { shareCard, guidance, link };
}

async function returnFromShareableProfile(ctx, lang, { sendOwnProfile } = {}) {
  const text = buildProfileText(ctx.user, lang, messages, { isOwnProfile: true });
  const keyboard = profileQuickActionsKeyboard(lang, {
    canShareProfile: hasCompletedMediaFavorites(ctx.user),
  });
  if (ctx.user?.photoFileId && ctx.editMessageMedia && ctx.callbackMessageId) {
    try {
      const edited = await ctx.editMessageMedia(
        ctx.callbackMessageId,
        { type: "photo", media: ctx.user.photoFileId, caption: text },
        keyboard,
      );
      if (edited) {
        await setNavigationMode(ctx, MODES.PROFILE);
        return edited;
      }
    } catch {}
  } else if (ctx.editMessageText && ctx.callbackMessageId) {
    try {
      const edited = await ctx.editMessageText(
        ctx.callbackMessageId,
        text,
        keyboard,
      );
      if (edited) {
        await setNavigationMode(ctx, MODES.PROFILE);
        return edited;
      }
    } catch {}
  }
  await setNavigationMode(ctx, MODES.PROFILE);
  if (ctx.deleteMessage && ctx.callbackMessageId) {
    try { await ctx.deleteMessage(ctx.callbackMessageId); } catch {}
  }
  if (typeof sendOwnProfile === "function") return sendOwnProfile(ctx, lang, ctx.user);
  return true;
}

module.exports = {
  SHARED_PROFILE_BANNER_PATH,
  createShareableProfileCard,
  returnFromShareableProfile,
};
