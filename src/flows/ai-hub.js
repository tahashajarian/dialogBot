const path = require("node:path");
const { aiAssistantKeyboard } = require("../keyboards");
const { buildAiAssistantMenuMessage } = require("../services/ai-list-ui");
const { sendBannerPhoto } = require("../services/banner-media");
const { MODES, setStableNavigationState } = require("../services/reply-keyboard-navigation");
const {
  hasSectionTipBeenShown,
  markSectionTipShownForContext,
} = require("../services/users");

const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
const FAVORITES_HUB_BANNER_PATH = path.join(__dirname, "../../assets/favorites-hub-banner.jpg");

async function sendAiAssistantHub(ctx, lang, { showFirstVisitTip = false } = {}) {
  await setStableNavigationState(ctx, MODES.FAVORITES);
  const text = buildAiAssistantMenuMessage(lang, { showFirstVisitTip, user: ctx.user });
  const keyboard = aiAssistantKeyboard(lang);
  const shouldShowBanner = !hasSectionTipBeenShown(ctx.user, "favoritesBanner");
  if (!shouldShowBanner || !ctx.replyWithPhoto || text.length > TELEGRAM_CAPTION_MAX_LENGTH) {
    return ctx.reply(text, keyboard);
  }
  try {
    const sent = await sendBannerPhoto(ctx, {
      bannerKey: "favorites_hub_v2",
      localSource: FAVORITES_HUB_BANNER_PATH,
      configuredFileId: process.env.FAVORITES_HUB_BANNER_FILE_ID,
      extra: { ...keyboard, caption: text },
    });
    await markSectionTipShownForContext(ctx, "favoritesBanner", new Date()).catch(() => null);
    return sent;
  } catch {
    return ctx.reply(text, keyboard);
  }
}

module.exports = {
  sendAiAssistantHub,
};
